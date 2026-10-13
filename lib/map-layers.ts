"use client";

/**
 * map-layers - the lifecycle every unmap data layer shares, and the design-token colours.
 *
 * `useLayerSet` adds a GeoJSON source and its layers once the map's style is ready, adds them
 * again after a style swap (a swap removes every source and layer), updates the data in place,
 * and removes both on unmount. Layers go below the first label layer unless told otherwise, so
 * place names stay readable over your data.
 *
 * The colour helpers turn your design system's tokens (`--primary`, `--chart-1`..`--chart-5`,
 * `--background`, `--muted-foreground`) into the concrete colours MapLibre paint needs.
 *
 * Copied into your project by `npx shadcn add`. Edit it freely.
 */

import { useEffect, useRef } from "react";
import type { Map } from "@unmap/maps";
import { useMap, useMapGeneration, useMapReady } from "@/lib/map-context";

/**
 * Marker/route styling the gateway resolved from a `?theme=` code, embedded in the style's
 * metadata under "unmap:theme". Absent (empty object) on unthemed styles. Duplicated per
 * component file on purpose: registry items must stand alone once copied into a project.
 */
type UnmapThemeMeta = {
  marker?: { color?: string; scale?: number };
  route?: {
    color?: string;
    width?: number;
    opacity?: number;
    casingColor?: string;
    casingWidth?: number;
    casingOpacity?: number;
  };
};

function themeMeta(map: { getStyle: () => { metadata?: unknown } | undefined } | null): UnmapThemeMeta {
  const meta = map?.getStyle()?.metadata;
  const t = meta && typeof meta === "object" ? (meta as Record<string, unknown>)["unmap:theme"] : undefined;
  return t && typeof t === "object" ? (t as UnmapThemeMeta) : {};
}

/** Theme metadata may carry `var()` strings; MapLibre cannot take those, so treat them as absent. */
function concrete(value: string | undefined): string | null {
  return value && !value.includes("var(") ? value : null;
}

/** The last resort when neither a theme nor a design-system token supplies a colour. */
const FALLBACK_ACCENT = "#ff3e9a";
/** A value no design system uses, so an invalid token can be told apart from a real colour. */
const SENTINEL = "#010203";

type MapLike = {
  getStyle: () => { metadata?: unknown } | undefined;
  getContainer?: () => HTMLElement | null;
};

/** The `<Map>` root: carries `data-unmap-accent` and the design-system custom properties. */
function hostOf(map: MapLike | null): HTMLElement | null {
  const element = map?.getContainer?.() ?? null;
  return element?.closest?.("[data-unmap-map]") ?? element;
}

function accentOf(host: HTMLElement | null): "theme" | "system" {
  return host?.getAttribute("data-unmap-accent") === "system" ? "system" : "theme";
}

/**
 * Resolve a design-system custom property (`--primary`, `--background`) to a concrete `#rrggbb`
 * string. MapLibre paint and the marker SVG cannot take `var()`, so the computed value is read off
 * the map container, painted into a 1x1 canvas, and the pixel read back. The pixel, not the
 * serialisation: a colour-managed canvas (Chrome 111+) hands `fillStyle` back in the colour's own
 * space, so an OKLCH token — what Tailwind v4 emits — comes back as `oklch(...)`, never as hex.
 * Returns null when the property is unset or the browser rejects the value. A translucent
 * token composites over the empty canvas and comes back as opaque RGB; its alpha is dropped.
 */
function resolveToken(host: HTMLElement | null, name: string): string | null {
  if (!host || typeof getComputedStyle !== "function") return null;
  const raw = getComputedStyle(host).getPropertyValue(name).trim();
  if (!raw) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = SENTINEL;
  context.fillStyle = raw; // left at the sentinel when the browser rejects `raw`
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  const hex = `#${[r, g, b].map((channel) => channel!.toString(16).padStart(2, "0")).join("")}`;
  return hex === SENTINEL && raw.toLowerCase() !== SENTINEL ? null : hex;
}

export { themeMeta, concrete, hostOf, accentOf, resolveToken, FALLBACK_ACCENT };
export type { UnmapThemeMeta };

/**
 * A single-series colour. An explicit colour first. Then, under `accent="theme"`, the theme's
 * colour before `--primary`; under `accent="system"`, `--primary` before the theme's.
 */
