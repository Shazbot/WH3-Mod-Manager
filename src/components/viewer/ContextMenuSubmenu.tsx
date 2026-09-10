import React, { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const CONTEXT_MENU_PADDING_PX = 8;
// Keep the floating panel touching its trigger so a hover can cross into it without falling into a
// gap that fires the trigger's mouse-leave handler.
const SUBMENU_GAP_PX = 0;

type SubmenuPosition = {
  left: number;
  top: number;
};

const getSubmenuPosition = (trigger: DOMRect, submenu: DOMRect): SubmenuPosition => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rightCandidate = trigger.right + SUBMENU_GAP_PX;
  const leftCandidate = trigger.left - SUBMENU_GAP_PX - submenu.width;
  const rightFits = rightCandidate + submenu.width <= viewportWidth - CONTEXT_MENU_PADDING_PX;
  const leftFits = leftCandidate >= CONTEXT_MENU_PADDING_PX;

  let left = rightFits ? rightCandidate : leftFits ? leftCandidate : rightCandidate;
  const maxLeft = Math.max(CONTEXT_MENU_PADDING_PX, viewportWidth - submenu.width - CONTEXT_MENU_PADDING_PX);
  left = Math.min(Math.max(left, CONTEXT_MENU_PADDING_PX), maxLeft);

  let top = trigger.top;
  if (top + submenu.height > viewportHeight - CONTEXT_MENU_PADDING_PX) {
    top = viewportHeight - submenu.height - CONTEXT_MENU_PADDING_PX;
  }
  top = Math.max(CONTEXT_MENU_PADDING_PX, top);

  return { left, top };
};

export type ContextMenuSubmenuProps = {
  label: ReactNode;
  children: ReactNode;
};

const ContextMenuSubmenu = ({ label, children }: ContextMenuSubmenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState<SubmenuPosition | null>(null);

  const updateSubmenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const submenu = submenuRef.current;
    if (!trigger || !submenu) return;

    const nextPosition = getSubmenuPosition(trigger.getBoundingClientRect(), submenu.getBoundingClientRect());
    setSubmenuPosition((current) =>
      current?.left === nextPosition.left && current.top === nextPosition.top ? current : nextPosition,
    );
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setSubmenuPosition(null);
      return;
    }

    updateSubmenuPosition();
    const frame = window.requestAnimationFrame(updateSubmenuPosition);
    const onResize = () => updateSubmenuPosition();
    window.addEventListener("resize", onResize);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && submenuRef.current) {
      observer = new ResizeObserver(updateSubmenuPosition);
      observer.observe(submenuRef.current);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [isOpen, updateSubmenuPosition]);

  return (
    <div
      ref={triggerRef}
      className="relative"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocus={() => setIsOpen(true)}
    >
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white text-sm flex items-center justify-between gap-4"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <span>{label}</span>
        <span aria-hidden="true">▶</span>
      </button>

      {isOpen && (
        <div
          ref={submenuRef}
          role="menu"
          className="fixed z-50 min-w-[250px] max-w-[340px] max-h-[calc(100vh-1rem)] overflow-y-auto bg-gray-800 border border-gray-600 rounded shadow-lg p-1"
          style={{
            left: submenuPosition?.left ?? 0,
            top: submenuPosition?.top ?? 0,
            visibility: submenuPosition ? "visible" : "hidden",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

export default ContextMenuSubmenu;
