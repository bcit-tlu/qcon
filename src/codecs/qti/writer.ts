// SPDX-License-Identifier: MPL-2.0
// QTI writer: model -> questiondb.xml (QTI 1.2 questestinterop/objectbank with D2L d2l_2p0 extensions).
// Port of qcon-api/api/scorm/XmlWriter.py.
//
// Intentional deviations from the legacy port (legacy bugs, noted inline):
//   - Matching: render_choice is emitted into every response_grp instead of being moved into the last one by ET.append
//   - Matching grading types 1/2 emit the intended score expressions instead of the buggy legacy XML (XmlWriter.py lines 582-609)
//   - WR: initial_text_material nests inside initial_text

import type {
  FibQuestion,
  Library,
  MatQuestion,
  McQuestion,
  MsQuestion,
  OrdQuestion,
  Question,
  Section,
  TfQuestion,
  WrQuestion,
} from "../../model/types.js";
import { QUESTION_KIND_LABELS } from "../../model/types.js";
import { cdata, el, serialize, type XmlNode } from "./xml.js";

const D2L_NS = "http://desire2learn.com/xsd/d2lcp_v2p0";

export interface WriterOptions {
  /** fixed timestamp for deterministic output in tests */
  timestamp?: number;
  /** extra entropy source for deterministic idents in tests */
  random?: () => number;
}

class IdentGen {
  private n = 0;
  constructor(private opts: WriterOptions) {}
  next(): string {
    const ts = this.opts.timestamp ?? Date.now();
    const rand = this.opts.random ?? Math.random;
    this.n++;
    return `${ts.toString(36)}${Math.floor(rand() * 1e7)
      .toString()
      .padStart(7, "0")}${this.n.toString(36)}`;
  }
}

// ---- shared item helpers -------------------------------------------------

function itemetadata(typeLabel: string, points?: number): XmlNode {
  const field = (label: string, entry: string) =>
    el(
      "qti_metadatafield",
      {},
      el("fieldlabel", {}, label),
      el("fieldentry", {}, entry),
    );
  return el(
    "itemmetadata",
    {},
    el(
      "qtimetadata",
      {},
      field("qmd_computerscored", "yes"),
      field("qmd_questiontype", typeLabel),
      field("qmd_weighting", (points ?? 1).toFixed(4)),
    ),
  );
}

function itemprocExtension(): XmlNode {
  return el(
    "itemproc_extension",
    {},
    el("d2l_2p0:difficulty", {}, "1"),
    el("d2l_2p0:isbonus", {}, "no"),
    el("d2l_2p0:ismandatory", {}, "no"),
  );
}

function feedbackItem(ident: string, feedback: string): XmlNode {
  return el(
    "itemfeedback",
    { ident },
    el("material", {}, el("mattext", { texttype: "text/html" }, cdata(feedback))),
  );
}

function hintItem(hint: string): XmlNode {
  return el(
    "hint",
    {},
    el(
      "hintmaterial",
      {},
      el(
        "flow_mat",
        {},
        el("material", {}, el("mattext", { texttype: "text/html" }, cdata(hint))),
      ),
    ),
  );
}

function htmlMaterial(html: string): XmlNode {
  return el("material", {}, el("mattext", { texttype: "text/html" }, cdata(html)));
}

function responseExtension(enumeration: string | undefined, gradingType: string): XmlNode {
  return el(
    "response_extension",
    {},
    el("d2l_2p0:display_style", {}, "2"),
    el("d2l_2p0:enumeration", {}, enumeration ?? "4"),
    el("d2l_2p0:grading_type", {}, gradingType),
  );
}

function responseLabel(ident: string, html: string): XmlNode {
  return el(
    "response_label",
    { ident },
    el(
      "flow_mat",
      {},
      el("material", {}, el("mattext", { texttype: "text/html" }, cdata(html))),
    ),
  );
}

function labeledAnswer(ident: string, html: string, useCdata = true): XmlNode {
  return el(
    "flow_label",
    { class: "Block" },
    useCdata
      ? responseLabel(ident, html)
      : el(
          "response_label",
          { ident },
          el(
            "flow_mat",
            {},
            el("material", {}, el("mattext", { texttype: "text/plain" }, html)),
          ),
        ),
  );
}

// ---- per-type item generators ---------------------------------------------

