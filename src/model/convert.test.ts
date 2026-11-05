// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { conversionLosses, convertQuestion } from "./convert.js";
import { createQuestion } from "./factory.js";
import type {
  FibQuestion,
  MatQuestion,
  McQuestion,
  MsQuestion,
  OrdQuestion,
  TfQuestion,
  WrQuestion,
} from "./types.js";

describe("conversionLosses", () => {
  it("is empty for same-kind conversion", () => {
    const q = createQuestion("MC");
    expect(conversionLosses(q, "MC")).toEqual([]);
  });

  it("is empty for MC -> MS (answers carry over)", () => {
    const q = createQuestion("MC") as McQuestion;
    q.answers[0]!.html = "<p>Alpha</p>";
    expect(conversionLosses(q, "MS")).toEqual([]);
  });

  it("reports answers for MC -> TF when answers have text", () => {
    const q = createQuestion("MC") as McQuestion;
    q.answers[0]!.html = "<p>Alpha</p>";
    q.answers[1]!.html = "<p>Beta</p>";
    expect(conversionLosses(q, "TF")).toEqual(["2 answers"]);
  });

  it("is empty for MC -> TF when answers are blank", () => {
    const q = createQuestion("MC") as McQuestion;
    expect(conversionLosses(q, "TF")).toEqual([]);
  });

  it("reports correct-answer markings for MC -> ORD", () => {
    const q = createQuestion("MC") as McQuestion;
    expect(conversionLosses(q, "ORD")).toEqual(["correct-answer markings"]);
  });

  it("reports nothing for MS -> ORD when no answer is marked", () => {
    const q = createQuestion("MS") as MsQuestion;
    q.answers = q.answers.map((a) => ({ ...a, isCorrect: false }));
    expect(conversionLosses(q, "ORD")).toEqual([]);
  });

  it("reports matching pairs for MAT -> MC", () => {
    const q = createQuestion("MAT") as MatQuestion;
    q.pairs[0]!.premise = "<p>Term</p>";
    expect(conversionLosses(q, "MC")).toEqual(["1 matching pair"]);
  });

  it("reports blanks for FIB -> MC", () => {
    const q = createQuestion("FIB") as FibQuestion;
    const blank = q.parts.find((p) => p.part === "blank");
    if (blank && blank.part === "blank") blank.answers = ["alpha"];
    expect(conversionLosses(q, "MC")).toEqual(["1 blank with accepted answers"]);
  });

  it("reports answer key for WR -> MC", () => {
    const q = createQuestion("WR") as WrQuestion;
    q.answerKey = "<p>Key</p>";
    expect(conversionLosses(q, "MC")).toEqual(["the answer key"]);
  });

  it("reports TF feedback for TF -> FIB", () => {
    const q = createQuestion("TF") as TfQuestion;
    q.trueFeedback = "<p>Well done</p>";
    expect(conversionLosses(q, "FIB")).toEqual(["true/false answer feedback"]);
  });
});

describe("convertQuestion", () => {
  it("MC -> MS preserves answers and correctness", () => {
    const q = createQuestion("MC") as McQuestion;
    q.title = "T";
    q.points = 5;
    q.text = "<p>Pick one</p>";
    q.answers[0]!.html = "<p>Alpha</p>";
    q.answers[1]!.html = "<p>Beta</p>";
    const ms = convertQuestion(q, "MS") as MsQuestion;
    expect(ms.kind).toBe("MS");
    expect(ms.id).toBe(q.id);
    expect(ms.title).toBe("T");
    expect(ms.points).toBe(5);
    expect(ms.text).toBe("<p>Pick one</p>");
    expect(ms.answers).toHaveLength(2);
    expect(ms.answers[0]!.html).toBe("<p>Alpha</p>");
    expect(ms.answers[0]!.isCorrect).toBe(true);
    expect(ms.answers[1]!.isCorrect).toBe(false);
  });

  it("MS -> MC preserves answers, first correct wins weight", () => {
    const q = createQuestion("MS") as MsQuestion;
    q.answers[0]!.isCorrect = true;
    q.answers[1]!.isCorrect = false;
    const mc = convertQuestion(q, "MC") as McQuestion;
    expect(mc.answers[0]!.weight).toBe(100);
    expect(mc.answers[1]!.weight).toBe(0);
  });

  it("TF -> MC generates True/False answers preserving correctness", () => {
    const q = createQuestion("TF") as TfQuestion;
    q.trueWeight = 0;
    q.falseWeight = 100;
    const mc = convertQuestion(q, "MC") as McQuestion;
    expect(mc.answers).toHaveLength(2);
    expect(mc.answers[0]!.html).toBe("True");
    expect(mc.answers[0]!.weight).toBe(0);
    expect(mc.answers[1]!.html).toBe("False");
    expect(mc.answers[1]!.weight).toBe(100);
  });

  it("MC -> TF keeps shared fields but drops answers", () => {
    const q = createQuestion("MC") as McQuestion;
    q.title = "T";
    q.hint = "<p>hint</p>";
    const tf = convertQuestion(q, "TF") as TfQuestion;
    expect(tf.kind).toBe("TF");
    expect(tf.title).toBe("T");
    expect(tf.hint).toBe("<p>hint</p>");
    expect(tf.trueWeight).toBe(100);
  });

  it("MC -> ORD moves answers to items", () => {
    const q = createQuestion("MC") as McQuestion;
    q.answers[0]!.html = "<p>First</p>";
    const ord = convertQuestion(q, "ORD") as OrdQuestion;
    expect(ord.items.map((i) => i.html)).toEqual(["<p>First</p>", ""]);
  });

  it("X -> FIB wraps question text in a text part", () => {
    const q = createQuestion("MC") as McQuestion;
    q.text = "<p>Body</p>";
    const fib = convertQuestion(q, "FIB") as FibQuestion;
    expect(fib.parts).toHaveLength(1);
    expect(fib.parts[0]).toMatchObject({ part: "text", html: "<p>Body</p>" });
  });

  it("FIB -> MC joins text parts into question text", () => {
    const q = createQuestion("FIB") as FibQuestion;
    q.parts = q.parts.map((p) =>
      p.part === "text" && p.html === "" ? { ...p, html: "<p>A</p>" } : p,
    );
    q.parts = q.parts.map((p, i) =>
      p.part === "text" && i === q.parts.length - 1 ? { ...p, html: "<p>B</p>" } : p,
    );
    const mc = convertQuestion(q, "MC") as McQuestion;
    expect(mc.text).toBe("<p>A</p><p>B</p>");
  });

  it("same-kind conversion returns the question unchanged", () => {
    const q = createQuestion("ORD");
    expect(convertQuestion(q, "ORD")).toBe(q);
  });
});
