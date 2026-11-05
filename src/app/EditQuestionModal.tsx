// SPDX-License-Identifier: MPL-2.0
// Modal for editing a single question; the draft applies only on Save.

import type { Question } from "../model/types.js";
import { QuestionEditor } from "../editor/QuestionEditor.js";

interface EditQuestionModalProps {
  draft: Question;
  onDraftChange: (q: Question) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

export function EditQuestionModal({
  draft,
  onDraftChange,
  onSave,
  onCancel,
  onDelete,
}: EditQuestionModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Edit question">
        <QuestionEditor
          question={draft}
          onChange={onDraftChange}
        />
        <div className="modal-actions">
          <button type="button" className="danger" onClick={onDelete}>
            Delete question
          </button>
          <button type="button" className="primary" onClick={onSave}>
            Save changes
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
