// SPDX-License-Identifier: MPL-2.0
// OOXML writer: canonical model -> .docx.
//
// Emits the authoring format described in the qcon guide so that output round-trips through interpret.ts and is editable in Word:
//   - Heading 1 library title
//   - questions = level-0 decimal list items
//   - answers  = level-1 lowerLetter items of the same list, "*" marks correct
//   - #section / /section markers around titled sections
//   - @feedback:, @hint:, Points: header lines as plain paragraphs

import JSZip from "jszip";
import type { Library, Question, Section } from "../../model/types.js";
import { mathmlToOmml } from "./omml.js";

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const stripHtml = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

const DATA_URI_IMG = /<img\b[^>]*?\bsrc="data:([^;,]+);base64,([^"]+)"[^>]*>/g;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

/** split html into paragraph-sized chunks (inner html, no <p> wrapper) */
function toParagraphs(html: string): string[] {
  const paras = html
    .split(/<\/p>\s*<p[^>]*>/i)
    .map((p) => p.replace(/^\s*<p[^>]*>/i, "").replace(/<\/p>\s*$/i, ""))
    .filter((p) => p.trim() !== "");
  return paras.length > 0 ? paras : [""];
}

interface PendingImage {
  rid: string;
  filename: string;
  mime: string;
  base64: string;
}

/** Decode image dimensions from base64-encoded PNG/JPEG/GIF data. */
function imageSize(base64: string, mime: string): { cx: number; cy: number } {
  const EMU_PER_PX = 914400 / 96; // 96 dpi
  const fallback = { cx: 2743200, cy: 1828800 }; // 3" x 2"
  try {
    const bin = atob(base64);
    if (mime === "image/png") {
      const w = (bin.charCodeAt(16) << 24) | (bin.charCodeAt(17) << 16) | (bin.charCodeAt(18) << 8) | bin.charCodeAt(19);
      const h = (bin.charCodeAt(20) << 24) | (bin.charCodeAt(21) << 16) | (bin.charCodeAt(22) << 8) | bin.charCodeAt(23);
      return { cx: w * EMU_PER_PX, cy: h * EMU_PER_PX };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i < bin.length) {
        if (bin.charCodeAt(i) !== 0xff) { i++; continue; }
        const marker = bin.charCodeAt(i + 1);
        if (marker >= 0xc0 && marker <= 0xc2) {
          const h = (bin.charCodeAt(i + 5) << 8) | bin.charCodeAt(i + 6);
          const w = (bin.charCodeAt(i + 7) << 8) | bin.charCodeAt(i + 8);
          return { cx: w * EMU_PER_PX, cy: h * EMU_PER_PX };
        }
        i += 2 + ((bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3));
      }
    }
    if (mime === "image/gif") {
      const w = bin.charCodeAt(6) | (bin.charCodeAt(7) << 8);
      const h = bin.charCodeAt(8) | (bin.charCodeAt(9) << 8);
      return { cx: w * EMU_PER_PX, cy: h * EMU_PER_PX };
    }
  } catch { /* fall through */ }
  return fallback;
}

/** Render inline html to <w:r> runs; images become drawing refs, <math> becomes m:oMath. */
function htmlToRuns(html: string, images: PendingImage[]): string {
  // tokenize on the tags we support; formatting tags recurse so nesting is preserved
  const re =
    /<(strong|b|em|i|sup|sub|u)>([\s\S]*?)<\/\1>|<math\b[^>]*>[\s\S]*?<\/math>|<img\b[^>]*?\bsrc="data:([^;,]+);base64,([^"]+)"[^>]*>|<br\s*\/?>|([^<]+)/gi;

  const PROP_BY_TAG: Record<string, string> = {
    strong: "<w:b/>",
    b: "<w:b/>",
    em: "<w:i/>",
    i: "<w:i/>",
    u: `<w:u w:val="single"/>`,
    sup: `<w:vertAlign w:val="superscript"/>`,
    sub: `<w:vertAlign w:val="subscript"/>`,
  };

  const walk = (frag: string, rPr: string): string => {
    // fresh regex per call: a failed exec resets lastIndex, which would corrupt the outer loop
    const local = new RegExp(re.source, re.flags);
    let out = "";
    let m: RegExpExecArray | null;
    while ((m = local.exec(frag)) !== null) {
      if (m[1]) {
        out += walk(m[2]!, rPr + (PROP_BY_TAG[m[1].toLowerCase()] ?? ""));
      } else if (m[0].toLowerCase().startsWith("<math")) {
        out += mathmlToOmml(m[0]);
      } else if (m[3]) {
        const ext = EXT_BY_MIME[m[3]!] ?? "png";
        const rid = `rIdImg${images.length + 1}`;
        images.push({
          rid,
          filename: `media/image${images.length + 1}.${ext}`,
          mime: m[3]!,
          base64: m[4]!,
        });
        const { cx, cy } = imageSize(m[4]!, m[3]!);
        out +=
          `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
          `<wp:extent cx="${Math.round(cx)}" cy="${Math.round(cy)}"/>` +
          `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
          `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
          `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
          `<pic:nvPicPr><pic:cNvPr id="0" name="image"/><pic:cNvPicPr/></pic:nvPicPr>` +
          `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
          `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>` +
          `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
          `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
      } else if (m[0].toLowerCase().startsWith("<br")) {
        out += `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:br/></w:r>`;
      } else if (m[5]) {
        const text = m[5]!
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");
        if (text !== "")
          out += `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
      }
    }
    return out;
  };

  return walk(html, "");
}

