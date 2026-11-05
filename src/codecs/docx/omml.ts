// SPDX-License-Identifier: MPL-2.0
// OMML <-> MathML mapping for Word equations (m:oMath/m:oMathPara).
// Covers the common OMML subset: runs, fractions, scripts, radicals, delimiters,
// n-ary operators, limits, accents, bars, matrices, and equation arrays.
// Unknown nodes degrade to their concatenated text so content is never lost.

import { XMLParser } from "fast-xml-parser";

const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

// ordered-node helpers matching the preserveOrder shape used by ooxml.ts
// ({tag: children[], ":@": {attrs}}; text nodes are {"#text": "..."})
type N = Record<string, any>;
const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
const tagOf = (el: N): string | undefined =>
  Object.keys(el).find((k) => k !== ":@");
const kidsOf = (el: N): N[] => {
  const tag = tagOf(el);
  return tag ? asArray(el[tag]) : [];
};
const attrOf = (el: N, name: string): string | undefined =>
  el[":@"]?.[`@_${name}`] as string | undefined;
const firstKid = (kids: N[], tag: string): N | undefined =>
  kids.find((c) => c && typeof c === "object" && c[tag] !== undefined);

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!node || typeof node !== "object") return "";
  const el = node as N;
  if (el["#text"] !== undefined) return String(el["#text"]);
  return kidsOf(el).map(textOf).join("");
}

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- OMML -> MathML --------------------------------------------------------

/** m:r run text -> mi/mn/mo by content shape. */
function classifyMathText(s: string): string {
  const t = escapeHtml(s);
  if (/^[\d.,]+$/.test(s.trim())) return `<mn>${t}</mn>`;
  if (/^[a-zA-Zα-ωΑ-Ω]+$/.test(s.trim())) return `<mi>${t}</mi>`;
  return `<mo>${t}</mo>`;
}

/** attr of a child property node, e.g. dPr -> begChr @val. */
function chrAttr(props: N | undefined, tag: string, fallback: string): string {
  const kid = props ? firstKid(kidsOf(props), tag) : undefined;
  return (kid && attrOf(kid, "val")) ?? fallback;
}

const kidsHtml = (el: N | undefined): string =>
  el ? kidsOf(el).map(nodeToMathml).join("") : "";
const mrow = (el: N | undefined): string => `<mrow>${kidsHtml(el)}</mrow>`;

