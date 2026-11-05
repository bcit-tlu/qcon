// SPDX-License-Identifier: MPL-2.0
// Section editor: title, intro text, shuffle flag, question list.

import type { QuestionKind, Section } from "../model/types.js";
import { QUESTION_KIND_LABELS } from "../model/types.js";
import { createQuestion } from "../model/factory.js";
import { RichText } from "./RichText.js";
import { QuestionEditor } from "./QuestionEditor.js";
import { moveQuestion, removeQuestion, updateQuestion } from "./update.js";
import type { Library } from "../model/types.js";

interface Props {
  library: Library;
  section: Section;
  /** true for the untitled "main" section (no title/markers) */
  isMain: boolean;
  onLibraryChange: (lib: Library) => void;
  onRemove?: () => void;
}

export function SectionEditor({ library, section, isMain, onLibraryChange, onRemove }: Props) {
  const patchSection = (fn: (s: Section) => Section) =>
    onLibraryChange({
      ...library,
      sections: library.sections.map((s) => (s.id === section.id ? fn(s) : s)),
    });

  const addQuestion = (kind: QuestionKind) =>
    patchSection((s) => ({ ...s, questions: [...s.questions, createQuestion(kind)] }));

  return (
    <section className="section-card">
      <header className="section-head">
        {isMain ? (
          <h3>Questions</h3>
        ) : (
          <input
            className="section-title"
            placeholder="Section title"
            value={section.title}
            onChange={(e) => patchSection((s) => ({ ...s, title: e.target.value }))}
          />
        )}
        <span className="q-actions">
          {!isMain && onRemove && (
            <button type="button" className="danger" onClick={onRemove} title="Delete section">
              ✕ section
            </button>
          )}
        </span>
      </header>

      {!isMain && (
        <label className="block">
          Intro text (optional)
          <RichText
            compact
            value={section.text ?? ""}
            onChange={(html) => patchSection((s) => ({ ...s, text: html || undefined }))}
          />
        </label>
      )}

      {section.questions.map((q) => (
        <QuestionEditor
          key={q.id}
          question={q}
          onChange={(next) =>
            onLibraryChange(updateQuestion(library, section.id, q.id, () => next))
          }
          onRemove={() => onLibraryChange(removeQuestion(library, section.id, q.id))}
          onMove={(dir) => onLibraryChange(moveQuestion(library, section.id, q.id, dir))}
        />
      ))}

      <div className="row add-question">
        <span>Add:</span>
        {(Object.keys(QUESTION_KIND_LABELS) as QuestionKind[]).map((k) => (
          <button key={k} type="button" onClick={() => addQuestion(k)}>
            + {k}
          </button>
        ))}
      </div>
    </section>
  );
}
