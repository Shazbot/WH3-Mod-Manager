import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("flow editor node selection style", () => {
  it("visually outlines selected custom nodes", () => {
    const css = readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");
    const selectionRule = css.match(/\.node-editor-flow \.react-flow__node\.selected\s*\{[^}]+\}/)?.[0];
    expect(selectionRule).toBeDefined();

    const styleElement = document.createElement("style");
    styleElement.textContent = selectionRule || "";
    document.head.appendChild(styleElement);

    const flow = document.createElement("div");
    flow.className = "node-editor-flow";

    const node = document.createElement("div");
    node.className = "react-flow__node selected";
    flow.appendChild(node);
    document.body.appendChild(flow);

    const style = window.getComputedStyle(node);
    expect(style.outline).toBe("4px solid #facc15");
    expect(style.outlineOffset).toBe("3px");
    expect(style.filter).toContain("drop-shadow");
  });

  it("shows when a node is armed as the quick-connect source", () => {
    const css = readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");
    const quickConnectRule = css.match(
      /\.node-editor-flow \.react-flow__node\.quick-connect-source\s*\{[^}]+\}/,
    )?.[0];
    expect(quickConnectRule).toBeDefined();

    const styleElement = document.createElement("style");
    styleElement.textContent = quickConnectRule || "";
    document.head.appendChild(styleElement);

    const flow = document.createElement("div");
    flow.className = "node-editor-flow";

    const node = document.createElement("div");
    node.className = "react-flow__node quick-connect-source";
    flow.appendChild(node);
    document.body.appendChild(flow);

    const style = window.getComputedStyle(node);
    expect(style.outline).toBe("4px dashed #22d3ee");
    expect(style.filter).toContain("drop-shadow");
  });

  it("shows disabled nodes and their stopped outgoing connections", () => {
    const css = readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");

    expect(css).toContain(".react-flow__node.node-disabled > *");
    expect(css).toContain('content: "Disabled"');
    expect(css).toContain(".react-flow__node.node-disabled-by-upstream > *");
    expect(css).toContain('content: "Blocked by disabled node"');
    expect(css).toContain(".react-flow__edge.disabled-source .react-flow__edge-path");
    expect(css).toContain(".react-flow__edge.disabled-consequence .react-flow__edge-path");
  });
});
