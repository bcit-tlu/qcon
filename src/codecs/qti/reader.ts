// SPDX-License-Identifier: MPL-2.0
// QTI reader: questiondb.xml -> model.
// Symmetric with writer.ts - the round-trip invariant decode(encode(model)) == model is enforced by tests.

import { XMLParser } from "fast-xml-parser";
import type { Library, Question, Section } from "../../model/types.js";
import { newId } from "../../model/factory.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  parseTagValue: false,
  parseAttributeValue: false,
  // keep these as arrays even when only one child exists
  isArray: (tag) =>
    [
      "section",
      "item",
      "qti_metadatafield",
      "respcondition",
      "response_label",
      "flow_label",
      "material",
      "setvar",
      "itemfeedback",
      "response_grp",
      "decvar",
    ].includes(tag),
});

type N = Record<string, any>;

const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

const text = (node: N | string | number | undefined): string => {
  if (node === undefined) return "";
  if (typeof node !== "object") return String(node);
  if ("#cdata" in node) return String(node["#cdata"]);
  if ("#text" in node) return String(node["#text"]);
  return "";
};

const mattextHtml = (material: N | N[] | undefined): string => {
  const m = asArray(material)[0];
  return text(asArray(m?.mattext as N | N[])[0] ?? (m?.mattext as N));
};

function metaField(item: N, label: string): string | undefined {
  const fields = asArray(item.itemmetadata?.qtimetadata?.qti_metadatafield as N[]);
  const f = fields.find((x) => text(x.fieldlabel) === label);
  return f ? text(f.fieldentry) : undefined;
}

function firstMaterial(flowChildren: N | N[] | undefined): string {
  const materials = asArray(flowChildren as N[]);
  return materials.length > 0 ? mattextHtml(materials[0]) : "";
}

function questionText(flow: N): string {
  const materials = asArray(flow?.material as N[]);
  return materials.length > 0 ? mattextHtml(materials[0]) : "";
}

function questionHint(item: N): string | undefined {
  const m = item.hint?.hintmaterial?.flow_mat?.material as N | undefined;
  const html = mattextHtml(m);
  return html || undefined;
}

function generalFeedback(item: N, qLabel: string): string | undefined {
  const fbs = asArray(item.itemfeedback as N[]);
  const fb = fbs.find((f) => f["@_ident"] === qLabel);
  if (!fb) return undefined;
  const html = mattextHtml(fb.material as N);
  return html || undefined;
}

function answerFeedbackMap(item: N): Map<string, string> {
  const map = new Map<string, string>();
  for (const fb of asArray(item.itemfeedback as N[])) {
    map.set(fb["@_ident"], mattextHtml(fb.material as N));
  }
  return map;
}

interface RespCondition {
  varequalRespident?: string;
  varequalText?: string;
  varequalCase?: string;
  setvars: { varname?: string; action?: string; text: string }[];
}

function respconditions(item: N): RespCondition[] {
  return asArray(item.resprocessing?.respcondition as N[]).map((rc) => {
    const cv = rc.conditionvar;
    const ve = cv?.varequal ? (Array.isArray(cv.varequal) ? cv.varequal[0] : cv.varequal) : undefined;
    return {
      varequalRespident: ve?.["@_respident"],
      varequalText: ve === undefined ? undefined : text(ve),
      varequalCase: ve?.["@_case"],
      setvars: asArray(rc.setvar as N[]).map((sv) => ({
        varname: sv["@_varname"],
        action: sv["@_action"],
        text: text(sv),
      })),
    };
  });
}

function flowLabels(item: N): { ident: string; html: string }[] {
  const lid = item.presentation?.flow?.response_lid;
  const labels: { ident: string; html: string }[] = [];
  for (const fl of asArray(lid?.render_choice?.flow_label as N[])) {
    for (const rl of asArray(fl.response_label as N[])) {
      labels.push({
        ident: rl["@_ident"],
        html: mattextHtml(rl.flow_mat?.material as N | N[]),
      });
    }
  }
  return labels;
}

function parseMcOrMs(item: N, kind: "MC" | "MS", base: Partial<Question>): Question {
  const labels = flowLabels(item);
  const conds = respconditions(item);
  const fbMap = answerFeedbackMap(item);
  const qIdent = item["@_label"] as string;
  const shuffle =
    item.presentation?.flow?.response_lid?.render_choice?.["@_shuffle"] === "yes";

  const answers = labels.map((l, i) => {
    const cond = conds.find((c) => c.varequalText === l.ident);
    const setvar = cond?.setvars[0];
    const feedback = fbMap.get(`${qIdent}_IF${i + 1}`) || undefined;
    if (kind === "MC") {
      return {
        id: newId("a"),
        html: l.html,
        feedback,
        weight: setvar && parseFloat(setvar.text) > 0 ? 100 : 0,
      };
    }
    return {
      id: newId("a"),
      html: l.html,
      feedback,
      isCorrect: setvar?.varname === "D2L_Correct",
    };
  });

  const rawEnum = item.presentation?.flow?.response_extension?.["d2l_2p0:enumeration"];
  const enumText = rawEnum != null ? text(rawEnum) : undefined;
  // "4" is the writer's default when the model carries no enumeration
  const enumeration = enumText === "4" ? undefined : enumText;
  // "no" is the serializer default rather than an authored choice; only an explicit yes pins randomize
  const randomize = shuffle ? true : undefined;

  return {
    ...base,
    kind,
    randomize,
    enumeration,
    answers,
  } as Question;
}

