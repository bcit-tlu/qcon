// SPDX-License-Identifier: MPL-2.0
// Canonical question-library model - the pivot between all codecs (docx, QTI) and the editor.
// Every entity carries a stable `id` for selection, undo/redo, and React keys.
// Validation issues are computed by src/model/validate.ts, never stored here.

export type QuestionKind = "MC" | "MS" | "TF" | "FIB" | "MAT" | "ORD" | "WR";

export interface Library {
  id: string;
  title: string;
  /** library-wide "randomize answers" default (Randomize: yes/no on import) */
  randomizeAnswers: boolean;
  sections: Section[];
  /** image/binary assets referenced from question HTML (src = asset filename) */
  assets: LibraryAsset[];
  /** import-time notices produced by the codecs, e.g. unresolved tracked changes */
  importWarnings?: ImportWarning[];
}

export interface ImportWarning {
  /** message text (html, codec-authored) */
  html: string;
  /** plain-text list of each detected change/comment shown under the message */
  details?: string[];
}

export interface LibraryAsset {
  id: string;
  filename: string;
  /** base64 payload without data: prefix */
  base64: string;
  mediaType: string;
}

export interface Section {
  id: string;
  title: string;
  /** optional intro text (html) shown before the questions */
  text?: string;
  shuffle: boolean;
  questions: Question[];
}

interface QuestionBase {
  id: string;
  title?: string;
  /** question body, html */
  text: string;
  points?: number;
  hint?: string; // html
  feedback?: string; // html
}

export interface McAnswer {
  id: string;
  html: string;
  feedback?: string;
  /** 100 for the correct answer, 0 otherwise */
  weight: number;
}

export interface McQuestion extends QuestionBase {
  kind: "MC";
  /** explicit per-question setting wins; undefined = use the library-level default */
  randomize?: boolean;
  enumeration?: string;
  answers: McAnswer[];
}

export interface MsAnswer {
  id: string;
  html: string;
  feedback?: string;
  isCorrect: boolean;
}

export interface MsQuestion extends QuestionBase {
  kind: "MS";
  /** explicit per-question setting wins; undefined = use the library-level default */
  randomize?: boolean;
  enumeration?: string;
  answers: MsAnswer[];
}

export interface TfQuestion extends QuestionBase {
  kind: "TF";
  enumeration?: string;
  trueWeight: number;
  trueFeedback?: string;
  falseWeight: number;
  falseFeedback?: string;
}

export type FibPart =
  | { id: string; part: "text"; html: string }
  | { id: string; part: "blank"; answers: string[] };

export interface FibQuestion extends QuestionBase {
  kind: "FIB";
  /** interleaved text segments and blanks, in display order */
  parts: FibPart[];
}

export interface MatPair {
  id: string;
  premise: string; // html (choice)
  response: string; // html (match)
}

export interface MatQuestion extends QuestionBase {
  kind: "MAT";
  /** 0 = equally weighted, 1 = all or nothing, 2 = right minus wrong */
  gradingType: 0 | 1 | 2;
  pairs: MatPair[];
}

export interface OrdItem {
  id: string;
  html: string;
  feedback?: string;
}

export interface OrdQuestion extends QuestionBase {
  kind: "ORD";
  /** items in correct order */
  items: OrdItem[];
}

export interface WrQuestion extends QuestionBase {
  kind: "WR";
  /** answer key (html), shown to graders */
  answerKey?: string;
}

export type Question =
  | McQuestion
  | MsQuestion
  | TfQuestion
  | FibQuestion
  | MatQuestion
  | OrdQuestion
  | WrQuestion;

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  MC: "Multiple Choice",
  MS: "Multi-Select",
  TF: "True/False",
  FIB: "Fill in the Blanks",
  MAT: "Matching",
  ORD: "Ordering",
  WR: "Long Answer",
};
