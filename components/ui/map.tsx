"use client";

/**
 * <Map> - the unmap map display component.
 *
 * Mounts a container, creates a MapLibre map wired to the unmap gateway (via `map-context`),
 * and shares it with any children (Geocoder, RoutingPanel, Marker, Popup) through `useMap()`.
 *
 * The container is styled with your design-system classes (`rounded-lg`, `bg-muted`), so it
 * takes your radius and palette. MapLibre's own popups and controls are restyled onto your
 * tokens by the CSS this item adds to your stylesheet, scoped under `[data-unmap-map]`.
 * The basemap follows your page's light or dark mode unless you pass `mode`.
 *
 * Copied into your project by `npx shadcn add`. Edit freely.
 */

import { useState, type CSSProperties, type ReactNode } from "react";
import {
  MapProvider,
  useMapGeneration,
  useResolvedMode,
  type MapBounds,
  type MapMode,
  type MapProviderOptions,
  type MapViewport,
} from "@/lib/map-context";
import type { MapProfile, Projection, UnmapControlsOptions } from "@unmap/maps";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// MapLibre's stylesheet. Required for controls, markers, and popups to render correctly.
import "maplibre-gl/dist/maplibre-gl.css";

export type { MapMode, MapViewport, MapBounds };

/**
 * Whose accent markers and route lines take when nothing explicit is passed: the theme code's
 * (`"theme"`) or your design system's `--primary` (`"system"`).
 */
export type MapAccent = "theme" | "system";

export interface MapProps {
  /** unmap API key (`um_live_...` / `um_test_...`). */
  apiKey: string;
  /** Gateway base URL. Defaults to the unmap production gateway. */
  gateway?: string;
  /**
   * A named style ("base" | "muted" | "outdoor" | "blueprint" | "blush" | "orchid" | "canopy" | "lagoon" | "tropic" | "sunset" | "bold" | "pastel" | "atlas" | "swiss"), a full style URL, or a MapLibre style.
   * Defaults to "base".
   */
  style?: string;
  /**
   * `"light"`, `"dark"`, or `"auto"` (the default) to follow your page: a `dark` or `light` class
   * on <html>, then `data-theme`, then `color-scheme`, then the OS. Switching swaps the style in
   * place; the camera, markers and popups stay.
   */
  mode?: MapMode;
  /** Label language (`en`, `fr`, ...). Omit to follow the reader's browser. */
  lang?: string;
  /**
   * Compact theme code from unmap.dev/create (`u00` and up, or `ut1.`). Its marker/route
   * styles reach `<Marker>`/`<RoutingPanel>` via the style's metadata.
   */
  theme?: string;
  /** Catalog overlay ids composed onto the style. */
  overlays?: readonly string[];
  /** Composition preset. Not a style. Explicit overlays replace the profile list. */
  profile?: MapProfile;
  /**
   * Which accent markers and routes use by default. Defaults to `"theme"` when a `theme` is set
   * (you composed that accent on purpose) and to `"system"` otherwise.
   */
  accent?: MapAccent;
  /** Centre as [longitude, latitude]. Changes move the camera in place. */
  center?: [number, number];
  /** Zoom. Changes move the camera in place. */
  zoom?: number;
  /** Bearing in degrees clockwise from north. */
  bearing?: number;
  /** Pitch in degrees from straight down. */
  pitch?: number;
  /**
   * Keeps the camera inside these bounds: `[[west, south], [east, north]]`, or `"canada"` for all of
   * Canada with a margin. Changes apply in place.
   */
  maxBounds?: MapBounds;
  /**
   * The lowest zoom the camera may reach. Above `maxZoom`, both are ignored. On its own it is
   * ignored below -2, above 22 when `maxZoom` is unset, or when it is not a finite number. Each
   * of these logs a console warning.
   */
  minZoom?: number;
  /**
   * The highest zoom the camera may reach. A value above 22 is kept as given. It is ignored, with a
   * console warning, below -2 or when it is not a finite number.
   */
  maxZoom?: number;
  /**
   * `false` turns off panning, zooming, rotating and the keyboard, for a static map. Pins (draggable
   * ones too), popups and the zoom buttons keep working.
   */
  interactive?: boolean;
  /**
   * Ask for Ctrl or Cmd with the scroll wheel, and two fingers on touch, so a map in a long page
   * does not trap the scroll.
   */
  cooperativeGestures?: boolean;
  /**
   * Keep the camera in the page URL (`#zoom/lat/lng`). A string names the parameter
   * (`#map=zoom/lat/lng`) so other hash state, or a second map, survives. A position already in
   * the URL wins over `center` and `zoom` when the map loads. A recreated map (a new `apiKey`,
   * say) starts from the props' camera, as MapLibre's own remove-and-recreate does.
   */
  hash?: boolean | string;
  /**
   * Fires as the camera moves. Feed it back into `center`/`zoom`/`bearing`/`pitch` for a
   * controlled map; moves caused by these props are not reported back.
   */
  onViewportChange?: (viewport: MapViewport) => void;
  /** `"globe"` draws the map as a sphere. Defaults to `"mercator"`, the flat map. */
  projection?: Projection;
  /**
   * On-map controls. `true` (the default) adds MapLibre's zoom and compass buttons at
   * `top-right`, restyled onto your tokens; `false` adds none. Pass `{ position }` to move them.
   */
  controls?: boolean | UnmapControlsOptions;
  /** Show the loading overlay regardless of the map's state, e.g. while your data loads. */
  loading?: boolean;
  /** Distinguishes multiple maps on one page. Defaults to "default". */
  id?: string;
  /** Extra inline styles for the map container. */
  containerStyle?: CSSProperties;
  className?: string;
  /** Children rendered inside the map context (controls, markers, popups). */
  children?: ReactNode;
}

