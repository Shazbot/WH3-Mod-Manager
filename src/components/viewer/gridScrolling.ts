/** AG Grid 36 uses one viewport for both axes, including pinned columns. */
export const getGridViewport = (gridRoot: HTMLElement): HTMLElement | null =>
  gridRoot.querySelector<HTMLElement>(".ag-grid-viewport");

export const scrollGridBy = (gridRoot: HTMLElement, deltaX: number, deltaY: number): boolean => {
  const viewport = getGridViewport(gridRoot);
  if (!viewport) return false;

  const previousLeft = viewport.scrollLeft;
  const previousTop = viewport.scrollTop;
  viewport.scrollLeft = Math.min(
    Math.max(0, viewport.scrollWidth - viewport.clientWidth),
    Math.max(0, previousLeft + deltaX),
  );
  viewport.scrollTop = Math.min(
    Math.max(0, viewport.scrollHeight - viewport.clientHeight),
    Math.max(0, previousTop + deltaY),
  );
  // AG Grid synchronises its scrollbar controls from the viewport's native scroll event.
  return viewport.scrollLeft !== previousLeft || viewport.scrollTop !== previousTop;
};
