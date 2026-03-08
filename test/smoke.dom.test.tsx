import React from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

describe("DOM test support", () => {
  it("renders React components and supports user interactions", async () => {
    const user = userEvent.setup();

    const Counter = () => {
      const [count, setCount] = React.useState(0);

      return <button onClick={() => setCount((currentCount) => currentCount + 1)}>Clicked {count}</button>;
    };

    render(<Counter />);

    const button = screen.getByRole("button", { name: "Clicked 0" });
    await user.click(button);

    expect(button).toHaveTextContent("Clicked 1");
    expect(window.api).toBeDefined();
  });
});