function parseTF(item: N, base: Partial<Question>): Question {
  const conds = respconditions(item);
  const fbMap = answerFeedbackMap(item);
  const qIdent = item["@_label"] as string;
  const weightFor = (n: number) => {
    const cond = conds.find((c) => c.varequalText === `${qIdent}_A${n}`);
    return cond && parseFloat(cond.setvars[0]?.text ?? "0") > 0 ? 100 : 0;
  };
  return {
    ...base,
    kind: "TF",
    trueWeight: weightFor(0),
    falseWeight: weightFor(1),
    trueFeedback: fbMap.get(`${qIdent}_IF0`) || undefined,
    falseFeedback: fbMap.get(`${qIdent}_IF1`) || undefined,
  } as Question;
}

// preserveOrder parser used only for FIB, where the interleaved order of text segments and blanks inside <flow> is significant
const orderParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  parseTagValue: false,
});
// preserveOrder node shape: { tagname: [...children], ":@": { attrs } }
type OrderedNode = Record<string, unknown>;

const orderedKids = (node: OrderedNode | undefined, tag: string): OrderedNode[] =>
  (node?.[tag] as OrderedNode[] | undefined) ?? [];

function orderedCdata(children: OrderedNode[], tag: string): string {
  const target = children.find((n) => tag in n);
  if (!target) return "";
  const inner = orderedKids(target, tag);
  const cd = inner.find((n) => "#cdata" in n);
  if (cd) {
    const arr = orderedKids(cd, "#cdata");
    const t = arr[0]?.["#text"];
    return typeof t === "string" ? t : "";
  }
  const tx = inner.find((n) => "#text" in n);
  return tx ? String(tx["#text"]) : "";
}

interface ReaderCtx {
  /** item <item> children in document order (from a preserveOrder parse) */
  itemNodes: OrderedNode[][];
  index: number;
}

// items are processed in document order (base-section items first, then nested sections - the writer always emits untitled/main sections first)
function collectItemNodes(sectionNode: OrderedNode, acc: OrderedNode[][]): void {
  for (const child of orderedKids(sectionNode, "section")) {
    if ("item" in child) acc.push(orderedKids(child, "item"));
    else if ("section" in child) collectItemNodes(child, acc);
  }
}

function parseFIB(item: N, base: Partial<Question>, itemIndex: number, ctx: ReaderCtx): Question {
  const conds = respconditions(item);
  const parts: Extract<Question, { kind: "FIB" }>["parts"] = [];

  const itemNode = ctx.itemNodes[itemIndex];
  const presentation = (itemNode ?? []).find((n) => "presentation" in n);
  const flow = orderedKids(presentation, "presentation").find((n) => "flow" in n);
  const sequence = orderedKids(flow, "flow");

  for (const node of sequence) {
    if ("material" in node) {
      const html = orderedCdata(orderedKids(node, "material"), "mattext");
      parts.push({ id: newId("p"), part: "text", html });
    } else if ("response_str" in node) {
      const attrs = node[":@"] as Record<string, string> | undefined;
      const ansIdent = (attrs?.["@_ident"] ?? "").replace(/_STR$/, "_ANS");
      const answers = conds
        .filter((c) => c.varequalRespident === ansIdent)
        .map((c) => c.varequalText ?? "");
      parts.push({ id: newId("p"), part: "blank", answers });
    }
  }

  return { ...base, kind: "FIB", text: "", parts } as Question;
}

function parseMAT(item: N, base: Partial<Question>): Question {
  const grps = asArray(item.presentation?.flow?.response_grp as N[]);
  const pairs: Extract<Question, { kind: "MAT" }>["pairs"] = [];
  const conds = respconditions(item);

  for (const grp of grps) {
    const premise = mattextHtml(asArray(grp.material as N[])[0]);
    const grpIdent = grp["@_respident"] as string;
    const labels = asArray(
      grp.render_choice?.flow_label?.[0]?.response_label as N[],
    ).length
      ? asArray(grp.render_choice.flow_label[0].response_label as N[])
      : asArray(grp.render_choice?.flow_label as N[]).flatMap((fl) =>
          asArray(fl.response_label as N[]),
        );
    const correctCond = conds.find(
      (c) => c.varequalRespident === grpIdent && c.setvars[0]?.varname === "D2L_Correct",
    );
    const correctIdent = correctCond?.varequalText;
    const correct = labels.find((l) => l["@_ident"] === correctIdent);
    const response = correct
      ? mattextHtml(correct.flow_mat?.material as N | N[])
      : "";
    pairs.push({ id: newId("m"), premise, response });
  }

  return { ...base, kind: "MAT", gradingType: 0, pairs } as Question;
}

