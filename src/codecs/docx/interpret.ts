// SPDX-License-Identifier: MPL-2.0
// Semantic interpreter: block IR -> model.
//
// Implements the qcon-guide authoring rules over structured blocks:
//   - Heading styles: first heading = library title; "SECTION"/"/SECTION" markers delimit sections; heading after SECTION = section title
//   - decimal list items (level 0) = questions; lettered items = answers
//   - "*" at the start of an answer = correct
//   - Title:/Points:/Type:/Randomize: header lines, @Feedback:/@Hint:, "Correct Answer:" (WR key), [blank] markers (FIB), a = b pairs (MAT)
//   - trailing "Answers:" numbered block = end-answer key (positional)
//
// Type detection mirrors the legacy check_inline/check_endanswer logic.

import type { Library, Question, Section } from "../../model/types.js";
import { createLibrary, createSection, newId } from "../../model/factory.js";
import { readDocxBlocks, type Block } from "./ooxml.js";

const stripHtml = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

// section markers tolerate typed variants seen in the wild: "# SECTION", "#section", "**# SECTION**", "/section" (hashes optional, case-insensitive)
const SECTION_MARKER = /^[*\s#]*(\/?)\s*section[*\s]*$/i;
const HEADER_PARAM = /^(Title|Point(?:s)?|Type|Random(?:ize)?)\s*:\s*(.*)$/i;
const FEEDBACK = /^@Feedback\s*:?\s*(.*)$/i;
const HINT = /^@Hint\s*:?\s*(.*)$/i;
const WR_KEY = /^Correct\s+Answers?\s*:?\s*(.*)$/i;
const ANSWERS_KEY = /^Answers\s*:?\s*$/i;
const BLANK = /\[([^\]]*)\]/g;

interface WorkingAnswer {
  html: string;
  correct: boolean;
  feedback?: string;
}

interface WorkingQuestion {
  title?: string;
  points?: number;
  declaredType?: string;
  randomize?: boolean;
  /** the question's own list id, to tell a WR answer's sublist apart from the next question */
  numId?: string;
  textParts: string[];
  answers: WorkingAnswer[];
  hint?: string;
  feedback?: string;
  wrAnswer?: string;
}

const newWorking = (): WorkingQuestion => ({ textParts: [], answers: [] });

function isHeading(block: Block): boolean {
  return /^Heading[12]$/i.test(block.style ?? "");
}

function isQuestionNumber(block: Block): boolean {
  return block.numbering?.fmt === "decimal" && block.numbering.level === 0;
}

function isAnswerLetter(block: Block): boolean {
  return (
    block.numbering !== undefined &&
    (block.numbering.fmt === "lowerLetter" || block.numbering.fmt === "upperLetter")
  );
}

// Typed-marker fallback: the legacy ANTLR grammars also accept literal "1."/"1)"
// question numbers and "a."/"a)"/"*a." answer letters typed as plain text. These
// only apply to paragraphs with no real Word numbering.
const TYPED_QUESTION = /^\s*\**\s*\d+\s*[.)]\s/;
const TYPED_ANSWER = /^\s*(\*)?\s*[a-zA-Z]\s*(\*)?\s*[.)]\s/;

/** Strip a typed "1." / "*a." / "a*." marker from block html, keeping leading tags. */
const stripTypedMarker = (html: string): string =>
  html.replace(/^((?:<[^>]+>)*)\s*\**\s*(?:\d+|[a-zA-Z])\s*\**\s*[.)]\s*/, "$1");

