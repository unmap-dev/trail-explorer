"use client";

/**
 * <GeoJSONLayer> - draw any GeoJSON on an unmap map: polygons as a fill with an outline, lines,
 * and points as circles, each filtered to its geometry type.
 *
 * Colours default to your `--primary`, with a `--background` stroke on points. Pass `onClick` or
 * `onHover` (or `interactive`) and the feature under the pointer is highlighted and reported.
 * `data` can be an object or a URL; a new value updates the map in place.
 *
 * Sits below the map's labels unless you pass `beforeId`. Survives a style swap.
 *
 * Copied into your project by `npx shadcn add`. Edit freely.
 */

import { useId } from "react";
import {
  accentColor,
  themeMeta,
  tokenColor,
  useLayerPointer,
  useLayerSet,
  type BeforeId,
  type GeoJSONData,
  type LayerSpec,
  type MapFeatureEvent,
} from "@/lib/map-layers";

type Paint = Record<string, unknown>;

export interface GeoJSONLayerProps {
  /** GeoJSON (a FeatureCollection, Feature or geometry) or a URL MapLibre fetches. */
  data: GeoJSONData;
  /** Map id when multiple maps share a page. Defaults to "default". */
  mapId?: string;
  /** Source id and layer-id prefix. Defaults to a generated id. */
  id?: string;
  /** A property to use as the feature id (stable hover across `data` updates). Ids are generated otherwise. */
  promoteId?: string;
  /** Colour for fills, lines and points. Defaults to your --primary (or the theme accent). */
  color?: string;
  /** Fill paint merged over the defaults, or `false` for no fill layer. */
  fillPaint?: Paint | false;
  /** Line paint merged over the defaults, or `false` for no line layer. */
  linePaint?: Paint | false;
  /** Circle paint merged over the defaults, or `false` for no circle layer. */
  circlePaint?: Paint | false;
  /** Highlight and report the feature under the pointer. Defaults to true when a handler is passed. */
  interactive?: boolean;
  onClick?: (event: MapFeatureEvent) => void;
  /** Called when the feature under the pointer changes; `null` when it leaves. */
  onHover?: (event: MapFeatureEvent | null) => void;
  /** Insertion point. Default: below the labels. `null`: on top. */
  beforeId?: BeforeId;
}

const POLYGONS = ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]];
const LINES = ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString", "Polygon", "MultiPolygon"]]];
const POINTS = ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]];

function hovered(on: unknown, off: unknown): unknown[] {
  return ["case", ["boolean", ["feature-state", "hover"], false], on, off];
}

export function GeoJSONLayer({
  data,
  mapId,
  id,
  promoteId,
  color,
  fillPaint,
  linePaint,
  circlePaint,
  interactive,
  onClick,
  onHover,
  beforeId,
}: GeoJSONLayerProps) {
  const generated = `unmap-geojson-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const sourceId = id ?? generated;
  const active = interactive ?? (onClick !== undefined || onHover !== undefined);
  const layerIds = [
    ...(fillPaint === false ? [] : [`${sourceId}-fill`]),
    ...(linePaint === false ? [] : [`${sourceId}-line`]),
    ...(circlePaint === false ? [] : [`${sourceId}-circle`]),
  ];

  const { map } = useLayerSet({
    mapId,
    sourceId,
    source: promoteId ? { promoteId } : { generateId: true },
    data,
    beforeId,
    key: JSON.stringify([color, fillPaint, linePaint, circlePaint]),
    layers: (live) => {
      const colour = accentColor(live, color, themeMeta(live).marker?.color);
      const stroke = tokenColor(live, "--background") ?? colour;
      const layers: LayerSpec[] = [];
      if (fillPaint !== false) {
        layers.push({
          id: `${sourceId}-fill`,
          type: "fill",
          source: sourceId,
          filter: POLYGONS,
          paint: { "fill-color": colour, "fill-opacity": hovered(0.45, 0.25), ...fillPaint },
        } as LayerSpec);
      }
      if (linePaint !== false) {
        layers.push({
          id: `${sourceId}-line`,
          type: "line",
          source: sourceId,
          filter: LINES,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": colour, "line-width": hovered(3, 1.5), ...linePaint },
        } as LayerSpec);
      }
      if (circlePaint !== false) {
        layers.push({
          id: `${sourceId}-circle`,
          type: "circle",
          source: sourceId,
          filter: POINTS,
          paint: {
            "circle-color": colour,
            "circle-radius": hovered(7, 5),
            "circle-stroke-color": stroke,
            "circle-stroke-width": 1.5,
            ...circlePaint,
          },
        } as LayerSpec);
      }
      return layers;
    },
  });

  // Generated ids follow feature order, so new data can hand the hovered id to another feature.
  useLayerPointer({ map, layerIds, enabled: active, hoverSource: sourceId, onClick, onHover, resetOn: promoteId ? undefined : data });
  return null;
}