function nodeToMathml(el: N): string {
  const tag = tagOf(el);
  if (!tag) return "";
  if (el["#text"] !== undefined) return escapeHtml(String(el["#text"]));
  const kids = kidsOf(el);

  switch (tag) {
    case "oMathPara":
    case "oMath":
      return kids.map(nodeToMathml).join("");

    case "r": {
      // math run: m:t children carry the text; m:rPr is styling we ignore
      const txt = kids
        .filter((k) => tagOf(k) === "t")
        .map(textOf)
        .join("");
      return classifyMathText(txt);
    }
    case "t":
      return escapeHtml(textOf(el));

    // pass-through argument containers
    case "e":
    case "num":
    case "den":
    case "deg":
    case "sub":
    case "sup":
    case "lim":
    case "fName":
    case "box":
    case "func":
      return kids.map(nodeToMathml).join("");

    case "f":
      return `<mfrac>${mrow(firstKid(kids, "num"))}${mrow(firstKid(kids, "den"))}</mfrac>`;

    case "sSup":
      return `<msup>${mrow(firstKid(kids, "e"))}${mrow(firstKid(kids, "sup"))}</msup>`;
    case "sSub":
      return `<msub>${mrow(firstKid(kids, "e"))}${mrow(firstKid(kids, "sub"))}</msub>`;
    case "sSubSup":
      return `<msubsup>${mrow(firstKid(kids, "e"))}${mrow(firstKid(kids, "sub"))}${mrow(firstKid(kids, "sup"))}</msubsup>`;

    case "rad": {
      const deg = firstKid(kids, "deg");
      const degText = deg ? textOf(deg).trim() : "";
      const base = mrow(firstKid(kids, "e"));
      return degText ? `<mroot>${base}<mrow>${kidsHtml(deg)}</mrow></mroot>` : `<msqrt>${base}</msqrt>`;
    }

    case "d": {
      const dPr = firstKid(kids, "dPr");
      const beg = chrAttr(dPr, "begChr", "(");
      const end = chrAttr(dPr, "endChr", ")");
      return `<mrow><mo>${escapeHtml(beg)}</mo>${kids.filter((k) => tagOf(k) === "e").map(nodeToMathml).join("")}<mo>${escapeHtml(end)}</mo></mrow>`;
    }

    case "nary": {
      const naryPr = firstKid(kids, "naryPr");
      const chr = chrAttr(naryPr, "chr", "∫");
      return (
        `<munderover><mo>${escapeHtml(chr)}</mo>${mrow(firstKid(kids, "sub"))}${mrow(firstKid(kids, "sup"))}</munderover>` +
        mrow(firstKid(kids, "e"))
      );
    }

    case "limLow":
      return `<munder>${mrow(firstKid(kids, "e"))}${mrow(firstKid(kids, "lim"))}</munder>`;
    case "limUpp":
      return `<mover>${mrow(firstKid(kids, "e"))}${mrow(firstKid(kids, "lim"))}</mover>`;

    case "m": {
      // matrix: rows are m:mr, cells are m:e
      const rows = kids
        .filter((k) => tagOf(k) === "mr")
        .map(
          (mr) =>
            `<mtr>${kidsOf(mr)
              .filter((c) => tagOf(c) === "e")
              .map((c) => `<mtd>${kidsHtml(c)}</mtd>`)
              .join("")}</mtr>`,
        )
        .join("");
      return `<mtable>${rows}</mtable>`;
    }
    case "eqArr": {
      const rows = kids
        .filter((k) => tagOf(k) === "e")
        .map((e) => `<mtr><mtd>${kidsHtml(e)}</mtd></mtr>`)
        .join("");
      return `<mtable>${rows}</mtable>`;
    }

    case "acc": {
      const accPr = firstKid(kids, "accPr");
      const chr = chrAttr(accPr, "chr", "̂");
      return `<mover>${mrow(firstKid(kids, "e"))}<mo>${escapeHtml(chr)}</mo></mover>`;
    }
    case "bar": {
      const barPr = firstKid(kids, "barPr");
      const pos = barPr ? attrOf(firstKid(kidsOf(barPr), "pos") ?? {}, "val") : undefined;
      const body = `${mrow(firstKid(kids, "e"))}<mo>¯</mo>`;
      return pos === "bot" ? `<munder>${body}</munder>` : `<mover>${body}</mover>`;
    }
    case "groupChr": {
      const gPr = firstKid(kids, "groupChrPr");
      const chr = chrAttr(gPr, "chr", "⏟");
      const body = `${mrow(firstKid(kids, "e"))}<mo>${escapeHtml(chr)}</mo>`;
      const pos = gPr ? attrOf(firstKid(kidsOf(gPr), "pos") ?? {}, "val") : undefined;
      return pos === "top" ? `<mover>${body}</mover>` : `<munder>${body}</munder>`;
    }

    default:
      // property nodes (rPr, ctrlPr, *Pr, brk, argPr ...) carry no content;
      // anything else degrades to its children (never loses text)
      if (tag.endsWith("Pr") || tag === "brk" || tag === "phantPr") return "";
      return kids.map(nodeToMathml).join("");
  }
}

/** Convert an m:oMath or m:oMathPara ordered node to a <math> html string. */
export function ommlToMathml(el: N): string {
  return `<math xmlns="${MATHML_NS}"><mrow>${nodeToMathml(el)}</mrow></math>`;
}

// ---- MathML -> OMML (docx export) ------------------------------------------

const orderedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  preserveOrder: true,
});

const mathRun = (text: string) =>
  `<m:r><m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>`;

const kidsOmml = (el: N | undefined): string =>
  el ? kidsOf(el).map(nodeToOmml).join("") : "";