/** finalize one working question into a typed model question (inline mode) */
function buildQuestion(w: WorkingQuestion): Question {
  const base = {
    id: newId("q"),
    title: w.title,
    points: w.points ?? 1,
    hint: w.hint,
    feedback: w.feedback,
  };
  const text = w.textParts.join("");
  const declared = normalizeDeclared(w.declaredType);

  const marked = w.answers.filter((a) => a.correct).length;
  const plainTexts = w.answers.map((a) => stripHtml(a.html).toLowerCase());
  const isTrueFalse =
    w.answers.length === 2 &&
    plainTexts.some((t) => t === "true") &&
    plainTexts.some((t) => t === "false");
  const allPairs =
    w.answers.length > 1 && w.answers.every((a) => stripHtml(a.html).includes("="));

  // ---- explicit/kind resolution, mirroring legacy inline detection ----
  if (w.answers.length === 0) {
    if (BLANK.test(text)) {
      BLANK.lastIndex = 0;
      return buildFib(base, text);
    }
    if (w.wrAnswer !== undefined || declared === "WR") {
      return { ...base, kind: "WR", text, answerKey: w.wrAnswer };
    }
  }

  if (isTrueFalse || declared === "TF") {
    const tf = {
      ...base,
      kind: "TF" as const,
      text,
      trueWeight: 0,
      falseWeight: 0,
      trueFeedback: undefined as string | undefined,
      falseFeedback: undefined as string | undefined,
    };
    for (const a of w.answers) {
      const t = stripHtml(a.html).toLowerCase();
      if (t.includes("true")) {
        if (a.correct) tf.trueWeight = 100;
        if (a.feedback) tf.trueFeedback = a.feedback;
      }
      if (t.includes("false")) {
        if (a.correct) tf.falseWeight = 100;
        if (a.feedback) tf.falseFeedback = a.feedback;
      }
    }
    return tf;
  }

  if (allPairs || declared === "MAT") {
    const pairs = w.answers.map((a) => {
      const [premise = "", response = ""] = splitPair(a.html);
      return { id: newId("m"), premise: premise.trim(), response: response.trim() };
    });
    return { ...base, kind: "MAT", text, gradingType: 0, pairs };
  }

  if (marked > 1 || declared === "MS") {
    return {
      ...base,
      kind: "MS",
      text,
      randomize: w.randomize,
      answers: w.answers.map((a) => ({
        id: newId("a"),
        html: a.html,
        feedback: a.feedback,
        isCorrect: a.correct,
      })),
    };
  }

  if (marked === 1 || declared === "MC") {
    return {
      ...base,
      kind: "MC",
      text,
      randomize: w.randomize,
      answers: w.answers.map((a) => ({
        id: newId("a"),
        html: a.html,
        feedback: a.feedback,
        weight: a.correct ? 100 : 0,
      })),
    };
  }

  if (w.answers.length === 1 || declared === "WR") {
    return { ...base, kind: "WR", text, answerKey: w.answers[0]?.html };
  }

  if (w.answers.length > 1) {
    return {
      ...base,
      kind: "ORD",
      text,
      items: w.answers.map((a) => ({ id: newId("o"), html: a.html, feedback: a.feedback })),
    };
  }

  // no answers, no blanks, no WR key - fall back to WR without a key
  return { ...base, kind: "WR", text };
}

function normalizeDeclared(declared: string | undefined): string | undefined {
  if (!declared) return undefined;
  const up = declared.toUpperCase();
  // Respondus-compat aliases (legacy WarningTypes)
  const aliases: Record<string, string> = { E: "WR", MR: "MS", MT: "MAT", FMB: "FIB" };
  return aliases[up] ?? up;
}

/** `a = b` / `a == b` / backtick-escaped pairs (legacy matching.py regex) */
function splitPair(html: string): [string, string] {
  const plain = html;
  const m = plain.match(/^(.*?)\s*==\s*(.*)$/) ?? plain.match(/^(.*?)\s*=\s*(.*)$/);
  if (!m) return [html, ""];
  return [m[1]!.replace(/\\`/g, ""), m[2]!.replace(/\\`/g, "")];
}

function buildFib(
  base: { id: string; title?: string; points: number; hint?: string; feedback?: string },
  text: string,
): Question {
  const parts: Extract<Question, { kind: "FIB" }>["parts"] = [];
  let last = 0;
  for (const m of text.matchAll(BLANK)) {
    const idx = m.index;
    if (idx > last)
      parts.push({ id: newId("p"), part: "text", html: text.slice(last, idx) });
    parts.push({
      id: newId("p"),
      part: "blank",
      answers: m[1]!.split(",").map((s) => s.trim()),
    });
    last = idx + m[0].length;
  }
  if (last < text.length)
    parts.push({ id: newId("p"), part: "text", html: text.slice(last) });
  return { ...base, kind: "FIB", text: "", parts };
}

