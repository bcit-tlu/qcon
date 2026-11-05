// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { readDocx } from "./interpret.js";

const NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function p(opts: { style?: string; numId?: number; ilvl?: number }, text: string): string {
  const pPr =
    opts.style || opts.numId
      ? `<w:pPr>${
          opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ""
        }${
          opts.numId
            ? `<w:numPr><w:ilvl w:val="${opts.ilvl ?? 0}"/><w:numId w:val="${opts.numId}"/></w:numPr>`
            : ""
        }</w:pPr>`
      : "";
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

const NUMBERING_XML = `<?xml version="1.0"?>
<w:numbering xmlns:w="${NS}">
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="2">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`;

const M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";

async function makeDocx(
  bodyParagraphs: string,
  extra: { rels?: string; media?: Record<string, string> } = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="${NS}" xmlns:m="${M_NS}"><w:body>${bodyParagraphs}</w:body></w:document>`,
  );
  zip.file("word/numbering.xml", NUMBERING_XML);
  if (extra.rels) zip.file("word/_rels/document.xml.rels", extra.rels);
  for (const [name, content] of Object.entries(extra.media ?? {}))
    zip.file(`word/media/${name}`, content);
  return zip.generateAsync({ type: "uint8array" });
}

const SAMPLE_BODY = [
  p({ style: "Heading1" }, "Midterm Exam"),
  p({ numId: 1 }, "What is 2 + 2?"),
  p({ numId: 2 }, "3"),
  p({ numId: 2 }, "*4"),
  p({ numId: 2 }, "5"),
  p({ numId: 1 }, "The sky is blue."),
  p({ numId: 2 }, "*True"),
  p({ numId: 2 }, "False"),
  p({ numId: 1 }, "The capital of France is [Paris, paris]."),
].join("");

describe("docx reader", () => {
  it("reads title, questions, and detects types", async () => {
    const lib = await readDocx(await makeDocx(SAMPLE_BODY));
    expect(lib.title).toBe("Midterm Exam");
    const questions = lib.sections.flatMap((s) => s.questions);
    expect(questions).toHaveLength(3);
    expect(questions.map((q) => q.kind)).toEqual(["MC", "TF", "FIB"]);
  });

  it("marks the starred MC answer correct", async () => {
    const lib = await readDocx(await makeDocx(SAMPLE_BODY));
    const mc = lib.sections[0]!.questions[0]!;
    if (mc.kind !== "MC") throw new Error("expected MC");
    expect(mc.answers.map((a) => a.weight)).toEqual([0, 100, 0]);
  });

  it("splits FIB text into parts with acceptable answers", async () => {
    const lib = await readDocx(await makeDocx(SAMPLE_BODY));
    const fib = lib.sections[0]!.questions[2]!;
    if (fib.kind !== "FIB") throw new Error("expected FIB");
    expect(fib.parts.map((p) => p.part)).toEqual(["text", "blank", "text"]);
    const blank = fib.parts[1]!;
    if (blank.part !== "blank") throw new Error("expected blank");
    expect(blank.answers).toEqual(["Paris", "paris"]);
  });

  it("applies an end-answer key positionally", async () => {
    const body = [
      p({ style: "Heading1" }, "Quiz"),
      p({ numId: 1 }, "2 + 2 = ?"),
      p({ numId: 2 }, "3"),
      p({ numId: 2 }, "4"),
      p({ numId: 1 }, "Water is wet."),
      p({ numId: 2 }, "True"),
      p({ numId: 2 }, "False"),
      p({}, "Answers:"),
      p({ numId: 1 }, "b"),
      p({ numId: 1 }, "a"),
    ].join("");
    const lib = await readDocx(await makeDocx(body));
    const [mc, tf] = lib.sections[0]!.questions;
    if (mc!.kind !== "MC" || tf!.kind !== "TF") throw new Error("wrong kinds");
    expect(mc!.answers[1]!.weight).toBe(100);
    expect(tf!.trueWeight).toBe(100);
  });

  it("parses header param aliases and tri-state randomize values", async () => {
    const body = [
      p({ style: "Heading1" }, "Quiz"),
      p({}, "Point: 5"),
      p({}, "Random: true"),
      p({ numId: 1 }, "Q one?"),
      p({ numId: 2 }, "*a"),
      p({ numId: 2 }, "b"),
      p({}, "Points: 2"),
      p({}, "Randomize: false"),
      p({ numId: 1 }, "Q two?"),
      p({ numId: 2 }, "*a"),
      p({ numId: 2 }, "b"),
      p({}, "Randomize: banana"),
      p({ numId: 1 }, "Q three?"),
      p({ numId: 2 }, "*a"),
      p({ numId: 2 }, "b"),
    ].join("");
    const lib = await readDocx(await makeDocx(body));
    const [q1, q2, q3] = lib.sections[0]!.questions;
    if (q1!.kind !== "MC" || q2!.kind !== "MC" || q3!.kind !== "MC")
      throw new Error("expected MC");
    expect(q1!.points).toBe(5);
    expect(q1!.randomize).toBe(true);
    expect(q2!.points).toBe(2);
    expect(q2!.randomize).toBe(false);
    expect(q3!.randomize).toBeUndefined();
  });

  it("warns on tracked changes and comments, and excludes inserted text", async () => {
    const tracked = `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
      `<w:r><w:t xml:space="preserve">Keep </w:t></w:r>` +
      `<w:ins><w:r><w:t xml:space="preserve">inserted</w:t></w:r></w:ins>` +
      `<w:del><w:r><w:delText xml:space="preserve"> deleted</w:delText></w:r></w:del>` +
      `<w:commentRangeStart w:id="0"/></w:p>`;
    const body = [
      p({ style: "Heading1" }, "Quiz"),
      tracked,
      p({ numId: 2 }, "*yes"),
      p({ numId: 2 }, "no"),
    ].join("");
    const lib = await readDocx(await makeDocx(body));
    expect(lib.importWarnings).toBeDefined();
    const trackedWarn = lib.importWarnings!.find((w) => w.html.includes("Track Changes"));
    const commentsWarn = lib.importWarnings!.find((w) => w.html.includes("comments"));
    expect(trackedWarn).toBeDefined();
    expect(commentsWarn).toBeDefined();
    expect(trackedWarn!.details).toContain('Inserted: "inserted"');
    expect(trackedWarn!.details).toContain('Deleted: "deleted"');
    const q = lib.sections[0]!.questions[0]!;
    if (q.kind !== "MC") throw new Error("expected MC");
    expect(q.text).not.toContain("inserted");
    expect(q.text).toContain("deleted");
  });

  it("parses typed 1./a. markers without Word list numbering", async () => {
    const body = [
      p({ style: "Heading1" }, "Typed Quiz"),
      p({}, "1. What is 2 + 2?"),
      p({}, "a. 3"),
      p({}, "b. *4"),
      p({}, "c. 5"),
      p({}, "2) The sky is blue."),
      p({}, "*a) True"),
      p({}, "b) False"),
    ].join("");
    const lib = await readDocx(await makeDocx(body));
    const questions = lib.sections.flatMap((s) => s.questions);
    expect(questions.map((q) => q.kind)).toEqual(["MC", "TF"]);

    const mc = questions[0]!;
    if (mc.kind !== "MC") throw new Error("expected MC");
    expect(mc.answers.map((a) => a.weight)).toEqual([0, 100, 0]);
    // the typed marker is stripped from the question text
    expect(mc.text).not.toContain("1.");
    expect(mc.text).toContain("What is 2 + 2?");

    const tf = questions[1]!;
    if (tf.kind !== "TF") throw new Error("expected TF");
    expect(tf.trueWeight).toBe(100);
  });

  it("does not treat prose starting with digits or letters as markers", async () => {
    const body = [
      p({ style: "Heading1" }, "Quiz"),
      p({ numId: 1 }, "Explain pi."),
      p({ numId: 1 }, "What about e?"),
      p({}, "3.14159 is not a question."),
    ].join("");
    const lib = await readDocx(await makeDocx(body));
    const questions = lib.sections.flatMap((s) => s.questions);
    // "3.14159" has no whitespace after the delimiter so it stays question text
    expect(questions).toHaveLength(2);
    expect(questions[1]!.text).toContain("3.14159");
  });

  it("applies a typed-number end-answer key", async () => {
    const body = [
      p({ style: "Heading1" }, "Quiz"),
      p({}, "1. 2 + 2 = ?"),
      p({}, "a. 3"),
      p({}, "b. 4"),
      p({}, "Answers:"),
      p({}, "1. b"),
    ].join("");
    const lib = await readDocx(await makeDocx(body));
    const mc = lib.sections.flatMap((s) => s.questions)[0]!;
    if (mc.kind !== "MC") throw new Error("expected MC");
    expect(mc.answers.map((a) => a.weight)).toEqual([0, 100]);
  });

  it("converts OMML equations to MathML", async () => {
    const math =
      `<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num>` +
      `<m:den><m:r><m:t>2</m:t></m:r></m:den></m:f>` +
      `<m:r><m:t>+</m:t></m:r>` +
      `<m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>`;
    const body = [
      p({ style: "Heading1" }, "Math Quiz"),
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
        `<w:r><w:t xml:space="preserve">Solve </w:t></w:r>${math}<w:r><w:t xml:space="preserve"> for x</w:t></w:r></w:p>`,
      p({ numId: 2 }, "*yes"),
      p({ numId: 2 }, "no"),
    ].join("");
    const lib = await readDocx(await makeDocx(body));
    const q = lib.sections[0]!.questions[0]!;
    expect(q.text).toContain("<math");
    expect(q.text).toContain("<mfrac>");
    expect(q.text).toContain("<mn>1</mn>");
    expect(q.text).toContain("<msup>");
    expect(q.text).toContain("for x");
  });

  it("preserves Word tables as html tables", async () => {
    const tbl =
      `<w:tbl><w:tr>` +
      `<w:tc><w:p><w:r><w:t xml:space="preserve">H1</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t xml:space="preserve">H2</w:t></w:r></w:p></w:tc>` +
      `</w:tr><w:tr>` +
      `<w:tc><w:p><w:r><w:t xml:space="preserve">a</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:p><w:r><w:t xml:space="preserve">b</w:t></w:r></w:p></w:tc>` +
      `</w:tr></w:tbl>`;
    const body = [
      p({ style: "Heading1" }, "Quiz"),
      p({ numId: 1 }, "Fill in the table:"),
      tbl,
      p({ numId: 2 }, "*yes"),
      p({ numId: 2 }, "no"),
      // a second table with w:tblLook firstRow: header cells become <th>
      p({ numId: 1 }, "And this one:"),
      `<w:tbl><w:tblPr><w:tblLook w:firstRow="1"/></w:tblPr><w:tr>` +
        `<w:tc><w:p><w:r><w:t xml:space="preserve">Name</w:t></w:r></w:p></w:tc></w:tr>` +
        `<w:tr><w:tc><w:p><w:r><w:t xml:space="preserve">x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      p({ numId: 2 }, "*yes"),
      p({ numId: 2 }, "no"),
    ].join("");
    const lib = await readDocx(await makeDocx(body));
    const q = lib.sections[0]!.questions[0]!;
    expect(q.text).toContain("<table");
    expect(q.text).toMatch(/<td[^>]*>H1<\/td>/);
    expect(q.text).toMatch(/<td[^>]*>b<\/td>/);
    // inline styling travels with the html so the LMS renders borders
    expect(q.text).toContain("border-collapse:collapse");
    expect(q.text).toContain("border:1px solid");

    // second question's table has a firstRow header -> <th> cells
    const q2 = lib.sections[0]!.questions[1]!;
    expect(q2.text).toMatch(/<th[^>]*>Name<\/th>/);
    expect(q2.text).toMatch(/<td[^>]*>x<\/td>/);
  });

  it("preserves superscript and subscript runs", async () => {
    const body = [
      p({ style: "Heading1" }, "Quiz"),
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
        `<w:r><w:t xml:space="preserve">E = mc</w:t></w:r>` +
        `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">2</w:t></w:r>` +
        `<w:r><w:t xml:space="preserve"> and H</w:t></w:r>` +
        `<w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t xml:space="preserve">2</w:t></w:r>` +
        `<w:r><w:t xml:space="preserve">O</w:t></w:r></w:p>`,
      p({ numId: 2 }, "*yes"),
      p({ numId: 2 }, "no"),
    ].join("");
    const lib = await readDocx(await makeDocx(body));
    const q = lib.sections[0]!.questions[0]!;
    expect(q.text).toContain("<sup>2</sup>");
    expect(q.text).toContain("<sub>2</sub>");
  });

  it("warns on EMF images and emits no broken <img>", async () => {
    const rels =
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/fig1.emf"/>` +
      `</Relationships>`;
    const body = [
      p({ style: "Heading1" }, "Quiz"),
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
        `<w:r><w:t xml:space="preserve">See figure: </w:t></w:r>` +
        `<w:r><w:pict><v:shape><v:imagedata r:id="rId5"/></v:shape></w:pict></w:r></w:p>`,
      p({ numId: 2 }, "*yes"),
      p({ numId: 2 }, "no"),
    ].join("");
    const lib = await readDocx(
      await makeDocx(body, { rels, media: { "fig1.emf": "fake-emf" } }),
    );
    expect(lib.importWarnings?.some((w) => w.html.includes("EMF/WMF"))).toBe(true);
    expect(lib.importWarnings?.flatMap((w) => w.details ?? [])).toContain("Image: fig1.emf");
    expect(lib.sections[0]!.questions[0]!.text).not.toContain("<img");
  });

  it("groups questions under SECTION markers with heading titles", async () => {
    const body = [
      p({ style: "Heading1" }, "Exam"),
      p({}, "# SECTION"),
      p({ style: "Heading2" }, "Chapter 1"),
      p({ numId: 1 }, "Q one?"),
      p({ numId: 2 }, "*yes"),
      p({ numId: 2 }, "no"),
      p({}, "# /SECTION"),
    ].join("");
    const lib = await readDocx(await makeDocx(body));
    const section = lib.sections.find((s) => s.title === "Chapter 1");
    expect(section).toBeTruthy();
    expect(section!.questions).toHaveLength(1);
  });
});
