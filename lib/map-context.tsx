"use client";

/**
 * map-context - headless MapLibre lifecycle for React, wired to the unmap gateway.
 *
 * Owns the map instance so every other unmap component (Map, Geocoder, RoutingPanel,
 * Marker/Popup) can reach it through a hook instead of prop-drilling. Supports more than
 * one map on a page via an optional string id.
 *
 * - `MapProvider`        creates the map with `@unmap/maps` `createMap`, swaps the style in place
 *                        when only the cartography changes, and calls `map.remove()` on unmount.
 * - `useMap(id?)`        returns the MapLibre `Map` (or null before it exists).
 * - `useMapReady(id?)`   true while a style is loaded: false before the first load and while a
 *                        new style is loading.
 * - `useMapGeneration()` 0 until the first load, then +1 per completed style load. A style swap
 *                        removes every source and layer, so anything that adds them re-adds them
 *                        when this changes.
 * - `useResolvedMode()`  resolves `"auto"` to the page's light or dark mode, and follows it.
 *
 * This file is copied into your project by `npx shadcn add`. Edit it freely.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createMap, maplibregl, unmapStyle, type Map, type UnmapMapOptions } from "@unmap/maps";

/** A MapLibre projection, as `getProjection()` returns it. */
type ProjectionSpec = ReturnType<Map["getProjection"]>;

/**
 * The projection a map is drawn in when the caller does not say. Set here as well as in
 * `@unmap/maps` so the provider owns it whichever version of the package is installed.
 */
const DEFAULT_PROJECTION: NonNullable<UnmapMapOptions["projection"]> = "globe";

/** The default map id, used when a component does not pass one. */
export const DEFAULT_MAP_ID = "default";

interface MapEntry {
  map: Map | null;
  /** True while a style is loaded. */
  ready: boolean;
  /** 0 until the first load, then +1 for every completed style load. */
  generation: number;
}

const EMPTY_ENTRY: MapEntry = { map: null, ready: false, generation: 0 };

interface MapContextValue {
  /** Register (or replace) the map instance for an id. */
  set: (id: string, entry: MapEntry) => void;
  /** Clear an entry only when it still refers to the supplied map. */
  clear: (id: string, map: Map) => void;
  /** Read the current entry for an id. */
  get: (id: string) => MapEntry | undefined;
  /** Snapshot used to trigger re-renders of consumers. */
  entries: Record<string, MapEntry>;
}

const MapContext = createContext<MapContextValue | null>(null);

/** `"light"` or `"dark"`, or `"auto"` to follow the page. */
export type MapMode = "light" | "dark" | "auto";

/** The camera, as `onViewportChange` reports it. */
export interface MapViewport {
  /** [longitude, latitude]. */
  center: [number, number];
  zoom: number;
  /** Degrees clockwise from north. */
  bearing: number;
  /** Degrees from straight down. */
  pitch: number;
}

/**
 * The options `MapProvider` accepts. `apiKey` avoids React's reserved `key` prop; it is
 * translated back to the SDK's `key` option when the map is created.
 */
export type MapProviderOptions = Omit<UnmapMapOptions, "container" | "key"> & {
  apiKey: string;
  /** Camera bearing in degrees, applied in place. */
  bearing?: number;
  /** Camera pitch in degrees, applied in place. */
  pitch?: number;
  /** Fires as the camera moves, except for moves these props caused. */
  onViewportChange?: (viewport: MapViewport) => void;
  /** Keeps the camera inside these bounds: a tuple, or `"canada"`. Applied in place. */
  maxBounds?: MapBounds;
  /** The lowest zoom the camera may reach. Applied in place. */
  minZoom?: number;
  /** The highest zoom the camera may reach. Applied in place. */
  maxZoom?: number;
  /** `false` turns off every gesture and the keyboard. Applied in place. */
  interactive?: boolean;
  /** Ctrl or Cmd with the wheel, two fingers on touch. Applied in place. */
  cooperativeGestures?: boolean;
  /** Sync the camera to the URL hash; a string names the hash parameter. Applied in place. */
  hash?: boolean | string;
};

/** The raw MapLibre options `createMap` merges last. The shared camera helpers read limits from it. */
type MaplibreOptions = NonNullable<UnmapMapOptions["maplibre"]>;