/** Split html into inline segments and <table> segments, in document order. */
function* splitBlocks(html: string): Generator<{ type: "p" | "tbl"; html: string }> {
  const re = /<table\b[\s\S]*?<\/table>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) yield { type: "p", html: html.slice(last, m.index) };
    yield { type: "tbl", html: m[0] };
    last = m.index + m[0].length;
  }
  if (last < html.length) yield { type: "p", html: html.slice(last) };
}

/** Render a <table> html fragment to w:tbl with simple single-line borders. */
function tblXml(html: string, images: PendingImage[]): string {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const body = rows
    .map((r) => {
      const cells = [...r[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
      const tcs = cells
        .map((c) => {
          // cell paragraphs separate with a line break inside the cell paragraph
          const inner = c[1]!
            .replace(/<\/p>\s*<p[^>]*>/gi, "<br>")
            .replace(/<\/?p[^>]*>/gi, "");
          return `<w:tc><w:p>${htmlToRuns(inner, images)}</w:p></w:tc>`;
        })
        .join("");
      return `<w:tr>${tcs}</w:tr>`;
    })
    .join("");
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>` +
    `<w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/>` +
    `<w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/>` +
    `<w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders>` +
    `</w:tblPr>${body}</w:tbl>`
  );
}

interface PProps {
  style?: string;
  ilvl?: number;
  numId?: number;
}

function para(html: string, images: PendingImage[], props: PProps = {}): string {
  let pPr = "";
  if (props.style || props.numId !== undefined) {
    pPr =
      "<w:pPr>" +
      (props.style ? `<w:pStyle w:val="${props.style}"/>` : "") +
      (props.numId !== undefined
        ? `<w:numPr><w:ilvl w:val="${props.ilvl ?? 0}"/><w:numId w:val="${props.numId}"/></w:numPr>`
        : "") +
      "</w:pPr>";
  }
  return `<w:p>${pPr}${htmlToRuns(html, images)}</w:p>`;
}

const NUM_ID = 1;

function writeQuestion(q: Question, images: PendingImage[]): string {
  let out = "";
  // header params precede the numbered item (guide format)
  if (q.title) out += para(`Title: ${escapeXml(q.title)}`, images);
  if (q.points !== undefined && q.points !== 1) out += para(`Points: ${q.points}`, images);
  if ((q.kind === "MC" || q.kind === "MS") && q.randomize !== undefined)
    out += para(`Randomize: ${q.randomize ? "yes" : "no"}`, images);

  if (q.kind === "FIB") {
    // blanks are inline markers in the numbered question paragraph; text parts are mid-sentence fragments, so drop their <p> wrappers
    const joined = q.parts
      .map((p) =>
        p.part === "text"
          ? p.html.replace(/<\/?p[^>]*>/gi, "")
          : `[${p.answers.join(", ")}]`,
      )
      .join("");
    out += para(joined, images, { numId: NUM_ID, ilvl: 0 });
  } else {
    // question text may interleave paragraphs and tables; only the first paragraph is numbered
    let numbered = false;
    for (const seg of splitBlocks(q.text)) {
      if (seg.type === "tbl") {
        out += tblXml(seg.html, images);
        continue;
      }
      for (const p of toParagraphs(seg.html)) {
        out += para(p, images, numbered ? {} : { numId: NUM_ID, ilvl: 0 });
        numbered = true;
      }
    }
    if (!numbered) out += para("", images, { numId: NUM_ID, ilvl: 0 });
  }

  if (q.hint) out += para(`@hint: ${stripHtml(q.hint)}`, images);
  if (q.feedback) out += para(`@feedback: ${stripHtml(q.feedback)}`, images);

  switch (q.kind) {
    case "MC":
      for (const a of q.answers) {
        out += para((a.weight === 100 ? "*" : "") + stripHtml(a.html), images, {
          numId: NUM_ID,
          ilvl: 1,
        });
        if (a.feedback) out += para(`@feedback: ${stripHtml(a.feedback)}`, images);
      }
      break;
    case "MS":
      for (const a of q.answers) {
        out += para((a.isCorrect ? "*" : "") + stripHtml(a.html), images, {
          numId: NUM_ID,
          ilvl: 1,
        });
        if (a.feedback) out += para(`@feedback: ${stripHtml(a.feedback)}`, images);
      }
      break;
    case "TF":
      out += para(q.trueWeight === 100 ? "*True" : "True", images, {
        numId: NUM_ID,
        ilvl: 1,
      });
      if (q.trueFeedback) out += para(`@feedback: ${stripHtml(q.trueFeedback)}`, images);
      out += para(q.falseWeight === 100 ? "*False" : "False", images, {
        numId: NUM_ID,
        ilvl: 1,
      });
      if (q.falseFeedback) out += para(`@feedback: ${stripHtml(q.falseFeedback)}`, images);
      break;
    case "FIB":
      // nothing more: the numbered paragraph already carries [blank] markers
      break;
    case "MAT":
      for (const pair of q.pairs) {
        out += para(`${stripHtml(pair.premise)} = ${stripHtml(pair.response)}`, images, {
          numId: NUM_ID,
          ilvl: 1,
        });
      }
      break;
    case "ORD":
      for (const item of q.items) {
        out += para(stripHtml(item.html), images, { numId: NUM_ID, ilvl: 1 });
        if (item.feedback) out += para(`@feedback: ${stripHtml(item.feedback)}`, images);
      }
      break;
    case "WR":
      if (q.answerKey) out += para(`Correct Answer: ${stripHtml(q.answerKey)}`, images);
      break;
  }
  return out;
}

function writeSection(section: Section, images: PendingImage[]): string {
  let out = "";
  const titled = section.title !== "";
  if (titled) out += para("#section", images) + para(section.title, images);
  if (section.text) {
    for (const seg of splitBlocks(section.text)) {
      if (seg.type === "tbl") out += tblXml(seg.html, images);
      else for (const p of toParagraphs(seg.html)) out += para(p, images);
    }
  }
  for (const q of section.questions) out += writeQuestion(q, images);
  if (titled) out += para("/section", images);
  return out;
}

function documentXml(library: Library, images: PendingImage[]): string {
  const body =
    para(escapeXml(library.title), images, { style: "Heading1" }) +
    library.sections.map((s) => writeSection(s, images)).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">` +
    `<w:body>${body}<w:sectPr/></w:body></w:document>`
  );
}

const NUMBERING_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>` +
  `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>` +
  `<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>` +
  `<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/>` +
  `<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>` +
  `</w:abstractNum><w:num w:numId="${NUM_ID}"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>` +
  `<w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
  `<w:pPr><w:outlineLvl w:val="0"/></w:pPr>` +
  `<w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>` +
  `</w:styles>`;

function contentTypesXml(images: PendingImage[]): string {
  const exts = [...new Set(images.map((i) => i.filename.split(".").pop()!))];
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    exts
      .map((ext) => {
        const mime =
          Object.entries(EXT_BY_MIME).find(([, e]) => e === ext)?.[0] ?? "image/png";
        return `<Default Extension="${ext}" ContentType="${mime}"/>`;
      })
      .join("") +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`
  );
}

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

function documentRelsXml(images: PendingImage[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    images
      .map(
        (i) =>
          `<Relationship Id="${i.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${i.filename}"/>`,
      )
      .join("") +
    `</Relationships>`
  );
}

/** Write the model to a .docx (Uint8Array; caller decides how to save it). */
export async function writeDocx(library: Library): Promise<Uint8Array> {
  const images: PendingImage[] = [];
  const body = documentXml(library, images);

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml(images));
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/document.xml", body);
  zip.file("word/numbering.xml", NUMBERING_XML);
  zip.file("word/styles.xml", STYLES_XML);
  zip.file("word/_rels/document.xml.rels", documentRelsXml(images));
  for (const img of images) {
    zip.file(`word/${img.filename}`, img.base64, { base64: true });
  }
  return zip.generateAsync({ type: "uint8array" });
}
