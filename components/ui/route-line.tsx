"use client";

/**
 * <RouteLine> - draw a route (or any line of [lng, lat] points) on an unmap map.
 *
 * A theme casing under a line in your `--primary` (or the theme's route colour, per the Map's
 * accent). `active={false}` draws an alternative in `--muted-foreground`. `progress` (0 to 1)
 * draws the travelled part at full strength over a faded full line. `gradient` colours the line
 * by a value per point (grade, elevation, speed) on your `--chart-1`..`--chart-5`.
 *
 * Sits below the map's labels unless you pass `beforeId`. Survives a style swap.
 *
 * Copied into your project by `npx shadcn add`. Edit freely.
 */

import { useEffect, useId, useMemo, useRef } from "react";
import {
  accentColor,
  accentOf,
  chartRamp,
  concrete,
  hostOf,
  themeMeta,
  tokenColor,
  useLayerSet,
  type LayerSpec,
} from "@/lib/map-layers";

/** The last resort when neither a theme nor a design-system token supplies a route casing. */
const FALLBACK_CASING = "#0c1418";
/** Past this many points a gradient is sampled down; MapLibre compiles every stop. */
const MAX_GRADIENT_STOPS = 128;
const EARTH_RADIUS_METRES = 6_371_008.8;

/** Layer metadata key marking a route-line layer as the selected route or an alternative. */
const ROLE_KEY = "unmap:route-line";

type StyleWithLayers = { getStyle: () => { layers?: { id: string; metadata?: unknown }[] } | undefined };

/**
 * The lowest layer of any active route on the map, where an alternative goes so it never covers
 * the selected route whatever order they mounted in. Undefined when no route is active, which
 * puts the alternative below the labels like any other overlay.
 */
function belowActiveRoute(map: StyleWithLayers): string | undefined {
  return map.getStyle()?.layers?.find((layer) => {
    const metadata = layer.metadata as Record<string, unknown> | undefined;
    return metadata?.[ROLE_KEY] === "active";
  })?.id;
}

export interface RouteGradient {
  /** One value per coordinate, e.g. grade in percent or elevation in metres. */
  values: number[];
  /** The value range mapped onto the ramp. Defaults to the values' own minimum and maximum. */
  domain?: [number, number];
}

