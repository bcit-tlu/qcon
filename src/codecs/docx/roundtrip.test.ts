// SPDX-License-Identifier: MPL-2.0
// Round-trip invariant for the docx codec: decode(encode(model)) preserves content, modulo html markup the Word authoring format cannot express (inline tags other than bold/italic are stripped on export).
// Strings are therefore compared tag-stripped; ids regenerate on import.

import { describe, expect, it } from "vitest";
import { createLibrary, createQuestion, newId } from "../../model/factory.js";
import type { Library } from "../../model/types.js";
import { readDocx } from "./interpret.js";
import { writeDocx } from "./writer.js";

function fullLibrary(): Library {
  const lib = createLibrary("Docx Round Trip");
  const main = lib.sections[0]!;

  const mc = createQuestion("MC");
  if (mc.kind === "MC") {
    mc.title = "MC title";
    mc.text = "<p>Pick one</p>";
    mc.points = 2.5;
    mc.randomize = true;
    mc.hint = "<p>mc hint</p>";
    mc.feedback = "<p>mc general feedback</p>";
    mc.answers = [
      { id: newId("a"), html: "<p>wrong</p>", weight: 0, feedback: "<p>nope</p>" },
      { id: newId("a"), html: "<p>right</p>", weight: 100 },
    ];
  }

  const ms = createQuestion("MS");
  if (ms.kind === "MS") {
    ms.text = "<p>Pick many</p>";
    ms.answers = [
      { id: newId("a"), html: "<p>a</p>", isCorrect: true },
      { id: newId("a"), html: "<p>b</p>", isCorrect: true },
      { id: newId("a"), html: "<p>c</p>", isCorrect: false },
    ];
  }

  const tf = createQuestion("TF");
  if (tf.kind === "TF") {
    tf.text = "<p>Yes or no</p>";
    tf.trueWeight = 0;
    tf.falseWeight = 100;
    tf.falseFeedback = "<p>indeed false</p>";
  }

  const fib = createQuestion("FIB");
  if (fib.kind === "FIB") {
    fib.parts = [
      { id: newId("p"), part: "text", html: "<p>The capital of France is </p>" },
      { id: newId("p"), part: "blank", answers: ["Paris", "paris"] },
      { id: newId("p"), part: "text", html: "<p>.</p>" },
    ];
  }

  const mat = createQuestion("MAT");
  if (mat.kind === "MAT") {
    mat.text = "<p>Match them</p>";
    mat.pairs = [
      { id: newId("m"), premise: "<p>A</p>", response: "<p>1</p>" },
      { id: newId("m"), premise: "<p>B</p>", response: "<p>2</p>" },
    ];
  }

  const ord = createQuestion("ORD");
  if (ord.kind === "ORD") {
    ord.text = "<p>Order them</p>";
    ord.items = [
      { id: newId("o"), html: "<p>first</p>" },
      { id: newId("o"), html: "<p>second</p>" },
    ];
  }

  const wr = createQuestion("WR");
  if (wr.kind === "WR") {
    wr.text = "<p>Discuss.</p>";
    wr.answerKey = "<p>key points</p>";
  }

  main.questions.push(mc, ms, tf, fib, mat, ord, wr);
  return lib;
}

/** Strip volatile ids and html tags for lossy-format comparison. */
function normalize(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .trim();
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([k, v]) =>
            v !== undefined &&
            k !== "id" &&
            k !== "assets" &&
            k !== "randomizeAnswers" &&
            k !== "shuffle" && // not expressible in docx
            k !== "enumeration" && // not emitted by the docx writer
            k !== "gradingType", // not expressible in docx
        )
        .map(([k, v]) => [k, normalize(v)]),
    );
  }
  return value;
}

describe("docx round trip", () => {
  it("decode(encode(model)) preserves all seven question types", async () => {
    const original = fullLibrary();
    const decoded = await readDocx(await writeDocx(original));

    expect(decoded.title).toBe(original.title);
    const origQ = original.sections[0]!.questions;
    const decQ = decoded.sections[0]!.questions;
    expect(decQ).toHaveLength(origQ.length);
    expect(decQ.map((q) => q.kind)).toEqual(origQ.map((q) => q.kind));

    for (let i = 0; i < origQ.length; i++) {
      expect(normalize(decQ[i])).toEqual(normalize(origQ[i]));
    }
  });

  it("preserves titled sections and their intro text", async () => {
    const lib = fullLibrary();
    lib.sections.push({
      id: newId("sec"),
      title: "Chapter 2",
      text: "<p>intro</p>",
      shuffle: false,
      questions: [createQuestion("TF")],
    });
    const decoded = await readDocx(await writeDocx(lib));
    const sub = decoded.sections.find((s) => s.title === "Chapter 2");
    expect(sub?.text).toBe("<p>intro</p>");
    expect(sub?.questions).toHaveLength(1);
  });

  it("embeds images and restores them as data URIs", async () => {
    const lib = createLibrary("Images");
    const q = createQuestion("WR");
    // 1x1 png
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    q.text = `<p>look <img src="data:image/png;base64,${png}"> here</p>`;
    lib.sections[0]!.questions.push(q);

    const decoded = await readDocx(await writeDocx(lib));
    const out = decoded.sections[0]!.questions[0]!;
    expect(out.text).toContain(`data:image/png;base64,${png}`);
  });
});

describe("docx round trip - fidelity additions", () => {
  it("preserves tables as w:tbl and back to <table>", async () => {
    const lib = createLibrary("Tables");
    const q = createQuestion("WR");
    q.text =
      "<p>Before</p><table><tr><td>H1</td><td>H2</td></tr><tr><td>a</td><td>b</td></tr></table><p>After</p>";
    lib.sections[0]!.questions.push(q);
    const decoded = await readDocx(await writeDocx(lib));
    const out = decoded.sections[0]!.questions[0]!;
    expect(out.text).toContain("<table");
    expect(out.text).toMatch(/<td[^>]*>H1<\/td>/);
    expect(out.text).toMatch(/<td[^>]*>b<\/td>/);
    expect(out.text).toContain("After");
  });

  it("preserves sup/sub and MathML through OMML", async () => {
    const lib = createLibrary("Math");
    const q = createQuestion("WR");
    q.text =
      `<p>E = mc<sup>2</sup>, H<sub>2</sub>O, and ` +
      `<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mn>1</mn><mn>2</mn></mfrac></math></p>`;
    lib.sections[0]!.questions.push(q);
    const decoded = await readDocx(await writeDocx(lib));
    const out = decoded.sections[0]!.questions[0]!;
    expect(out.text).toContain("<sup>2</sup>");
    expect(out.text).toContain("<sub>2</sub>");
    expect(out.text).toContain("<math");
    expect(out.text).toContain("<mfrac>");
  });
});
