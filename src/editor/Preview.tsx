// SPDX-License-Identifier: MPL-2.0
// Read-only preview of a library, rendered roughly as it would appear in the LMS.
// Correct answers are highlighted (instructor view).
// Each question has an Edit button for single-question editing.

import { Fragment } from "react";
import DOMPurify from "dompurify";
import type { Library, Question, Section } from "../model/types.js";
import { QUESTION_KIND_LABELS } from "../model/types.js";
import { validateLibrary, type QuestionIssue } from "../model/validate.js";

interface PreviewProps {
  library: Library;
  /** D2L enumeration code ("1"-"6"); default "4" = lower-alpha */
  enumeration: string;
  onEditQuestion: (questionId: string) => void;
}

// legacy qcon enumeration codes -> CSS list-style-type
const ENUM_STYLES: Record<string, string> = {
  "1": "decimal",
  "2": "lower-roman",
  "3": "upper-roman",
  "4": "lower-alpha",
  "5": "upper-alpha",
  "6": "none",
};

/** strip one wrapping <p>…</p> so the html can sit inline without a block break */
const unwrapP = (html: string) => {
  const m = html.match(/^\s*<p[^>]*>([\s\S]*)<\/p>\s*$/i);
  return m ? m[1]! : html;
};

/** strip ALL <p>/<\p> tags - for inline fragments like FIB text parts */
const stripP = (html: string) => html.replace(/<\/?p[^>]*>/gi, "");

// Block rendering by default: a <span> around <p> content gets torn apart by the browser's parser, producing phantom gaps.
// Use inline only where the caller unwraps the paragraph first.
const sanitize = (html: string) => DOMPurify.sanitize(html);

const Html = ({ html, inline }: { html: string; inline?: boolean }) =>
  inline ? (
    <span className="html" dangerouslySetInnerHTML={{ __html: sanitize(unwrapP(html)) }} />
  ) : (
    <div className="html" dangerouslySetInnerHTML={{ __html: sanitize(html) }} />
  );

export function LibraryPreview({ library, enumeration, onEditQuestion }: PreviewProps) {
  const validation = validateLibrary(library);
  const issueMap = new Map<string, QuestionIssue[]>();
  for (const issue of validation.issues) {
    const list = issueMap.get(issue.questionId) ?? [];
    list.push(issue);
    issueMap.set(issue.questionId, list);
  }
  // continuous question numbering across sections
  let n = 0;
  const starts = library.sections.map((s) => {
    const start = n;
    n += s.questions.length;
    return start;
  });
  return (
    <div className="preview">
      <h2 className="preview-title">{library.title || "Untitled"}</h2>
      {validation.errorCount + validation.warningCount > 0 && (
        <p className={validation.errorCount > 0 ? "val-error" : "val-warn"}>
          {validation.errorCount} error(s), {validation.warningCount} warning(s).
          Open edit mode to fix them.
        </p>
      )}
      {library.sections.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && <hr className="section-divider" />}
          <SectionPreview
            section={s}
            index={i}
            grouped={library.sections.length > 1}
            startIndex={starts[i] ?? 0}
            enumeration={enumeration}
            onEditQuestion={onEditQuestion}
            issueMap={issueMap}
          />
        </Fragment>
      ))}
    </div>
  );
}

function SectionPreview({
  section,
  index,
  grouped,
  startIndex,
  enumeration,
  onEditQuestion,
  issueMap,
}: {
  section: Section;
  index: number;
  grouped: boolean;
  startIndex: number;
  enumeration: string;
  onEditQuestion: (id: string) => void;
  issueMap: Map<string, QuestionIssue[]>;
}) {
  return (
    <section className={`preview-section${grouped ? " grouped" : ""}`}>
      {(section.title || grouped) && (
        <header className="preview-section-head">
          <h3>{section.title || `Section ${index + 1}`}</h3>
          {grouped && (
            <span className="section-count">
              {section.questions.length} question{section.questions.length === 1 ? "" : "s"}
            </span>
          )}
        </header>
      )}
      {section.text && (
        <div className="section-text" dangerouslySetInnerHTML={{ __html: sanitize(section.text) }} />
      )}
      {section.questions.map((q, i) => (
        <QuestionPreview
          key={q.id}
          question={q}
          number={startIndex + i + 1}
          enumeration={enumeration}
          onEdit={() => onEditQuestion(q.id)}
          issues={issueMap.get(q.id)}
        />
      ))}
    </section>
  );
}

