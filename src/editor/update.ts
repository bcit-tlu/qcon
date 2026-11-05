// SPDX-License-Identifier: MPL-2.0
// Immutable update helpers for the editor.
// Every edit produces a new Library so React re-renders and future undo/redo stays trivial.

import type { Library, Question, Section } from "../model/types.js";

export function updateSection(
  lib: Library,
  sectionId: string,
  fn: (s: Section) => Section,
): Library {
  return {
    ...lib,
    sections: lib.sections.map((s) => (s.id === sectionId ? fn(s) : s)),
  };
}

export function updateQuestion(
  lib: Library,
  sectionId: string,
  questionId: string,
  fn: (q: Question) => Question,
): Library {
  return updateSection(lib, sectionId, (s) => ({
    ...s,
    questions: s.questions.map((q) => (q.id === questionId ? fn(q) : q)),
  }));
}

export function removeSection(lib: Library, sectionId: string): Library {
  return { ...lib, sections: lib.sections.filter((s) => s.id !== sectionId) };
}

export function removeQuestion(
  lib: Library,
  sectionId: string,
  questionId: string,
): Library {
  return updateSection(lib, sectionId, (s) => ({
    ...s,
    questions: s.questions.filter((q) => q.id !== questionId),
  }));
}

/** Move a question within its section (dir = -1 | 1). */
export function moveQuestion(
  lib: Library,
  sectionId: string,
  questionId: string,
  dir: -1 | 1,
): Library {
  return updateSection(lib, sectionId, (s) => {
    const i = s.questions.findIndex((q) => q.id === questionId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= s.questions.length) return s;
    const questions = [...s.questions];
    [questions[i], questions[j]] = [questions[j]!, questions[i]!];
    return { ...s, questions };
  });
}
