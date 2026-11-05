// SPDX-License-Identifier: MPL-2.0
// Model factories and ID generation.

import type {
  FibQuestion,
  Library,
  MatQuestion,
  McQuestion,
  MsQuestion,
  OrdQuestion,
  Question,
  QuestionKind,
  Section,
  TfQuestion,
  WrQuestion,
} from "./types.js";

let counter = 0;

/** Stable, unique-enough ID for model entities (not cryptographic). */
export function newId(prefix = "e"): string {
  counter = (counter + 1) % 0xffff;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createLibrary(title = ""): Library {
  return {
    id: newId("lib"),
    title,
    randomizeAnswers: false,
    sections: [createSection("Section 1")],
    assets: [],
  };
}

export function createSection(title = ""): Section {
  return { id: newId("sec"), title, shuffle: false, questions: [] };
}

export function createQuestion(kind: QuestionKind): Question {
  const base = { id: newId("q"), text: "", points: 1 };
  switch (kind) {
    case "MC": {
      const q: McQuestion = {
        ...base,
        kind,
        answers: [
          { id: newId("a"), html: "", weight: 100 },
          { id: newId("a"), html: "", weight: 0 },
        ],
      };
      return q;
    }
    case "MS": {
      const q: MsQuestion = {
        ...base,
        kind,
        answers: [
          { id: newId("a"), html: "", isCorrect: true },
          { id: newId("a"), html: "", isCorrect: false },
        ],
      };
      return q;
    }
    case "TF": {
      const q: TfQuestion = { ...base, kind, trueWeight: 100, falseWeight: 0 };
      return q;
    }
    case "FIB": {
      const q: FibQuestion = {
        ...base,
        kind,
        parts: [
          { id: newId("p"), part: "text", html: "" },
          { id: newId("p"), part: "blank", answers: [""] },
          { id: newId("p"), part: "text", html: "" },
        ],
      };
      return q;
    }
    case "MAT": {
      const q: MatQuestion = {
        ...base,
        kind,
        gradingType: 0,
        pairs: [{ id: newId("m"), premise: "", response: "" }],
      };
      return q;
    }
    case "ORD": {
      const q: OrdQuestion = {
        ...base,
        kind,
        items: [{ id: newId("o"), html: "" }],
      };
      return q;
    }
    case "WR": {
      const q: WrQuestion = { ...base, kind };
      return q;
    }
  }
}
