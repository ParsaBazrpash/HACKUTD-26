"use client";

import { useSyncExternalStore } from "react";
import { getIncidentClient } from "@/lib/client";
import { clientErrorMessage } from "@/lib/client/errors";
import { EMPTY_PROFILE, type IncidentState } from "@/lib/client/types";

const SERVER_SNAPSHOT: IncidentState = {
  connection: "connecting",
  me: null,
  incident: null,
  status: null,
  members: [],
  channels: [],
  timeline: [],
  scope: [],
  tasks: [],
  profile: EMPTY_PROFILE,
  discovery: null,
  materiality: null,
  deadlineUpdates: {},
  evidence: [],
  integrity: {
    ok: true,
    checkedAt: new Date(0),
    channels: {},
    rosterFailures: [],
  },
  org: null,
  roster: [],
  pages: [],
};

let clientFailure: IncidentState | null = null;
let clientReady = false;

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let unsubscribe = () => {};
  try {
    unsubscribe = getIncidentClient().subscribe(listener);
  } catch {
    unsubscribe = () => {};
  }
  // The server snapshot stays in place until this subscription runs, so hydration
  // does not compare "opening" HTML with an already-ready client store.
  clientReady = true;
  queueMicrotask(listener);
  return () => {
    unsubscribe();
  };
}

function getSnapshot(): IncidentState {
  if (typeof window === "undefined" || !clientReady) return SERVER_SNAPSHOT;
  try {
    return getIncidentClient().getState();
  } catch (cause) {
    clientFailure ??= {
      ...SERVER_SNAPSHOT,
      connection: "error",
      error: clientErrorMessage(cause),
    };
    return clientFailure;
  }
}

function getServerSnapshot(): IncidentState {
  return SERVER_SNAPSHOT;
}

/** Incident snapshot. The same object is returned until the client publishes a change. */
export function useIncident(): IncidentState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