export interface MapProviderProps extends MapProviderOptions {
  /**
   * The map container element. Rendered and owned by the `<Map>` component; the provider
   * waits until it is non-null before creating the map. Pass `null` to defer creation.
   */
  container: HTMLElement | null;
  /** Distinguishes multiple maps on one page. Defaults to `"default"`. */
  id?: string;
  children?: ReactNode;
}

/**
 * A shared registry context so sibling providers (multiple maps) share one store and
 * `useMap(id)` can resolve any of them. If no parent provider exists we create the store here.
 */
function useMapStore(): MapContextValue {
  const parent = useContext(MapContext);
  const [entries, setEntries] = useState<Record<string, MapEntry>>({});
  const get = useCallback((id: string) => entries[id], [entries]);
  const set = useCallback(
    (id: string, entry: MapEntry) => setEntries((prev) => ({ ...prev, [id]: entry })),
    [],
  );
  const clear = useCallback(
    (id: string, map: Map) =>
      setEntries((prev) => (prev[id]?.map === map ? { ...prev, [id]: EMPTY_ENTRY } : prev)),
    [],
  );
  const local = useMemo<MapContextValue>(() => ({ entries, get, set, clear }), [entries, get, set, clear]);
  return parent ?? local;
}

function viewportOf(map: Map): MapViewport {
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

type CameraTarget = { center?: [number, number]; zoom?: number; bearing?: number; pitch?: number };

/** True when every field `target` sets matches `viewport`. */
function matches(target: CameraTarget, viewport: MapViewport): boolean {
  return (
    (target.center == null || (near(target.center[0], viewport.center[0]) && near(target.center[1], viewport.center[1]))) &&
    (target.zoom == null || near(target.zoom, viewport.zoom)) &&
    (target.bearing == null || near(target.bearing, viewport.bearing)) &&
    (target.pitch == null || near(target.pitch, viewport.pitch))
  );
}

/** A viewport reported through onViewportChange, and when. */
type Report = { viewport: MapViewport; at: number };

// Long enough for a parent's re-render (or a frame and a debounce) to echo a report, short
// enough that a deliberate prop change back to a viewport the user passed through still moves.
const ECHO_WINDOW_MS = 250;

/** A memory bound on the reports kept when no camera prop re-renders; the window decides echoes. */
const MAX_REPORTED = 64;

function timestamp(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

// --- shared camera helpers: byte-identical in both lanes (registry-contract.test.ts) ---

/** `[[west, south], [east, north]]` or `[west, south, east, north]`, in degrees. */
export type MapBoundsTuple = [[number, number], [number, number]] | [number, number, number, number];

/** Where the camera may go: a bounds tuple, or `"canada"` for all of Canada with a margin. */
export type MapBounds = MapBoundsTuple | "canada";

/**
 * All of Canada with room around it. Canada runs from 141°W (Yukon and Alaska) to 52.6°W (Cape
 * Spear) and from 41.7°N (Middle Island, Lake Erie) to 83.1°N (Cape Columbia). The margin keeps a
 * pin on any coast off the edge of the screen. The north edge is 85°N, just inside the 85.05°N
 * where Web Mercator ends: MapLibre cannot constrain past it.
 */
export const CANADA_BOUNDS: [[number, number], [number, number]] = [
  [-150, 38],
  [-45, 85],
];

/** A `maxBounds` value as MapLibre takes it: the preset resolved, an unknown preset dropped. */
export function resolveBounds(bounds: MapBounds | undefined): MapBoundsTuple | undefined {
  if (bounds === undefined) return undefined;
  if (typeof bounds === "string") return bounds === "canada" ? CANADA_BOUNDS : undefined;
  return bounds;
}

/** Tell a controlled parent where the camera is, and remember it so its echo is recognised. */
function report(map: Map, onViewportChange: ((viewport: MapViewport) => void) | undefined, reported: Report[]): void {
  if (!onViewportChange) return;
  const viewport = viewportOf(map);
  reported.push({ viewport, at: timestamp() });
  if (reported.length > MAX_REPORTED) reported.shift();
  onViewportChange(viewport);
}

type LimitOptions = { maxBounds?: MapBounds; minZoom?: number; maxZoom?: number };

/** The camera limits MapLibre is given: only those that are set. */
type Constraints = {
  maxBounds?: MapBoundsTuple | NonNullable<MaplibreOptions["maxBounds"]>;
  minZoom?: number;
  maxZoom?: number;
};

/** MapLibre's zoom range when no limit narrows it. It accepts no minZoom below -2. */
const DEFAULT_MIN_ZOOM = -2;
const DEFAULT_MAX_ZOOM = 22;

/** Identifies the limits a set of props asks for, so they are applied only when they change. */
function limitsKey(options: LimitOptions): string {
  return JSON.stringify([options.maxBounds ?? null, options.minZoom ?? null, options.maxZoom ?? null]);
}

/** True when a camera limit is set, by a prop or by the raw `maplibre` option. */
function limited(options: LimitOptions, raw: MaplibreOptions | undefined): boolean {
  return (
    options.maxBounds != null ||
    raw?.maxBounds != null ||
    [options.minZoom, options.maxZoom, raw?.minZoom, raw?.maxZoom].some((value) => Number.isFinite(value))
  );
}

/** A zoom limit MapLibre can take. One that is not a finite number (NaN, Infinity) is unset, with a warning. */
function finiteZoom(name: "minZoom" | "maxZoom", value: number | null | undefined): number | undefined {
  if (value == null) return undefined;
  if (Number.isFinite(value)) return value;
  console.warn(`unmap: ${name} ${value} is not a finite number; it is ignored.`);
  return undefined;
}

/**
 * The limits as MapLibre accepts them. Each one is the prop, or else the raw `maplibre` option's;
 * a zoom that is not a finite number counts as unset. MapLibre throws on a minZoom above maxZoom
 * (an unset one counts as its default, -2 or 22) and on a minZoom below -2, so those are dropped
 * with a warning: both of an inverted pair, or the one bound that is out of range on its own (a
 * minZoom below -2 or above the max zoom, or a maxZoom below -2).
 */
function constraintsOf(options: LimitOptions, raw: MaplibreOptions | undefined): Constraints {
  const maxBounds = resolveBounds(options.maxBounds) ?? raw?.maxBounds ?? undefined;
  let minZoom = finiteZoom("minZoom", options.minZoom) ?? finiteZoom("minZoom", raw?.minZoom);
  let maxZoom = finiteZoom("maxZoom", options.maxZoom) ?? finiteZoom("maxZoom", raw?.maxZoom);
  if (minZoom != null && maxZoom != null && minZoom > maxZoom) {
    console.warn(`unmap: minZoom ${minZoom} is above maxZoom ${maxZoom}; both are ignored.`);
    minZoom = undefined;
    maxZoom = undefined;
  }
  if (minZoom != null && (minZoom < DEFAULT_MIN_ZOOM || minZoom > (maxZoom ?? DEFAULT_MAX_ZOOM))) {
    console.warn(`unmap: minZoom ${minZoom} is outside ${DEFAULT_MIN_ZOOM} to ${maxZoom ?? DEFAULT_MAX_ZOOM}; it is ignored.`);
    minZoom = undefined;
  }
  if (maxZoom != null && maxZoom < DEFAULT_MIN_ZOOM) {
    console.warn(`unmap: maxZoom ${maxZoom} is below ${DEFAULT_MIN_ZOOM}; it is ignored.`);
    maxZoom = undefined;
  }
  return {
    ...(maxBounds ? { maxBounds } : {}),
    ...(minZoom != null ? { minZoom } : {}),
    ...(maxZoom != null ? { maxZoom } : {}),
  };
}

/**
 * The raw `maplibre` option with its limits replaced by `constraints`. When they already agree it
 * is returned as given, so a map whose props set no limits is created with the caller's own object.
 */
function withConstraints(raw: MaplibreOptions | undefined, constraints: Constraints): MaplibreOptions | undefined {
  const { maxBounds, minZoom, maxZoom, ...rest } = raw ?? {};
  const asked = JSON.stringify([maxBounds ?? null, minZoom ?? null, maxZoom ?? null]);
  const given = JSON.stringify([constraints.maxBounds ?? null, constraints.minZoom ?? null, constraints.maxZoom ?? null]);
  return asked === given ? raw : { ...rest, ...constraints };
}

/**
 * Apply limits to a live map. A limit that is not set goes back to MapLibre's default. MapLibre
 * throws when a new minZoom is above the current maxZoom (or a new maxZoom below the current
 * minZoom), so the bound that makes room moves first.
 */
function applyConstraints(map: Map, constraints: Constraints): void {
  map.setMaxBounds(constraints.maxBounds ?? null);
  const min = constraints.minZoom ?? null;
  const max = constraints.maxZoom ?? null;
  if (min != null && min > map.getMaxZoom()) {
    map.setMaxZoom(max);
    map.setMinZoom(min);
  } else {
    map.setMinZoom(min);
    map.setMaxZoom(max);
  }
}

/** The gesture handlers MapLibre's `interactive` option gates, by their option and property name. */
const GESTURE_HANDLERS = [
  "scrollZoom",
  "boxZoom",
  "dragRotate",
  "dragPan",
  "keyboard",
  "doubleClickZoom",
  "touchZoomRotate",
  "touchPitch",
] as const;

/**
 * What MapLibre's `interactive` option decides, applied to a live map: the eight gesture handlers
 * it leaves disabled when false, and the two things it sets on the container at construction
 * (the grab cursor class and the canvas's keyboard focus). MapLibre has no setter for it.
 * Turning it on does what the constructor does: a handler the raw `maplibre` option turned off
 * (`dragRotate: false`) stays off, and one given options (`scrollZoom: { around: "center" }`) is
 * enabled with them, since a bare `enable()` resets them.
 */
function setInteractive(map: Map, on: boolean, raw: MaplibreOptions | undefined): void {
  for (const name of GESTURE_HANDLERS) {
    const handler: { enable(options?: boolean | object | null): void; disable(): void } = map[name];
    const option = raw?.[name];
    if (!on) handler.disable();
    else if (option !== false) handler.enable(typeof option === "object" ? option : undefined);
  }
  map.getCanvasContainer().classList.toggle("maplibregl-interactive", on);
  map.getCanvas().setAttribute("tabindex", on ? "0" : "-1");
}

/** The gesture options a map can set in place. */
type GestureProps = { interactive?: boolean; cooperativeGestures?: boolean };

/**
 * The raw `maplibre` option with the gesture options that are set laid over it. With none set it
 * is returned as given: MapLibre reads an explicit `interactive: undefined` as off, and a caller's
 * own `maplibre.interactive` must survive a map that does not set the option.
 */
function withGestures(raw: MaplibreOptions | undefined, options: GestureProps): MaplibreOptions | undefined {
  const set: GestureProps = {
    ...(options.interactive !== undefined ? { interactive: options.interactive } : {}),
    ...(options.cooperativeGestures !== undefined ? { cooperativeGestures: options.cooperativeGestures } : {}),
  };
  return Object.keys(set).length === 0 ? raw : { ...raw, ...set };
}

/**
 * `hash` as MapLibre reads it: `true` for the bare `#zoom/lat/lng`, a name for
 * `#name=zoom/lat/lng`, `false` for off. An empty name is off, as it is in MapLibre.
 */
function hashParamOf(hash: boolean | string | undefined): string | boolean {
  return hash === true ? true : typeof hash === "string" && hash !== "" ? hash : false;
}

// --- end shared camera helpers ---

export function MapProvider({
  container,
  id = DEFAULT_MAP_ID,
  children,
  apiKey,
  gateway,
  style,
  mode,
  lang,
  theme,
  overlays,
  profile,
  center,
  zoom,
  bearing,
  pitch,
  projection = DEFAULT_PROJECTION,
  controls,
  maplibre,
  maxBounds,
  minZoom,
  maxZoom,
  interactive,
  cooperativeGestures,
  hash,
  onViewportChange,
}: MapProviderProps) {
  const store = useMapStore();
  const { set, clear } = store;
  const activeMapRef = useRef<Map | null>(null);
  // The style URL the active map shows or is loading. A cartography change swaps only when it differs.
  const appliedStyleRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const loadedRef = useRef(false);
  // The projection the next style load puts back: the `projection` prop, or whatever the map
  // showed when a swap began (a control such as map-controls' globe button sets it directly).
  const projectionRef = useRef<ProjectionSpec>({ type: projection });
  // True while the provider itself moves the camera, so the move is not echoed to onViewportChange.
  const syncingRef = useRef(false);
  // Viewports reported through onViewportChange, oldest first. A parent that feeds them back
  // renders one of these as props, possibly several reports late and after the gesture moved on.
  const reportedRef = useRef<Report[]>([]);
  // The limits the active map was created with or last given, so an unchanged set is never re-applied.
  const appliedLimitsRef = useRef("");
  // What the active map was created with or last given, so an unchanged value is never re-applied
  // and a caller's raw `maplibre` gesture options survive a map that does not set these props.
  const appliedInteractiveRef = useRef(true);
  const appliedCooperativeRef = useRef(false);

  // Keyed on primitives, not on the object: `controls={{ position: "bottom-left" }}` is exactly
  // the shape a caller writes inline, and an object in a dependency list would tear the map
  // down and rebuild it on every render.
  const controlsOff = controls === false;
  const controlsPosition = typeof controls === "object" ? controls.position : undefined;
  const overlaysKey = overlays?.join(",") ?? "";

  // Latest props, read by effects that must not re-run when these change.
  const latest = useRef({ style, mode, lang, theme, overlays, profile, center, zoom, bearing, pitch, projection, onViewportChange, maxBounds, minZoom, maxZoom, maplibre, interactive, cooperativeGestures });
  latest.current = { style, mode, lang, theme, overlays, profile, center, zoom, bearing, pitch, projection, onViewportChange, maxBounds, minZoom, maxZoom, maplibre, interactive, cooperativeGestures };

  // Connection: only what a style swap cannot change rebuilds the map.
  useEffect(() => {
    if (!container) return;
    const now = latest.current;
    const cartography = {
      style: now.style,
      mode: now.mode,
      lang: now.lang,
      theme: now.theme,
      overlays: now.overlays,
      profile: now.profile,
    };
    const constraints = constraintsOf(now, maplibre);
    const map = createMap({
      container,
      key: apiKey,
      gateway,
      ...cartography,
      center: now.center,
      zoom: now.zoom,
      projection: now.projection,
      controls: controlsOff ? false : controlsPosition ? { position: controlsPosition } : true,
      // The caller's own object unless a limit or gesture prop (or a limit dropped as invalid)
      // changes it, so a map that sets none of them is created with exactly the options it was given.
      maplibre: withGestures(withConstraints(maplibre, constraints), now),
    });
    appliedLimitsRef.current = limitsKey(now);
    // What the map was really created with: a set prop wins over the raw option, which wins over
    // MapLibre's default.
    appliedInteractiveRef.current = now.interactive ?? maplibre?.interactive ?? true;
    appliedCooperativeRef.current = now.cooperativeGestures ?? maplibre?.cooperativeGestures ?? false;
    activeMapRef.current = map;
    projectionRef.current = { type: now.projection };
    appliedStyleRef.current = unmapStyle({ key: apiKey, gateway, ...cartography });
    generationRef.current = 0;
    loadedRef.current = false;
    if (now.bearing != null || now.pitch != null) {
      map.jumpTo({
        ...(now.bearing != null ? { bearing: now.bearing } : {}),
        ...(now.pitch != null ? { pitch: now.pitch } : {}),
      });
    }
    set(id, { map, ready: false, generation: 0 });

    const onStyleLoad = () => {
      generationRef.current += 1;
      // MapLibre 6 keeps the projection on the style, so a swapped style arrives flat. Put back the
      // one the map showed before the swap, or the `projection` prop if it changed since.
      map.setProjection(projectionRef.current);
      if (loadedRef.current) set(id, { map, ready: true, generation: generationRef.current });
    };
    const onLoad = () => {
      loadedRef.current = true;
      // A cached style can fire `style.load` inside the constructor, before this listener existed.
      generationRef.current = Math.max(generationRef.current, 1);
      set(id, { map, ready: true, generation: generationRef.current });
    };
    // createMap applies the projection it was created with on its own one-time `style.load` and
    // `load`, which MapLibre runs after every `on` listener, so they would undo a change made
    // before the first load, and (when a cached style loaded inside the constructor) its pending
    // `style.load` one would undo the latest projection on the first swap. One-time listeners run
    // in registration order: these, registered after createMap's, put the latest value back: the
    // carried one, so a projection set on the map itself survives the first swap too.
    const reapply = () => map.setProjection(projectionRef.current);
    map.once("style.load", reapply);
    map.once("load", reapply);
    const onMove = () => {
      if (syncingRef.current) return;
      report(map, latest.current.onViewportChange, reportedRef.current);
    };
    map.on("style.load", onStyleLoad);
    map.on("load", onLoad);
    map.on("move", onMove);
    // MapLibre sizes its canvas once, at construction, and only re-measures on window resize.
    // On a fresh page load the container can still be 0 wide when this effect runs (its CSS
    // has not applied yet), which leaves the map painted at the wrong size with no error. Follow
    // the container itself so the canvas tracks its real box.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => map.resize());
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      map.off("style.load", onStyleLoad);
      map.off("load", onLoad);
      map.off("move", onMove);
      map.remove();
      if (activeMapRef.current === map) activeMapRef.current = null;
      clear(id, map);
    };
  }, [container, id, apiKey, gateway, controlsOff, controlsPosition, maplibre, set, clear]);

  // Cartography: swap the style on the live map. Declared after the connection effect so a
  // change that also recreates the map finds the new map already showing the new style.
  useEffect(() => {
    const map = activeMapRef.current;
    if (!map) return;
    const url = unmapStyle({ key: apiKey, gateway, style, mode, lang, theme, overlays, profile });
    if (url === appliedStyleRef.current) return;
    appliedStyleRef.current = url;
    // Whatever the map shows now crosses the swap.
    // A style JSON's own projection is carried too, onto later styles, overriding theirs.
    const shown = map.getProjection();
    if (shown) projectionRef.current = shown;
    set(id, { map, ready: false, generation: generationRef.current });
    // A full reload, not a diff: `style.load` must fire so every layer owner re-adds its layers.
    map.setStyle(url, { diff: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, mode, lang, theme, overlaysKey, profile]);

  // Projection applies in place, and is what the next style load puts back. Before a style has
  // loaded (the first one, or mid-swap) `setProjection` throws, and the `style.load` handler
  // applies it then. `getStyle()` is undefined exactly then; `isStyleLoaded()` is also false while
  // tiles load, and a change made then would be lost. An omitted prop is the globe.
  useEffect(() => {
    const map = activeMapRef.current;
    if (!map) return;
    const next: ProjectionSpec = { type: projection };
    projectionRef.current = next;
    if (generationRef.current === 0 || !map.getStyle()) return;
    map.setProjection(next);
  }, [projection]);

  // Limits apply in place. Declared before the camera effect, so a limit and a camera change made
  // in one render apply in that order. A limit that moves the camera is reported like a gesture:
  // `setMaxBounds` moves it without a move event, and the zoom setters' own events are suppressed.
  const limits = limitsKey({ maxBounds, minZoom, maxZoom });
  useEffect(() => {
    const map = activeMapRef.current;
    if (!map || limits === appliedLimitsRef.current) return;
    const before = viewportOf(map);
    syncingRef.current = true;
    try {
      applyConstraints(map, constraintsOf(latest.current, latest.current.maplibre));
    } finally {
      syncingRef.current = false;
    }
    // Recorded only once applied, so a set that failed is tried again on the next change.
    appliedLimitsRef.current = limits;
    if (!matches(before, viewportOf(map))) report(map, latest.current.onViewportChange, reportedRef.current);
  }, [limits]);

  // Gestures apply in place. Unset means what the map was created with: the raw `maplibre` option,
  // or else MapLibre's default (interactive, no cooperative gestures). These run on mount, where
  // that is exactly what the map already has.
  useEffect(() => {
    const map = activeMapRef.current;
    const want = interactive ?? latest.current.maplibre?.interactive ?? true;
    if (!map || want === appliedInteractiveRef.current) return;
    appliedInteractiveRef.current = want;
    setInteractive(map, want, latest.current.maplibre);
  }, [interactive]);

  useEffect(() => {
    const map = activeMapRef.current;
    const want = cooperativeGestures ?? latest.current.maplibre?.cooperativeGestures ?? false;
    if (!map || want === appliedCooperativeRef.current) return;
    appliedCooperativeRef.current = want;
    if (want) map.cooperativeGestures.enable();
    else map.cooperativeGestures.disable();
  }, [cooperativeGestures]);

  // Camera: applied in place, and only when it differs from where the map already is, so a
  // parent that feeds `onViewportChange` back into these props never loops. A target equal to a
  // viewport this provider reported within the echo window is that feedback arriving late, not a
  // request to move: by the time React renders it the user's gesture may have carried the camera
  // on, and jumping back would cancel the gesture. The echo consumes that report and every older
  // one, and keeps the newer ones, which a parent lagging several reports behind still has to
  // render. Past the window a matching target is a deliberate change and moves the camera.
  const lng = center?.[0];
  const lat = center?.[1];
  useEffect(() => {
    const reported = reportedRef.current;
    const cutoff = timestamp() - ECHO_WINDOW_MS;
    const fresh = reported.findIndex((report) => report.at >= cutoff);
    reported.splice(0, fresh === -1 ? reported.length : fresh);
    const map = activeMapRef.current;
    if (!map) return;
    const target: CameraTarget = {};
    if (lng != null && lat != null) target.center = [lng, lat];
    if (zoom != null) target.zoom = zoom;
    if (bearing != null) target.bearing = bearing;
    if (pitch != null) target.pitch = pitch;
    if (Object.keys(target).length === 0) return;
    if (matches(target, viewportOf(map))) return;
    const echo = reported.findIndex((report) => matches(target, report.viewport));
    if (echo !== -1) {
      reported.splice(0, echo + 1);
      return;
    }
    syncingRef.current = true;
    try {
      map.jumpTo(target);
    } finally {
      syncingRef.current = false;
    }
    // A limit clamped the move (or the constructor's camera): say where the map really is. Only
    // under a limit: MapLibre also normalises a camera it was given (a bearing of 270 reads back
    // as -90), and that is not a move to report.
    if (limited(latest.current, latest.current.maplibre) && !matches(target, viewportOf(map))) {
      report(map, latest.current.onViewportChange, reported);
    }
  }, [lng, lat, zoom, bearing, pitch]);

  // URL hash. Keyed on the store's map, which is set a render after the map is created, so this
  // runs after the camera effect has placed the map from the props: a valid position in the URL
  // then wins, exactly as MapLibre's own `hash: true` constructor option does, and the jump is
  // reported through onViewportChange so a controlled parent adopts it. Removing the Hash (hash
  // off, a new map, unmount) removes the map's part of the URL, as MapLibre's map.remove() does.
  const hashParam = hashParamOf(hash);
  const liveMap = store.get(id)?.map ?? null;
  useEffect(() => {
    if (!liveMap || hashParam === false) return;
    const handle = new maplibregl.Hash(hashParam === true ? undefined : hashParam).addTo(liveMap);
    // Mirrors MapLibre 6.13's Map constructor after `new Hash().addTo(this)`; `_onHashChange` is on
    // the public Hash type. Recheck on MapLibre upgrades.
    handle._onHashChange();
    return () => {
      handle.remove();
    };
  }, [liveMap, hashParam]);

  return <MapContext.Provider value={store}>{children}</MapContext.Provider>;
}

function useEntry(id: string, hook: string): MapEntry {
  const ctx = useContext(MapContext);
  if (!ctx) {
    throw new Error(`${hook} must be used within a <MapProvider> (rendered by <Map>).`);
  }
  return ctx.get(id) ?? EMPTY_ENTRY;
}

/** Returns the MapLibre map for `id` (default `"default"`), or null until it exists. */
export function useMap(id: string = DEFAULT_MAP_ID): Map | null {
  return useEntry(id, "useMap").map;
}

/** True while a style is loaded on the map for `id`: false before the first load and during a swap. */
export function useMapReady(id: string = DEFAULT_MAP_ID): boolean {
  return useEntry(id, "useMapReady").ready;
}

/**
 * 0 until the map for `id` first loads, then +1 for every completed style load. Key any effect
 * that adds sources or layers on this: a style swap removes them.
 */
export function useMapGeneration(id: string = DEFAULT_MAP_ID): number {
  return useEntry(id, "useMapGeneration").generation;
}

/**
 * The page's colour mode: a `dark` or `light` class on <html> (shadcn, next-themes), then
 * `data-theme`, then an inline `color-scheme` (the only signal on a page that toggles `.dark`
 * alone), then the operating system's preference.
 */
export function pageMode(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const root = document.documentElement;
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light")) return "light";
  const attribute = root.getAttribute("data-theme");
  if (attribute === "dark" || attribute === "light") return attribute;
  const scheme = root.style.colorScheme;
  if (scheme === "dark" || scheme === "light") return scheme;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Resolves `"auto"` to the page's mode and re-renders when the page or the OS switches. */
export function useResolvedMode(mode: MapMode = "auto"): "light" | "dark" {
  const [page, setPage] = useState<"light" | "dark">(() => (mode === "auto" ? pageMode() : "light"));
  useEffect(() => {
    if (mode !== "auto" || typeof document === "undefined") return;
    const update = () => setPage(pageMode());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener?.("change", update);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.("change", update);
    };
  }, [mode]);
  return mode === "auto" ? page : mode;
}
