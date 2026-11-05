// SPDX-License-Identifier: MPL-2.0
// Undo/redo stacks for library edits, capped at MAX_HISTORY entries.

import { useCallback, useRef, useState } from "react";
import type { Library } from "../model/types.js";

const MAX_HISTORY = 100;

export function useLibraryHistory(
  library: Library | null,
  setLibrary: (lib: Library | null) => void,
) {
  const undoStack = useRef<Library[]>([]);
  const redoStack = useRef<Library[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const setLibraryTracked = useCallback(
    (next: Library) => {
      if (library) {
        undoStack.current.push(library);
        if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
        redoStack.current = [];
        setCanUndo(true);
        setCanRedo(false);
      }
      setLibrary(next);
    },
    [library, setLibrary],
  );

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev || !library) return;
    redoStack.current.push(library);
    setLibrary(prev);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  }, [library, setLibrary]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next || !library) return;
    undoStack.current.push(library);
    setLibrary(next);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }, [library, setLibrary]);

  const resetHistory = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  return { setLibraryTracked, undo, redo, resetHistory, canUndo, canRedo };
}
