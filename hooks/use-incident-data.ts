"use client";

import { useSyncExternalStore } from "react";
import {
  createIncidentDataClient,
  type IncidentDataClient,
  type IncidentSnapshot,
} from "@/lib/data";
import type { IncidentShell } from "@/types/shells";

const EMPTY_INCIDENTS: readonly IncidentShell[] = [];

interface SharedClient {
  client: IncidentDataClient | null;
  error: string | null;
}

let resolved = false;
let shared: SharedClient = { client: null, error: null };

function getSharedClient(): SharedClient {
  if (!resolved) {
    resolved = true;
    try {
      shared = { client: createIncidentDataClient(), error: null };
    } catch (cause) {
      shared = {
        client: null,
        error: cause instanceof Error ? cause.message : "Unable to open the incident client.",
      };
    }
  }
  return shared;
}

export interface IncidentListState {
  incidents: readonly IncidentShell[];
  client: IncidentDataClient | null;
  error: string | null;
  mode: IncidentDataClient["mode"] | "unavailable";
}

export function useIncidentList(): IncidentListState {
  const sharedClient = getSharedClient();
  const canRead = sharedClient.client?.mode === "mock";

  const incidents = useSyncExternalStore(
    (callback) => {
      if (!canRead || !sharedClient.client) return () => {};
      return sharedClient.client.subscribe(callback);
    },
    () => (canRead && sharedClient.client ? sharedClient.client.getIncidentList() : EMPTY_INCIDENTS),
    () => (canRead && sharedClient.client ? sharedClient.client.getIncidentList() : EMPTY_INCIDENTS),
  );

  return {
    incidents,
    client: sharedClient.client,
    error: sharedClient.error,
    mode: sharedClient.client?.mode ?? "unavailable",
  };
}

export function useIncidentSnapshot(incidentId: string): {
  snapshot: IncidentSnapshot | null;
  error: string | null;
  mode: IncidentListState["mode"];
} {
  const { client, error, mode } = useIncidentList();
  const snapshot = client && mode === "mock" ? client.getSnapshot(incidentId) : null;
  return { snapshot, error, mode };
}