export function accentColor(map: Map | null, explicit: string | undefined, themed: string | undefined): string {
  if (explicit) return explicit;
  const host = hostOf(map);
  const fromTheme = concrete(themed);
  const system = () => resolveToken(host, "--primary");
  return (accentOf(host) === "system" ? system() ?? fromTheme : fromTheme ?? system()) ?? FALLBACK_ACCENT;
}

/** One design-system token as a concrete colour, or null when it is unset or invalid. */
export function tokenColor(map: Map | null, name: string): string | null {
  return resolveToken(hostOf(map), name);
}

/** `--chart-1`..`--chart-5` as concrete colours, skipping any that do not resolve. */
export function chartRamp(map: Map | null): string[] {
  const host = hostOf(map);
  const ramp = [1, 2, 3, 4, 5]
    .map((index) => resolveToken(host, `--chart-${index}`))
    .filter((colour): colour is string => colour !== null);
  return ramp.length > 0 ? ramp : [accentColor(map, undefined, undefined)];
}

/** GeoJSON as an object, or a URL MapLibre fetches. */
export type GeoJSONData = object | string;
export type LayerSpec = Parameters<Map["addLayer"]>[0];
type SourceSpec = Parameters<Map["addSource"]>[1];

/** Layer metadata key `useLayerSet` sets on every layer it adds, so ours never pass for the style's. */
const OVERLAY_KEY = "unmap:overlay";

/** A symbol layer of the style itself, not one an unmap layer item added (a cluster's counts). */
function isStyleLabels(layer: { type: string; metadata?: unknown }): boolean {
  return layer.type === "symbol" && (layer.metadata as Record<string, unknown> | undefined)?.[OVERLAY_KEY] !== true;
}

/** The first label layer of the current style: where overlays go by default. */
export function labelsLayerId(map: Map): string | undefined {
  return map.getStyle()?.layers?.find(isStyleLabels)?.id;
}

/**
 * An insertion point: a layer id, `null` for on top, `undefined` for below the labels, or a
 * function of the live map returning one of those, evaluated each time the layers are added.
 */
export type BeforeId = string | null | undefined | ((map: Map) => string | null | undefined);

/**
 * Where to insert. `undefined`: below the first label layer. `null`: on top of everything. A
 * layer id: below that layer, or below the labels when the current style no longer has it. A
 * function: called with the map, and its answer read the same way.
 */
export function resolveBeforeId(map: Map, beforeId: BeforeId): string | undefined {
  const target = typeof beforeId === "function" ? beforeId(map) : beforeId;
  if (target === null) return undefined;
  if (target && map.getLayer(target)) return target;
  return labelsLayerId(map);
}

/** A layer on `sourceId`, tagged as ours on top of any metadata it already carries. */
function overlay(layer: LayerSpec, sourceId: string): LayerSpec {
  const metadata = (layer as { metadata?: Record<string, unknown> }).metadata;
  return { ...layer, source: sourceId, metadata: { ...metadata, [OVERLAY_KEY]: true } } as LayerSpec;
}

export interface LayerSet {
  /** Map id when multiple maps share a page. Defaults to "default". */
  mapId?: string;
  /** The GeoJSON source id. Layer ids are yours; prefix them with this by convention. */
  sourceId: string;
  /** GeoJSON source options other than `data`, e.g. `{ lineMetrics: true }` or `{ cluster: true }`. */
  source?: Record<string, unknown>;
  /** The data to draw. A new object updates the source in place. */
  data: GeoJSONData;
  /**
   * The layers on this source, bottom first. Called whenever they are (re)added, with the live
   * map, so colours can be resolved from the current style's theme and your tokens.
   */
  layers: (map: Map) => LayerSpec[];
  /**
   * Insertion point; see `resolveBeforeId`. A function is evaluated against the live map each
   * time the layers are added (after a style swap or a key change), not when it changes.
   */
  beforeId?: BeforeId;
  /** Change this to rebuild the layers, e.g. when a colour or width prop changes. */
  key?: string;
}

/**
 * Add `set`'s source and layers when the style is ready, again after every style swap, and
 * remove them on unmount. Data changes go through `setData`.
 */
