// SPDX-License-Identifier: MPL-2.0
// Fixture tests against real Word files from the qcon guide (docs/assets/example_files).
// These are the parity oracles for the OOXML reader.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readDocx } from "./interpret.js";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));

describe("docx reader - real guide fixtures", () => {
  it("basic-question-types.docx: question order and kinds", async () => {
    const lib = await readDocx(fixture("basic-question-types.docx"));
    expect(lib.title).toBe("Basic Question Types");
    const questions = lib.sections.flatMap((s) => s.questions);
    const kinds = questions.map((q) => q.kind);
    // document order (guide display order differs): MC, TF, MC, MS, WR, FIB, MAT, ORD
    expect(kinds).toEqual(["MC", "TF", "MC", "MS", "WR", "FIB", "MAT", "ORD"]);
  });

  it("basic-question-types.docx: correct answers resolved", async () => {
    const lib = await readDocx(fixture("basic-question-types.docx"));
    const questions = lib.sections.flatMap((s) => s.questions);

    const mc1 = questions[0]!;
    if (mc1.kind !== "MC") throw new Error("expected MC");
    expect(mc1.answers.map((a) => a.weight)).toEqual([0, 0, 0, 100]); // d. *Voltage

    const tf = questions[1]!;
    if (tf.kind !== "TF") throw new Error("expected TF");
    expect(tf.falseWeight).toBe(100); // b. *False

    const mc2 = questions[2]!;
    if (mc2.kind !== "MC") throw new Error("expected MC");
    expect(mc2.answers[0]?.weight).toBe(100); // a. *Quieter

    const ms = questions[3]!;
    if (ms.kind !== "MS") throw new Error("expected MS");
    expect(ms.answers.map((a) => a.isCorrect)).toEqual([true, true, false, false]);

    const fib = questions[5]!;
    if (fib.kind !== "FIB") throw new Error("expected FIB");
    const blanks = fib.parts.filter((p) => p.part === "blank");
    expect(blanks).toHaveLength(2); // [rose, flower] ... [sweet, good]

    const mat = questions[6]!;
    if (mat.kind !== "MAT") throw new Error("expected MAT");
    expect(mat.pairs).toHaveLength(3);

    const ord = questions[7]!;
    if (ord.kind !== "ORD") throw new Error("expected ORD");
    expect(ord.items).toHaveLength(5);
  });

  it("section_examples.docx: sections with plain-text titles and feedback", async () => {
    const lib = await readDocx(fixture("section_examples.docx"));
    expect(lib.title).toBe("Canadian Holidays Quiz");

    const federal = lib.sections.find((s) => s.title === "Federal Holiday");
    const provincial = lib.sections.find((s) => s.title === "Provincial Holiday");
    expect(federal).toBeTruthy();
    expect(provincial).toBeTruthy();

    expect(federal!.text).toContain("Federal Holiday");
    expect(federal!.questions).toHaveLength(1);
    expect(provincial!.questions).toHaveLength(1);

    // Word splits runs mid-sentence at spellcheck boundaries; spaces must survive
    expect(federal!.questions[0]!.text).toContain(
      "Select all of the Federal Holidays from the list below:",
    );

    // @feedback: lines attach to the preceding answer
    const q = provincial!.questions[0]!;
    if (q.kind !== "MS") throw new Error("expected MS");
    expect(q.answers.map((a) => a.isCorrect)).toEqual([
      true, true, false, true, false, false, true, false, false, true,
    ]);
    expect(q.answers[2]?.feedback).toContain("Louis Riel Day");
  });

  it("qcon_formatting_examples.docx: image-only question paragraphs keep their images", async () => {
    const lib = await readDocx(fixture("qcon_formatting_examples.docx"));
    const questions = lib.sections.flatMap((s) => s.questions);
    const withImages = questions.filter((q) => q.text.includes("<img"));
    expect(withImages).toHaveLength(2);
    expect(withImages[0]!.text).toContain("data:image/png;base64,");
  });

  it("reviewer-mode-and-comments.docx: warns on tracked changes and comments", async () => {
    const lib = await readDocx(fixture("reviewer-mode-and-comments.docx"));
    expect(lib.importWarnings).toBeDefined();
    const tracked = lib.importWarnings!.find((w) => w.html.includes("Track Changes"));
    const comments = lib.importWarnings!.find((w) => w.html.includes("comments"));
    expect(tracked).toBeDefined();
    expect(comments).toBeDefined();
    expect(tracked!.details!.length).toBeGreaterThan(0);
    expect(comments!.details!.some((d) => d.startsWith("Comment:"))).toBe(true);
  });

  it("qcon_formatting_examples.docx: converts without throwing", async () => {
    const lib = await readDocx(fixture("qcon_formatting_examples.docx"));
    const questions = lib.sections.flatMap((s) => s.questions);
    expect(questions.length).toBeGreaterThan(3);
  });

  // same content as qcon_formatting_examples.docx but with deliberate errors:
  // a flipped TF answer, an MC with no correct answer, and a typo'd option
  it("qcon_formatting_examples_with_error.docx: parses without throwing, errors preserved", async () => {
    const ok = await readDocx(fixture("qcon_formatting_examples.docx"));
    const err = await readDocx(fixture("qcon_formatting_examples_with_error.docx"));
    const errQuestions = err.sections.flatMap((s) => s.questions);

    expect(err.title).toBe(ok.title);
    expect(errQuestions.map((q) => q.kind)).toEqual(
      ok.sections.flatMap((s) => s.questions).map((q) => q.kind),
    );

    const tf = errQuestions[0]!;
    if (tf.kind !== "TF") throw new Error("expected TF");
    expect(tf.falseWeight).toBe(100);

    const mc = errQuestions[3]!;
    if (mc.kind !== "MC") throw new Error("expected MC");
    expect(mc.answers.some((a) => a.weight === 100)).toBe(false);

    const msQuestions = errQuestions.filter((q) => q.kind === "MS");
    const hasTypo = msQuestions.some(
      (q) => q.kind === "MS" && q.answers.some((a) => a.html.includes("Saskatechewan")),
    );
    expect(hasTypo).toBe(true);
  });

  it("example-questions.docx: two sections, mixed kinds", async () => {
    const lib = await readDocx(fixture("example-questions.docx"));
    expect(lib.sections.map((s) => s.title)).toEqual([
      "Section 1 Title",
      "Section 2 Title",
    ]);
    expect(lib.sections.map((s) => s.questions.length)).toEqual([18, 1]);
    const counts: Record<string, number> = {};
    for (const s of lib.sections)
      for (const q of s.questions) counts[q.kind] = (counts[q.kind] ?? 0) + 1;
    expect(counts).toEqual({ TF: 3, MC: 4, MS: 3, WR: 3, FIB: 2, MAT: 2, ORD: 2 });
  });
});

