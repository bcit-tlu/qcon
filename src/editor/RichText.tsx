// SPDX-License-Identifier: MPL-2.0
// HugeRTE rich-text field. Self-hosted (bundled) HugeRTE build - no CDN.

import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { Editor } from "@hugerte/hugerte-react";
import "hugerte";
import "hugerte/icons/default";
import "hugerte/themes/silver";
import "hugerte/models/dom";
import "hugerte/plugins/lists";
import "hugerte/plugins/image";
import "hugerte/plugins/table";
import "hugerte/plugins/code";
import "hugerte/plugins/autoresize";
import "hugerte/skins/ui/oxide/skin.min.css";
import "hugerte/skins/content/default/content.css";

const CONTENT_STYLE =
  "body { font-family: system-ui, sans-serif; font-size: 14px; margin: 8px; }" +
  "img { max-width: 100%; }";

interface RichTextProps {
  value: string;
  onChange: (html: string) => void;
  /** compact single-line-ish toolbar for short fields (answers, titles) */
  compact?: boolean;
  placeholder?: string;
}

const imagesUploadHandler = (blobInfo: { base64: () => string; blob: () => Blob }) =>
  Promise.resolve(`data:${blobInfo.blob().type};base64,${blobInfo.base64()}`);

export function RichText({ value, onChange, compact, placeholder }: RichTextProps) {
  // Lazy-mount: HugeRTE is expensive to initialize; edit-all mode would mount dozens at once and freeze.
  // Render a static preview until clicked.
  const [editing, setEditing] = useState(false);

  const init = useMemo(
    () => ({
      menubar: false,
      plugins: `lists image table code${compact ? " autoresize" : ""}`,
      toolbar: compact
        ? "bold italic underline | image | removeformat | code"
        : "undo redo | bold italic underline | bullist numlist | image table | removeformat | code",
      skin: false,
      content_css: false,
      content_style: CONTENT_STYLE,
      branding: false,
      promotion: false,
      placeholder,
      width: "100%",
      height: compact ? 100 : 200,
      min_height: compact ? 60 : undefined,
      max_height: compact ? 300 : undefined,
      statusbar: !compact,
      resize: !compact,
      images_upload_handler: imagesUploadHandler,
    }),
    [compact, placeholder],
  );

  if (!editing) {
    const empty = !value || value.replace(/<[^>]+>/g, "").trim() === "";
    return (
      <div
        className={`rte-placeholder${compact ? " compact" : ""}${empty ? " empty" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onFocus={() => setEditing(true)}
      >
        {empty ? (
          <span className="rte-placeholder-text">{placeholder ?? "Click to edit"}</span>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }} />
        )}
      </div>
    );
  }

  return (
    <Editor
      value={value}
      onEditorChange={(html) => onChange(html)}
      onInit={(_evt, editor) => {
        editor.focus();
        editor.selection.select(editor.getBody(), true);
        editor.selection.collapse(false);
      }}
      init={init}
    />
  );
}