function nodeToOmml(el: N): string {
  const tag = tagOf(el);
  if (!tag) return "";
  if (el["#text"] !== undefined) return mathRun(String(el["#text"]));
  const kids = kidsOf(el).filter(
    (k) => typeof k === "object" && k["#text"] === undefined,
  );

  switch (tag) {
    case "math":
    case "mrow":
    case "mstyle":
    case "mpadded":
    case "semantics":
      return kids.map(nodeToOmml).join("");

    case "mi":
    case "mn":
    case "mo":
    case "mtext":
    case "ms":
      return mathRun(textOf(el));
    case "mspace":
      return mathRun(" ");

    case "mfrac":
      return `<m:f><m:num>${nodeToOmml(kids[0] ?? {})}</m:num><m:den>${nodeToOmml(kids[1] ?? {})}</m:den></m:f>`;
    case "msup":
      return `<m:sSup><m:e>${nodeToOmml(kids[0] ?? {})}</m:e><m:sup>${nodeToOmml(kids[1] ?? {})}</m:sup></m:sSup>`;
    case "msub":
      return `<m:sSub><m:e>${nodeToOmml(kids[0] ?? {})}</m:e><m:sub>${nodeToOmml(kids[1] ?? {})}</m:sub></m:sSub>`;
    case "msubsup":
      return `<m:sSubSup><m:e>${nodeToOmml(kids[0] ?? {})}</m:e><m:sub>${nodeToOmml(kids[1] ?? {})}</m:sub><m:sup>${nodeToOmml(kids[2] ?? {})}</m:sup></m:sSubSup>`;
    case "msqrt":
      return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${kids.map(nodeToOmml).join("")}</m:e></m:rad>`;
    case "mroot":
      return `<m:rad><m:deg>${nodeToOmml(kids[1] ?? {})}</m:deg><m:e>${nodeToOmml(kids[0] ?? {})}</m:e></m:rad>`;

    case "munder":
      return `<m:limLow><m:e>${nodeToOmml(kids[0] ?? {})}</m:e><m:lim>${nodeToOmml(kids[1] ?? {})}</m:lim></m:limLow>`;
    case "mover":
      return `<m:limUpp><m:e>${nodeToOmml(kids[0] ?? {})}</m:e><m:lim>${nodeToOmml(kids[1] ?? {})}</m:lim></m:limUpp>`;
    case "munderover": {
      const chr = textOf(kids[0] ?? {}).trim() || "∫";
      return `<m:nary><m:naryPr><m:chr m:val="${escapeXml(chr)}"/></m:naryPr><m:sub>${nodeToOmml(kids[1] ?? {})}</m:sub><m:sup>${nodeToOmml(kids[2] ?? {})}</m:sup><m:e></m:e></m:nary>`;
    }

    case "mfenced": {
      const open = attrOf(el, "open") ?? "(";
      const close = attrOf(el, "close") ?? ")";
      return `<m:d><m:dPr><m:begChr m:val="${escapeXml(open)}"/><m:endChr m:val="${escapeXml(close)}"/></m:dPr><m:e>${kids.map(nodeToOmml).join("")}</m:e></m:d>`;
    }

    case "mtable":
      return `<m:m>${kids.map(nodeToOmml).join("")}</m:m>`;
    case "mtr":
    case "mlabeledtr":
      return `<m:mr>${kids.map(nodeToOmml).join("")}</m:mr>`;
    case "mtd":
      return `<m:e>${kids.map(nodeToOmml).join("")}</m:e>`;

    default:
      return kids.map(nodeToOmml).join("");
  }
}

/** Convert a <math> html fragment to an inline m:oMath element for w:p content. */
export function mathmlToOmml(mathml: string): string {
  const doc = orderedParser.parse(mathml) as N[];
  const mathEl = firstKid(doc, "math");
  if (!mathEl) return "";
  return `<m:oMath>${kidsOf(mathEl).map(nodeToOmml).join("")}</m:oMath>`;
}
