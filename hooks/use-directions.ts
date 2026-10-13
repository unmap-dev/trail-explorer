"use client";

import type { RouteResult } from "@unmap/sdk";
import type { Lang } from "@/lib/kit/i18n";
import { getUnmap } from "@/lib/kit/client";
import { useAsync } from "@/lib/use-async";

/**
 * A road route by car from `from` to a trailhead, with turn-by-turn steps in the page's language.
 * Off until both ends exist and it is asked for. Road routing only: it ends at the nearest road.
 */
export function useDirections(from: [number, number] | null, to: [number, number] | null, lang: Lang, enabled: boolean) {
  const key = enabled && from && to ? `${from.join(",")}|${to.join(",")}|${lang}` : null;
  return useAsync<RouteResult>(key, async (signal) => {
    const unmap = getUnmap();
    if (!unmap || !from || !to) throw new Error("No API key");
    return unmap.router.route(from, to, { mode: "auto", steps: true, lang, signal });
  });
}
