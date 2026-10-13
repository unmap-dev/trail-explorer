"use client";

/**
 * <MapControls> - zoom, compass, locate, fullscreen, globe and 3D terrain buttons for an unmap map.
 *
 * Built on your shadcn ButtonGroup, Button, Tooltip and Alert, so the buttons take your radius,
 * palette and focus ring, and the icons follow your icon library. Render it inside
 * `<Map controls={false}>`: the map's own zoom and compass buttons are then off and these take
 * their place. The attribution stays either way; the OpenStreetMap licence requires it.
 *
 * Copied into your project by `npx shadcn add`. Edit freely.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { maplibregl, type Map } from "@unmap/maps";
import {
  GlobeIcon,
  LocateFixedIcon,
  MaximizeIcon,
  MinimizeIcon,
  MinusIcon,
  MountainIcon,
  Navigation2Icon,
  PlusIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMap, useMapGeneration, useMapReady } from "@/lib/map-context";
import { cn } from "@/lib/utils";

/* map-controls:shared:start */
type Lang = "en" | "fr";

/** The corner the controls sit in. */
export type MapControlsPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** Where the reader is, as the locate event reports it. `accuracy` is in metres. */
export interface MapLocation {
  lngLat: [number, number];
  accuracy: number;
}

/** Why the reader's location could not be shown, as the locate error event reports it. */
export interface MapLocateError {
  code: "denied" | "unavailable" | "timeout" | "unsupported";
  /** The sentence for this code, in the `lang` the controls had when the error happened. */
  message: string;
}

const COPY = {
  en: {
    zoomGroup: "Zoom",
    viewGroup: "Map view",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    compass: "Reset to north",
    globe: "Globe view",
    terrain: "3D terrain",
    locate: "Show my location",
    fullscreen: "Fullscreen",
    here: "Your location",
    errors: {
      denied: "Location permission was denied.",
      unavailable: "Your location could not be found.",
      timeout: "Finding your location took too long.",
      unsupported: "This browser cannot share its location.",
    },
  },
  fr: {
    zoomGroup: "Zoom",
    viewGroup: "Vue de la carte",
    zoomIn: "Zoom avant",
    zoomOut: "Zoom arrière",
    compass: "Réorienter vers le nord",
    globe: "Vue globe",
    terrain: "Relief 3D",
    locate: "Afficher ma position",
    fullscreen: "Plein écran",
    here: "Votre position",
    errors: {
      denied: "L'accès à votre position a été refusé.",
      unavailable: "Votre position est introuvable.",
      timeout: "La recherche de votre position a pris trop de temps.",
      unsupported: "Ce navigateur ne peut pas partager sa position.",
    },
  },
} as const;

/**
 * The source the terrain button adds: its own copy of the style's DEM. MapLibre renders terrain
 * better from a source no hillshade layer shares, and warns when they share one.
 */
const TERRAIN_SOURCE_ID = "unmap-controls-terrain";
/** Seen from straight above, terrain is a flat map: below FLAT_PITCH, turning it on tilts to TERRAIN_PITCH. */
const TERRAIN_PITCH = 60;
const FLAT_PITCH = 30;
/** How close locate flies: street level, unless the camera is already closer. */
const LOCATE_ZOOM = 14;
const LOCATE_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 };
/** MapLibre's own fill-the-window class, styled by the stylesheet the `map` item imports. */
const PSEUDO_FULLSCREEN = "maplibregl-pseudo-fullscreen";

/** Layout per corner, on MapLibre's 10px control margin. Bottom-right clears the attribution. */
const CORNERS: Record<MapControlsPosition, string> = {
  "top-left": "top-2.5 left-2.5 items-start",
  "top-right": "top-2.5 right-2.5 items-end",
  "bottom-left": "bottom-2.5 left-2.5 items-start",
  "bottom-right": "bottom-10 right-2.5 items-end",
};

type StyleSource = ReturnType<Map["getStyle"]>["sources"][string];

/** The style's own elevation source, or null. The terrain copy is skipped, so a re-check finds the original. */
function demSourceOf(map: Map): StyleSource | null {
  const sources = map.getStyle()?.sources ?? {};
  for (const [id, source] of Object.entries(sources)) {
    if (id !== TERRAIN_SOURCE_ID && source.type === "raster-dem") return source;
  }
  return null;
}

