// SPDX-License-Identifier: MPL-2.0
// Library editor: title, section list, validation summary.

import type { Library } from "../model/types.js";
import { createSection } from "../model/factory.js";
import { validateLibrary } from "../model/validate.js";
import { SectionEditor } from "./SectionEditor.js";
import { removeSection } from "./update.js";

interface Props {
  library: Library;
  onChange: (lib: Library) => void;
}

export function LibraryEditor({ library, onChange }: Props) {
  const validation = validateLibrary(library);

  const addSection = () =>
    onChange({
      ...library,
      sections: [...library.sections, createSection(`Section ${library.sections.length + 1}`)],
    });

  return (
    <div className="library-editor">
      <label className="block">
        Library title
        <input
          className="library-title"
          value={library.title}
          onChange={(e) => onChange({ ...library, title: e.target.value })}
        />
      </label>

      <label>
        <input
          type="checkbox"
          checked={library.randomizeAnswers}
          onChange={(e) => onChange({ ...library, randomizeAnswers: e.target.checked })}
        />{" "}
        Randomize answers by default
      </label>

      {validation.errorCount + validation.warningCount > 0 && (
        <p className={validation.errorCount > 0 ? "val-error" : "val-warn"}>
          {validation.errorCount} error(s), {validation.warningCount} warning(s)
        </p>
      )}

      {library.sections.map((s, i) => (
        <SectionEditor
          key={s.id}
          library={library}
          section={s}
          isMain={i === 0 && s.title === ""}
          onLibraryChange={onChange}
          onRemove={() => onChange(removeSection(library, s.id))}
        />
      ))}

      <button type="button" onClick={addSection}>+ Add section</button>
    </div>
  );
}
