// SPDX-License-Identifier: MPL-2.0
// Round-trip invariant: decode(encode(model)) preserves everything the model carries (ids excluded - they regenerate on import).

import { describe, expect, it } from "vitest";
import { createLibrary, createQuestion, newId } from "../../model/factory.js";
import type { Library, Question } from "../../model/types.js";
import { readScormZip, writeScormZip } from "./zip.js";

const OPTS = { timestamp: 1755565200000, random: () => 0.5 };

function fullLibrary(): Library {
  const lib = createLibrary("Full Round Trip");
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

/** Strip volatile ids for structural comparison. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([k, v]) =>
            v !== undefined &&
            k !== "id" &&
            k !== "assets" &&
            k !== "randomizeAnswers",
        )
        .map(([k, v]) => [k, normalize(v)]),
    );
  }
  return value;
}

describe("QTI round trip", () => {
  it("decode(encode(model)) preserves all seven question types", async () => {
    const original = fullLibrary();
    const bytes = await writeScormZip(original, OPTS);
    const decoded = await readScormZip(bytes);

    expect(decoded.title).toBe(original.title);
    const origQ = original.sections[0]!.questions;
    const decQ = decoded.sections[0]!.questions;
    expect(decQ).toHaveLength(origQ.length);
    expect(decQ.map((q) => q.kind)).toEqual(origQ.map((q) => q.kind));

    for (let i = 0; i < origQ.length; i++) {
      expect(normalize(decQ[i])).toEqual(normalize(origQ[i]));
    }
  });

  it("preserves sections with titles, text, and shuffle", async () => {
    const lib = fullLibrary();
    lib.sections.push({
      id: newId("sec"),
      title: "Chapter 2",
      text: "<p>intro</p>",
      shuffle: true,
      questions: [createQuestion("TF")],
    });
    const decoded = await readScormZip(await writeScormZip(lib, OPTS));
    const sub = decoded.sections.find((s) => s.title === "Chapter 2");
    expect(sub?.text).toBe("<p>intro</p>");
    expect(sub?.shuffle).toBe(true);
    expect(sub?.questions).toHaveLength(1);
  });
});
