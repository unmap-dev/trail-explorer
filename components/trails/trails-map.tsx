"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import type { RouteResult } from "@unmap/sdk";
import { GeoJSONLayer } from "@/components/ui/geojson-layer";
import { Map } from "@/components/ui/map";
import { MapControls } from "@/components/ui/map-controls";
import { Marker } from "@/components/ui/marker-popup";
import { RouteLine } from "@/components/ui/route-line";
import { boundsOf, type LngLat } from "@/lib/geo";
import type { GpxTrack } from "@/lib/gpx";
import { API_KEY, GATEWAY } from "@/lib/kit/config";
import type { Lang } from "@/lib/kit/i18n";
import { useMap, useMapReady } from "@/lib/map-context";
import { tokenColor } from "@/lib/map-layers";
import { TEXT } from "@/lib/text";
import { trailGeometry, type Trail } from "@/lib/trails";
import type { Origin } from "./directions";

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
type Bounds = [number, number, number, number];

/** Banff, before the trails load. */
const START: LngLat = [-115.9, 51.3];

/**
 * Moves the camera when the question changes, never on every render: every trail once they load,
 * the chosen trail (or your file) when it changes, and the road route when it arrives.
 */
function Camera({ all, focus, focusKey, route }: { all: Bounds | null; focus: Bounds | null; focusKey: string; route: RouteResult | null }) {
  const map = useMap();
  const fit = (b: Bounds | null, maxZoom = 14) => {
    if (!map || !b) return;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 48, maxZoom, duration: reduceMotion() ? 0 : 600 });
  };
  const allKey = all?.join(",") ?? "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!focusKey) fit(all, 11); }, [map, allKey, focusKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (focusKey) fit(focus, 15); }, [map, focusKey]);
  useEffect(() => {
    if (route) fit(boundsOf([route.geometry.coordinates as LngLat[]]), 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, route]);
  return null;
}

/** Every trail in the list as a quiet line with its trailhead; click one to choose it. */
function AllTrails({ trails, onSelect }: { trails: readonly Trail[]; onSelect: (id: string) => void }) {
  const map = useMap();
  const ready = useMapReady();
  // The design system's muted colour, so the chosen trail (--primary) stands out against the rest.
  const muted = useMemo(() => (map && ready ? (tokenColor(map, "--muted-foreground") ?? undefined) : undefined), [map, ready]);
  const data = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: trails.flatMap((t) => [
        { type: "Feature" as const, geometry: trailGeometry(t), properties: { id: t.id } },
        { type: "Feature" as const, geometry: { type: "Point" as const, coordinates: t.trailhead.coordinates }, properties: { id: t.id } },
      ]),
    }),
    [trails],
  );
  if (!muted) return null;
  return (
    <GeoJSONLayer
      id="trails-all"
      data={data}
      color={muted}
      fillPaint={false}
      linePaint={{ "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 4.5, 2.5], "line-opacity": 0.85 }}
      circlePaint={{ "circle-radius": 4 }}
      onClick={(e) => onSelect(String(e.feature.properties?.id))}
    />
  );
}

export interface TrailsMapProps {
  trails: readonly Trail[];
  selected: Trail | null;
  file: GpxTrack | null;
  fileActive: boolean;
  origin: Origin | null;
  route: RouteResult | null;
  onSelect: (id: string) => void;
  lang: Lang;
  /**
   * Rendered inside the map's provider. The panel's map-aware registry parts (the elevation
   * profile, the origin search and the turn-by-turn list) arrive here as portals into the panel,
   * so they reach the map's context.
   */
  children?: ReactNode;
}

/**
 * The live outdoor map (Unmap's `outdoor` style: hillshade and contours from the DEM, and trails):
 * every listed trail, the chosen one drawn over them with its trailhead, your GPX file, and the
 * road route to the trailhead. Every layer is a registry component.
 */
export function TrailsMap({ trails, selected, file, fileActive, origin, route, onSelect, lang, children }: TrailsMapProps) {
  const t = TEXT[lang];
  const all = useMemo(() => boundsOf(trails.flatMap((x) => x.lines)), [trails]);
  const focus = fileActive && file ? boundsOf([...file.lines, ...file.waypoints.map((w) => [w.coordinates])]) : selected ? boundsOf(selected.lines) : null;
  const focusKey = fileActive && file ? `file:${file.points}:${file.metres}` : (selected?.id ?? "");
  const waypoints = useMemo(
    () => ({ type: "FeatureCollection" as const, features: (file?.waypoints ?? []).map((w) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: w.coordinates }, properties: { name: w.name ?? "" } })) }),
    [file],
  );
  return (
    <div role="region" aria-label={t.mapLabel} className="relative h-full min-h-0">
      <Map apiKey={API_KEY} gateway={GATEWAY} style="outdoor" lang={lang} center={START} zoom={9} controls={false} className="rounded-none" containerStyle={{ position: "absolute", inset: 0, minHeight: 0 }}>
        <Camera all={all} focus={focus} focusKey={focusKey} route={route} />
        <MapControls position="bottom-right" />
        <AllTrails trails={trails} onSelect={onSelect} />
        {selected && !(fileActive && file)
          ? selected.lines.map((line, i) => <RouteLine key={`${selected.id}-${i}`} id={`trail-selected-${i}`} coordinates={line} />)
          : null}
        {file ? file.lines.map((line, i) => <RouteLine key={`file-${focusKey}-${i}`} id={`gpx-line-${i}`} coordinates={line} active={fileActive} />) : null}
        {file && file.waypoints.length ? <GeoJSONLayer id="gpx-waypoints" data={waypoints} fillPaint={false} linePaint={false} /> : null}
        {route ? <RouteLine id="road-route" coordinates={route.geometry.coordinates as LngLat[]} active={false} /> : null}
        {selected && !(fileActive && file) ? (
          <Marker
            key={selected.id}
            lngLat={selected.trailhead.coordinates}
            markerContent={<span aria-label={`${t.trailhead}: ${selected.name}`} data-trailhead-pin={selected.id} className="block size-5 rounded-full border-[3px] border-background bg-primary shadow-lg" />}
          />
        ) : null}
        {origin ? (
          <Marker lngLat={origin.coordinates} markerContent={<span aria-label={origin.label} data-origin-pin="" className="block size-4 rounded-full border-4 border-background bg-foreground shadow-md" />} />
        ) : null}
        {children}
      </Map>
    </div>
  );
}
