// SPDX-License-Identifier: MPL-2.0
// Toolbar shown while a library is loaded: re-import, mode switch, undo/redo, export.

export type Mode = "preview" | "edit-all";

interface LibraryToolbarProps {
  busy: boolean;
  onFile: (file: File) => void;
  showModeSwitch: boolean;
  mode: Mode;
  onMode: (mode: Mode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExportDocx: () => void;
  onExportZip: () => void;
}

export function LibraryToolbar({
  busy,
  onFile,
  showModeSwitch,
  mode,
  onMode,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onExportDocx,
  onExportZip,
}: LibraryToolbarProps) {
  return (
    <div className="app-toolbar">
      <label className="file-button">
        {busy ? "Importing…" : "Import file"}
        <input
          type="file"
          accept=".docx,.zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onFile(f);
          }}
        />
      </label>
      {showModeSwitch && (
        <div className="mode-switch" role="tablist">
          <button
            type="button"
            className={mode === "preview" ? "active" : ""}
            onClick={() => onMode("preview")}
          >
            Preview
          </button>
          <button
            type="button"
            className={mode === "edit-all" ? "active" : ""}
            onClick={() => onMode("edit-all")}
          >
            Edit all
          </button>
        </div>
      )}
      <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">↩</button>
      <button type="button" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">↪</button>
      <button type="button" onClick={onExportDocx}>Export Word (.docx)</button>
      <button type="button" className="primary" onClick={onExportZip}>Export SCORM zip</button>
    </div>
  );
}
