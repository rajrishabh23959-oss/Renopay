import { useEffect, useRef } from "react";

/**
 * Custom hook to trap focus and handle ESC key for accessible modal dialogs (WCAG 2.2 AA).
 *
 * @param {boolean} isOpen Whether modal is currently open.
 * @param {Function} onClose Callback when user presses Escape.
 * @returns {React.RefObject} Ref to attach to the modal container.
 */
export function useFocusTrap(isOpen, onClose) {
  const containerRef = useRef(null);
  const prevFocusedElement = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    // Save active element to restore upon closing
    prevFocusedElement.current = document.activeElement;

    // Focus first focusable element inside container
    const timer = setTimeout(() => {
      if (containerRef.current) {
        const focusable = containerRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          containerRef.current.focus?.();
        }
      }
    }, 50);

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }

      if (e.key === "Tab" && containerRef.current) {
        const focusable = Array.from(
          containerRef.current.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusable.length === 0) return;

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !containerRef.current.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !containerRef.current.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      if (prevFocusedElement.current && typeof prevFocusedElement.current.focus === "function") {
        prevFocusedElement.current.focus();
      }
    };
  }, [isOpen, onClose]);

  return containerRef;
}
