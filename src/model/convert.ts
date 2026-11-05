// SPDX-License-Identifier: MPL-2.0
// Question-kind conversion. convertQuestion() preserves everything the target kind can represent.
// conversionLosses() reports what would be discarded so the UI can ask for confirmation before committing a lossy conversion.

import type {
  FibQuestion,
  MatQuestion,
  McQuestion,
  MsQuestion,
  OrdQuestion,
  Question,
  QuestionKind,
  TfQuestion,
  WrQuestion,
} from "./types.js";
import { createQuestion, newId } from "./factory.js";

const hasText = (html: string | undefined): boolean =>
  !!html && html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;

/**
 * Describe the content that converting q to `target` would discard.
 * Empty array = the conversion is lossless and can be applied directly.
 */
export function conversionLosses(q: Question, target: QuestionKind): string[] {
  if (q.kind === target) return [];
  const losses: string[] = [];
  const answersCarry = target === "MC" || target === "MS" || target === "ORD";

  if ((q.kind === "MC" || q.kind === "MS") && !answersCarry) {
    const n = q.answers.filter((a) => hasText(a.html)).length;
    if (n > 0) losses.push(`${n} answer${n > 1 ? "s" : ""}`);
  }
  if ((q.kind === "MC" || q.kind === "MS") && target === "ORD") {
    const marked = q.answers.some((a) => ("weight" in a ? a.weight > 0 : a.isCorrect));
    if (marked) losses.push("correct-answer markings");
  }
  if (q.kind === "MAT") {
    const n = q.pairs.filter((p) => hasText(p.premise) || hasText(p.response)).length;
    if (n > 0) losses.push(`${n} matching pair${n > 1 ? "s" : ""}`);
  }
  if (q.kind === "FIB") {
    const n = q.parts.filter(
      (p) => p.part === "blank" && p.answers.some((a) => a.trim() !== ""),
    ).length;
    if (n > 0) losses.push(`${n} blank${n > 1 ? "s" : ""} with accepted answers`);
  }
  if (q.kind === "TF" && target !== "MC" && target !== "MS" && target !== "ORD") {
    if (hasText(q.trueFeedback) || hasText(q.falseFeedback))
      losses.push("true/false answer feedback");
  }
  if (q.kind === "WR" && hasText(q.answerKey)) {
    losses.push("the answer key");
  }
  return losses;
}

/** Convert q to `target`, preserving everything the target kind can represent. */
export function convertQuestion(q: Question, target: QuestionKind): Question {
  if (q.kind === target) return q;

  // FIB stores its body in parts; every other kind uses q.text
  const text =
    q.kind === "FIB"
      ? q.parts
          .filter((p) => p.part === "text")
          .map((p) => p.html)
          .join("")
      : q.text;

  const shared = {
    id: q.id,
    title: q.title,
    points: q.points,
    hint: q.hint,
    feedback: q.feedback,
    text,
  };
  const enumeration = "enumeration" in q ? q.enumeration : undefined;
  const randomize = q.kind === "MC" || q.kind === "MS" ? q.randomize : undefined;

  switch (target) {
    case "MC": {
      const fresh = createQuestion("MC") as McQuestion;
      const mc: McQuestion = {
        ...shared,
        kind: "MC",
        randomize,
        enumeration,
        answers:
          q.kind === "MS"
            ? q.answers.map((a) => ({
                id: a.id,
                html: a.html,
                feedback: a.feedback,
                weight: a.isCorrect ? 100 : 0,
              }))
            : q.kind === "ORD"
              ? q.items.map((i) => ({ id: i.id, html: i.html, feedback: i.feedback, weight: 0 }))
              : q.kind === "TF"
                ? [
                    { id: newId("a"), html: "True", feedback: q.trueFeedback, weight: q.trueWeight },
                    { id: newId("a"), html: "False", feedback: q.falseFeedback, weight: q.falseWeight },
                  ]
                : fresh.answers,
      };
      return mc;
    }
    case "MS": {
      const fresh = createQuestion("MS") as MsQuestion;
      const ms: MsQuestion = {
        ...shared,
        kind: "MS",
        randomize,
        enumeration,
        answers:
          q.kind === "MC"
            ? q.answers.map((a) => ({
                id: a.id,
                html: a.html,
                feedback: a.feedback,
                isCorrect: a.weight > 0,
              }))
            : q.kind === "ORD"
              ? q.items.map((i) => ({ id: i.id, html: i.html, feedback: i.feedback, isCorrect: false }))
              : q.kind === "TF"
                ? [
                    { id: newId("a"), html: "True", feedback: q.trueFeedback, isCorrect: q.trueWeight > 0 },
                    { id: newId("a"), html: "False", feedback: q.falseFeedback, isCorrect: q.falseWeight > 0 },
                  ]
                : fresh.answers,
      };
      return ms;
    }
    case "TF": {
      const tf: TfQuestion = {
        ...shared,
        kind: "TF",
        enumeration,
        trueWeight: 100,
        falseWeight: 0,
      };
      return tf;
    }
    case "FIB": {
      const fib: FibQuestion = {
        ...shared,
        kind: "FIB",
        parts: [{ id: newId("p"), part: "text", html: q.text }],
      };
      return fib;
    }
    case "MAT": {
      const fresh = createQuestion("MAT") as MatQuestion;
      return { ...shared, kind: "MAT", gradingType: fresh.gradingType, pairs: fresh.pairs };
    }
    case "ORD": {
      const fresh = createQuestion("ORD") as OrdQuestion;
      const ord: OrdQuestion = {
        ...shared,
        kind: "ORD",
        items:
          q.kind === "MC" || q.kind === "MS"
            ? q.answers.map((a) => ({ id: a.id, html: a.html, feedback: a.feedback }))
            : q.kind === "TF"
              ? [
                  { id: newId("o"), html: "True", feedback: q.trueFeedback },
                  { id: newId("o"), html: "False", feedback: q.falseFeedback },
                ]
              : fresh.items,
      };
      return ord;
    }
    case "WR": {
      const fresh = createQuestion("WR") as WrQuestion;
      return { ...shared, kind: "WR", answerKey: fresh.answerKey };
    }
  }
}
