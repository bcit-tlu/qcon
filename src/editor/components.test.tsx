// @vitest-environment happy-dom
// SPDX-License-Identifier: MPL-2.0
// Shallow render tests for editor components.

import React from "react";
import { describe, expect, it, vi } from "vitest";

// HugeRTE accesses window at module scope; stub it out for tests
vi.mock("./RichText.js", () => ({
  RichText: ({ value, onChange, placeholder }: { value: string; onChange: (h: string) => void; placeholder?: string }) =>
    React.createElement("textarea", {
      "data-testid": "rich-text",
      value,
      placeholder,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    }),
}));

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { createLibrary, createQuestion } from "../model/factory.js";

afterEach(cleanup);
import { LibraryPreview } from "./Preview.js";
import { LibraryEditor } from "./LibraryEditor.js";
import { QuestionEditor } from "./QuestionEditor.js";

const lib = () => createLibrary("Test Library");

describe("LibraryPreview", () => {
  it("renders the library title", () => {
    render(
      <LibraryPreview library={lib()} enumeration="4" onEditQuestion={() => {}} />,
    );
    expect(screen.getByRole("heading", { name: "Test Library" })).toBeTruthy();
  });

  it("shows question count per section", () => {
    const library = lib();
    const sec = library.sections[0]!;
    sec.questions.push(createQuestion("MC"), createQuestion("TF"));
    const { container } = render(
      <LibraryPreview library={library} enumeration="4" onEditQuestion={() => {}} />,
    );
    const numbers = container.querySelectorAll(".q-number");
    expect(numbers).toHaveLength(2);
    expect(numbers[0]!.textContent).toBe("1.");
    expect(numbers[1]!.textContent).toBe("2.");
  });

  it("calls onEditQuestion when Edit is clicked", () => {
    const library = lib();
    const q = createQuestion("MC");
    library.sections[0]!.questions.push(q);
    const onEdit = vi.fn();
    render(
      <LibraryPreview library={library} enumeration="4" onEditQuestion={onEdit} />,
    );
    screen.getByRole("button", { name: "Edit" }).click();
    expect(onEdit).toHaveBeenCalledWith(q.id);
  });

  it("shows validation errors", () => {
    const library = lib();
    library.sections[0]!.questions.push(createQuestion("MC"));
    render(
      <LibraryPreview library={library} enumeration="4" onEditQuestion={() => {}} />,
    );
    expect(screen.getByText(/error\(s\)/)).toBeTruthy();
  });
});

describe("LibraryEditor", () => {
  it("renders title input", () => {
    render(<LibraryEditor library={lib()} onChange={() => {}} />);
    expect(screen.getByDisplayValue("Test Library")).toBeTruthy();
  });

  it("shows validation summary", () => {
    const library = lib();
    library.sections[0]!.questions.push(createQuestion("MC"));
    const { container } = render(<LibraryEditor library={library} onChange={() => {}} />);
    expect(container.querySelector(".val-error")).toBeTruthy();
  });

  it("renders sections and add button", () => {
    render(<LibraryEditor library={lib()} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "+ Add section" })).toBeTruthy();
  });
});

describe("QuestionEditor", () => {
  it("renders kind badge", () => {
    const q = createQuestion("MC");
    render(
      <QuestionEditor question={q} onChange={() => {}} onRemove={() => {}} onMove={() => {}} />,
    );
    const badges = screen.getAllByText("Multiple Choice");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0]!.className).toContain("kind-badge");
  });

  it("shows points input", () => {
    const q = createQuestion("MC");
    q.points = 5;
    render(
      <QuestionEditor question={q} onChange={() => {}} onRemove={() => {}} onMove={() => {}} />,
    );
    expect(screen.getByDisplayValue("5")).toBeTruthy();
  });
});

describe("Preview sanitization", () => {
  it("keeps MathML, tables, and sup/sub from imported docx content", () => {
    const library = lib();
    const q = createQuestion("WR");
    q.text =
      `<p>E = mc<sup>2</sup>, H<sub>2</sub>O</p>` +
      `<table><tr><td>H1</td></tr><tr><td>a</td></tr></table>` +
      `<p><math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mn>1</mn><mn>2</mn></mfrac></math></p>`;
    library.sections[0]!.questions.push(q);
    const { container } = render(
      <LibraryPreview library={library} enumeration="4" onEditQuestion={() => {}} />,
    );
    const qText = container.querySelector(".q-text")!;
    expect(qText.querySelector("sup")).toBeTruthy();
    expect(qText.querySelector("sub")).toBeTruthy();
    expect(qText.querySelector("table td")).toBeTruthy();
    expect(qText.querySelector("math mfrac")).toBeTruthy();
  });
});