/** Interpret blocks into the model. */
export function interpretBlocks(blocks: Block[]): Library {
  const library = createLibrary("");
  const mainSection = library.sections[0]!;
  mainSection.title = "";

  const titledSections: Section[] = [];
  let currentSection = mainSection;
  let sectionOpen = false;
  let inAnswerKey = false;
  const answerKey: string[] = [];
  /** question working state paired with the section it started in */
  const assignments: { section: Section; question: WorkingQuestion }[] = [];
  let current: WorkingQuestion | null = null;
  let lastWasAnswer = false;
  // "Correct answer:" opens a WR key; following numbered items are the sample answer, not new questions
  let wrAnswerOpen = false;
  // Title:/Points:/Type:/Randomize: lines precede their question (guide format)
  let pending: Pick<WorkingQuestion, "title" | "points" | "declaredType" | "randomize"> = {};

  const flushQuestion = () => {
    current = null;
    lastWasAnswer = false;
    wrAnswerOpen = false;
  };

  for (const block of blocks) {
    const text = stripHtml(block.html);
    const marker = text.match(SECTION_MARKER);

    // tables are pure content: attach to the open answer/question/section, never parse markers
    if (block.type === "table") {
      if (current !== null) {
        if (lastWasAnswer && current.answers.length > 0) {
          const prev = current.answers[current.answers.length - 1]!;
          prev.html = prev.html.replace(/<\/p>$/, "") + block.html + "</p>";
        } else {
          current.textParts.push(block.html);
        }
      } else {
        currentSection.text = (currentSection.text ?? "") + block.html;
      }
      continue;
    }

    if (marker) {
      flushQuestion();
      if (marker[1] === "/") {
        sectionOpen = false;
        currentSection = mainSection;
      } else {
        sectionOpen = true;
        currentSection = createSection("");
        titledSections.push(currentSection);
      }
      continue;
    }

    if (isHeading(block) && !inAnswerKey) {
      if (library.title === "") library.title = text;
      else if (sectionOpen && currentSection.title === "") currentSection.title = text;
      else if (sectionOpen)
        currentSection.text = (currentSection.text ?? "") + `<p>${block.html}</p>`;
      continue;
    }

    // no heading style used: first plain paragraph before any question or section becomes the library title (guide: filename fallback otherwise)
    if (
      library.title === "" &&
      !sectionOpen &&
      current === null &&
      assignments.length === 0 &&
      text
    ) {
      library.title = text;
      continue;
    }

    if (ANSWERS_KEY.test(text)) {
      flushQuestion();
      inAnswerKey = true;
      continue;
    }

    if (inAnswerKey) {
      if (isQuestionNumber(block)) {
        answerKey.push(text);
      } else if (block.numbering === undefined && TYPED_QUESTION.test(text)) {
        answerKey.push(stripHtml(stripTypedMarker(block.html)));
      } else if (answerKey.length > 0) {
        answerKey[answerKey.length - 1] += " " + text;
      }
      continue;
    }

    // header params apply to the NEXT question (they precede the item)
    const header = text.match(HEADER_PARAM);
    if (header) {
      wrAnswerOpen = false;
      const key = header[1]!.toLowerCase();
      const value = header[2]!.trim();
      if (key === "title") pending.title = value;
      else if (key.startsWith("point")) {
        const n = value.match(/\d+([.,]\d+)?/);
        if (n) pending.points = parseFloat(n[0].replace(",", "."));
      } else if (key === "type") pending.declaredType = value;
      else if (key.startsWith("random")) {
        const v = value.toLowerCase();
        if (["yes", "true"].includes(v)) pending.randomize = true;
        else if (["no", "false"].includes(v)) pending.randomize = false;
      }
      continue;
    }

    // markers belong to the current question by text, even if the line is numbered
    if (current !== null) {
      const feedback = text.match(FEEDBACK);
      if (feedback) {
        wrAnswerOpen = false;
        const value = feedback[1]!.trim();
        if (lastWasAnswer && current.answers.length > 0) {
          current.answers[current.answers.length - 1]!.feedback = value;
        } else {
          current.feedback = value;
        }
        continue;
      }

      const hint = text.match(HINT);
      if (hint) {
        wrAnswerOpen = false;
        current.hint = hint[1]!.trim();
        continue;
      }

      const wrKey = text.match(WR_KEY);
      if (wrKey) {
        current.wrAnswer = wrKey[1]!.trim();
        wrAnswerOpen = true;
        continue;
      }
    }

    // lines after "Correct answer:" extend the WR sample answer. Numbered items only merge
    // when they belong to a different list than the question's own (a sublist, not the next question).
    if (
      wrAnswerOpen &&
      current !== null &&
      !isAnswerLetter(block) &&
      (block.numbering === undefined || block.numbering.numId !== current.numId)
    ) {
      if (text) {
        const item = block.numbering ? `${block.numbering.value}. ${text}` : text;
        current.wrAnswer = (current.wrAnswer ? current.wrAnswer + " " : "") + item;
      }
      continue;
    }

    const typedQ = block.numbering === undefined && TYPED_QUESTION.test(text);
    if (isQuestionNumber(block) || typedQ) {
      flushQuestion();
      current = { ...newWorking(), ...pending, numId: block.numbering?.numId };
      pending = {};
      assignments.push({ section: currentSection, question: current });
      const html = typedQ ? stripTypedMarker(block.html) : block.html;
      // guard on raw html: image-only paragraphs strip to empty text but must still become the question body
      if (html.trim()) current.textParts.push(`<p>${html}</p>`);
      continue;
    }

    if (current === null) {
      if (sectionOpen) {
        // first plain paragraph in a section without a heading title becomes the title; following paragraphs are intro text
        if (currentSection.title === "") currentSection.title = text;
        else currentSection.text = (currentSection.text ?? "") + `<p>${block.html}</p>`;
      }
      continue;
    }

    const typedA =
      block.numbering === undefined ? text.match(TYPED_ANSWER) : null;
    if (isAnswerLetter(block) || typedA) {
      wrAnswerOpen = false;
      let html = typedA ? stripTypedMarker(block.html) : block.html;
      let correct = !!(typedA && (typedA[1] || typedA[2]));
      const t = stripHtml(html);
      if (t.startsWith("*")) {
        correct = true;
        html = html.replace(/^(<[^>]+>)*\s*\*/, (m) => m.replace("*", ""));
      }
      current.answers.push({ html: `<p>${html}</p>`, correct });
      lastWasAnswer = true;
      continue;
    }

    // plain continuation line
    if (lastWasAnswer && current.answers.length > 0) {
      const prev = current.answers[current.answers.length - 1]!;
      prev.html = prev.html.replace(/<\/p>$/, "") + `<br>${block.html}</p>`;
    } else if (block.html.trim()) {
      current.textParts.push(`<p>${block.html}</p>`);
    }
  }

  // finalize: build questions into their sections, answer key by global index
  assignments.forEach(({ section, question }, i) => {
    section.questions.push(applyAnswerKey(question, i, answerKey));
  });
  library.sections = [
    ...(mainSection.questions.length > 0 ? [mainSection] : []),
    ...titledSections,
  ];
  return library;
}

