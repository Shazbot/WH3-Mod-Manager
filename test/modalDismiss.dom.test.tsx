import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "../src/flowbite/components/Modal/index";

const getBackdrop = (content: HTMLElement) => content.closest('[data-testid="modal"]') as HTMLElement;

const clickOn = (element: HTMLElement, mouseDownOn: HTMLElement = element) => {
  fireEvent.mouseDown(mouseDownOn);
  fireEvent.click(element);
};

describe("Modal dismissal", () => {
  it("closes on a click on the backdrop but not on one inside the modal", () => {
    const onClose = vi.fn();
    render(
      <Modal show dismissible onClose={onClose}>
        <Modal.Body>inside</Modal.Body>
      </Modal>,
    );

    const content = screen.getByText("inside");
    clickOn(content);
    expect(onClose).not.toHaveBeenCalled();

    clickOn(getBackdrop(content));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when a drag starts inside the modal and ends on the backdrop", () => {
    const onClose = vi.fn();
    render(
      <Modal show dismissible onClose={onClose}>
        <Modal.Body>inside</Modal.Body>
      </Modal>,
    );

    const content = screen.getByText("inside");
    clickOn(getBackdrop(content), content);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal show dismissible onClose={onClose}>
        <Modal.Body>inside</Modal.Body>
      </Modal>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores the backdrop and Escape unless dismissible", () => {
    const onClose = vi.fn();
    render(
      <Modal show onClose={onClose}>
        <Modal.Body>inside</Modal.Body>
      </Modal>,
    );

    clickOn(getBackdrop(screen.getByText("inside")));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("only closes the modal on top when Escape is pressed", () => {
    const onCloseBottom = vi.fn();
    const onCloseTop = vi.fn();
    render(
      <>
        <Modal show dismissible onClose={onCloseBottom}>
          <Modal.Body>bottom</Modal.Body>
        </Modal>
        <Modal show dismissible onClose={onCloseTop}>
          <Modal.Body>top</Modal.Body>
        </Modal>
      </>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCloseTop).toHaveBeenCalledTimes(1);
    expect(onCloseBottom).not.toHaveBeenCalled();
  });
});
