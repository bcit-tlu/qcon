// SPDX-License-Identifier: MPL-2.0
// Export helpers: apply app options to the library and trigger a browser download.

import type { Library } from "../model/types.js";
import { writeScormZip } from "../codecs/qti/zip.js";
import { writeDocx } from "../codecs/docx/writer.js";

export interface ExportOptions {
  enumeration: string;
  enumEnabled: boolean;
  customFolder: boolean;
  folderName: string;
}

/** apply the chosen enumeration to MC/MS/TF questions lacking an explicit one */
function withEnumeration(lib: Library, enumeration: string): Library {
  return {
    ...lib,
    sections: lib.sections.map((s) => ({
      ...s,
      questions: s.questions.map((q) =>
        (q.kind === "MC" || q.kind === "MS" || q.kind === "TF") && !q.enumeration
          ? { ...q, enumeration }
          : q,
      ),
    })),
  };
}

/** apply the library default to MC/MS questions lacking an explicit randomize setting */
function withRandomize(lib: Library): Library {
  return {
    ...lib,
    sections: lib.sections.map((s) => ({
      ...s,
      questions: s.questions.map((q) =>
        (q.kind === "MC" || q.kind === "MS") && q.randomize === undefined
          ? { ...q, randomize: true }
          : q,
      ),
    })),
  };
}

/** library title -> download filename, minus characters that are unsafe on disk */
const safeFilename = (title: string) =>
  title.replace(/[\\/:*?"<>|]/g, "_").trim() || "questions";

function download(bytes: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportScormZip(library: Library, opts: ExportOptions) {
  let out = library.randomizeAnswers ? withRandomize(library) : library;
  if (opts.enumEnabled) out = withEnumeration(out, opts.enumeration);
  download(
    await writeScormZip(out, {
      mediaFolder: opts.customFolder ? opts.folderName : undefined,
    }),
    `${safeFilename(library.title)}.zip`,
    "application/zip",
  );
}

export async function exportDocxFile(library: Library) {
  if (
    library.importWarnings?.length &&
    !window.confirm(
      "The original Word file had content that can't be exported (tracked changes, comments, or unsupported images). Continue?",
    )
  )
    return;
  download(
    await writeDocx(library),
    `${safeFilename(library.title)}.docx`,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
}
