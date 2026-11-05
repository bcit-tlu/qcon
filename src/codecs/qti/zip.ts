// SPDX-License-Identifier: MPL-2.0
// SCORM packaging: questiondb.xml + imsmanifest.xml + image assets, zipped.
// Data-URI images embedded in question/section HTML are extracted into zip files and their src attributes rewritten to the packaged filename.

import JSZip from "jszip";
import type { Library, Question, Section } from "../../model/types.js";
import { writeManifest, writeQuestionDb, type WriterOptions } from "./writer.js";
import { readQuestionDb } from "./reader.js";

const DATA_URI_IMG = /<img\b[^>]*?\bsrc=["']data:([^;,]+);base64,([^"']+)["'][^>]*>/g;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

interface ExtractedImage {
  path: string;
  base64: string;
}

/** Legacy qcon folder slug: lowercase, non-alphanumerics collapsed to hyphens. */
function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[\W_]+/g, " ")
    .trim()
    .replace(/ /g, "-");
  return slug || "questions";
}

/**
 * Replace data-URI <img> sources with packaged asset paths; collect payloads.
 * Mirrors legacy qcon: images become image_N.ext under the media folder, and the whole tag is rewritten with alt + max-width style.
 */
function extractDataUriImages(
  library: Library,
  mediaFolder: string,
): {
  library: Library;
  images: ExtractedImage[];
} {
  const images: ExtractedImage[] = [];
  const rewrite = (html: string): string =>
    html.replace(DATA_URI_IMG, (_m, mime: string, base64: string) => {
      const ext = EXT_BY_MIME[mime] ?? "png";
      const filename = `image_${images.length + 1}.${ext}`;
      const path = `${mediaFolder}/${filename}`;
      images.push({ path, base64 });
      return `<img src="${path}" alt="${filename}" style="max-width:100%;">`;
    });

  const rewriteQuestion = (q: Question): Question => {
    const cloned = { ...q, text: rewrite(q.text) } as Question;
    if (cloned.hint) cloned.hint = rewrite(cloned.hint);
    if (cloned.feedback) cloned.feedback = rewrite(cloned.feedback);
    if (cloned.kind === "MC") cloned.answers = cloned.answers.map((x) => ({ ...x, html: rewrite(x.html) }));
    if (cloned.kind === "MS") cloned.answers = cloned.answers.map((x) => ({ ...x, html: rewrite(x.html) }));
    if (cloned.kind === "ORD") cloned.items = cloned.items.map((x) => ({ ...x, html: rewrite(x.html) }));
    if (cloned.kind === "MAT")
      cloned.pairs = cloned.pairs.map((x) => ({
        ...x,
        premise: rewrite(x.premise),
        response: rewrite(x.response),
      }));
    if (cloned.kind === "FIB")
      cloned.parts = cloned.parts.map((p) =>
        p.part === "text" ? { ...p, html: rewrite(p.html) } : p,
      );
    if (cloned.kind === "WR" && cloned.answerKey)
      cloned.answerKey = rewrite(cloned.answerKey);
    return cloned;
  };

  const sections: Section[] = library.sections.map((s) => ({
    ...s,
    text: s.text ? rewrite(s.text) : undefined,
    questions: s.questions.map(rewriteQuestion),
  }));

  return { library: { ...library, sections }, images };
}

export interface ZipOptions extends WriterOptions {
  /**
   * Folder inside the zip for extracted images. Defaults to the legacy
   * `assessment-assets/{title-slug}` layout.
   */
  mediaFolder?: string;
}

/** Build the SCORM zip as a Uint8Array (caller decides how to save it). */
export async function writeScormZip(
  library: Library,
  opts: ZipOptions = {},
): Promise<Uint8Array> {
  const mediaFolder = (
    opts.mediaFolder ?? `assessment-assets/${slugify(library.title)}`
  ).replace(/^\/+|\/+$/g, "");
  const { library: rewritten, images } = extractDataUriImages(library, mediaFolder);

  const zip = new JSZip();
  zip.file("questiondb.xml", writeQuestionDb(rewritten, opts));
  zip.file("imsmanifest.xml", writeManifest());
  for (const img of images) {
    zip.file(img.path, img.base64, { base64: true });
  }
  return zip.generateAsync({ type: "uint8array" });
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

/** Read a SCORM zip back into the model; image files become data URIs. */
export async function readScormZip(data: Uint8Array | ArrayBuffer): Promise<Library> {
  const zip = await JSZip.loadAsync(data);
  const questiondb = zip.file("questiondb.xml");
  if (!questiondb) throw new Error("Not a qcon SCORM package: questiondb.xml missing");

  // collect binary assets and re-inline them as data URIs
  const dataUris = new Map<string, string>();
  for (const [filename, entry] of Object.entries(zip.files)) {
    if (entry.dir || filename === "questiondb.xml" || filename === "imsmanifest.xml")
      continue;
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const mime = MIME_BY_EXT[ext];
    if (!mime) continue;
    const base64 = await entry.async("base64");
    dataUris.set(filename, `data:${mime};base64,${base64}`);
  }

  let xml = await questiondb.async("string");
  for (const [filename, uri] of dataUris) {
    xml = xml.split(`src="${filename}"`).join(`src="${uri}"`);
  }
  return readQuestionDb(xml);
}
