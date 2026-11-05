// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { createLibrary, createQuestion, newId } from "../../model/factory.js";
import { validateLibrary } from "../../model/validate.js";
import { writeQuestionDb, writeManifest } from "./writer.js";
import { writeScormZip } from "./zip.js";
import JSZip from "jszip";

const OPTS = { timestamp: 1755565200000, random: () => 0.5 };

function sampleLibrary() {
  const lib = createLibrary("Midterm Exam");
  const section = lib.sections[0]!;

  const mc = createQuestion("MC");
  if (mc.kind === "MC") {
    mc.title = "Addition";
    mc.text = "<p>What is 2 + 2?</p>";
    mc.points = 2;
    mc.answers = [
      { id: newId("a"), html: "<p>3</p>", weight: 0 },
      { id: newId("a"), html: "<p>4</p>", weight: 100 },
      { id: newId("a"), html: "<p>5</p>", weight: 0 },
    ];
  }
  const tf = createQuestion("TF");
  if (tf.kind === "TF") {
    tf.text = "<p>The sky is blue.</p>";
    tf.trueWeight = 100;
    tf.falseWeight = 0;
  }
  section.questions.push(mc, tf);
  return lib;
}

describe("QTI writer", () => {
  it("emits objectbank with the library title as base section", () => {
    const xml = writeQuestionDb(sampleLibrary(), OPTS);
    expect(xml).toContain("<questestinterop>");
    expect(xml).toContain('ident="QLIB_');
    expect(xml).toContain('title="Midterm Exam"');
  });

  it("marks the correct MC answer with weight 100", () => {
    const xml = writeQuestionDb(sampleLibrary(), OPTS);
    const conditions = xml.match(/<respcondition[^>]*title="Response Condition\d"/g);
    expect(conditions).toHaveLength(5); // 3 MC + 2 TF
    expect(xml).toContain(">100<");
  });

  it("writes qmd metadata with question type and points", () => {
    const xml = writeQuestionDb(sampleLibrary(), OPTS);
    expect(xml).toContain("<fieldlabel>qmd_questiontype</fieldlabel>");
    expect(xml).toContain("<fieldentry>Multiple Choice</fieldentry>");
    expect(xml).toContain("<fieldentry>2.0000</fieldentry>");
  });

  it("emits a manifest with the question-library resource", () => {
    const manifest = writeManifest();
    expect(manifest).toContain('identifier="MANIFEST_1"');
    expect(manifest).toContain('d2l_2p0:material_type="d2lquestionlibrary"');
    expect(manifest).toContain('href="questiondb.xml"');
  });

  it("packages a valid zip with questiondb + manifest", async () => {
    const bytes = await writeScormZip(sampleLibrary(), OPTS);
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file("questiondb.xml")).toBeTruthy();
    expect(zip.file("imsmanifest.xml")).toBeTruthy();
  });

  it("extracts data-URI images into the legacy assessment-assets folder", async () => {
    const lib = sampleLibrary();
    const q = lib.sections[0]!.questions[0]!;
    q.text = '<p>Pic <img src="data:image/png;base64,iVBORw0KGgo=" /></p>';
    const bytes = await writeScormZip(lib, OPTS);
    const zip = await JSZip.loadAsync(bytes);
    // legacy layout: assessment-assets/{title-slug}/image_N.ext
    const path = "assessment-assets/midterm-exam/image_1.png";
    expect(zip.file(path)).toBeTruthy();
    const db = await zip.file("questiondb.xml")!.async("string");
    expect(db).toContain(`src="${path}"`);
    expect(db).not.toContain("data:image/png");
  });

  it("honours a custom media folder", async () => {
    const lib = sampleLibrary();
    const q = lib.sections[0]!.questions[0]!;
    q.text = '<p>Pic <img src="data:image/png;base64,iVBORw0KGgo=" /></p>';
    const bytes = await writeScormZip(lib, { ...OPTS, mediaFolder: "assets/m3" });
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file("assets/m3/image_1.png")).toBeTruthy();
    const db = await zip.file("questiondb.xml")!.async("string");
    expect(db).toContain('src="assets/m3/image_1.png"');
  });
});

describe("validation", () => {
  it("passes a well-formed library", () => {
    const result = validateLibrary(sampleLibrary());
    expect(result.errorCount).toBe(0);
  });

  it("flags an MC question without a correct answer", () => {
    const lib = sampleLibrary();
    const mc = lib.sections[0]!.questions[0]!;
    if (mc.kind === "MC") mc.answers.forEach((a) => (a.weight = 0));
    const result = validateLibrary(lib);
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.issues[0]?.message).toContain("No correct answer");
  });
});
