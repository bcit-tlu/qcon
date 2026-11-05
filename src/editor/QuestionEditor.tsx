// SPDX-License-Identifier: MPL-2.0
// Per-question structured editor. Dispatches kind-specific answer controls.
// Shared fields (title, points, text, hint, feedback) render for all kinds.

import { useState } from "react";
import type { Question, QuestionKind } from "../model/types.js";
import { QUESTION_KIND_LABELS } from "../model/types.js";
import { newId } from "../model/factory.js";
import { conversionLosses, convertQuestion } from "../model/convert.js";
import { RichText } from "./RichText.js";

interface Props {
  question: Question;
  onChange: (q: Question) => void;
  /** omit to hide the delete button (e.g. modal mode has its own) */
  onRemove?: () => void;
  /** omit to hide the move up/down buttons */
  onMove?: (dir: -1 | 1) => void;
}

const KINDS = Object.keys(QUESTION_KIND_LABELS) as QuestionKind[];

export function QuestionEditor({ question, onChange, onRemove, onMove }: Props) {
  const q = question;
  const set = (patch: Partial<Question>) => onChange({ ...q, ...patch } as Question);

  const [pendingKind, setPendingKind] = useState<QuestionKind | null>(null);

  const changeKind = (kind: QuestionKind) => {
    if (kind === q.kind) return;
    if (conversionLosses(q, kind).length === 0) {
      onChange(convertQuestion(q, kind));
    } else {
      setPendingKind(kind);
    }
  };

  return (
    <fieldset className="question">
      <legend>
        <span className="kind-badge">{QUESTION_KIND_LABELS[q.kind]}</span>
        {(onMove || onRemove) && (
          <span className="q-actions">
            {onMove && (
              <>
                <button type="button" onClick={() => onMove(-1)} title="Move up">↑</button>
                <button type="button" onClick={() => onMove(1)} title="Move down">↓</button>
              </>
            )}
            {onRemove && (
              <button type="button" className="danger" onClick={onRemove} title="Delete question">✕</button>
            )}
          </span>
        )}
      </legend>

      <div className="row">
        <label>
          Type{" "}
          <select value={q.kind} onChange={(e) => changeKind(e.target.value as QuestionKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{QUESTION_KIND_LABELS[k]}</option>
            ))}
          </select>
        </label>
        <label>
          Points{" "}
          <input
            type="number"
            min={0}
            step={0.5}
            value={q.points ?? 1}
            onChange={(e) => set({ points: parseFloat(e.target.value) || 0 })}
          />
        </label>
        <label className="grow">
          Title (optional){" "}
          <input value={q.title ?? ""} onChange={(e) => set({ title: e.target.value || undefined })} />
        </label>
      </div>

      {q.kind !== "FIB" && (
        <label className="block">
          Question text
          <RichText value={q.text} onChange={(html) => set({ text: html })} />
        </label>
      )}

      <KindFields q={q} set={set} />

      <details className="extras">
        <summary>Hint &amp; general feedback</summary>
        <label className="block">
          Hint
          <RichText compact value={q.hint ?? ""} onChange={(html) => set({ hint: html || undefined })} />
        </label>
        <label className="block">
          Feedback
          <RichText compact value={q.feedback ?? ""} onChange={(html) => set({ feedback: html || undefined })} />
        </label>
      </details>

      {pendingKind && (
        <div className="modal-backdrop">
          <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label="Confirm conversion">
            <h3>
              Convert to {QUESTION_KIND_LABELS[pendingKind]}?
            </h3>
            <p>The following content cannot be carried over and will be removed:</p>
            <ul>
              {conversionLosses(q, pendingKind).map((loss) => (
                <li key={loss}>{loss}</li>
              ))}
            </ul>
            <div className="modal-actions">
              <button
                type="button"
                className="danger"
                onClick={() => {
                  onChange(convertQuestion(q, pendingKind));
                  setPendingKind(null);
                }}
              >
                Convert and discard
              </button>
              <button type="button" onClick={() => setPendingKind(null)}>
                Keep {QUESTION_KIND_LABELS[q.kind]}
              </button>
            </div>
          </div>
        </div>
      )}
    </fieldset>
  );
}