// Per-kind guide fixtures: each file holds 10 questions of a single kind.
// {basic,answer_key,variation} cover the marking/format variants in the guide.
describe("docx reader - per-kind example fixtures", () => {
  const KINDS = ["FIB", "MAT", "MC", "MS", "ORD", "TF", "WR"] as const;
  const VARIANTS = ["basic", "answer_key", "variation"] as const;

  for (const kind of KINDS) {
    for (const variant of VARIANTS) {
      const name = `${kind}_${variant}_examples.docx`;
      it(`${name}: 10 ${kind} questions`, async () => {
        const lib = await readDocx(fixture(name));
        expect(lib.title).toBeTruthy();
        const questions = lib.sections.flatMap((s) => s.questions);
        expect(questions).toHaveLength(10);
        expect(questions.every((q) => q.kind === kind)).toBe(true);

        for (const q of questions) {
          switch (q.kind) {
            case "MC":
              expect(q.answers.length).toBeGreaterThanOrEqual(2);
              expect(q.answers.filter((a) => a.weight === 100)).toHaveLength(1);
              break;
            case "MS":
              expect(q.answers.length).toBeGreaterThanOrEqual(2);
              expect(q.answers.some((a) => a.isCorrect)).toBe(true);
              break;
            case "FIB":
              expect(q.parts.some((p) => p.part === "blank")).toBe(true);
              break;
            case "MAT":
              expect(q.pairs.length).toBeGreaterThanOrEqual(2);
              break;
            case "ORD":
              expect(q.items.length).toBeGreaterThanOrEqual(2);
              break;
          }
        }
      });
    }
  }
});

// fidelity-test.docx exercises every fidelity feature in one document:
// typed markers (no Word numbering), OMML equations, a firstRow-header table,
// sup/sub runs, an EMF image, plus real-numbered questions as a regression check.
describe("docx reader - fidelity-test.docx", () => {
  it("parses all fidelity features", async () => {
    const lib = await readDocx(fixture("fidelity-test.docx"));
    expect(lib.title).toBe("Fidelity Test Quiz");
    expect(lib.sections.map((s) => s.title)).toEqual(["Typed Markers", "Rich Content"]);
    const questions = lib.sections.flatMap((s) => s.questions);
    expect(questions).toHaveLength(8);

    // typed 1./a. markers -> MC; typed 2)/*a)/b) -> TF. Markers stripped from text.
    const [mc, tf] = questions;
    if (mc!.kind !== "MC" || tf!.kind !== "TF") throw new Error("typed markers not parsed");
    expect(mc!.answers.map((a) => a.weight)).toEqual([0, 100, 0]);
    expect(mc!.text).toContain("What is the capital of France?");
    expect(mc!.text).not.toContain("1. What");
    expect(tf!.trueWeight).toBe(100);

    // OMML -> MathML (integral/fraction/superscript), vertAlign sup/sub,
    // and real Word numbering still detects questions alongside typed ones
    expect(questions[2]!.text).toContain("<mfrac>");
    expect(questions[2]!.text).toContain("<msup>");
    expect(questions[3]!.text).toContain("<sup>2</sup>");
    expect(questions[3]!.text).toContain("<sub>2</sub>");
    expect(questions[4]!.text).toContain("numbered-list question");

    // table: real markup with inline borders (the LMS renders bare html),
    // w:tblLook firstRow -> <th> header cells
    expect(questions[5]!.text).toContain("border-collapse:collapse");
    expect(questions[5]!.text).toMatch(/<th[^>]*>A<\/th>/);
    expect(questions[5]!.text).toMatch(/<td[^>]*>T<\/td>/);

    // OMML radical -> mroot in a numbered question
    expect(questions[7]!.text).toContain("<mroot>");

    // EMF image: import warning with filename, no broken <img>
    const emf = lib.importWarnings?.find((w) => w.html.includes("EMF/WMF"));
    expect(emf?.details).toContain("Image: fig1.emf");
    expect(questions[6]!.text).not.toContain("<img");
  });
});