/** A Geolocation error code (1 denied, 2 unavailable, 3 timeout), or null when there is no Geolocation API. */
function locateErrorOf(code: number | null, lang: Lang): MapLocateError {
  const kind: MapLocateError["code"] =
    code === null ? "unsupported" : code === 1 ? "denied" : code === 3 ? "timeout" : "unavailable";
  return { code: kind, message: COPY[lang].errors[kind] };
}

/** The reader's position: a dot in your --primary, ringed in --background so it reads on any map. */
function locationDot(label: string): HTMLElement {
  const dot = document.createElement("span");
  dot.className = "block size-4 rounded-full border-2 border-background bg-primary";
  dot.setAttribute("role", "img");
  dot.setAttribute("aria-label", label);
  dot.setAttribute("data-unmap-location", "");
  return dot;
}
/* map-controls:shared:end */

type MarkerHandle = InstanceType<typeof maplibregl.Marker>;

export interface MapControlsProps {
  /** Map id when several maps share a page. Defaults to "default". */
  mapId?: string;
  /** The corner the controls sit in. Defaults to "top-right", where the map's own buttons were. */
  position?: MapControlsPosition;
  /** Zoom in and out. On by default. */
  zoom?: boolean;
  /** A needle that follows the bearing; a press turns the map back to north and flat. On by default. */
  compass?: boolean;
  /** Fly to the reader's location and mark it. The browser asks for permission on the first press. */
  locate?: boolean;
  /** Fill the screen with the map, or the window where the page cannot go fullscreen. */
  fullscreen?: boolean;
  /** Switch between the flat map and the globe. */
  globe?: boolean;
  /** Tilt the map over 3D terrain. Shown only while the style carries elevation, such as `outdoor`. */
  terrain?: boolean;
  /** Button names, tooltips and messages. Defaults to English. */
  lang?: "en" | "fr";
  /** Fires with the reader's position after a successful locate. */
  onLocate?: (location: MapLocation) => void;
  /** Fires when the location cannot be shown: denied, unavailable, timed out or unsupported. */
  onLocateError?: (error: MapLocateError) => void;
  /** Show locate errors in an Alert under the buttons. Set false when you show your own from `onLocateError`. */
  locateAlert?: boolean;
  className?: string;
}

interface Control {
  name: string;
  label: string;
  icon: ReactNode;
  pressed?: boolean;
  busy?: boolean;
  disabled: boolean;
  run: () => void;
}

