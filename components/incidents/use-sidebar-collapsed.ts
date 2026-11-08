"use client";

import { useCallback, useSyncExternalStore } from "react";

// Per-browser layout preference only. It holds no incident data, so localStorage is fine here.
const KEY = "haven.sidebarCollapsed";
const listeners = new Set<() => void>();
// Fallback when storage is blocked, so the toggle still works for this tab.
let memory = false;

function read(): boolean {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === null ? memory : stored === "1";
  } catch {
    return memory;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the incident sidebar is collapsed to icons. Expanded by default and on the server. */
export function useSidebarCollapsed(): [boolean, (next: boolean) => void] {
  const collapsed = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => {
    memory = next;
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // Storage can be blocked; the in-memory value keeps the toggle working in this tab.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [collapsed, set];
}