function applyAnswerKey(w: WorkingQuestion, idx: number, key: string[]): Question {
  if (key.length === 0) return buildQuestion(w);
  const entry = key[idx];
  if (entry === undefined) return buildQuestion(w);

  const declared = normalizeDeclared(w.declaredType);
  const base = {
    id: newId("q"),
    title: w.title,
    points: w.points ?? 1,
    hint: w.hint,
    feedback: w.feedback,
  };
  const text = w.textParts.join("");

  if (w.answers.length > 0) {
    // letter key: a,b,c (MC/MS/TF)
    const letters = entry.toLowerCase().split(",").map((s) => s.trim());
    const idxs = new Set(letters.map((l) => l.charCodeAt(0) - 97));
    const plainTexts = w.answers.map((a) => stripHtml(a.html).toLowerCase());
    const isTrueFalse =
      w.answers.length === 2 &&
      plainTexts.some((t) => t === "true") &&
      plainTexts.some((t) => t === "false");

    if (isTrueFalse || declared === "TF") {
      const tf = {
        ...base, kind: "TF" as const, text,
        trueWeight: 0, falseWeight: 0,
        trueFeedback: undefined as string | undefined,
        falseFeedback: undefined as string | undefined,
      };
      w.answers.forEach((a, i) => {
        const t = plainTexts[i]!;
        const correct = idxs.has(i);
        if (t.includes("true")) {
          if (correct) tf.trueWeight = 100;
          if (a.feedback) tf.trueFeedback = a.feedback;
        }
        if (t.includes("false")) {
          if (correct) tf.falseWeight = 100;
          if (a.feedback) tf.falseFeedback = a.feedback;
        }
      });
      return tf;
    }

    if (idxs.size > 1 || declared === "MS") {
      return {
        ...base, kind: "MS", text, randomize: w.randomize,
        answers: w.answers.map((a, i) => ({
          id: newId("a"), html: a.html, feedback: a.feedback, isCorrect: idxs.has(i),
        })),
      };
    }
    return {
      ...base, kind: "MC", text, randomize: w.randomize,
      answers: w.answers.map((a, i) => ({
        id: newId("a"), html: a.html, feedback: a.feedback, weight: idxs.has(i) ? 100 : 0,
      })),
    };
  }

  // no inline answers: semicolon-separated key entries
  const parts = entry.split(";").map((s) => s.trim()).filter(Boolean);
  const allPairs = parts.length > 1 && parts.every((p) => p.includes("="));
  const blanks = text.match(BLANK) ?? [];

  if (allPairs || declared === "MAT") {
    return {
      ...base, kind: "MAT", text, gradingType: 0,
      pairs: parts.map((p) => {
        const [premise = "", response = ""] = splitPair(p);
        return { id: newId("m"), premise, response };
      }),
    };
  }
  if (blanks.length > 0 && blanks.length === parts.length) {
    const q = buildFib(base, text) as Extract<Question, { kind: "FIB" }>;
    let i = 0;
    q.parts = q.parts.map((part) =>
      part.part === "blank" ? { ...part, answers: [parts[i++]!] } : part,
    );
    return q;
  }
  if (parts.length > 1 || declared === "ORD") {
    return {
      ...base, kind: "ORD", text,
      items: parts.map((p) => ({ id: newId("o"), html: p })),
    };
  }
  return { ...base, kind: "WR", text, answerKey: parts[0] ?? entry };
}