function KindFields({
  q,
  set,
}: {
  q: Question;
  set: (patch: Partial<Question>) => void;
}) {
  switch (q.kind) {
    case "MC":
      return (
        <div className="answers">
          <p className="hint-line">Mark exactly one answer correct.</p>
          {q.answers.map((a, i) => (
            <div key={a.id} className="answer-row">
              <input
                type="radio"
                name={`mc-${q.id}`}
                checked={a.weight === 100}
                onChange={() =>
                  set({
                    answers: q.answers.map((x, j) => ({ ...x, weight: j === i ? 100 : 0 })),
                  })
                }
              />
              <RichText compact value={a.html} onChange={(html) =>
                set({ answers: q.answers.map((x, j) => (j === i ? { ...x, html } : x)) })
              } />
              <input
                className="fb"
                placeholder="feedback (optional)"
                value={a.feedback ?? ""}
                onChange={(e) =>
                  set({
                    answers: q.answers.map((x, j) =>
                      j === i ? { ...x, feedback: e.target.value || undefined } : x,
                    ),
                  })
                }
              />
              <button type="button" className="danger" disabled={q.answers.length <= 2}
                onClick={() => set({ answers: q.answers.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" onClick={() =>
            set({ answers: [...q.answers, { id: newId("a"), html: "", weight: 0 }] })
          }>+ Add answer</button>
        </div>
      );

    case "MS":
      return (
        <div className="answers">
          <p className="hint-line">Mark all correct answers.</p>
          {q.answers.map((a, i) => (
            <div key={a.id} className="answer-row">
              <input
                type="checkbox"
                checked={a.isCorrect}
                onChange={(e) =>
                  set({
                    answers: q.answers.map((x, j) =>
                      j === i ? { ...x, isCorrect: e.target.checked } : x,
                    ),
                  })
                }
              />
              <RichText compact value={a.html} onChange={(html) =>
                set({ answers: q.answers.map((x, j) => (j === i ? { ...x, html } : x)) })
              } />
              <input
                className="fb"
                placeholder="feedback (optional)"
                value={a.feedback ?? ""}
                onChange={(e) =>
                  set({
                    answers: q.answers.map((x, j) =>
                      j === i ? { ...x, feedback: e.target.value || undefined } : x,
                    ),
                  })
                }
              />
              <button type="button" className="danger" disabled={q.answers.length <= 2}
                onClick={() => set({ answers: q.answers.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" onClick={() =>
            set({ answers: [...q.answers, { id: newId("a"), html: "", isCorrect: false }] })
          }>+ Add answer</button>
        </div>
      );

    case "TF":
      return (
        <div className="answers">
          <label>
            <input
              type="radio"
              name={`tf-${q.id}`}
              checked={q.trueWeight === 100}
              onChange={() => set({ trueWeight: 100, falseWeight: 0 })}
            />{" "}
            True is correct
          </label>
          <label>
            <input
              type="radio"
              name={`tf-${q.id}`}
              checked={q.falseWeight === 100}
              onChange={() => set({ trueWeight: 0, falseWeight: 100 })}
            />{" "}
            False is correct
          </label>
        </div>
      );

    case "FIB":
      return (
        <div className="answers">
          <p className="hint-line">
            Fill-in-the-blank: text segments interleaved with blanks. Each blank accepts
            one or more correct answers.
          </p>
          {q.parts.map((p, i) =>
            p.part === "text" ? (
              <RichText
                key={p.id}
                compact
                value={p.html}
                onChange={(html) =>
                  set({ parts: q.parts.map((x, j) => (j === i ? { ...x, html } : x)) })
                }
              />
            ) : (
              <div key={p.id} className="answer-row blank-row">
                <span className="kind-badge">blank</span>
                <input
                  className="grow"
                  placeholder="accepted answers, comma-separated"
                  value={p.answers.join(", ")}
                  onChange={(e) =>
                    set({
                      parts: q.parts.map((x, j) =>
                        j === i && x.part === "blank"
                          ? { ...x, answers: e.target.value.split(",").map((s) => s.trim()) }
                          : x,
                      ),
                    })
                  }
                />
                <button type="button" className="danger"
                  onClick={() => set({ parts: q.parts.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ),
          )}
          <div className="row">
            <button type="button" onClick={() =>
              set({
                parts: [
                  ...q.parts,
                  { id: newId("p"), part: "blank", answers: [""] },
                  { id: newId("p"), part: "text", html: "" },
                ],
              })
            }>+ Add blank</button>
          </div>
        </div>
      );

    case "MAT":
      return (
        <div className="answers">
          {q.pairs.map((p, i) => (
            <div key={p.id} className="answer-row">
              <input
                className="grow"
                placeholder="premise"
                value={stripTags(p.premise)}
                onChange={(e) =>
                  set({
                    pairs: q.pairs.map((x, j) => (j === i ? { ...x, premise: e.target.value } : x)),
                  })
                }
              />
              <span>=</span>
              <input
                className="grow"
                placeholder="response"
                value={stripTags(p.response)}
                onChange={(e) =>
                  set({
                    pairs: q.pairs.map((x, j) => (j === i ? { ...x, response: e.target.value } : x)),
                  })
                }
              />
              <button type="button" className="danger" disabled={q.pairs.length <= 1}
                onClick={() => set({ pairs: q.pairs.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" onClick={() =>
            set({ pairs: [...q.pairs, { id: newId("m"), premise: "", response: "" }] })
          }>+ Add pair</button>
        </div>
      );

    case "ORD":
      return (
        <div className="answers">
          <p className="hint-line">Items in the correct order.</p>
          {q.items.map((item, i) => (
            <div key={item.id} className="answer-row">
              <span className="ord-num">{i + 1}.</span>
              <RichText compact value={item.html} onChange={(html) =>
                set({ items: q.items.map((x, j) => (j === i ? { ...x, html } : x)) })
              } />
              <button type="button" className="danger" disabled={q.items.length <= 1}
                onClick={() => set({ items: q.items.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" onClick={() =>
            set({ items: [...q.items, { id: newId("o"), html: "" }] })
          }>+ Add item</button>
        </div>
      );

    case "WR":
      return (
        <label className="block">
          Answer key (shown to graders, optional)
          <RichText
            compact
            value={q.answerKey ?? ""}
            onChange={(html) => set({ answerKey: html || undefined })}
          />
        </label>
      );
  }
}

const stripTags = (html: string) => html.replace(/<[^>]+>/g, "");
