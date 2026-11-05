// SPDX-License-Identifier: MPL-2.0
// App shell: import (.docx | SCORM .zip) → preview → edit (single question or all) → export (.docx | .zip).
// Everything runs client-side.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Library, Question } from "../model/types.js";
import { readScormZip } from "../codecs/qti/zip.js";
import { readDocx } from "../codecs/docx/interpret.js";
import { LibraryEditor } from "../editor/LibraryEditor.js";
import { LibraryPreview } from "../editor/Preview.js";
import { LibrarySummary } from "../editor/Summary.js";
import { removeQuestion, updateQuestion } from "../editor/update.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { useLibraryHistory } from "./useLibraryHistory.js";
import { exportDocxFile, exportScormZip } from "./export.js";
import { Landing } from "./Landing.js";
import { LibraryToolbar, type Mode } from "./LibraryToolbar.js";
import { EditQuestionModal } from "./EditQuestionModal.js";
import { ImportWarnings } from "./ImportWarnings.js";

export function App() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [mode, setMode] = useState<Mode>("preview");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [enumeration, setEnumeration] = useState("4");
  const [enumEnabled, setEnumEnabled] = useState(false);
  const [randomize, setRandomize] = useState(false);
  const [customFolder, setCustomFolder] = useState(false);
  const [folderName, setFolderName] = useState("assessment-assets");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showSummary, setShowSummary] = useState(true);
  // draft of the question being edited in the modal; applied only on Save
  const [draft, setDraft] = useState<Question | null>(null);

  const { setLibraryTracked, undo, redo, resetHistory, canUndo, canRedo } =
    useLibraryHistory(library, setLibrary);

  // ref so keyboard handler can call the latest exportZip
  const exportZipRef = useRef<(() => void) | null>(null);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // don't hijack undo while a modal edit is open or the user is typing in a field
      const target = e.target as HTMLElement;
      if (editingId) return;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((mod && e.key === "y") || (mod && e.shiftKey && e.key === "z")) {
        e.preventDefault();
        redo();
      } else if (mod && e.key === "s") {
        e.preventDefault();
        if (library) void exportZipRef.current?.();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [undo, redo, library, editingId]);

  const onFile = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      if (/\.docx$/i.test(file.name) || /\.zip$/i.test(file.name)) {
        const lib = /\.docx$/i.test(file.name)
          ? await readDocx(buf)
          : await readScormZip(buf);
        // titleless documents inherit the source filename so exports get a real name
        if (!lib.title.trim()) lib.title = file.name.replace(/\.(docx|zip)$/i, "");
        lib.randomizeAnswers = randomize;
        setLibrary(lib);
      } else {
        setError("Unsupported file type. Choose a .docx or .zip file.");
      }
      setMode("preview");
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [randomize]);

  const exportZip = useCallback(async () => {
    if (!library) return;
    await exportScormZip(library, { enumeration, enumEnabled, customFolder, folderName });
  }, [library, enumEnabled, enumeration, customFolder, folderName]);
  exportZipRef.current = exportZip;

  const exportDocx = useCallback(async () => {
    if (library) await exportDocxFile(library);
  }, [library]);

  // locate the question being singly edited (and its section)
  const editing = useMemo(() => {
    if (!library || !editingId) return null;
    for (const s of library.sections) {
      const q = s.questions.find((x) => x.id === editingId);
      if (q) return { section: s, question: q };
    }
    return null;
  }, [library, editingId]);

  const close = () => {
    if (
      library &&
      !window.confirm(
        "Discard the imported questions and any edits? This cannot be undone.",
      )
    )
      return;
    setLibrary(null);
    setEditingId(null);
    setDraft(null);
    setMode("preview");
    resetHistory();
  };

  // ---- single-question edit modal ----
  const startEditing = useCallback(
    (id: string) => {
      if (!library) return;
      for (const s of library.sections) {
        const q = s.questions.find((x) => x.id === id);
        if (q) {
          setDraft(q);
          setEditingId(id);
          return;
        }
      }
    },
    [library],
  );

  const saveEditing = useCallback(() => {
    if (!library || !editingId || !draft) return;
    const sec = library.sections.find((s) => s.questions.some((q) => q.id === editingId));
    if (!sec) return;
    setLibraryTracked(updateQuestion(library, sec.id, editingId, () => draft));
    setEditingId(null);
    setDraft(null);
  }, [library, editingId, draft, setLibraryTracked]);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setDraft(null);
  }, []);

  const deleteEditing = useCallback(() => {
    if (!library || !editing) return;
    setLibraryTracked(removeQuestion(library, editing.section.id, editing.question.id));
    setEditingId(null);
    setDraft(null);
  }, [library, editing, setLibraryTracked]);

  // ---- drag-and-drop ----
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);
  const onDragLeave = useCallback(() => setDragging(false), []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) void onFile(f);
    },
    [onFile],
  );

  return (
    <ErrorBoundary>
      <main
        className={`app ${dragging ? "drag-over" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragging && <div className="drop-overlay">Drop .docx or .zip to import</div>}
        {busy && <div className="loading-overlay"><div className="spinner" /></div>}

        <header className="app-bar">
          <div className="app-bar-inner">
            <h1 className="app-title">
              <button type="button" onClick={close}>QCon</button>
            </h1>
            <hr className="separator" />
            <a
              className="guide-button"
              href="https://qcon-guide.ltc.bcit.ca"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 17h-2v-2h2v2zm2.07-7.75-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26A2 2 0 1 0 10 8H8a4 4 0 1 1 8 0c0 .88-.36 1.68-.93 2.25z" />
              </svg>
              QCon Guide
            </a>
          </div>
        </header>

        <div className="app-main">
          <nav className="breadcrumbs" aria-label="breadcrumb">
            <span className="crumb current">upload</span>
            {library && (
              <>
                <span className="crumb-sep" aria-hidden="true">›</span>
                <span className={`crumb ${!editing && mode === "preview" ? "current" : ""}`}>preview</span>
              </>
            )}
            {library && (editing || mode === "edit-all") && (
              <>
                <span className="crumb-sep" aria-hidden="true">›</span>
                <span className="crumb current">edit</span>
              </>
            )}
          </nav>

          {library && (
            <LibraryToolbar
              busy={busy}
              onFile={(f) => void onFile(f)}
              showModeSwitch={!editing}
              mode={mode}
              onMode={setMode}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={undo}
              onRedo={redo}
              onExportDocx={() => void exportDocx()}
              onExportZip={() => void exportZip()}
            />
          )}

          {error && <p className="val-error">Import failed: {error}</p>}

          {library?.importWarnings && (
            <ImportWarnings warnings={library.importWarnings} />
          )}

          {!library && (
            <Landing
              busy={busy}
              onFile={(f) => void onFile(f)}
              enumeration={enumeration}
              onEnumeration={setEnumeration}
              enumEnabled={enumEnabled}
              onEnumEnabled={setEnumEnabled}
              randomize={randomize}
              onRandomize={setRandomize}
              customFolder={customFolder}
              onCustomFolder={setCustomFolder}
              folderName={folderName}
              onFolderName={setFolderName}
            />
          )}

          {library && mode === "preview" && (
            <>
              <div className="view-summary">
                <button type="button" className="link" onClick={() => setShowSummary((v) => !v)}>
                  {showSummary ? "Hide Summary ▴" : "View Summary ▾"}
                </button>
              </div>
              {showSummary && <LibrarySummary library={library} />}
              <LibraryPreview
                library={library}
                enumeration={enumEnabled ? enumeration : "4"}
                onEditQuestion={startEditing}
              />
            </>
          )}

          {library && !editing && mode === "edit-all" && (
            <LibraryEditor library={library} onChange={setLibraryTracked} />
          )}

          {library && !editing && (
            <div className="buttons-group">
              <button type="button" onClick={() => void exportDocx()}>Export Word (.docx)</button>
              <button type="button" className="primary" onClick={() => void exportZip()}>Export SCORM zip</button>
            </div>
          )}

          {library && editing && draft && (
            <EditQuestionModal
              draft={draft}
              onDraftChange={setDraft}
              onSave={saveEditing}
              onCancel={cancelEditing}
              onDelete={deleteEditing}
            />
          )}
        </div>
      </main>
      <footer className="app-footer">
        <span>qcon v{__APP_VERSION__}</span>
        <span className="cp-footer">
          contact{" "}
          <a href="mailto:courseproduction@bcit.ca">courseproduction@bcit.ca</a>
        </span>
      </footer>
    </ErrorBoundary>
  );
}
