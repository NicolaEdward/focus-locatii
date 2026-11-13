"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";

type EscapeEntry = {
  id: symbol;
  close: () => void;
};

const escapeStack: EscapeEntry[] = [];
const modalStack: HTMLElement[] = [];
const inertOwners = new Map<HTMLElement, { count: number; previous: boolean }>();
let listenerAttached = false;
let previousBodyOverflow = "";

const focusSelector = 'a[href],button,input:not([type="hidden"]),select,textarea,[contenteditable="true"],[tabindex]';

function focusable(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusSelector)).filter((element) =>
    element.tabIndex >= 0 && !element.matches(":disabled")
    && !element.closest('[inert],[hidden],[aria-hidden="true"]') && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== "hidden"
  );
}

function initialFocus(dialog: HTMLElement) {
  if (dialog.contains(document.activeElement)) return;
  const items = focusable(dialog);
  const explicit = items.find((element) => element.matches('[autofocus],[data-autofocus]'));
  (explicit || items[0] || dialog).focus({ preventScroll: true });
}

function inertBackground(dialog: HTMLElement) {
  const owned: HTMLElement[] = [];
  let branch: HTMLElement = dialog;
  while (branch.parentElement) {
    const parent = branch.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (!(sibling instanceof HTMLElement) || sibling === branch || ["SCRIPT", "STYLE", "LINK"].includes(sibling.tagName)) continue;
      const current = inertOwners.get(sibling);
      if (current) current.count += 1;
      else {
        inertOwners.set(sibling, { count: 1, previous: sibling.inert });
        sibling.inert = true;
      }
      owned.push(sibling);
    }
    if (parent === document.body) break;
    branch = parent;
  }
  return () => {
    for (const sibling of owned) {
      const entry = inertOwners.get(sibling);
      if (!entry) continue;
      entry.count -= 1;
      if (entry.count === 0) {
        sibling.inert = entry.previous;
        inertOwners.delete(sibling);
      }
    }
  };
}

function handleEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented || event.repeat || event.isComposing) return;

  const activeEntry = escapeStack.at(-1);
  if (!activeEntry) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  activeEntry.close();
}

function attachListener() {
  if (listenerAttached || typeof window === "undefined") return;
  window.addEventListener("keydown", handleEscape);
  listenerAttached = true;
}

function detachListenerWhenIdle() {
  if (!listenerAttached || escapeStack.length || typeof window === "undefined") return;
  window.removeEventListener("keydown", handleEscape);
  listenerAttached = false;
}

export function useEscapeToClose(onClose: () => void, enabled = true) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;

    const entry: EscapeEntry = {
      id: Symbol("escape-close"),
      close: () => closeRef.current()
    };

    escapeStack.push(entry);
    attachListener();

    return () => {
      const index = escapeStack.findIndex((candidate) => candidate.id === entry.id);
      if (index >= 0) escapeStack.splice(index, 1);
      detachListenerWhenIdle();
    };
  }, [enabled]);
}

export function EscapeCloseHandler({ onClose, enabled = true }: { onClose: () => void; enabled?: boolean }) {
  const markerRef = useRef<HTMLSpanElement>(null);
  // Capture before React commits input autoFocus, which would lose the opener.
  const openerRef = useRef<HTMLElement | null>(typeof document === "undefined" ? null : document.activeElement as HTMLElement | null);
  const closeRef = useRef(onClose);
  const enabledRef = useRef(enabled);
  const headingId = useId();
  closeRef.current = onClose;
  enabledRef.current = enabled;

  useLayoutEffect(() => {
    const marker = markerRef.current;
    const dialog = marker?.closest<HTMLElement>('[role="dialog"]')
      || marker?.parentElement?.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const previousTabindex = dialog.getAttribute("tabindex");
    if (previousTabindex === null) dialog.tabIndex = -1;
    const heading = dialog.querySelector<HTMLElement>("h1,h2,h3,h4");
    const previousHeadingId = heading?.getAttribute("id") ?? null;
    const needsName = !dialog.getAttribute("aria-label") && !dialog.getAttribute("aria-labelledby");
    if (needsName && heading) {
      if (!heading.id) heading.id = `dialog-heading-${headingId}`;
      dialog.setAttribute("aria-labelledby", heading.id);
    } else if (needsName) dialog.setAttribute("aria-label", "Dialog");

    if (modalStack.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    modalStack.push(dialog);
    const restoreBackground = inertBackground(dialog);
    const escapeEntry: EscapeEntry = { id: Symbol("modal-close"), close: () => { if (enabledRef.current) closeRef.current(); } };
    escapeStack.push(escapeEntry);
    attachListener();
    initialFocus(dialog);

    function trap(event: KeyboardEvent) {
      if (modalStack.at(-1) !== dialog || event.key !== "Tab" || event.defaultPrevented) return;
      const items = focusable(dialog!);
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog!.focus();
      } else if (!dialog!.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      }
    }
    function containFocus(event: FocusEvent) {
      if (modalStack.at(-1) === dialog && !dialog!.contains(event.target as Node)) initialFocus(dialog!);
    }
    document.addEventListener("keydown", trap, true);
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("keydown", trap, true);
      document.removeEventListener("focusin", containFocus);
      const modalIndex = modalStack.lastIndexOf(dialog);
      if (modalIndex >= 0) modalStack.splice(modalIndex, 1);
      const escapeIndex = escapeStack.findIndex((entry) => entry.id === escapeEntry.id);
      if (escapeIndex >= 0) escapeStack.splice(escapeIndex, 1);
      detachListenerWhenIdle();
      restoreBackground();
      if (modalStack.length === 0) document.body.style.overflow = previousBodyOverflow;
      if (needsName) {
        dialog.removeAttribute("aria-labelledby");
        dialog.removeAttribute("aria-label");
      }
      if (heading && previousHeadingId === null) heading.removeAttribute("id");
      if (previousTabindex === null) dialog.removeAttribute("tabindex");
      queueMicrotask(() => {
        const opener = openerRef.current;
        if (opener?.isConnected && !opener.closest("[inert]")) opener.focus({ preventScroll: true });
        else if (modalStack.at(-1)) initialFocus(modalStack.at(-1)!);
      });
    };
  }, [headingId]);

  return <span ref={markerRef} hidden aria-hidden="true" data-modal-focus-sentinel="" />;
}