export interface RouteLineProps {
  /** The line as [longitude, latitude] pairs, e.g. a route's `geometry.coordinates`. */
  coordinates: [number, number][];
  /** Map id when multiple maps share a page. Defaults to "default". */
  mapId?: string;
  /** Source id and layer-id prefix. Give each line on a map its own. Defaults to a generated id. */
  id?: string;
  /** Line colour. Defaults to the theme's route colour or your --primary, per the Map's accent. */
  color?: string;
  /** Line width in pixels. Defaults to the theme's route width, else 5. */
  width?: number;
  /** Line opacity, 0 to 1. Defaults to the theme's route opacity, else 0.9. */
  opacity?: number;
  /** `false` draws an alternative: --muted-foreground, 1px thinner, fainter. Defaults to true. */
  active?: boolean;
  /** Travelled fraction, 0 to 1. Draws the travelled part over a faded full line. */
  progress?: number;
  /** Colour the line by a value per coordinate. Ignored when `values` does not match `coordinates`. */
  gradient?: RouteGradient;
  /**
   * Insertion point. Default: below the labels, and for an alternative, below the lowest active
   * route too, so the selected route is never covered. `null`: on top.
   */
  beforeId?: string | null;
  /** Called when the line is clicked. Also gives the line a pointer cursor. */
  onClick?: () => void;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function haversine(a: [number, number], b: [number, number]): number {
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative distance in metres at each point; the first is 0. */
export function measureLine(coordinates: [number, number][]): number[] {
  const measured: number[] = [];
  let total = 0;
  coordinates.forEach((point, index) => {
    if (index > 0) total += haversine(coordinates[index - 1]!, point);
    measured.push(total);
  });
  return measured;
}

/** The line from its start to `fraction` of its length, ending on an interpolated point. */
export function sliceLine(coordinates: [number, number][], fraction: number): [number, number][] {
  if (coordinates.length < 2 || fraction <= 0) return [];
  if (fraction >= 1) return coordinates;
  const measured = measureLine(coordinates);
  const target = measured[measured.length - 1]! * fraction;
  const sliced: [number, number][] = [coordinates[0]!];
  for (let index = 1; index < coordinates.length; index++) {
    const start = measured[index - 1]!;
    const end = measured[index]!;
    if (end < target) {
      sliced.push(coordinates[index]!);
      continue;
    }
    const t = end === start ? 0 : (target - start) / (end - start);
    const [x0, y0] = coordinates[index - 1]!;
    const [x1, y1] = coordinates[index]!;
    sliced.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    break;
  }
  return sliced;
}

/**
 * A `line-gradient` expression: each point's position along the line mapped to its value's colour
 * on `ramp`. Null when there is no usable gradient (mismatched values, a zero-length line).
 */
export function gradientStops(
  coordinates: [number, number][],
  values: number[],
  ramp: string[],
  domain?: [number, number],
): unknown[] | null {
  if (coordinates.length < 2 || values.length !== coordinates.length || ramp.length === 0) return null;
  const measured = measureLine(coordinates);
  const total = measured[measured.length - 1]!;
  if (total === 0) return null;
  // A loop, not Math.min(...values): spreading a long route's values overflows the call stack.
  let [low, high] = domain ?? [Infinity, -Infinity];
  if (!domain) {
    for (const value of values) {
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  const span = high - low || 1;
  const step = Math.max(1, Math.ceil(coordinates.length / MAX_GRADIENT_STOPS));
  const stops: unknown[] = ["interpolate", ["linear"], ["line-progress"]];
  let last = -1;
  for (let index = 0; index < coordinates.length; index += step) {
    const at = measured[index]! / total;
    if (at <= last) continue; // line-progress stops must strictly increase
    const t = Math.min(1, Math.max(0, (values[index]! - low) / span));
    stops.push(at, ramp[Math.round(t * (ramp.length - 1))]!);
    last = at;
  }
  if (last < 1) {
    const t = Math.min(1, Math.max(0, (values[values.length - 1]! - low) / span));
    stops.push(1, ramp[Math.round(t * (ramp.length - 1))]!);
  }
  return stops;
}

/** A serial per geometry object, so a rebuild key can tell two same-length lines apart cheaply. */
const geometryIds = new WeakMap<object, number>();
let nextGeometryId = 0;
function geometryId(geometry: object): number {
  let id = geometryIds.get(geometry);
  if (id === undefined) {
    id = ++nextGeometryId;
    geometryIds.set(geometry, id);
  }
  return id;
}

function lineFeature(coordinates: [number, number][]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: coordinates.length < 2 ? [] : coordinates },
  };
}

export function RouteLine({
  coordinates,
  mapId,
  id,
  color,
  width,
  opacity,
  active = true,
  progress,
  gradient,
  beforeId,
  onClick,
}: RouteLineProps) {
  const generated = `unmap-route-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const sourceId = id ?? generated;
  const lineId = `${sourceId}-line`;
  const hasProgress = progress !== undefined;
  const useGradient = gradient !== undefined && gradient.values.length === coordinates.length && coordinates.length >= 2;
  // A fresh object every render would fail useLayerSet's identity dedup and re-upload the
  // unchanged line to MapLibre on every render, including every `progress` tick during live
  // navigation. Memoized so setData only fires when the geometry actually changes.
  const mainData = useMemo(() => lineFeature(coordinates), [coordinates]);
  const progressData = useMemo(
    () => lineFeature(hasProgress ? sliceLine(coordinates, progress!) : []),
    [coordinates, hasProgress, progress],
  );
  const metadata = { [ROLE_KEY]: active ? "active" : "alternative" };
  const insertBefore = beforeId !== undefined || active ? beforeId : belowActiveRoute;

  // The gradient's stops are computed from the coordinates, so a new line (even one of the same
  // length) must rebuild the layer; setData alone would leave the old stops on the new shape.
  const lineKey = JSON.stringify([
    color,
    width,
    opacity,
    active,
    hasProgress,
    useGradient ? gradient : null,
    useGradient ? geometryId(mainData) : 0,
  ]);

  const { map } = useLayerSet({
    mapId,
    sourceId,
    source: useGradient ? { lineMetrics: true } : undefined,
    data: mainData,
    beforeId: insertBefore,
    key: lineKey,
    layers: (live) => {
      const theme = themeMeta(live).route;
      // An alternative is 1px thinner, but never thinner than 1px.
      const lineWidth = Math.max(1, (width ?? theme?.width ?? 5) - (active ? 0 : 1));
      const baseOpacity = opacity ?? theme?.opacity ?? 0.9;
      const lineColor = active
        ? accentColor(live, color, theme?.color)
        : color ?? tokenColor(live, "--muted-foreground") ?? accentColor(live, undefined, theme?.color);
      const layers: LayerSpec[] = [];
      if (active && theme && (theme.casingWidth ?? 0) > 0) {
        // Mirrors `accentColor`, but for the casing: under accent="system" the --background
        // token comes before the theme's casing colour; under accent="theme" the theme's casing
        // colour comes first.
        const themedCasing = concrete(theme.casingColor);
        const systemCasing = () => tokenColor(live, "--background");
        const casingColor =
          (accentOf(hostOf(live)) === "system" ? systemCasing() ?? themedCasing : themedCasing ?? systemCasing()) ??
          FALLBACK_CASING;
        layers.push({
          id: `${sourceId}-casing`,
          type: "line",
          source: sourceId,
          metadata,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": casingColor,
            "line-width": theme.casingWidth ?? 10,
            "line-opacity": theme.casingOpacity ?? 0.2,
          },
        } as LayerSpec);
      }
      const stops = useGradient ? gradientStops(coordinates, gradient!.values, chartRamp(live), gradient!.domain) : null;
      layers.push({
        id: lineId,
        type: "line",
        source: sourceId,
        metadata,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          ...(stops ? { "line-gradient": stops } : { "line-color": lineColor }),
          "line-width": lineWidth,
          "line-opacity": hasProgress ? baseOpacity * 0.35 : active ? baseOpacity : baseOpacity * 0.7,
        },
      } as LayerSpec);
      return layers;
    },
  });

  useLayerSet({
    mapId,
    sourceId: `${sourceId}-progress`,
    data: progressData,
    beforeId: insertBefore,
    // Built from the line's key: whenever the line re-adds, the travelled part re-adds after it
    // and so stays on top of it.
    key: JSON.stringify([lineKey, useGradient]),
    layers: (live) => {
      if (!hasProgress) return [];
      const theme = themeMeta(live).route;
      return [
        {
          id: `${sourceId}-progress-line`,
          type: "line",
          source: `${sourceId}-progress`,
          metadata,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": accentColor(live, color, theme?.color),
            "line-width": width ?? theme?.width ?? 5,
            "line-opacity": opacity ?? theme?.opacity ?? 0.9,
          },
        } as LayerSpec,
      ];
    },
  });

  // The latest handler, so an inline `onClick` does not rebind the listeners (and reset the
  // cursor) on every render, e.g. on every `progress` tick.
  const clickHandler = useRef(onClick);
  clickHandler.current = onClick;
  const clickable = onClick !== undefined;

  useEffect(() => {
    if (!map || !clickable) return;
    const canvas = map.getCanvas();
    const enter = () => {
      canvas.style.cursor = "pointer";
    };
    const leave = () => {
      canvas.style.cursor = "";
    };
    const click = () => clickHandler.current?.();
    map.on("mouseenter", lineId, enter);
    map.on("mouseleave", lineId, leave);
    map.on("click", lineId, click);
    return () => {
      map.off("mouseenter", lineId, enter);
      map.off("mouseleave", lineId, leave);
      map.off("click", lineId, click);
      canvas.style.cursor = "";
    };
  }, [map, lineId, clickable]);

  return null;
}
