// SPDX-License-Identifier: MPL-2.0
// Direct OOXML reader: .docx zip -> block IR.
//
// Unlike the legacy Pandoc path, list numbers/letters come from word/numbering.xml (ground truth), so Word-native numbered and lettered lists need no fuzzy renumbering pass.
// Output is a flat block list consumed by interpret.ts.

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { ommlToMathml } from "./omml.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  // Word splits runs mid-sentence (spellcheck boundaries etc.) and stores leading/trailing spaces in w:t with xml:space="preserve" - trimming them would glue words together
  trimValues: false,
});

// document.xml needs child order preserved: object mode groups same-named siblings, which scrambles
// paragraphs mixing tracked changes, hyperlinks, or other non-run elements between runs.
// Ordered nodes are {tag: children[], ":@": {attrs}}; text nodes are {"#text": "..."}.
const orderedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  preserveOrder: true,
});

type N = Record<string, any>;
const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

export type NumFmt =
  | "decimal"
  | "lowerLetter"
  | "upperLetter"
  | "bullet"
  | "other";

export interface Block {
  type: "paragraph" | "table";
  /** Word style name, e.g. "Heading1", "ListParagraph" */
  style?: string;
  numbering?: {
    fmt: NumFmt;
    level: number;
    /** resolved 1-based value of this item within its list */
    value: number;
    /** numbering instance id, incl. style-inherited; distinguishes sublists from the question list */
    numId: string;
  };
  /** inline content rendered as html */
  html: string;
}

interface NumberingLevel {
  fmt: NumFmt;
  start: number;
}

interface NumberingTables {
  /** numId -> ilvl -> level def */
  levels: Map<string, Map<number, NumberingLevel>>;
}

function parseNumbering(numberingXml: string | undefined): NumberingTables {
  const tables: NumberingTables = { levels: new Map() };
  if (!numberingXml) return tables;
  const doc = parser.parse(numberingXml) as N;

  const abstractDefs = new Map<string, Map<number, NumberingLevel>>();
  for (const abs of asArray(doc.numbering?.abstractNum as N[])) {
    const absId = abs["@_abstractNumId"] as string;
    const lvls = new Map<number, NumberingLevel>();
    for (const lvl of asArray(abs.lvl as N[])) {
      const ilvl = parseInt(lvl["@_ilvl"] ?? "0", 10);
      const fmtRaw = lvl.numFmt?.["@_val"] ?? "decimal";
      const fmt: NumFmt = ["decimal", "lowerLetter", "upperLetter", "bullet"].includes(
        fmtRaw,
      )
        ? (fmtRaw as NumFmt)
        : "other";
      const start = parseInt(lvl.start?.["@_val"] ?? "1", 10);
      lvls.set(ilvl, { fmt, start });
    }
    abstractDefs.set(absId, lvls);
  }

  for (const num of asArray(doc.numbering?.num as N[])) {
    const numId = num["@_numId"] as string;
    const absId = num.abstractNumId?.["@_val"] as string;
    const def = abstractDefs.get(absId);
    if (def) tables.levels.set(numId, def);
  }
  return tables;
}

/** Map paragraph styleId -> numbering carried by the style itself (pPr/numPr), resolving basedOn chains. */
function parseStyleNumbering(
  stylesXml: string | undefined,
): Map<string, { numId: string; ilvl?: number }> {
  const result = new Map<string, { numId: string; ilvl?: number }>();
  if (!stylesXml) return result;
  const doc = parser.parse(stylesXml) as N;
  const byId = new Map<string, N>();
  for (const s of asArray(doc.styles?.style as N[])) {
    const id = s["@_styleId"] as string | undefined;
    if (id) byId.set(id, s);
  }
  const resolve = (
    id: string,
    seen: Set<string>,
  ): { numId: string; ilvl?: number } | undefined => {
    const s = byId.get(id);
    if (!s || seen.has(id)) return undefined;
    seen.add(id);
    const numId = s.pPr?.numPr?.numId?.["@_val"] as string | undefined;
    if (numId !== undefined) {
      const ilvl = s.pPr?.numPr?.ilvl?.["@_val"];
      return { numId, ilvl: ilvl === undefined ? undefined : parseInt(ilvl, 10) };
    }
    const base = s.basedOn?.["@_val"] as string | undefined;
    return base ? resolve(base, seen) : undefined;
  };
  for (const id of byId.keys()) {
    const n = resolve(id, new Set());
    if (n) result.set(id, n);
  }
  return result;
}