export function useLayerSet(set: LayerSet): { map: Map | null; ready: boolean } {
  const map = useMap(set.mapId);
  const ready = useMapReady(set.mapId);
  const generation = useMapGeneration(set.mapId);
  const latest = useRef(set);
  latest.current = set;
  const drawn = useRef<GeoJSONData | undefined>(undefined);
  const sourceKey = JSON.stringify(set.source ?? {});
  const beforeKey =
    typeof set.beforeId === "function" ? "\u0000fn" : set.beforeId === null ? "\u0000top" : (set.beforeId ?? "");

  useEffect(() => {
    if (!map || !ready) return;
    const { sourceId, source, data, layers, beforeId } = latest.current;
    let removed = false;
    const onRemove = () => {
      removed = true;
    };
    map.on("remove", onRemove);
    const specs = layers(map).map((layer) => overlay(layer, sourceId));
    if (!map.getSource(sourceId)) map.addSource(sourceId, { type: "geojson", ...source, data } as SourceSpec);
    drawn.current = data;
    const before = resolveBeforeId(map, beforeId);
    for (const layer of specs) {
      if (!map.getLayer(layer.id)) map.addLayer(layer, before);
    }
    return () => {
      map.off("remove", onRemove);
      // A removed map throws on every call; a style mid-swap has already dropped these.
      if (removed || !map.getStyle()) return;
      for (const layer of [...specs].reverse()) {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      }
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
    // `latest` carries the rest; these are what require a fresh add.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ready, generation, set.sourceId, sourceKey, beforeKey, set.key]);

  useEffect(() => {
    if (!map || !ready || drawn.current === set.data) return;
    const source = map.getSource(set.sourceId) as { setData?: (data: GeoJSONData) => void } | undefined;
    source?.setData?.(set.data);
    drawn.current = set.data;
  }, [map, ready, set.data, set.sourceId]);

  return { map, ready };
}

/** A feature under the pointer, as your handlers receive it. */
export interface MapFeatureEvent {
  /** The feature as GeoJSON. `id` is set when the source has feature ids (`promoteId`, `generateId`). */
  feature: { id?: string | number; properties: Record<string, unknown>; geometry: unknown };
  /** Where the pointer is, as [longitude, latitude]. */
  lngLat: [number, number];
}

type LayerMouseEvent = {
  features?: { id?: string | number; properties?: Record<string, unknown> | null; geometry?: unknown }[];
  lngLat?: { lng: number; lat: number };
};

function featureEvent(event: LayerMouseEvent): MapFeatureEvent | null {
  const found = event.features?.[0];
  if (!found || !event.lngLat) return null;
  return {
    feature: { ...(found.id !== undefined ? { id: found.id } : {}), properties: found.properties ?? {}, geometry: found.geometry },
    lngLat: [event.lngLat.lng, event.lngLat.lat],
  };
}

export interface LayerPointer {
  map: Map | null;
  /** The layers that respond to the pointer. */
  layerIds: string[];
  /** Bind nothing when false. */
  enabled: boolean;
  /** The source whose features get a `hover` feature-state while the pointer is over them. */
  hoverSource?: string;
  onClick?: (event: MapFeatureEvent) => void;
  /** Called when the feature under the pointer changes; `null` when the pointer leaves. */
  onHover?: (event: MapFeatureEvent | null) => void;
  /**
   * A change clears the hover state and the last reported feature. Pass the data when feature ids
   * are generated: after `setData` the old id can belong to another feature, and MapLibre fires
   * no pointer event for a pointer that stays still.
   */
  resetOn?: unknown;
}

/**
 * The label font stack of the current style, so layers we add can draw text with glyphs it serves.
 * A Regular stack wins over the first one, which may be the italic of water or address labels.
 */
export function labelFont(map: Map): string[] {
  const stacks = (map.getStyle()?.layers ?? [])
    .filter(isStyleLabels)
    .map((layer) => (layer as { layout?: Record<string, unknown> }).layout?.["text-font"])
    .filter((font): font is string[] => Array.isArray(font) && font.length > 0 && font.every((part) => typeof part === "string"));
  return stacks.find((font) => font.some((part) => /regular/i.test(part))) ?? stacks[0] ?? ["Noto Sans Regular"];
}

/** `#rrggbb` at an opacity, as `rgba()`. Other colour syntaxes are returned unchanged. */
export function withAlpha(colour: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (!match) return colour;
  const [r, g, b] = match.slice(1).map((channel) => parseInt(channel, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Pointer behaviour for a set of layers: a pointer cursor, a `hover` feature-state on
 * `hoverSource` (for paint expressions like `["feature-state", "hover"]`), and click/hover
 * events carrying the feature. Handlers may be inline functions; they are read when an event
 * fires, so a new function never rebinds the listeners.
 */
export function useLayerPointer(pointer: LayerPointer): void {
  const latest = useRef(pointer);
  latest.current = pointer;
  const { map, enabled, hoverSource, resetOn } = pointer;
  const layersKey = pointer.layerIds.join("\u0000");
  /** Clears what the bound listeners hold: the hovered id's state and the last reported feature. */
  const reset = useRef(() => {});

  useEffect(() => {
    if (!map || !enabled) return;
    const layerIds = layersKey.split("\u0000");
    const canvas = map.getCanvas();
    let removed = false;
    let hovered: string | number | undefined;
    let reported: string | number | undefined | null = null;
    const onRemove = () => {
      removed = true;
    };
    const setHover = (id: string | number | undefined, hover: boolean) => {
      if (removed || id === undefined || !hoverSource || !map.getSource(hoverSource)) return;
      map.setFeatureState({ source: hoverSource, id }, { hover });
    };
    const move = (event: LayerMouseEvent) => {
      canvas.style.cursor = "pointer";
      const next = featureEvent(event);
      const id = next?.feature.id;
      if (id !== hovered) {
        setHover(hovered, false);
        setHover(id, true);
        hovered = id;
      }
      const identity = next ? (id ?? JSON.stringify(next.feature.properties)) : null;
      if (identity !== reported) {
        reported = identity;
        latest.current.onHover?.(next);
      }
    };
    const leave = () => {
      canvas.style.cursor = "";
      setHover(hovered, false);
      hovered = undefined;
      if (reported !== null) {
        reported = null;
        latest.current.onHover?.(null);
      }
    };
    const click = (event: LayerMouseEvent) => {
      const next = featureEvent(event);
      if (next) latest.current.onClick?.(next);
    };
    // A swap drops every feature state, so the id still under the pointer must highlight again.
    const onStyleLoad = () => {
      hovered = undefined;
    };
    reset.current = () => {
      setHover(hovered, false);
      hovered = undefined;
      reported = null;
    };
    map.on("remove", onRemove);
    map.on("style.load", onStyleLoad);
    map.on("mousemove", layerIds, move as never);
    map.on("mouseleave", layerIds, leave as never);
    map.on("click", layerIds, click as never);
    return () => {
      reset.current = () => {};
      map.off("remove", onRemove);
      map.off("style.load", onStyleLoad);
      map.off("mousemove", layerIds, move as never);
      map.off("mouseleave", layerIds, leave as never);
      map.off("click", layerIds, click as never);
      if (removed) return;
      canvas.style.cursor = "";
      setHover(hovered, false);
    };
  }, [map, enabled, hoverSource, layersKey]);

  useEffect(() => {
    reset.current();
  }, [resetOn]);
}

/**
 * A curved line from `from` to `to`: a quadratic Bezier in longitude/latitude whose control point
 * sits `curvature` chord-lengths to the left of travel, so opposite directions bow apart. The
 * destination is unwrapped across the antimeridian so the arc takes the shorter way round.
 */
export function arcLine(from: [number, number], to: [number, number], curvature = 0.2, samples = 64): [number, number][] {
  const [x0, y0] = from;
  let [x1, y1] = to;
  if (x1 - x0 > 180) x1 -= 360;
  else if (x0 - x1 > 180) x1 += 360;
  if (x0 === x1 && y0 === y1) return [from, from];
  const cx = (x0 + x1) / 2 - (y1 - y0) * curvature;
  const cy = (y0 + y1) / 2 + (x1 - x0) * curvature;
  const points: [number, number][] = [];
  for (let index = 0; index <= samples; index++) {
    const t = index / samples;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    points.push([a * x0 + b * cx + c * x1, a * y0 + b * cy + c * y1]);
  }
  return points;
}

/** Bearing in degrees clockwise from north of a line's last segment; 0 when it has no length. */
export function arcBearing(line: [number, number][]): number {
  for (let index = line.length - 1; index > 0; index--) {
    const [x0, y0] = line[index - 1]!;
    const [x1, y1] = line[index]!;
    if (x0 === x1 && y0 === y1) continue;
    const degrees = (Math.atan2((x1 - x0) * Math.cos((((y0 + y1) / 2) * Math.PI) / 180), y1 - y0) * 180) / Math.PI;
    return (degrees + 360) % 360;
  }
  return 0;
}

/**
 * An upward arrowhead as a signed distance field, for `addImage(id, image, { sdf: true })`. Alpha
 * encodes each pixel's distance to the triangle's edge the way MapLibre reads an SDF: 0.75 on the
 * edge, opaque from 0.75 px inside, transparent from 2.25 px outside, so the arrow stays smooth
 * when `icon-size` scales it down. The triangle sits 3 px in from every side, which leaves the
 * field room to reach zero before the image edge. White throughout: `icon-color` tints it. No
 * canvas, so it is SSR-safe.
 */
export function flowArrowImage(size = 32): { width: number; height: number; data: Uint8ClampedArray } {
  const margin = 3;
  /** Pixels of distance across the whole 0..1 alpha range. */
  const spread = 3;
  const corners: [number, number][] = [
    [size / 2, margin],
    [size - margin, size - margin],
    [margin, size - margin],
  ];
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let distance = Infinity;
      let inside = true;
      for (let index = 0; index < 3; index++) {
        const [ax, ay] = corners[index]!;
        const [bx, by] = corners[(index + 1) % 3]!;
        const ex = bx - ax;
        const ey = by - ay;
        // The corners run clockwise on screen (y down), so inside is right of every edge.
        if (ex * (py - ay) - ey * (px - ax) < 0) inside = false;
        const along = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey)));
        distance = Math.min(distance, Math.hypot(px - ax - along * ex, py - ay - along * ey));
      }
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(255 * Math.min(1, Math.max(0, 0.75 + (inside ? distance : -distance) / spread)));
    }
  }
  return { width: size, height: size, data };
}

// --- layer tool helpers (kept identical across both lanes) ---

/**
 * Layer metadata key for a tool's own layers (a measurement, an outline): drawn for the reader,
 * not data, so the feature inspector and the time slider skip them. Set it in a layer's `metadata` next to the
 * `unmap:overlay` key `useLayerSet` adds to every layer it draws.
 */
export const HELPER_KEY = "unmap:helper";

/** The ids in `ids` that `patterns` name, in style order. A pattern ending in `*` is a prefix. */
export function matchLayers(ids: string[], patterns: string[]): string[] {
  return ids.filter((id) =>
    patterns.some((pattern) => (pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern)),
  );
}

type FilterSyntax = "expression" | "legacy" | "neutral";

/** `classifyChildren` in MapLibre 6.13's style spec: one expression child decides; else any legacy one. */
function classifyChildren(children: unknown[]): FilterSyntax {
  let legacy = false;
  for (const child of children) {
    const syntax = classifyFilter(child);
    if (syntax === "expression") return "expression";
    if (syntax === "legacy") legacy = true;
  }
  return legacy ? "legacy" : "neutral";
}

/**
 * `classifyFilter` in MapLibre 6.13's style spec (`maplibre-gl-dev.mjs`), line for line. A
 * neutral filter (a boolean, `["has", name]`) reads the same in either syntax.
 */
function classifyFilter(filter: unknown): FilterSyntax {
  if (typeof filter === "boolean") return "neutral";
  if (!Array.isArray(filter) || filter.length === 0) return "legacy";
  switch (filter[0]) {
    case "has":
      if (filter.length < 2 || filter[1] === "$id" || filter[1] === "$type") return "legacy";
      return filter.length === 2 ? "neutral" : "expression";
    case "in":
      return filter.length >= 3 && (typeof filter[1] !== "string" || Array.isArray(filter[2])) ? "expression" : "legacy";
    case "!in":
    case "!has":
    case "none":
      return "legacy";
    case "==":
    case "!=":
    case ">":
    case ">=":
    case "<":
    case "<=":
      return filter.length !== 3 || Array.isArray(filter[1]) || Array.isArray(filter[2]) ? "expression" : "legacy";
    case "any":
    case "all":
      return classifyChildren(filter.slice(1));
    default:
      return "expression";
  }
}

/**
 * MapLibre's own test for an expression filter, as opposed to the legacy syntax: its
 * `isExpressionFilter` is `classifyFilter(filter) !== "legacy"`. The two cannot be mixed inside
 * one `all`, so a clause is written in the syntax the layer already uses.
 */
export function isExpressionFilter(filter: unknown): boolean {
  return classifyFilter(filter) !== "legacy";
}

/** Equal filters, with no filter (`undefined`) and a cleared one (`null`) the same. */
export function sameFilter(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** `base` narrowed by every clause: `["all", base, ...clauses]`, the clauses alone without a base, `base` alone without clauses. */
export function composeFilter(base: unknown, clauses: unknown[]): unknown {
  if (clauses.length === 0) return base ?? null;
  if (base == null) return clauses.length === 1 ? clauses[0] : ["all", ...clauses];
  return ["all", base, ...clauses];
}

/** The part of a MapLibre map a filter writer drives. */
export interface FilterMap {
  getFilter(id: string): unknown;
  setFilter(id: string, filter: unknown): unknown;
}

/** A writer's clause, built for the syntax of the layer's own filter: `true` for an expression, `false` for legacy. */
export type FilterClause = (expression: boolean) => unknown;

interface LayerFilterEntry {
  /** The layer's own filter: whatever it had that no writer put there. */
  base: unknown;
  /** The filter last written, or read as the base. */
  applied: unknown;
  /** Each writer's clause, by writer name, in the order they were first added. */
  clauses: globalThis.Map<string, unknown>;
}

// `globalThis.Map`: in this file `Map` is MapLibre's map type.
const LAYER_FILTERS = new WeakMap<object, globalThis.Map<string, LayerFilterEntry>>();

function layerFilters(map: object): globalThis.Map<string, LayerFilterEntry> {
  let store = LAYER_FILTERS.get(map);
  if (!store) {
    store = new globalThis.Map();
    LAYER_FILTERS.set(map, store);
  }
  return store;
}

/**
 * Put `writer`'s clause on layer `id`'s filter, or take it off with `null`, next to every other
 * writer's and on top of the layer's own filter. Several items can narrow one layer this way (a
 * legend's unchecked values, a time window) without undoing each other or nesting a clause twice.
 * The store is per map and outlives the items, so one that unmounts and mounts again still knows
 * what it wrote. A filter no writer put there is the layer's own (a new style, or an owner that
 * added its layer again): it becomes the base and every clause is dropped; each live writer puts
 * its own back on its next pass. Writes only when the result differs, so it can run on every
 * `styledata`. The layer must be in the style: MapLibre's `getFilter` throws on a missing one.
 */
export function setLayerClause(map: FilterMap, id: string, writer: string, clause: FilterClause | null): void {
  const store = layerFilters(map);
  let entry = store.get(id);
  if (!entry && clause === null) return;
  const current = map.getFilter(id);
  if (!entry || !sameFilter(current, entry.applied)) {
    entry = { base: current, applied: current, clauses: new globalThis.Map() };
    store.set(id, entry);
  }
  if (clause === null) entry.clauses.delete(writer);
  else entry.clauses.set(writer, clause(entry.base == null || isExpressionFilter(entry.base)));
  const next = composeFilter(entry.base, [...entry.clauses.values()]);
  if (sameFilter(current, next)) {
    entry.applied = next;
    return;
  }
  map.setFilter(id, next);
  // MapLibre validates a filter and rejects an invalid one with an `error` event, keeping the old
  // one. Recording `next` then would make the next pass take the real filter for the layer's own
  // and nest every clause inside it, so the store records what the layer really carries. The
  // rejected clause is dropped: held, it would sink every later write by any writer on the layer.
  entry.applied = map.getFilter(id);
  if (!sameFilter(entry.applied, next)) entry.clauses.delete(writer);
}

/** The layer ids whose filter carries a clause from `writer`. */
export function layersWithClause(map: object, writer: string): string[] {
  const store = LAYER_FILTERS.get(map);
  if (!store) return [];
  return [...store].filter(([, entry]) => entry.clauses.has(writer)).map(([id]) => id);
}

/**
 * Take `writer`'s clause off every layer that carries it. A layer the style no longer has (or
 * every layer, while a style swap is under way) is only forgotten: the next style brings its own
 * filter back anyway.
 */
export function releaseLayerClauses(
  map: FilterMap & { getStyle(): { layers?: Array<{ id: string }> } | undefined },
  writer: string,
): void {
  const store = LAYER_FILTERS.get(map);
  if (!store) return;
  const present = new Set((map.getStyle()?.layers ?? []).map((layer) => layer.id));
  for (const [id, entry] of [...store]) {
    if (!entry.clauses.has(writer)) continue;
    if (present.has(id)) setLayerClause(map, id, writer, null);
    else entry.clauses.delete(writer);
  }
}
// --- end layer tool helpers ---