function genMC(it: XmlNode, qIdent: string, q: McQuestion): void {
  it.children.push(itemetadata("Multiple Choice", q.points), itemprocExtension());
  const lid = `${qIdent}_LID`;
  const a = `${qIdent}_A`;
  const fb = `${qIdent}_IF`;

  const renderChoice = el("render_choice", { shuffle: q.randomize ? "yes" : "no" });
  const presentation = el(
    "presentation",
    {},
    el(
      "flow",
      {},
      htmlMaterial(q.text),
      responseExtension(q.enumeration, "0"),
      el("response_lid", { ident: lid, rcardinality: "Multiple" }, renderChoice),
    ),
  );
  it.children.push(presentation);

  if (q.hint) it.children.push(hintItem(q.hint));

  const resprocessing = el("resprocessing", {});
  it.children.push(resprocessing);
  if (q.feedback) it.children.push(feedbackItem(qIdent, q.feedback));

  q.answers.forEach((answer, i) => {
    const n = i + 1;
    renderChoice.children.push(labeledAnswer(`${a}${n}`, answer.html));
    resprocessing.children.push(
      el(
        "respcondition",
        { title: `Response Condition${n}` },
        el(
          "conditionvar",
          {},
          el("varequal", { respident: lid }, `${a}${n}`),
        ),
        el("setvar", { action: "Set" }, answer.weight ? String(answer.weight) : "0.0000"),
        el("displayfeedback", { feedbacktype: "Response", linkrefid: `${fb}${n}` }),
      ),
    );
    if (answer.feedback) it.children.push(feedbackItem(`${fb}${n}`, answer.feedback));
  });
}

function genTF(it: XmlNode, qIdent: string, q: TfQuestion): void {
  it.children.push(itemetadata("True/False", q.points), itemprocExtension());
  const lid = `${qIdent}_LID`;
  const a = `${qIdent}_A`;
  const fb = `${qIdent}_IF`;

  const renderChoice = el("render_choice", { shuffle: "no" });
  it.children.push(
    el(
      "presentation",
      {},
      el(
        "flow",
        {},
        htmlMaterial(q.text),
        responseExtension(q.enumeration, "0"),
        el("response_lid", { ident: lid, rcardinality: "Single" }, renderChoice),
      ),
    ),
  );

  const resprocessing = el("resprocessing", {});
  it.children.push(resprocessing);
  if (q.feedback) it.children.push(feedbackItem(qIdent, q.feedback));

  const sides = [
    { text: "True", weight: q.trueWeight, feedback: q.trueFeedback },
    { text: "False", weight: q.falseWeight, feedback: q.falseFeedback },
  ];
  sides.forEach((side, i) => {
    renderChoice.children.push(labeledAnswer(`${a}${i}`, side.text, false));
    resprocessing.children.push(
      el(
        "respcondition",
        { title: `Response Condition${i}` },
        el("conditionvar", {}, el("varequal", { respident: lid }, `${a}${i}`)),
        el("setvar", { action: "Set" }, side.weight ? String(side.weight) : "0.0000"),
        el("displayfeedback", { feedbacktype: "Response", linkrefid: `${fb}${i}` }),
      ),
    );
    if (side.feedback) it.children.push(feedbackItem(`${fb}${i}`, side.feedback));
  });
}

function genFIB(it: XmlNode, qIdent: string, q: FibQuestion): void {
  it.children.push(itemetadata("Fill in the Blanks", q.points), itemprocExtension());

  const flow = el("flow", {});
  it.children.push(el("presentation", {}, flow));

  let blankIdx = 0;
  for (const part of q.parts) {
    if (part.part === "blank") {
      blankIdx++;
      flow.children.push(
        el(
          "response_str",
          { rcardinality: "Single", ident: `${qIdent}${blankIdx}_STR` },
          el(
            "render_fib",
            { fibtype: "String", prompt: "Box", columns: "30", rows: "1" },
            el("response_label", { ident: `${qIdent}${blankIdx}_ANS` }),
          ),
        ),
      );
    } else {
      flow.children.push(htmlMaterial(part.html));
    }
  }

  if (q.hint) it.children.push(hintItem(q.hint));

  const outcomes = el("outcomes", {});
  const resprocessing = el("resprocessing", {}, outcomes);
  it.children.push(resprocessing);

  const blanks = q.parts.filter((p) => p.part === "blank");
  const weight = String(100.0 / (blanks.length || 1));
  blanks.forEach((blank, i) => {
    const n = i + 1;
    if (blank.part !== "blank") return;
    for (const answer of blank.answers.map((s) => s.trim()).filter(Boolean)) {
      resprocessing.children.push(
        el(
          "respcondition",
          {},
          el(
            "conditionvar",
            {},
            el("varequal", { case: "no", respident: `${qIdent}${n}_ANS` }, answer),
          ),
          el("setvar", { action: "Set" }, weight),
        ),
      );
    }
    outcomes.children.push(
      el("decvar", {
        varname: `Blank_${n}`,
        maxvalue: "100",
        minvalue: "0",
        vartype: "Integer",
      }),
    );
  });

  if (q.feedback) it.children.push(feedbackItem(qIdent, q.feedback));
}

