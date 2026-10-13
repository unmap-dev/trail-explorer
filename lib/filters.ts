/**
 * Searching and filtering the loaded trails. A filter is only offered when the data can answer
 * it: no measured climb on any trail hides the climb filter, no official rating hides the
 * difficulty filter (spec §6: never fake a field). Pure functions; test/filters.test.ts.
 */
import type { Trail } from "./trails";

export type DistanceBucket = "short" | "medium" | "long";
export type GainBucket = "low" | "mid" | "high";

/** Upper bounds in metres; the last bucket is open-ended. */
export const DISTANCE_BUCKETS: Record<DistanceBucket, [number, number]> = { short: [0, 5000], medium: [5000, 10000], long: [10000, Infinity] };
export const GAIN_BUCKETS: Record<GainBucket, [number, number]> = { low: [0, 300], mid: [300, 700], high: [700, Infinity] };

export interface Filters {
  query: string;
  distance: DistanceBucket[];
  gain: GainBucket[];
  difficulty: string[];
}

export const NO_FILTERS: Filters = { query: "", distance: [], gain: [], difficulty: [] };

/** A difficulty the data carries: its value (the filter key), its labels and its place on the scale. */
export interface DifficultyOption {
  value: string;
  label: { en: string; fr: string };
  level: number | null;
}

/** What the data can be filtered by. Difficulties run easiest first where the source numbers them. */
export function availableFilters(trails: readonly Trail[]): { gain: boolean; difficulties: DifficultyOption[] } {
  const byValue = new Map<string, DifficultyOption>();
  for (const { difficulty: d } of trails)
    if (d && !byValue.has(d.value)) byValue.set(d.value, { value: d.value, label: { en: d.value, fr: d.valueFr ?? d.value }, level: d.level });
  return {
    gain: trails.some((t) => t.elevation !== null),
    difficulties: [...byValue.values()].sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity) || a.value.localeCompare(b.value)),
  };
}

/** Lowercase without accents, so "lac" finds "Lac" and "eiffel" finds "Éiffel". */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const inBucket = (value: number, [lo, hi]: [number, number]) => value >= lo && value < hi;

/**
 * The trails that match: the query against the names and area, then every active group (one of
 * the chosen buckets or values in each). A trail with no measured climb never matches a climb
 * bucket; it is not assumed to be flat.
 */
export function filterTrails(trails: readonly Trail[], f: Filters): Trail[] {
  const q = fold(f.query.trim());
  return trails.filter((t) => {
    if (q && !fold([t.name, t.nameFr ?? "", t.area ?? ""].join(" ")).includes(q)) return false;
    if (f.distance.length && !f.distance.some((b) => inBucket(t.length.metres, DISTANCE_BUCKETS[b]))) return false;
    if (f.gain.length && (!t.elevation || !f.gain.some((b) => inBucket(t.elevation!.gain, GAIN_BUCKETS[b])))) return false;
    if (f.difficulty.length && (!t.difficulty || !f.difficulty.includes(t.difficulty.value))) return false;
    return true;
  });
}

export function isFiltered(f: Filters): boolean {
  return !!f.query.trim() || f.distance.length > 0 || f.gain.length > 0 || f.difficulty.length > 0;
}