export function MapControls({
  mapId,
  position = "top-right",
  zoom = true,
  compass = true,
  locate = false,
  fullscreen = false,
  globe = false,
  terrain = false,
  lang = "en",
  onLocate,
  onLocateError,
  locateAlert = true,
  className,
}: MapControlsProps) {
  const map = useMap(mapId);
  const ready = useMapReady(mapId);
  const generation = useMapGeneration(mapId);
  const copy = COPY[lang];

  const [bearing, setBearing] = useState(0);
  const [isGlobe, setIsGlobe] = useState(false);
  const [hasDem, setHasDem] = useState(false);
  // The map terrain was turned on for. Held per map, so a recreated map starts flat, as it does
  // with the globe, and never renders even once with the previous map's terrain.
  const [terrainMap, setTerrainMap] = useState<Map | null>(null);
  const terrainOn = map !== null && terrainMap === map;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [atMaxZoom, setAtMaxZoom] = useState(false);
  const [atMinZoom, setAtMinZoom] = useState(false);
  const [locating, setLocating] = useState(false);
  // The code, not the sentence, so the Alert follows a `lang` change.
  const [locateError, setLocateError] = useState<MapLocateError["code"] | null>(null);
  const dotRef = useRef<MarkerHandle | null>(null);
  const locateRequestRef = useRef(0);
  const latest = useRef({ lang, locateAlert, onLocate, onLocateError });
  latest.current = { lang, locateAlert, onLocate, onLocateError };

  // The compass, the zoom limits, fullscreen, terrain, the location dot and its Alert belong to
  // one map. A new map (or unmounting) leaves fullscreen and terrain, removes the dot and the
  // Alert and ignores any location answer still on its way. A style swap keeps the same map.
  useEffect(() => {
    if (!map) return;
    const container = map.getContainer();
    const updateBearing = () => setBearing(map.getBearing());
    // As NavigationControl does: the constrained minimum, which maxBounds can raise.
    const updateZoom = () => {
      const now = map.getZoom();
      setAtMaxZoom(now >= map.getMaxZoom());
      setAtMinZoom(now <= map.getMinZoom(true));
    };
    const updateFullscreen = () =>
      setIsFullscreen(document.fullscreenElement === container || container.classList.contains(PSEUDO_FULLSCREEN));
    const onKey = (event: KeyboardEvent) => {
      // A select, a dialog or a search box that closed on this Escape has handled it.
      if (event.key !== "Escape" || event.defaultPrevented || !container.classList.contains(PSEUDO_FULLSCREEN)) return;
      container.classList.remove(PSEUDO_FULLSCREEN);
      updateFullscreen();
    };
    updateBearing();
    updateZoom();
    updateFullscreen();
    map.on("rotate", updateBearing);
    map.on("move", updateZoom);
    document.addEventListener("fullscreenchange", updateFullscreen);
    document.addEventListener("keydown", onKey);
    return () => {
      map.off("rotate", updateBearing);
      map.off("move", updateZoom);
      document.removeEventListener("fullscreenchange", updateFullscreen);
      document.removeEventListener("keydown", onKey);
      container.classList.remove(PSEUDO_FULLSCREEN);
      if (document.fullscreenElement === container) void document.exitFullscreen?.().catch(() => {});
      locateRequestRef.current += 1;
      setLocating(false);
      setLocateError(null);
      setTerrainMap(null);
      dotRef.current?.remove();
      dotRef.current = null;
    };
  }, [map]);

  // The dot is made once per map, so a language change relabels the one already there.
  useEffect(() => {
    dotRef.current?.getElement().setAttribute("aria-label", COPY[lang].here);
  }, [lang]);

  // Turning the `terrain` prop off forgets the press, so turning it back on starts flat.
  useEffect(() => {
    if (!terrain) setTerrainMap(null);
  }, [terrain]);

  // Globe: read the projection back from the map, as MapLibre's own GlobeControl does, so the
  // button shows the `projection` prop, a style swap and its own presses alike.
  useEffect(() => {
    if (!map) {
      setIsGlobe(false);
      return;
    }
    const update = () => setIsGlobe(map.getProjection()?.type === "globe");
    update();
    map.on("projectiontransition", update);
    return () => {
      map.off("projectiontransition", update);
    };
  }, [map, generation]);

  // Terrain is offered only while the style carries a raster-dem source. Mid-swap the previous
  // answer stands, so the button does not blink out and back.
  useEffect(() => {
    if (!map) {
      setHasDem(false);
      return;
    }
    if (ready) setHasDem(demSourceOf(map) !== null);
  }, [map, ready, generation]);

  // Terrain on: add the DEM copy and set it as terrain. A style swap drops both, and the new
  // generation puts them back when the new style has elevation too.
  useEffect(() => {
    if (!map || !ready || !terrain || !terrainOn) return;
    const dem = demSourceOf(map);
    if (!dem) return;
    let removed = false;
    const onRemove = () => {
      removed = true;
    };
    map.on("remove", onRemove);
    if (!map.getSource(TERRAIN_SOURCE_ID)) map.addSource(TERRAIN_SOURCE_ID, dem);
    map.setTerrain({ source: TERRAIN_SOURCE_ID });
    return () => {
      map.off("remove", onRemove);
      // A removed map throws on every call; a style mid-swap has already dropped both.
      if (removed || !map.getStyle()) return;
      if (map.getTerrain()?.source === TERRAIN_SOURCE_ID) map.setTerrain(null);
      if (map.getSource(TERRAIN_SOURCE_ID)) map.removeSource(TERRAIN_SOURCE_ID);
    };
  }, [map, ready, generation, terrain, terrainOn]);

  function toggleGlobe() {
    // The projectiontransition listener updates the button; map-context carries it across a swap.
    map?.setProjection({ type: isGlobe ? "mercator" : "globe" });
  }

  function toggleTerrain() {
    if (!map) return;
    const next = !terrainOn;
    setTerrainMap(next ? map : null);
    if (next && map.getPitch() < FLAT_PITCH) map.easeTo({ pitch: TERRAIN_PITCH });
  }

  function toggleFullscreen() {
    if (!map) return;
    const container = map.getContainer();
    if (container.classList.contains(PSEUDO_FULLSCREEN)) {
      container.classList.remove(PSEUDO_FULLSCREEN);
      setIsFullscreen(false);
      return;
    }
    if (document.fullscreenElement === container) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    const fillWindow = () => {
      container.classList.add(PSEUDO_FULLSCREEN);
      setIsFullscreen(true);
    };
    if (!document.fullscreenEnabled || typeof container.requestFullscreen !== "function") {
      fillWindow();
      return;
    }
    container.requestFullscreen().catch(fillWindow);
  }

  function locateMe() {
    const target = map;
    if (!target) return;
    setLocateError(null);
    const request = ++locateRequestRef.current;
    const fail = (code: number | null) => {
      if (request !== locateRequestRef.current) return;
      const error = locateErrorOf(code, latest.current.lang);
      setLocating(false);
      if (latest.current.locateAlert) setLocateError(error.code);
      latest.current.onLocateError?.(error);
    };
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      fail(null);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (found) => {
        if (request !== locateRequestRef.current) return;
        setLocating(false);
        const lngLat: [number, number] = [found.coords.longitude, found.coords.latitude];
        dotRef.current ??= new maplibregl.Marker({ element: locationDot(COPY[latest.current.lang].here) });
        dotRef.current.setLngLat(lngLat).addTo(target);
        target.flyTo({ center: lngLat, zoom: Math.max(target.getZoom(), LOCATE_ZOOM) });
        latest.current.onLocate?.({ lngLat, accuracy: found.coords.accuracy });
      },
      (error) => fail(error.code),
      LOCATE_OPTIONS,
    );
  }

  const disabled = !map;
  const styleBusy = !map || !ready;
  const zoomControls: Control[] = zoom
    ? [
        { name: "zoom-in", label: copy.zoomIn, icon: <PlusIcon />, disabled: disabled || atMaxZoom, run: () => map?.zoomIn() },
        { name: "zoom-out", label: copy.zoomOut, icon: <MinusIcon />, disabled: disabled || atMinZoom, run: () => map?.zoomOut() },
      ]
    : [];
  const viewControls: Control[] = [];
  if (compass) {
    viewControls.push({
      name: "compass",
      label: copy.compass,
      icon: <Navigation2Icon style={{ transform: `rotate(${-bearing}deg)` }} />,
      disabled,
      run: () => map?.resetNorthPitch(),
    });
  }
  if (globe) {
    viewControls.push({ name: "globe", label: copy.globe, icon: <GlobeIcon />, pressed: isGlobe, disabled: styleBusy, run: toggleGlobe });
  }
  if (terrain && hasDem) {
    viewControls.push({ name: "terrain", label: copy.terrain, icon: <MountainIcon />, pressed: terrainOn, disabled: styleBusy, run: toggleTerrain });
  }
  if (locate) {
    viewControls.push({
      name: "locate",
      label: copy.locate,
      icon: <LocateFixedIcon className={locating ? "animate-pulse" : undefined} />,
      busy: locating,
      disabled,
      run: locateMe,
    });
  }
  if (fullscreen) {
    viewControls.push({
      name: "fullscreen",
      label: copy.fullscreen,
      icon: isFullscreen ? <MinimizeIcon /> : <MaximizeIcon />,
      pressed: isFullscreen,
      disabled,
      run: toggleFullscreen,
    });
  }
  const groups = [
    { name: "zoom", label: copy.zoomGroup, controls: zoomControls },
    { name: "view", label: copy.viewGroup, controls: viewControls },
  ].filter((group) => group.controls.length > 0);
  const side = position.endsWith("right") ? "left" : "right";

  return (
    <TooltipProvider>
      <div data-unmap-controls="" className={cn("absolute z-[5] flex flex-col gap-2", CORNERS[position], className)}>
        {groups.map((group) => (
          <ButtonGroup key={group.name} orientation="vertical" aria-label={group.label}>
            {group.controls.map((control) => (
              <Tooltip key={control.name}>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={control.label}
                      aria-pressed={control.pressed}
                      className="aria-pressed:bg-muted aria-pressed:text-foreground"
                      aria-busy={control.busy || undefined}
                      disabled={control.disabled}
                      onClick={control.run}
                    >
                      {control.icon}
                    </Button>
                  }
                />
                <TooltipContent side={side}>{control.label}</TooltipContent>
              </Tooltip>
            ))}
          </ButtonGroup>
        ))}
        {locateError ? (
          <Alert variant="destructive" className="w-56">
            <AlertDescription>{copy.errors[locateError]}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