function genMS(it: XmlNode, qIdent: string, q: MsQuestion): void {
  it.children.push(itemetadata("Multi-Select", q.points), itemprocExtension());
  const lid = `${qIdent}_LID`;
  const a = `${qIdent}_A`;
  const fb = `${qIdent}_IF`;

  const renderChoice = el("render_choice", { shuffle: q.randomize ? "yes" : "no" });
  it.children.push(
    el(
      "presentation",
      {},
      el(
        "flow",
        {},
        htmlMaterial(q.text),
        responseExtension(q.enumeration, "2"),
        el("response_lid", { ident: lid, rcardinality: "Multiple" }, renderChoice),
      ),
    ),
  );

  if (q.hint) it.children.push(hintItem(q.hint));

  const resprocessing = el(
    "resprocessing",
    {},
    el(
      "outcomes",
      {},
      el("decvar", { vartype: "Integer", defaultval: "0", varname: "que_score", minvalue: "0", maxvalue: "100" }),
      el("decvar", { vartype: "Integer", defaultval: "0", varname: "D2L_Correct", minvalue: "0" }),
      el("decvar", { vartype: "Integer", defaultval: "0", varname: "D2L_Incorrect", minvalue: "0" }),
    ),
  );
  it.children.push(resprocessing);
  if (q.feedback) it.children.push(feedbackItem(qIdent, q.feedback));

  q.answers.forEach((answer, i) => {
    const n = i + 1;
    renderChoice.children.push(labeledAnswer(`${a}${n}`, answer.html));
    resprocessing.children.push(
      el(
        "respcondition",
        { title: "Response Condition", continue: "yes" },
        el("conditionvar", {}, el("varequal", { respident: lid }, `${a}${n}`)),
        el(
          "setvar",
          { varname: answer.isCorrect ? "D2L_Correct" : "D2L_Incorrect", action: "Add" },
        ),
      ),
    );
    if (answer.feedback) it.children.push(feedbackItem(`${fb}${n}`, answer.feedback));
  });

  resprocessing.children.push(
    el(
      "respcondition",
      {},
      el("setvar", { varname: "que_score", action: "Set" }, "D2L_Correct"),
    ),
  );
}

function genMAT(it: XmlNode, qIdent: string, q: MatQuestion): void {
  it.children.push(itemetadata("Matching", q.points), itemprocExtension());
  const c = `${qIdent}_C`;
  const a = `${qIdent}_A`;

  if (q.hint) it.children.push(hintItem(q.hint));

  const resprocessing = el(
    "resprocessing",
    {},
    el(
      "outcomes",
      {},
      el("decvar", { vartype: "Integer", defaultval: "0", varname: "D2L_Correct", minvalue: "0", maxvalue: "100" }),
      el("decvar", { vartype: "Integer", defaultval: "0", varname: "D2L_Incorrect", minvalue: "0", maxvalue: "100" }),
      el("decvar", { vartype: "Decimal", defaultval: "0", varname: "que_score", minvalue: "0", maxvalue: "100" }),
    ),
  );
  it.children.push(resprocessing);

  // unique responses across all pairs
  const responses: string[] = [];
  for (const pair of q.pairs) {
    if (!responses.includes(pair.response)) responses.push(pair.response);
  }

  const answerLabels = () =>
    el(
      "flow_label",
      { class: "Block" },
      ...responses.map((r, j) => responseLabel(`${a}${j + 1}`, r)),
    );

  const flow = el(
    "flow",
    {},
    htmlMaterial(q.text),
    el("response_extension", {}, el("d2l_2p0:grading_type", {}, "2")),
  );
  it.children.push(el("presentation", {}, flow));

  q.pairs.forEach((pair, i) => {
    const n = i + 1;
    const grpIdent = `${c}${n}`;
    flow.children.push(
      el(
        "response_grp",
        { respident: grpIdent, rcardinality: "Single" },
        htmlMaterial(pair.premise),
        el("render_choice", { shuffle: "yes" }, answerLabels()),
      ),
    );
    responses.forEach((response, j) => {
      const correct = response === pair.response;
      resprocessing.children.push(
        el(
          "respcondition",
          {},
          el("conditionvar", {}, el("varequal", { respident: grpIdent }, `${a}${j + 1}`)),
          el("setvar", { varname: correct ? "D2L_Correct" : "D2L_Incorrect", action: "Add" }, "1"),
        ),
      );
    });
  });

  // final score expression per grading type (see header note on legacy bugs)
  if (q.gradingType === 0) {
    resprocessing.children.push(
      el(
        "respcondition",
        {},
        el("conditionvar", {}, el("other")),
        el("setvar", { varname: "que_score", action: "Set" }, "D2L_Correct"),
      ),
    );
  } else if (q.gradingType === 1) {
    resprocessing.children.push(
      el(
        "respcondition",
        {},
        el("conditionvar", {}, el("vargte", { respident: "D2L_Incorrect" }, "1")),
        el("setvar", { varname: "que_score", action: "Set" }, "0"),
      ),
      el(
        "respcondition",
        {},
        el("conditionvar", {}, el("other")),
        el("setvar", { varname: "que_score", action: "Set" }, "D2L_Correct"),
      ),
    );
  } else {
    resprocessing.children.push(
      el(
        "respcondition",
        {},
        el("conditionvar", {}, el("other")),
        el("setvar", { varname: "que_score", action: "Set" }, "D2L_Correct"),
        el("setvar", { varname: "que_score", action: "Subtract" }, "D2L_Incorrect"),
      ),
    );
  }

  if (q.feedback) it.children.push(feedbackItem(qIdent, q.feedback));
}