/** Read a .docx file into the model. */
export async function readDocx(data: Uint8Array | ArrayBuffer): Promise<Library> {
  const { blocks, trackedChanges, comments, insertedText, deletedText, commentTexts, badImages } =
    await readDocxBlocks(data);
  const lib = interpretBlocks(blocks);
  const warnings: NonNullable<Library["importWarnings"]> = [];
  if (trackedChanges)
    warnings.push({
      html: "This file was edited with Word's Track Changes (reviewer mode) and still has changes that were not accepted or rejected. <strong>The original text was imported without the reviewer's edits.</strong><br>Please review the questions carefully.",
      details: [
        ...insertedText.map((t) => `Inserted: "${t}"`),
        ...deletedText.map((t) => `Deleted: "${t}"`),
      ],
    });
  if (comments)
    warnings.push({
      html: "This file contains reviewer comments. <strong>Comments are not imported.</strong>",
      details: commentTexts.map((t) => `Comment: ${t}`),
    });
  if (badImages.length > 0)
    warnings.push({
      html: "This file contains EMF/WMF images, which web browsers and the LMS cannot display. <strong>Replace them with JPG or PNG images and convert again.</strong>",
      details: badImages.map((n) => `Image: ${n}`),
    });
  for (const w of warnings) if (w.details?.length === 0) delete w.details;
  if (warnings.length > 0) lib.importWarnings = warnings;
  return lib;
}
