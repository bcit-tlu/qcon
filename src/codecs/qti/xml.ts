// SPDX-License-Identifier: MPL-2.0
// Minimal XML builder with CDATA support, replacing xml.etree + xmlcdata.
// Pretty-prints with tabs for diffable output.

export type XmlChild = XmlNode | string | Cdata;

export interface Cdata {
  readonly cdata: string;
}

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlChild[];
}

export function el(
  tag: string,
  attrs: Record<string, string | undefined> = {},
  ...children: XmlChild[]
): XmlNode {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) clean[k] = v;
  }
  return { tag, attrs: clean, children };
}

/** Raw CDATA section. A literal "]]>" in the payload is split safely. */
export function cdata(text: string): Cdata {
  return { cdata: text };
}

const escapeText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s: string) =>
  escapeText(s).replace(/"/g, "&quot;");

function render(node: XmlNode, depth: number, out: string[]): void {
  const pad = "\t".repeat(depth);
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join("");

  if (node.children.length === 0) {
    out.push(`${pad}<${node.tag}${attrs}/>`);
    return;
  }

  // single short text child stays on one line
  if (
    node.children.length === 1 &&
    typeof node.children[0] === "string" &&
    !node.children[0].includes("\n")
  ) {
    out.push(
      `${pad}<${node.tag}${attrs}>${escapeText(node.children[0])}</${node.tag}>`,
    );
    return;
  }

  out.push(`${pad}<${node.tag}${attrs}>`);
  for (const child of node.children) {
    if (typeof child === "string") {
      for (const line of child.split("\n")) {
        out.push(`${pad}\t${escapeText(line)}`);
      }
    } else if ("cdata" in child) {
      const safe = child.cdata.replace(/\]\]>/g, "]]]]><![CDATA[>");
      out.push(`${pad}\t<![CDATA[${safe}]]>`);
    } else {
      render(child, depth + 1, out);
    }
  }
  out.push(`${pad}</${node.tag}>`);
}

export function serialize(root: XmlNode, xmlDeclaration = true): string {
  const out: string[] = [];
  render(root, 0, out);
  const body = out.join("\n");
  return xmlDeclaration
    ? `<?xml version="1.0" encoding="UTF-8"?>\n${body}`
    : body;
}