function parseORD(item: N, base: Partial<Question>): Question {
  const grp = asArray(item.presentation?.flow?.response_grp as N[])[0];
  const fbMap = answerFeedbackMap(item);
  const qIdent = item["@_label"] as string;
  const labels = asArray(grp?.render_choice?.flow_label as N[]).flatMap((fl) =>
    asArray(fl.response_label as N[]),
  );
  const items = labels.map((l, i) => ({
    id: newId("o"),
    html: mattextHtml(l.flow_mat?.material as N | N[]),
    feedback: fbMap.get(`${qIdent}_IF${i + 1}`) || undefined,
  }));
  return { ...base, kind: "ORD", items } as Question;
}

function parseWR(item: N, base: Partial<Question>): Question {
  const key = item.answer_key?.answer_key_material?.flow_mat?.material as N | N[];
  const answerKey = mattextHtml(key) || undefined;
  return { ...base, kind: "WR", answerKey } as Question;
}

const LABEL_TO_KIND: Record<string, Question["kind"]> = {
  "Multiple Choice": "MC",
  "Multi-Select": "MS",
  "True/False": "TF",
  "Fill in the Blanks": "FIB",
  Matching: "MAT",
  Ordering: "ORD",
  "Long Answer": "WR",
};

function parseItem(item: N, ctx: ReaderCtx): Question {
  const itemIndex = ctx.index++;
  const typeLabel = metaField(item, "qmd_questiontype") ?? "Multiple Choice";
  const kind = LABEL_TO_KIND[typeLabel] ?? "MC";
  const pointsRaw = metaField(item, "qmd_weighting");
  const title = (item["@_title"] as string) || undefined;

  const base: Partial<Question> = {
    id: newId("q"),
    title,
    text: questionText(item.presentation?.flow),
    points: pointsRaw !== undefined ? parseFloat(pointsRaw) : undefined,
    hint: questionHint(item),
    feedback: generalFeedback(item, item["@_label"] as string),
  };

  switch (kind) {
    case "MC":
      return parseMcOrMs(item, "MC", base);
    case "MS":
      return parseMcOrMs(item, "MS", base);
    case "TF":
      return parseTF(item, base);
    case "FIB":
      return parseFIB(item, base, itemIndex, ctx);
    case "MAT":
      return parseMAT(item, base);
    case "ORD":
      return parseORD(item, base);
    case "WR":
      return parseWR(item, base);
  }
}

function parseSectionOrdered(section: N, ctx: ReaderCtx): Section {
  const material =
    section.presentation_material?.flow_mat?.flow_mat?.material as N | N[];
  const textHtml = mattextHtml(material) || undefined;
  const shuffle = section.selection_ordering?.order?.["@_order_type"] === "Random";

  return {
    id: newId("sec"),
    title: (section["@_title"] as string) ?? "",
    text: textHtml,
    shuffle,
    questions: asArray(section.item as N[]).map((it) => parseItem(it, ctx)),
  };
}

/** Parse questiondb.xml content into the model. */
export function readQuestionDb(xml: string): Library {
  const doc = parser.parse(xml) as N;
  const objectbank = doc.questestinterop?.objectbank;
  if (!objectbank) throw new Error("Not a QTI questiondb document");

  // parallel document-order parse for order-sensitive content (FIB flows)
  const orderedDoc = orderParser.parse(xml) as OrderedNode[];
  const itemNodes: OrderedNode[][] = [];
  const qti = orderedDoc.find((n) => "questestinterop" in n);
  const ob = orderedKids(qti, "questestinterop").find((n) => "objectbank" in n);
  for (const node of orderedKids(ob, "objectbank")) {
    if ("section" in node) collectItemNodes(node, itemNodes);
  }
  const ctx: ReaderCtx = { itemNodes, index: 0 };

  const sections: Section[] = [];
  const base = objectbank.section as N | N[];
  const baseSection = Array.isArray(base) ? base[0] : base;

  const library: Library = {
    id: newId("lib"),
    title: (baseSection?.["@_title"] as string) ?? "",
    randomizeAnswers: false,
    sections: [],
    assets: [],
  };

  // questions directly under the base section become the untitled main section
  const mainQuestions = asArray(baseSection?.item as N[]).map((it) =>
    parseItem(it, ctx),
  );
  if (mainQuestions.length > 0) {
    sections.push({
      id: newId("sec"),
      title: "",
      shuffle: false,
      questions: mainQuestions,
    });
  }
  for (const sub of asArray(baseSection?.section as N[])) {
    sections.push(parseSectionOrdered(sub, ctx));
  }

  library.sections =
    sections.length > 0
      ? sections
      : [{ id: newId("sec"), title: "", shuffle: false, questions: [] }];
  return library;
}
