"use client";

import { useSyncExternalStore } from "react";
import { formatTimestamp } from "@/lib/time";

function subscribe(): () => void {
  return () => {};
}

/** False during server render and hydration, then true so local clocks cannot mismatch. */
export function useLocalClock(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

export function LocalTime({
  value,
  prefix = "",
  suffix = "",
}: {
  value: string | Date;
  prefix?: string;
  suffix?: string;
}) {
  const ready = useLocalClock();
  if (!ready) return null;
  return (
    <>
      {prefix}
      {formatTimestamp(value)}
      {suffix}
    </>
  );
}
