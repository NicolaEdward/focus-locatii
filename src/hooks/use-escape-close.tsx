"use client";

import { useEffect, useRef } from "react";

type EscapeEntry = {
  id: symbol;
  close: () => void;
};

const escapeStack: EscapeEntry[] = [];
let listenerAttached = false;

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
  useEscapeToClose(onClose, enabled);
  return null;
}
