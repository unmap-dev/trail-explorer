"use client";

import { useEffect, useState } from "react";
import { isAbort } from "@/lib/kit/errors";

export type AsyncState<T> = { status: "idle" } | { status: "loading" } | { status: "done"; data: T } | { status: "error"; error: unknown };

/**
 * Run `load` when `key` changes, cancelling the previous run through its AbortSignal so an
 * obsolete answer never lands (spec §11). `key: null` means nothing to load. A result is kept with
 * the key it was loaded for, so a stale one is never shown for a new key. `retry` re-runs it.
 */
export function useAsync<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): [AsyncState<T>, () => void] {
  const [entry, setEntry] = useState<{ key: string; state: AsyncState<T> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (key == null) return;
    const controller = new AbortController();
    load(controller.signal).then(
      (data) => !controller.signal.aborted && setEntry({ key: `${key}#${attempt}`, state: { status: "done", data } }),
      (error: unknown) => !controller.signal.aborted && !isAbort(error) && setEntry({ key: `${key}#${attempt}`, state: { status: "error", error } }),
    );
    return () => controller.abort();
    // `load` is a fresh closure every render; `key` and `attempt` identify the work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  const retry = () => setAttempt((n) => n + 1);
  if (key == null) return [{ status: "idle" }, retry];
  return [entry?.key === `${key}#${attempt}` ? entry.state : { status: "loading" }, retry];
}
