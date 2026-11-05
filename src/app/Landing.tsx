// SPDX-License-Identifier: MPL-2.0
// Landing page: intro blurb, staged dropzone, additional options, convert button.
// Mirrors the legacy qcon-web upload screen.

import { useRef, useState } from "react";
import { ENUM_OPTIONS } from "./options";

interface LandingProps {
  busy: boolean;
  onFile: (file: File) => void;
  enumeration: string;
  onEnumeration: (v: string) => void;
  enumEnabled: boolean;
  onEnumEnabled: (v: boolean) => void;
  randomize: boolean;
  onRandomize: (v: boolean) => void;
  customFolder: boolean;
  onCustomFolder: (v: boolean) => void;
  folderName: string;
  onFolderName: (v: string) => void;
}

const ACCEPT_RE = /\.(docx|zip)$/i;

function DocIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="60" height="60" fill={color} aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="60" height="60" fill={color} aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}

function ZipIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="60" height="60" fill={color} aria-hidden="true">
      <path d="M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm-2 6h-2v2h2v2h-2v2h-2v-2h2v-2h-2v-2h2v-2h-2V8h2v2zm-4-4h2v2h-2V8zm0 4h2v2h-2v-2z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3.1-9H8.9V6a3.1 3.1 0 0 1 6.2 0v2z" />
    </svg>
  );
}

export function Landing(props: LandingProps) {
  const [staged, setStaged] = useState<File | null>(null);
  const [rejected, setRejected] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const stage = (f: File | undefined | null) => {
    if (!f) return;
    if (!ACCEPT_RE.test(f.name)) {
      setRejected(true);
      setTimeout(() => setRejected(false), 1200);
      return;
    }
    setStaged(f);
  };

  const removeStaged = (e: React.MouseEvent) => {
    e.stopPropagation();
    setStaged(null);
  };

  return (
    <div className="landing">
      <div className="blurb">
        <p>
          QCon converts between Word documents (.docx) and Brightspace (D2L)
          SCORM question libraries (.zip), all in your browser.
        </p>
        <div className="blurb-grid">
          <div className="blurb-card">
            <DocIcon color="#2b579a" />
            <p>Upload a Word file or SCORM zip</p>
          </div>
          <div className="blurb-card">
            <CheckIcon color="#30b324" />
            <p>Preview and edit the questions</p>
          </div>
          <div className="blurb-card">
            <ZipIcon color="#e6b800" />
            <p>Export as .docx or .zip</p>
          </div>
        </div>
      </div>

      <div
        className={`dropzone ${rejected ? "reject" : ""} ${dragActive ? "active" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          setDragActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
          stage(e.dataTransfer.files[0]);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".docx,.zip"
          hidden
          onChange={(e) => {
            stage(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {staged ? (
          <div className="staged-file">
            <DocIcon color="#277da1" />
            <p>{staged.name}</p>
            <button type="button" className="danger" onClick={removeStaged}>
              Delete
            </button>
          </div>
        ) : (
          <p>
            {rejected
              ? "Wrong file format!"
              : dragActive
                ? "Drop file here"
                : "Drag a .docx or .zip file, or click here to choose a file"}
          </p>
        )}
      </div>

      <div className="options-form">
        <label>
          <input
            type="checkbox"
            checked={showOptions}
            onChange={(e) => {
              setShowOptions(e.target.checked);
              if (!e.target.checked) {
                props.onRandomize(false);
                props.onEnumEnabled(false);
                props.onCustomFolder(false);
              }
            }}
          />{" "}
          Additional Options
        </label>
        {showOptions && (
          <div className="options-choices">
            <div className="option-group">
              <label>
                <input
                  type="checkbox"
                  checked={props.randomize}
                  onChange={(e) => props.onRandomize(e.target.checked)}
                />{" "}
                Randomize answers
              </label>
              <p className="option-desc">Default: off.</p>
              <p className="option-desc">
                Shuffles the answers on Multiple Choice and Multi-Select
                questions. Matching and Ordering questions are always shuffled.
              </p>
            </div>
            <div className="option-group">
              <label>
                <input
                  type="checkbox"
                  checked={props.enumEnabled}
                  onChange={(e) => props.onEnumEnabled(e.target.checked)}
                />{" "}
                Answer Enumeration
              </label>
              <p className="option-desc">Default: Letters (a,b,c).</p>
              <p className="option-desc">
                Changes how answers are labeled (like a,b,c or i,ii,iii) on
                Multiple Choice, True/False, and Multi-Select questions.
              </p>
              {props.enumEnabled && (
                <select
                  className="option-nested"
                  value={props.enumeration}
                  onChange={(e) => props.onEnumeration(e.target.value)}
                >
                  {ENUM_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="option-group">
              <label>
                <input
                  type="checkbox"
                  checked={props.customFolder}
                  onChange={(e) => props.onCustomFolder(e.target.checked)}
                />{" "}
                Custom Image Folder
              </label>
              <p className="option-desc">
                Default: assessment-assets/{"{quiz title}"}/.
              </p>
              <p className="option-desc">
                Images are placed in this folder in the course's Manage Files
                area.
              </p>
              {props.customFolder && (
                <input
                  className="option-nested folder-input"
                  value={props.folderName}
                  onChange={(e) => props.onFolderName(e.target.value.replace(/[^a-z0-9\-/]/gi, ""))}
                  title="Folder inside the zip for extracted images"
                />
              )}
            </div>
          </div>
        )}
      </div>

      <div className="buttons-group">
        <button
          type="button"
          className="primary"
          disabled={!staged || props.busy}
          onClick={() => staged && props.onFile(staged)}
        >
          {props.busy ? "Importing…" : "Import File"}
        </button>
      </div>

      <p className="privacy-note">
        <LockIcon />
        Everything runs in your browser. Your file stays on your computer and is never uploaded.
      </p>
    </div>
  );
}
