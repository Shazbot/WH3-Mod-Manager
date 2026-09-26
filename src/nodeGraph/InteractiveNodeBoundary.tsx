import React, { useEffect, useRef } from "react";

const interactiveControlSelector = [
  "input",
  "textarea",
  "select",
  "button",
  "label",
  "a[href]",
  "[role='button']",
  "[contenteditable]:not([contenteditable='false'])",
].join(",");

/**
 * Keeps control gestures inside a custom node from reaching React Flow's node drag listener.
 * Native delegated listeners are intentional: React's delegated mouse handler runs after the
 * listener React Flow installs on the node wrapper, and many controls are mounted dynamically.
 */
export const InteractiveNodeBoundary: React.FC<React.PropsWithChildren> = ({ children }) => {
  const boundaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const boundary = boundaryRef.current;
    if (!boundary) return;

    const stopControlDrag = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(interactiveControlSelector)) {
        event.stopPropagation();
      }
    };

    boundary.addEventListener("mousedown", stopControlDrag);
    boundary.addEventListener("touchstart", stopControlDrag, { passive: true });
    return () => {
      boundary.removeEventListener("mousedown", stopControlDrag);
      boundary.removeEventListener("touchstart", stopControlDrag);
    };
  }, []);

  return <div ref={boundaryRef}>{children}</div>;
};

export const withInteractiveNodeBoundary = <Props extends object>(
  NodeRenderer: React.ComponentType<Props>,
): React.FC<Props> => {
  const WrappedNodeRenderer: React.FC<Props> = (props) => (
    <InteractiveNodeBoundary>
      <NodeRenderer {...props} />
    </InteractiveNodeBoundary>
  );
  WrappedNodeRenderer.displayName = `InteractiveNodeBoundary(${NodeRenderer.displayName || NodeRenderer.name || "Node"})`;
  return WrappedNodeRenderer;
};