function genORD(it: XmlNode, qIdent: string, q: OrdQuestion): void {
  it.children.push(itemetadata("Ordering", q.points), itemprocExtension());
  const o = `${qIdent}_O`;
  const fb = `${qIdent}_IF`;

  const renderFlow = el("flow_label", { class: "Block" });
  it.children.push(
    el(
      "presentation",
      {},
      el(
        "flow",
        {},
        htmlMaterial(q.text),
        el("response_extension", {}, el("d2l_2p0:grading_type", {}, "2")),
        el(
          "response_grp",
          { ident: o, rcardinality: "Ordered" },
          el("render_choice", { shuffle: "yes" }, renderFlow),
        ),
      ),
    ),
  );

  if (q.hint) it.children.push(hintItem(q.hint));

  const resprocessing = el(
    "resprocessing",
    {},
    el(
      "outcomes",
      {},
      el("decvar", { maxvalue: "100", minvalue: "0", varname: "D2L_Correct", defaultval: "0", vartype: "Integer" }),
      el("decvar", { minvalue: "0", varname: "D2L_Incorrect", defaultval: "0", vartype: "Integer" }),
      el("decvar", { minvalue: "0", varname: "que_score", defaultval: "0", vartype: "Integer" }),
    ),
    el(
      "respcondition",
      {},
      el("conditionvar", {}, el("other")),
      el("setvar", { varname: "que_score", action: "Set" }, "D2L_Correct"),
    ),
  );
  it.children.push(resprocessing);
  if (q.feedback) it.children.push(feedbackItem(qIdent, q.feedback));

  q.items.forEach((item, i) => {
    const n = i + 1;
    const ident = `${o}${n}`;
    renderFlow.children.push(
      el(
        "response_label",
        { ident },
        el("flow_mat", {}, htmlMaterial(item.html)),
      ),
    );
    resprocessing.children.push(
      el(
        "respcondition",
        { title: "Correct Condition" },
        el("conditionvar", {}, el("varequal", { respident: ident }, String(n))),
        el("setvar", { varname: "D2L_Correct", action: "Add" }, "1"),
      ),
      el(
        "respcondition",
        { title: "Incorrect Condition" },
        el(
          "conditionvar",
          {},
          el("not", {}, el("varequal", { respident: ident }, String(n))),
        ),
        el("setvar", { varname: "D2L_Incorrect", action: "Add" }, "1"),
      ),
    );
    if (item.feedback) it.children.push(feedbackItem(`${fb}${n}`, item.feedback));
  });
}