function parseRels(relsXml: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!relsXml) return map;
  const doc = parser.parse(relsXml) as N;
  for (const rel of asArray(doc.Relationships?.Relationship as N[])) {
    map.set(rel["@_Id"], rel["@_Target"]);
  }
  return map;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// tracked-change elements (names after removeNSPrefix): insertions, deletions, moves, formatting changes
const REVISION_KEYS = new Set([
  "ins", "del", "delText", "moveFrom", "moveTo",
  "moveFromRangeStart", "moveFromRangeEnd", "moveToRangeStart", "moveToRangeEnd",
  "rPrChange", "pPrChange", "numberingChange", "cellIns", "cellDel", "cellMerge",
]);
const COMMENT_KEYS = new Set(["commentRangeStart", "commentRangeEnd", "commentReference"]);

// tracked-change elements whose CONTENT is skipped (reject-all: reviewer insertions and moved-to copies are dropped; deletions stay)
const REJECTED_REVISIONS = new Set(["ins", "moveTo", "moveToRangeStart", "moveToRangeEnd"]);

function hasKey(node: unknown, keys: Set<string>): boolean {
  if (Array.isArray(node)) return node.some((n) => hasKey(n, keys));
  if (!node || typeof node !== "object") return false;
  return Object.entries(node as N).some(([k, v]) => keys.has(k) || hasKey(v, keys));
}

/** Concatenate all text inside an ordered node (any element subtree). */
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!node || typeof node !== "object") return "";
  const el = node as N;
  if (el["#text"] !== undefined) return String(el["#text"]);
  return kidsOf(el).map(textOf).join("");
}

/** Collect the text of every element with the given tag, in document order. */
function collectTagText(kids: N[], tag: string, out: string[]) {
  for (const el of kids) {
    if (!el || typeof el !== "object" || el["#text"] !== undefined) continue;
    if (el[tag] !== undefined) out.push(textOf(el[tag]).trim());
    else collectTagText(kidsOf(el), tag, out);
  }
}

/** Resolve a relationship id to an <img> tag (data URI) if it targets media. */
function imgTag(
  rid: string,
  rels: Map<string, string>,
  media: Map<string, string>,
  badImages?: Set<string>,
): string {
  const target = rels.get(rid) ?? "";
  const ext = target.split(".").pop()?.toLowerCase() ?? "";
  // legacy qcon flags EMF explicitly: browsers and the LMS can't render it (same for WMF).
  // Record it and emit nothing rather than a data URI that renders as a broken image.
  if (ext === "emf" || ext === "wmf") {
    badImages?.add(target.split("/").pop() ?? target);
    return "";
  }
  const dataUri = media.get(target);
  return dataUri ? `<img src="${dataUri}">` : "";
}

// ordered-node helpers (preserveOrder shape: {tag: children[], ":@": {attrs}})
const tagOf = (el: N): string | undefined =>
  Object.keys(el).find((k) => k !== ":@");
const kidsOf = (el: N): N[] => {
  const tag = tagOf(el);
  return tag ? (asArray(el[tag]) as N[]) : [];
};
const attrOf = (el: N, name: string): string | undefined =>
  el[":@"]?.[`@_${name}`] as string | undefined;
const firstKid = (kids: N[], tag: string): N | undefined =>
  kids.find((c) => c && typeof c === "object" && c[tag] !== undefined);

/**
 * Render one paragraph to html (bold/italic/images/links), preserving child order.
 * Fully recursive: handles runs nested in w:sdt, mc:AlternateContent, hyperlinks, and both drawing images (a:blip @embed) and legacy VML images (v:imagedata @id).
 * Tracked insertions (w:ins, w:moveTo) are excluded so imports match the original text before review.
 */