/** Covers the map until its first style has loaded, on your `Spinner` and `--background`. */
function LoadingOverlay({ mapId, loading }: { mapId?: string; loading?: boolean }) {
  const generation = useMapGeneration(mapId);
  if (!loading && generation > 0) return null;
  return (
    <div
      data-unmap-loading=""
      className="absolute inset-0 z-10 flex items-center justify-center bg-background/50"
    >
      <Spinner className="size-6" />
    </div>
  );
}

export function Map({
  apiKey,
  gateway,
  style = "base",
  mode = "auto",
  lang,
  theme,
  overlays,
  profile,
  accent,
  center,
  zoom,
  bearing,
  pitch,
  maxBounds,
  minZoom,
  maxZoom,
  interactive,
  cooperativeGestures,
  hash,
  onViewportChange,
  projection,
  controls,
  loading,
  id,
  containerStyle,
  className,
  children,
}: MapProps) {
  // The container element is handed to the provider once React has mounted the div.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const resolvedAccent: MapAccent = accent ?? (theme ? "theme" : "system");
  const resolvedMode = useResolvedMode(mode);

  const options: MapProviderOptions = {
    apiKey,
    gateway,
    style,
    mode: resolvedMode,
    theme,
    ...(lang ? { lang } : {}),
    ...(overlays && overlays.length > 0 ? { overlays } : {}),
    ...(profile ? { profile } : {}),
    ...(center ? { center } : {}),
    ...(zoom != null ? { zoom } : {}),
    ...(bearing != null ? { bearing } : {}),
    ...(pitch != null ? { pitch } : {}),
    ...(maxBounds !== undefined ? { maxBounds } : {}),
    ...(minZoom != null ? { minZoom } : {}),
    ...(maxZoom != null ? { maxZoom } : {}),
    ...(interactive !== undefined ? { interactive } : {}),
    ...(cooperativeGestures !== undefined ? { cooperativeGestures } : {}),
    ...(hash !== undefined ? { hash } : {}),
    ...(onViewportChange ? { onViewportChange } : {}),
    ...(projection ? { projection } : {}),
    ...(controls !== undefined ? { controls } : {}),
  };

  return (
    <div
      ref={setContainer}
      className={cn("relative h-full w-full overflow-hidden rounded-lg bg-muted", className)}
      style={{ minHeight: 320, ...containerStyle }}
      data-unmap-map=""
      data-unmap-accent={resolvedAccent}
    >
      <MapProvider container={container} id={id} {...options}>
        {children}
        <LoadingOverlay mapId={id} loading={loading} />
      </MapProvider>
    </div>
  );
}