function genWR(it: XmlNode, qIdent: string, q: WrQuestion): void {
  it.children.push(itemetadata("Long Answer", q.points), itemprocExtension());

  it.children.push(
    el(
      "presentation",
      {},
      el(
        "flow",
        {},
        htmlMaterial(q.text),
        el(
          "response_extension",
          {},
          el("d2l_2p0:has_signed_comments", {}, "no"),
          el("d2l_2p0:has_htmleditor", {}, "no"),
        ),
        el(
          "response_str",
          { rcardinality: "Multiple", ident: `${qIdent}_STR` },
          el(
            "render_fib",
            { fibtype: "String", prompt: "Box", columns: "100", rows: "15" },
            el(
              "response_label",
              { ident: `${qIdent}_LA` },
              el("flow_mat", {}, el("material", {}, el("mattext", { texttype: "text/html" }))),
            ),
          ),
        ),
      ),
    ),
  );

  if (q.hint) it.children.push(hintItem(q.hint));
  if (q.feedback) it.children.push(feedbackItem(qIdent, q.feedback));

  it.children.push(
    el(
      "initial_text",
      {},
      el(
        "initial_text_material",
        {},
        el("flow_mat", {}, el("material", {}, el("mattext", { texttype: "text/html" }))),
      ),
    ),
    el(
      "answer_key",
      {},
      el(
        "answer_key_material",
        {},
        el(
          "flow_mat",
          {},
          el(
            "material",
            {},
            el("mattext", { texttype: "text/html" }, cdata(q.answerKey ?? "")),
          ),
        ),
      ),
    ),
  );
}

const GENERATORS: Record<Question["kind"], (it: XmlNode, id: string, q: never) => void> = {
  MC: genMC as never,
  MS: genMS as never,
  TF: genTF as never,
  FIB: genFIB as never,
  MAT: genMAT as never,
  ORD: genORD as never,
  WR: genWR as never,
};

// ---- document structure ----------------------------------------------------

function sectionEl(title: string, text: string | undefined, shuffle: boolean, ident: string): XmlNode {
  const section = el("section", { ident, title });
  if (shuffle) {
    section.children.push(el("selection_ordering", {}, el("order", { order_type: "Random" })));
  }
  section.children.push(
    el(
      "presentation_material",
      {},
      el(
        "flow_mat",
        {},
        el(
          "flow_mat",
          {},
          text
            ? htmlMaterial(text)
            : el("material", {}, el("mattext", { texttype: "text/html" })),
        ),
      ),
    ),
    el(
      "sectionproc_extension",
      {},
      el("d2l_2p0:display_section_name", {}, "yes"),
      el("d2l_2p0:display_section_line", {}, "no"),
      el("d2l_2p0:type_display_section", {}, text ? "1" : "0"),
    ),
  );
  return section;
}

function questionItem(q: Question, gen: IdentGen): XmlNode {
  const ident = gen.next();
  const qIdent = `QUES_${ident}`;
  const item = el("item", {
    ident: `OBJ_${ident}`,
    label: qIdent,
    "d2l_2p0:page": "1",
    title: q.title ?? "",
  });
  GENERATORS[q.kind](item, qIdent, q as never);
  return item;
}

/** Serialize the library to questiondb.xml content. */
export function writeQuestionDb(library: Library, opts: WriterOptions = {}): string {
  const gen = new IdentGen(opts);
  const libIdent = `QLIB_${(opts.timestamp ?? Date.now()).toString(36)}`;
  const sectIdent = `SECT_${gen.next()}`;

  // base section holds main questions directly; named sections nest inside
  const base = sectionEl(library.title, undefined, false, sectIdent);
  for (const section of library.sections) {
    appendSection(base, section, gen);
  }

  const root = el(
    "questestinterop",
    {},
    el("objectbank", { ident: libIdent, "xmlns:d2l_2p0": D2L_NS }, base),
  );
  return serialize(root);
}

function appendSection(parent: XmlNode, section: Section, gen: IdentGen): void {
  const target =
    section.title === ""
      ? parent // untitled sections merge into the parent (main content)
      : (() => {
          const sub = sectionEl(section.title, section.text, section.shuffle, `SECT_${gen.next()}`);
          parent.children.push(sub);
          return sub;
        })();
  for (const q of section.questions) {
    target.children.push(questionItem(q, gen));
  }
}

/** imsmanifest.xml content (single question-library resource, as legacy). */
export function writeManifest(): string {
  const root = el(
    "manifest",
    {
      "xmlns:d2l_2p0": D2L_NS,
      xmlns: "http://www.imsglobal.org/xsd/imscp_v1p1",
      identifier: "MANIFEST_1",
    },
    el(
      "resources",
      {},
      el("resource", {
        identifier: "res_question_library",
        type: "webcontent",
        "d2l_2p0:material_type": "d2lquestionlibrary",
        href: "questiondb.xml",
        "d2l_2p0:link_target": "",
        title: "Question Library",
      }),
    ),
  );
  return serialize(root);
}