function QuestionPreview({
  question,
  number,
  enumeration,
  onEdit,
  issues,
}: {
  question: Question;
  number: number;
  enumeration: string;
  onEdit: () => void;
  issues?: QuestionIssue[];
}) {
  const q = question;
  const hasError = issues?.some((i) => i.severity === "error");
  const hasWarning = !hasError && issues?.some((i) => i.severity === "warning");
  const issueClass = hasError ? "has-error" : hasWarning ? "has-warning" : "";
  return (
    <article className={`preview-question ${issueClass}`}>
      <header className="preview-q-head">
        <span className="q-number">{number}.</span>
        <span className="kind-badge">{QUESTION_KIND_LABELS[q.kind]}</span>
        <span className="q-points">{q.points ?? 1} pts</span>
        {q.title && <span className="q-title">{q.title}</span>}
        {issues && issues.length > 0 && (
          <span className={`issue-badge ${hasError ? "error" : "warning"}`} title={issues.map((i) => i.message).join("\n")}>
            {hasError ? "!" : "?"}
          </span>
        )}
        <button type="button" className="edit-one" onClick={onEdit}>
          Edit
        </button>
      </header>

      <div className="preview-q-body">
        {q.kind !== "FIB" && <div className="q-text"><Html html={q.text} /></div>}
        <KindPreview q={q} enumeration={enumeration} />
        {q.hint && <p className="meta-line">Hint: <Html inline html={q.hint} /></p>}
        {q.feedback && <p className="meta-line">Feedback: <Html inline html={q.feedback} /></p>}
      </div>
    </article>
  );
}

function KindPreview({ q, enumeration }: { q: Question; enumeration: string }) {
  // per-question override wins (set from docx Enumeration or QTI import); otherwise the user's global selection
  const perQuestion =
    (q.kind === "MC" || q.kind === "MS" || q.kind === "TF") && q.enumeration
      ? q.enumeration
      : enumeration;
  const listStyle = { listStyleType: ENUM_STYLES[perQuestion] ?? "lower-alpha" };

  switch (q.kind) {
    case "MC":
      return (
        <ul className="preview-answers" style={listStyle}>
          {q.answers.map((a) => (
            <li key={a.id} className={a.weight === 100 ? "correct" : ""}>
              <Html html={a.html} />
              {a.feedback && <div className="meta-line">{a.feedback}</div>}
            </li>
          ))}
        </ul>
      );
    case "MS":
      return (
        <ul className="preview-answers" style={listStyle}>
          {q.answers.map((a) => (
            <li key={a.id} className={a.isCorrect ? "correct" : ""}>
              <Html html={a.html} />
              {a.feedback && <div className="meta-line">{a.feedback}</div>}
            </li>
          ))}
        </ul>
      );
    case "TF":
      return (
        <ul className="preview-answers" style={listStyle}>
          <li className={q.trueWeight === 100 ? "correct" : ""}>True</li>
          <li className={q.falseWeight === 100 ? "correct" : ""}>False</li>
        </ul>
      );
    case "FIB":
      return (
        <p className="fib-text">
          {q.parts.map((p) =>
            p.part === "text" ? (
              <span key={p.id} className="html" dangerouslySetInnerHTML={{ __html: sanitize(stripP(p.html)) }} />
            ) : (
              <span key={p.id} className="fib-blank correct" title={p.answers.join(", ")}>
                {p.answers[0] || "____"}
              </span>
            ),
          )}
        </p>
      );
    case "MAT":
      return (
        <table className="preview-mat">
          <tbody>
            {q.pairs.map((p) => (
              <tr key={p.id}>
                <td><Html html={p.premise} /></td>
                <td><Html html={p.response} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "ORD":
      return (
        <ol className="preview-answers">
          {q.items.map((item) => (
            <li key={item.id} className="correct"><Html html={item.html} /></li>
          ))}
        </ol>
      );
    case "WR":
      return q.answerKey ? (
        <p className="meta-line correct">Answer key: <Html inline html={q.answerKey} /></p>
      ) : null;
  }
}
