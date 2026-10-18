import classNames from "classnames";
import type { ComponentProps, FC, PropsWithChildren } from "react";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { excludeClassName } from "../../helpers/exclude";
import windowExists from "../../helpers/window-exists";
import type { FlowbitePositions, FlowbiteSizes } from "../Flowbite/FlowbiteTheme";
import { useTheme } from "../Flowbite/ThemeContext";
import { ModalBody } from "./ModalBody";
import { ModalContext } from "./ModalContext";
import { ModalFooter } from "./ModalFooter";
import { ModalHeader } from "./ModalHeader";

/** Every modal that is showing, oldest first, so Escape only ever reaches the one on top. */
const openModalStack: symbol[] = [];

/**
 * Whether any modal is showing.
 * @returns True while at least one modal is open.
 */
export const isAnyModalOpen = () => openModalStack.length > 0;

export interface ModalPositions extends FlowbitePositions {
  [key: string]: string;
}

export interface ModalSizes extends Omit<FlowbiteSizes, "xs"> {
  [key: string]: string;
}

export interface ModalProps extends PropsWithChildren<Omit<ComponentProps<"div">, "className">> {
  onClose?: () => void;
  position?: keyof ModalPositions;
  popup?: boolean;
  root?: HTMLElement;
  show?: boolean;
  size?: keyof ModalSizes;
  explicitClasses?: string[];
  /** Close on a click outside the modal or on Escape. Needs `onClose` to do anything. */
  dismissible?: boolean;
}

const ModalComponent: FC<ModalProps> = ({
  children,
  root = windowExists() ? document.body : undefined,
  show,
  popup,
  size = "2xl",
  position = "center",
  explicitClasses = [],
  onClose,
  dismissible = false,
  onClick,
  onMouseDown,
  ...props
}) => {
  const [container] = useState<HTMLDivElement | undefined>(windowExists() ? document.createElement("div") : undefined);
  const theme = useTheme().theme.modal;
  const theirProps = excludeClassName(props);
  const canDismiss = dismissible && !!onClose;

  // Read by the Escape listener so it does not have to be re-registered on every render.
  const closeOnEscapeRef = useRef<(() => void) | undefined>();
  closeOnEscapeRef.current = canDismiss ? onClose : undefined;

  // A drag that starts inside the modal and ends on the backdrop still fires a click on the backdrop.
  const isMouseDownOnBackdropRef = useRef(false);

  useEffect(() => {
    if (!show) return;

    const modalId = Symbol();
    openModalStack.push(modalId);

    // Bubble phase on window, so an input or menu inside the modal that handles Escape itself goes first.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (openModalStack[openModalStack.length - 1] !== modalId || !closeOnEscapeRef.current) return;
      event.preventDefault();
      closeOnEscapeRef.current();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      openModalStack.splice(openModalStack.indexOf(modalId), 1);
    };
  }, [show]);

  useEffect(() => {
    if (!container || !root || !show) {
      return;
    }

    root.appendChild(container);

    return () => {
      root.removeChild(container);
    };
  }, [container, root, show]);

  return container
    ? createPortal(
        <ModalContext.Provider value={{ popup, onClose }}>
          <div
            aria-hidden={!show}
            className={classNames(theme.base, theme.positions[position], show ? theme.show.on : theme.show.off)}
            data-testid="modal"
            role="dialog"
            {...theirProps}
            onMouseDown={(event) => {
              isMouseDownOnBackdropRef.current = event.target === event.currentTarget;
              onMouseDown?.(event);
            }}
            onClick={(event) => {
              if (canDismiss && isMouseDownOnBackdropRef.current && event.target === event.currentTarget) onClose?.();
              onClick?.(event);
            }}
          >
            <div className={classNames(theme.content.base, ...explicitClasses, theme.sizes[size])}>
              <div className={classNames(theme.content.inner, "!h-full")}>{children}</div>
            </div>
          </div>
        </ModalContext.Provider>,
        container,
      )
    : null;
};

ModalComponent.displayName = "Modal";
ModalHeader.displayName = "Modal.Header";
ModalBody.displayName = "Modal.Body";
ModalFooter.displayName = "Modal.Footer";

export const Modal = Object.assign(ModalComponent, {
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter,
});