function runsToHtml(
  p: N,
  rels: Map<string, string>,
  media: Map<string, string>,
  badImages?: Set<string>,
): string {
  const walk = (node: unknown): string => {
    if (Array.isArray(node)) return node.map(walk).join("");
    if (!node || typeof node !== "object") return "";
    const el = node as N;
    if (el["#text"] !== undefined) return escapeHtml(String(el["#text"]));

    const tag = tagOf(el);
    if (!tag) return "";
    const kids = kidsOf(el);

    // not content: tracked insertions/moved-to copies, move range markers, field codes
    if (REJECTED_REVISIONS.has(tag) || tag === "instrText") return "";
    if (tag === "pPr" || tag === "rPr") return "";
    if (tag === "br") return "<br>";

    // Word equations -> MathML (legacy pipeline gets this via pandoc)
    if (tag === "oMath" || tag === "oMathPara") return ommlToMathml(el);

    // a:blip (drawing image) and v:imagedata (VML image) reference media via relationships
    if (tag === "blip")
      return imgTag(String(attrOf(el, "embed") ?? ""), rels, media, badImages);
    if (tag === "imagedata")
      return imgTag(String(attrOf(el, "id") ?? ""), rels, media, badImages);

    if (tag === "hyperlink") {
      const rid = attrOf(el, "id");
      const href = rid ? rels.get(rid) : undefined;
      const inner = walk(kids);
      return href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
    }

    // text run: apply bold/italic/sup-sub, then children in document order
    if (tag === "r") {
      const rPr = firstKid(kids, "rPr");
      const rPrKids = rPr ? kidsOf(rPr) : [];
      let inner = walk(kids);
      if (firstKid(rPrKids, "b")) inner = `<strong>${inner}</strong>`;
      if (firstKid(rPrKids, "i")) inner = `<em>${inner}</em>`;
      const va = firstKid(rPrKids, "vertAlign");
      const v = va ? attrOf(va, "val") : undefined;
      if (v === "superscript") inner = `<sup>${inner}</sup>`;
      else if (v === "subscript") inner = `<sub>${inner}</sub>`;
      return inner;
    }

    // container element (del, moveFrom, sdt, t, delText, …): recurse children
    return walk(kids);
  };

  return walk(p);
}

// tables carry their own inline styling: the LMS renders the question html bare,
// so stylesheet rules in the preview wouldn't apply there
const TABLE_STYLE = ` border="1" style="border-collapse:collapse"`;
const CELL_STYLE = ` style="border:1px solid #999;padding:2px 8px"`;

/** Render a w:tbl to an html <table>; cell paragraphs join with <br>, nested tables recurse. */
function tblToHtml(
  tbl: N[],
  rels: Map<string, string>,
  media: Map<string, string>,
  badImages?: Set<string>,
): string {
  // w:tblLook marks a header first row
  const tblPr = firstKid(tbl, "tblPr");
  const look = tblPr ? firstKid(kidsOf(tblPr), "tblLook") : undefined;
  const headerRow = look ? /^(1|true|on)$/i.test(attrOf(look, "firstRow") ?? "") : false;
  let rows = "";
  let ri = 0;
  for (const row of tbl) {
    if (row.tr === undefined) continue;
    const cellTag = headerRow && ri++ === 0 ? "th" : "td";
    let cells = "";
    for (const cell of kidsOf(row)) {
      if (cell.tc === undefined) continue;
      const inner = kidsOf(cell)
        .map((c) => {
          if (c.p !== undefined) return runsToHtml(c, rels, media, badImages);
          if (c.tbl !== undefined) return tblToHtml(kidsOf(c), rels, media, badImages);
          return "";
        })
        .filter(Boolean)
        .join("<br>");
      cells += `<${cellTag}${CELL_STYLE}>${inner}</${cellTag}>`;
    }
    rows += `<tr>${cells}</tr>`;
  }
  return `<table${TABLE_STYLE}>${rows}</table>`;
}

const MEDIA_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  emf: "image/emf",
  wmf: "image/wmf",
};

export interface DocxBlocks {
  blocks: Block[];
  /** unresolved reviewer markup found in the document */
  trackedChanges: boolean;
  comments: boolean;
  /** plain text of each tracked insertion/deletion and each comment, in document order */
  insertedText: string[];
  deletedText: string[];
  commentTexts: string[];
  /** filenames of referenced EMF/WMF media (unrenderable in browsers) */
  badImages: string[];
}

