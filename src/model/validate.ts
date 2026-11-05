// SPDX-License-Identifier: MPL-2.0
// Pure validation over the model.
// Error/warning messages reproduce the legacy qcon-api catalog (api/logging/ErrorTypes.py, WarningTypes.py) so users see identical feedback during import and while editing.

import type { Library, Question } from "./types.js";

export interface QuestionIssue {
  questionId: string;
  severity: "error" | "warning";
  message: string;
}

export interface ValidationResult {
  issues: QuestionIssue[];
  errorCount: number;
  warningCount: number;
}

const stripHtml = (html: string) =>
  html
    // an image is content even though it carries no text
    .replace(/<img\b[^>]*>/gi, "image")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

export function validateQuestion(q: Question): QuestionIssue[] {
  const issues: QuestionIssue[] = [];
  const error = (message: string) =>
    issues.push({ questionId: q.id, severity: "error", message });
  const warn = (message: string) =>
    issues.push({ questionId: q.id, severity: "warning", message });

  if (q.kind !== "FIB" && stripHtml(q.text) === "") {
    error("Question text is missing.");
  }

  switch (q.kind) {
    case "MC": {
      const correct = q.answers.filter((a) => a.weight === 100);
      if (q.answers.length < 2) error("Multiple Choice question needs at least two answers.");
      if (correct.length === 0)
        error("No correct answer selected in Multiple Choice question.");
      if (correct.length > 1)
        error("More than one correct answer selected in Multiple Choice question.");
      if (q.answers.some((a) => stripHtml(a.html) === ""))
        warn("One or more answer choices are empty.");
      break;
    }
    case "MS": {
      if (q.answers.length < 2) error("Multi-Select question needs at least two answers.");
      if (!q.answers.some((a) => a.isCorrect))
        error("No correct answer selected in Multi-Select question.");
      if (q.answers.some((a) => stripHtml(a.html) === ""))
        warn("One or more answer choices are empty.");
      break;
    }
    case "TF": {
      const correct = (q.trueWeight === 100 ? 1 : 0) + (q.falseWeight === 100 ? 1 : 0);
      if (correct === 0) error("No answer selected in True/False question.");
      if (correct > 1) error("More than one answer selected in True/False question.");
      break;
    }
    case "FIB": {
      const blanks = q.parts.filter((p) => p.part === "blank");
      if (blanks.length === 0) error("Fill in the Blanks question has no blanks.");
      for (const b of blanks) {
        if (b.part === "blank" && b.answers.every((a) => a.trim() === ""))
          error("One or more blanks have no acceptable answers.");
      }
      break;
    }
    case "MAT": {
      if (q.pairs.length < 2) error("Matching question needs at least two pairs.");
      if (q.pairs.some((p) => stripHtml(p.premise) === ""))
        error("One or more matching choice is missing.");
      if (q.pairs.some((p) => stripHtml(p.response) === ""))
        error("One or more matching answer is missing.");
      break;
    }
    case "ORD": {
      if (q.items.length < 2) error("Ordering question needs at least two items.");
      if (q.items.some((i) => stripHtml(i.html) === ""))
        warn("One or more ordering items are empty.");
      break;
    }
    case "WR":
      break;
  }

  return issues;
}

export function validateLibrary(library: Library): ValidationResult {
  const issues = library.sections.flatMap((s) =>
    s.questions.flatMap(validateQuestion),
  );
  return {
    issues,
    errorCount: issues.filter((i) => i.severity === "error").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
  };
}
