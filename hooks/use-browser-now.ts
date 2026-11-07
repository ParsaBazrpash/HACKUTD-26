"use client";

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let cachedNow: number | null = null;
let intervalId: number | null = null;

function notify(): void {
  cachedNow = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (intervalId === null) {
    cachedNow = Date.now();
    intervalId = window.setInterval(notify, 1000);
    queueMicrotask(() => {
      for (const current of listeners) current();
    });
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
      cachedNow = null;
    }
  };
}

function getSnapshot(): number | null {
  return cachedNow;
}

function getServerSnapshot(): number | null {
  return null;
}

/** Browser clock. Server and hydration render null so timestamps do not mismatch. */
export function useBrowserNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
