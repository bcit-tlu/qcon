// SPDX-License-Identifier: MPL-2.0
// Conversion summary tables: counts and points by section and question type.
// Recreates the qcon-web Summary panel, computed client-side from the Library model.

import type { Library, QuestionKind } from "../model/types.js";
import { validateLibrary } from "../model/validate.js";

const GUIDE = "https://qcon-guide.ltc.bcit.ca";

// Question type rows in the same order and with the same guide links as the legacy summary.
const KIND_ROWS: { kind: QuestionKind; label: string; href: string }[] = [
  { kind: "MC", label: "Multiple Choice (MC)", href: `${GUIDE}/detailed-question-types/multiple-choice/` },
  { kind: "TF", label: "True/False (TF)", href: `${GUIDE}/detailed-question-types/true-false/` },
  { kind: "MS", label: "Multiple-Select (MS)", href: `${GUIDE}/detailed-question-types/multiple-select/` },
  { kind: "ORD", label: "Ordering (ORD)", href: `${GUIDE}/detailed-question-types/ordering/` },
  { kind: "MAT", label: "Matching (MAT)", href: `${GUIDE}/detailed-question-types/matching/` },
  { kind: "FIB", label: "Fill In the Blanks (FIB)", href: `${GUIDE}/detailed-question-types/fill-in-blanks/` },
  { kind: "WR", label: "Written Response (WR)", href: `${GUIDE}/detailed-question-types/written-response/` },
];

const pts = (q: { points?: number }) => q.points ?? 1;

const sumPoints = (qs: { points?: number }[]) => qs.reduce((n, q) => n + pts(q), 0);

export function LibrarySummary({ library }: { library: Library }) {
  const validation = validateLibrary(library);
  const all = library.sections.flatMap((s) => s.questions);

  const titled = library.sections.filter((s) => s.title !== "");
  const untitled = library.sections.filter((s) => s.title === "");
  const untitledQuestions = untitled.flatMap((s) => s.questions);
  const sectionRows = titled.map((s) => ({
    title: s.title,
    count: s.questions.length,
    points: sumPoints(s.questions),
  }));
  const sectionTotal = { count: all.length, points: sumPoints(all) };

  const kindStats = KIND_ROWS.map((row) => {
    const qs = all.filter((q) => q.kind === row.kind);
    return { ...row, count: qs.length, points: sumPoints(qs) };
  }).filter((r) => r.count > 0);

  const errorIds = new Set(
    validation.issues.filter((i) => i.severity === "error").map((i) => i.questionId),
  );
  const errorPoints = sumPoints(all.filter((q) => errorIds.has(q.id)));

  // Question numbers match LibraryPreview's continuous numbering across sections.
  const numbers = new Map<string, number>();
  let n = 0;
  for (const s of library.sections) for (const q of s.questions) numbers.set(q.id, ++n);

  return (
    <div className="summary">
      <table className="summary-table object-summary">
        <thead>
          <tr className="header-row">
            <th>Object</th>
            <th>Counts</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <a href={`${GUIDE}/additional-info/media-links/#images`} target="_blank" rel="noopener noreferrer">Image</a>
            </td>
            <td className="num">{library.assets.length}</td>
          </tr>
          <tr>
            <td>
              <a href={`${GUIDE}/additional-info/sections/`} target="_blank" rel="noopener noreferrer">Section</a>
            </td>
            <td className="num">{titled.length}</td>
          </tr>
        </tbody>
      </table>

      {sectionRows.length > 0 && (
        <table className="summary-table">
          <thead>
            <tr className="header-row">
              <th>Section Name</th>
              <th>Counts</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {untitledQuestions.length > 0 && (
              <tr>
                <td>Questions without section</td>
                <td className="num">{untitledQuestions.length}</td>
                <td className="num">{sumPoints(untitledQuestions)}</td>
              </tr>
            )}
            {sectionRows.map((r) => (
              <tr key={r.title}>
                <td>{r.title}</td>
                <td className="num">{r.count}</td>
                <td className="num">{r.points}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td><strong>TOTAL</strong></td>
              <td className="num"><strong>{sectionTotal.count}</strong></td>
              <td className="num"><strong>{sectionTotal.points}</strong></td>
            </tr>
          </tbody>
        </table>
      )}

      <table className="summary-table">
        <thead>
          <tr className="header-row">
            <th>Question Type</th>
            <th>Counts</th>
            <th>
              <a href={`${GUIDE}/additional-info/points/`} target="_blank" rel="noopener noreferrer">Points</a>
            </th>
          </tr>
        </thead>
        <tbody>
          {kindStats.map((r) => (
            <tr key={r.kind}>
              <td>
                <a href={r.href} target="_blank" rel="noopener noreferrer">{r.label}</a>
              </td>
              <td className="num">{r.count}</td>
              <td className="num">{r.points}</td>
            </tr>
          ))}
          {errorIds.size > 0 && (
            <tr className="error-row">
              <td>ERROR</td>
              <td className="num">{errorIds.size}</td>
              <td className="num">{errorPoints}</td>
            </tr>
          )}
          <tr className="total-row">
            <td><strong>TOTAL</strong></td>
            <td className="num"><strong>{all.length}</strong></td>
            <td className="num"><strong>{sumPoints(all)}</strong></td>
          </tr>
        </tbody>
      </table>

      {validation.issues.length > 0 && (
        <table className="summary-table error-summary">
          <thead>
            <tr>
              <th>Question Number</th>
              <th>Error Message(s)</th>
            </tr>
          </thead>
          <tbody>
            {validation.issues.map((issue, i) => (
              <tr key={i} className={issue.severity === "warning" ? "warning-row" : ""}>
                <td className="num">{numbers.get(issue.questionId)}</td>
                <td>
                  {issue.severity === "warning" ? "Warning: " : ""}
                  {issue.message}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
