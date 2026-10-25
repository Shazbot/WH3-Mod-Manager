import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AddNodeModal from "../src/components/skillsViewer/AddNodeModal";

vi.mock("../src/flowbite/components/Modal/index", () => {
  const Modal = ({ children, show }: { children?: React.ReactNode; show?: boolean }) => (show ? <>{children}</> : null);
  Modal.Header = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  Modal.Body = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  Modal.Footer = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return { Modal };
});

describe("AddNodeModal effect labels", () => {
  it("draws tagged images inline instead of showing raw tags", () => {
    const editorData = {
      allEffects: [],
      allSkills: [],
      allSkillIcons: [],
      icons: { "ui\\x.png": "asset://x" },
      taggedImages: { icon_x: "ui\\x.png" },
    } as SkillsEditorData;
    const { container } = render(
      <AddNodeModal
        isOpen
        onClose={() => undefined}
        onAdd={() => undefined}
        editorData={editorData}
        editingData={{
          name: "Skill",
          description: "",
          maxLevel: 1,
          unlockRank: 1,
          effects: [
            { effectKey: "e1", localizedKey: "[[img:icon_x]][[/img]]+5 Leadership", level: 1, value: "5" } as Effect,
          ],
        }}
      />,
    );

    expect(container.querySelector('img[src="asset://x"]')).not.toBeNull();
    expect(container.textContent).toContain("+5 Leadership");
    expect(container.textContent).not.toContain("[[img");
  });
});
