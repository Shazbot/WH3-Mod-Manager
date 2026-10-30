import React, { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { components, type GroupBase, type MenuListProps } from "react-select";
import { describe, expect, it, vi } from "vitest";
import VirtualizedSelect from "../src/components/VirtualizedSelect";

type TestOption = { value: string; label: string; disabled?: boolean };

const fixedRowStyles = {
  option: (base: React.CSSProperties) => ({ ...base, height: 40 }),
};

const largeOptions: TestOption[] = Array.from({ length: 1000 }, (_, index) => ({
  value: `option-${index}`,
  label: index === 799 ? "Unique needle option" : `Option ${index + 1}`,
}));

describe("VirtualizedSelect", () => {
  it("bounds large menus, scrolls keyboard focus to offscreen options, and selects them", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    const rowContentMeasurement = vi.fn();
    const rowContentObserver = vi.fn();
    class TrackingResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}
      observe(target: Element) {
        const parent = target.parentElement;
        if (parent?.style.position === "absolute" && parent.style.height === "40px") rowContentObserver();
      }
      disconnect() {}
    }
    globalThis.ResizeObserver = TrackingResizeObserver as unknown as typeof ResizeObserver;
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.parentElement?.style.position === "absolute" && this.parentElement.style.height === "40px") {
        rowContentMeasurement();
      }
      return originalGetBoundingClientRect.call(this);
    });

    const SelectHarness = () => {
      const [value, setValue] = useState<TestOption | null>(null);
      return (
        <VirtualizedSelect<TestOption, false>
          aria-label="Large options"
          classNamePrefix="test-select"
          options={largeOptions}
          value={value}
          onChange={(nextValue, meta) => {
            onChange(nextValue, meta);
            setValue(nextValue);
          }}
          windowThreshold={20}
          maxMenuHeight={120}
          menuPortalTarget={document.body}
          menuPosition="fixed"
          styles={fixedRowStyles}
        />
      );
    };

    try {
      render(<SelectHarness />);

      const input = screen.getByRole("combobox", { name: "Large options" });
      await user.click(input);

      const listbox = screen.getByRole("listbox");
      expect(listbox).toBeInTheDocument();
      expect(screen.getAllByRole("option").length).toBeLessThan(30);
      expect(screen.getAllByRole("option")[0]).toHaveStyle({ height: "40px" });
      expect(screen.getAllByRole("option")[0].parentElement?.parentElement).toHaveStyle({ height: "40px" });

      await user.keyboard("{End}");
      const lastOption = await screen.findByRole("option", { name: "Option 1000" });
      await waitFor(() => expect(listbox.scrollTop).toBeGreaterThan(0));
      expect(lastOption).toBeInTheDocument();

      await user.keyboard("{Enter}");
      expect(onChange).toHaveBeenCalledWith(largeOptions[999], expect.objectContaining({ action: "select-option" }));
      expect(screen.queryByRole("listbox")).toBeNull();

      await user.click(input);
      const reopenedListbox = screen.getByRole("listbox");
      expect(await screen.findByRole("option", { name: "Option 1000" })).toBeInTheDocument();
      await waitFor(() => expect(reopenedListbox.scrollTop).toBeGreaterThan(0));
      expect(rowContentMeasurement).not.toHaveBeenCalled();
      expect(rowContentObserver).not.toHaveBeenCalled();
    } finally {
      rectSpy.mockRestore();
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("filters options and shows the no-results message", async () => {
    const user = userEvent.setup();
    render(
      <VirtualizedSelect<TestOption, false>
        aria-label="Search options"
        options={largeOptions}
        value={null}
        onChange={vi.fn()}
        windowThreshold={20}
        styles={fixedRowStyles}
      />,
    );

    const input = screen.getByRole("combobox", { name: "Search options" });
    await user.click(input);
    await user.type(input, "needle");
    expect(await screen.findByRole("option", { name: "Unique needle option" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);

    await user.clear(input);
    await user.type(input, "no-such-option");
    expect(await screen.findByText("No options")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("remeasures unconstrained rows and updates the menu when they resize", async () => {
    const user = userEvent.setup();
    let rowHeight = 72;
    let resize: ResizeObserverCallback | undefined;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    }
    const originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.parentElement?.style.position === "absolute") return new DOMRect(0, 0, 120, rowHeight);
      return new DOMRect();
    });

    try {
      render(
        <VirtualizedSelect<TestOption, false>
          aria-label="Dynamic row"
          options={[{ value: "dynamic", label: "Dynamic" }]}
          value={null}
          onChange={vi.fn()}
          windowThreshold={1}
          maxMenuHeight={500}
        />,
      );
      await user.click(screen.getByRole("combobox", { name: "Dynamic row" }));

      const listbox = screen.getByRole("listbox");
      await waitFor(() => expect(listbox.style.height).toBe("80px"));
      expect(rectSpy).toHaveBeenCalled();

      rowHeight = 96;
      act(() => resize?.([], {} as ResizeObserver));
      await waitFor(() => expect(listbox.style.height).toBe("104px"));
    } finally {
      rectSpy.mockRestore();
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("keeps multi-selection, disabled options, and clearable behavior", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const options: TestOption[] = [
      { value: "alpha", label: "Alpha" },
      { value: "disabled", label: "Disabled", disabled: true },
    ];

    const MultiSelect = () => {
      const [value, setValue] = useState<TestOption[]>([]);
      return (
        <VirtualizedSelect<TestOption, true>
          aria-label="Multiple options"
          classNamePrefix="multi-select"
          options={options}
          value={value}
          onChange={(nextValue, meta) => {
            onChange(nextValue, meta);
            setValue([...nextValue]);
          }}
          isMulti
          isClearable
          isOptionDisabled={(option) => Boolean(option.disabled)}
          windowThreshold={1}
        />
      );
    };

    const { container } = render(<MultiSelect />);
    await user.click(screen.getByRole("combobox", { name: "Multiple options" }));
    await user.click(screen.getByRole("option", { name: "Disabled" }));
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("option", { name: "Alpha" }));
    expect(onChange).toHaveBeenLastCalledWith([options[0]], expect.objectContaining({ action: "select-option" }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();

    const clearIndicator = container.querySelector(".multi-select__clear-indicator");
    expect(clearIndicator).not.toBeNull();
    await user.click(clearIndicator as Element);
    expect(onChange).toHaveBeenLastCalledWith([], expect.objectContaining({ action: "clear" }));
  });

  it("leaves a caller-provided MenuList in control above the threshold", async () => {
    const user = userEvent.setup();
    const options = largeOptions.slice(0, 120);
    const customMenuList = (props: MenuListProps<TestOption, false>) => (
      <components.MenuList {...props} innerProps={{ ...props.innerProps, "data-testid": "custom-menu-list" }} />
    );

    render(
      <VirtualizedSelect<TestOption, false>
        aria-label="Custom list"
        options={options}
        value={null}
        onChange={vi.fn()}
        windowThreshold={1}
        components={{ MenuList: customMenuList }}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Custom list" }));
    expect(screen.getByTestId("custom-menu-list")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(options.length);
  });

  it("keeps grouped headings and options visible in the windowed menu", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const options: GroupBase<TestOption>[] = [
      { label: "First group", options: [{ value: "grouped", label: "Grouped option" }] },
    ];

    render(
      <VirtualizedSelect<TestOption, false, GroupBase<TestOption>>
        aria-label="Grouped options"
        options={options}
        value={null}
        onChange={onChange}
        windowThreshold={1}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Grouped options" }));
    expect(screen.getByText("First group")).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Grouped option" }));
    expect(onChange).toHaveBeenCalledWith(options[0].options[0], expect.objectContaining({ action: "select-option" }));
  });
});