/** Read a .docx into the flat block IR. */
export async function readDocxBlocks(data: Uint8Array | ArrayBuffer): Promise<DocxBlocks> {
  const zip = await JSZip.loadAsync(data);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("Not a .docx file: word/document.xml missing");

  const numbering = await zip.file("word/numbering.xml")?.async("string");
  const stylesXml = await zip.file("word/styles.xml")?.async("string");
  const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
  const tables = parseNumbering(numbering);
  const styleNums = parseStyleNumbering(stylesXml);
  const rels = parseRels(relsXml);

  // media files -> data URIs
  const media = new Map<string, string>();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (!path.startsWith("word/media/") || entry.dir) continue;
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const mime = MEDIA_MIME[ext];
    if (!mime) continue;
    const base64 = await entry.async("base64");
    media.set(`media/${path.split("/").pop()}`, `data:${mime};base64,${base64}`);
  }

  const doc = orderedParser.parse(await documentFile.async("string")) as N[];
  const body = firstKid(doc, "document");
  const bodyKids = body ? kidsOf(body) : [];

  // collect blocks recursively so content in sdt blocks and text boxes is not dropped.
  // w:tbl becomes a single table block instead of flattening cell paragraphs (pandoc parity).
  const blockEls: N[] = [];
  const collectBlocks = (kids: N[]) => {
    for (const el of kids) {
      if (!el || typeof el !== "object") continue;
      if (el.p !== undefined || el.tbl !== undefined) blockEls.push(el);
      else if (el["#text"] === undefined) collectBlocks(kidsOf(el));
    }
  };
  collectBlocks(bodyKids);

  const trackedChanges = hasKey(bodyKids, REVISION_KEYS);
  const insertedText: string[] = [];
  const deletedText: string[] = [];
  collectTagText(bodyKids, "ins", insertedText);
  collectTagText(bodyKids, "del", deletedText);

  // comment bodies live in word/comments.xml; commentRangeStart in the body only marks the anchor
  const commentTexts: string[] = [];
  const commentsXml = await zip.file("word/comments.xml")?.async("string");
  if (commentsXml) {
    const cdoc = orderedParser.parse(commentsXml) as N[];
    const root = firstKid(cdoc, "comments");
    for (const c of root ? kidsOf(root) : []) {
      if (c.comment === undefined) continue;
      const author = attrOf(c, "author");
      const text = textOf(c.comment).trim();
      if (text) commentTexts.push(author ? `${author}: "${text}"` : `"${text}"`);
    }
  }
  const comments = hasKey(bodyKids, COMMENT_KEYS) || commentTexts.length > 0;

  // running counters per numId/ilvl for resolved list values
  const counters = new Map<string, number>();
  const badImages = new Set<string>();

  const blocks: Block[] = [];
  for (const p of blockEls) {
    if (p.tbl !== undefined) {
      const tableHtml = tblToHtml(kidsOf(p), rels, media, badImages);
      if (tableHtml.includes("<tr"))
        blocks.push({ type: "table", html: tableHtml });
      continue;
    }
    const pKids = kidsOf(p);
    const pPr = firstKid(pKids, "pPr");
    const pPrKids = pPr ? kidsOf(pPr) : [];
    const pStyle = firstKid(pPrKids, "pStyle");
    const style = pStyle ? attrOf(pStyle, "val") : undefined;
    const html = runsToHtml(p, rels, media, badImages);

    let numbering: Block["numbering"];
    const numPr = firstKid(pPrKids, "numPr");
    const numPrKids = numPr ? kidsOf(numPr) : [];
    const numIdEl = firstKid(numPrKids, "numId");
    const ilvlEl = firstKid(numPrKids, "ilvl");
    let numId = numIdEl ? attrOf(numIdEl, "val") : undefined;
    let ilvl = parseInt((ilvlEl ? attrOf(ilvlEl, "val") : undefined) ?? "0", 10);
    // no explicit numId: numbering may come from the paragraph style (e.g. List Paragraph)
    if (numId === undefined && style) {
      const sn = styleNums.get(style);
      if (sn) {
        numId = sn.numId;
        if (!ilvlEl && sn.ilvl !== undefined) ilvl = sn.ilvl;
      }
    }
    // numId 0 means "no numbering" (suppresses style-inherited lists); an
    // unresolved numId renders unnumbered in Word, so require a level def
    if (numId !== undefined && numId !== "0") {
      const def = tables.levels.get(numId)?.get(ilvl);
      if (def) {
        const key = `${numId}:${ilvl}`;
        const count = (counters.get(key) ?? 0) + 1;
        counters.set(key, count);
        // deeper levels restart when a shallower item appears
        for (const k of [...counters.keys()]) {
          const [kNum, kLvl] = k.split(":");
          if (kNum === numId && parseInt(kLvl!, 10) > ilvl) counters.delete(k);
        }
        numbering = { fmt: def.fmt, level: ilvl, value: def.start + count - 1, numId };
      }
    }

    if (html.trim() === "" && !numbering) continue; // skip empty paragraphs
    blocks.push({ type: "paragraph", style, numbering, html });
  }
  return {
    blocks,
    trackedChanges,
    comments,
    insertedText: insertedText.filter(Boolean),
    deletedText: deletedText.filter(Boolean),
    commentTexts,
    badImages: [...badImages],
  };
}
