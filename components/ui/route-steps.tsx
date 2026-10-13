"use client";

/**
 * <RouteSteps> - the turn-by-turn steps of an unmap route, as a list beside the map.
 *
 * Pass `steps` and the route's `coordinates` from a route requested with `steps: true` (see
 * `@unmap/routing`). Each row shows an icon for the maneuver, the instruction the API wrote (in the
 * language you asked it for), and the distance to the next step. Hover or focus a row and its
 * stretch of the route is drawn over the line, thicker, on top of the labels; click it or press
 * Enter and the map frames that stretch. `onSelect` hands you the step and its index.
 *
 * Written directions only: there is no voice. Built on your shadcn Button. Copied into your
 * project by `npx shadcn add`. Edit freely.
 */

import { useState } from "react";
import type { RouteStep } from "@unmap/routing";
import {
  ArrowRightLeft,
  ArrowUp,
  ArrowUpDown,
  ArrowUpLeft,
  ArrowUpRight,
  Bus,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Footprints,
  LogIn,
  LogOut,
  Merge,
  Navigation,
  Redo2,
  RotateCw,
  Ship,
  Signpost,
  Split,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RouteLine } from "@/components/ui/route-line";
import { useMap } from "@/lib/map-context";
import { cn } from "@/lib/utils";

// --- route-steps helpers (kept identical across both lanes) ---

/** A position as [longitude, latitude]. */
type Position = [number, number];

/** The icon a step shows. Each lane maps these names to its own lucide component. */
export type StepIconName =
  | "depart"
  | "arrive"
  | "straight"
  | "left"
  | "right"
  | "slight-left"
  | "slight-right"
  | "uturn-left"
  | "uturn-right"
  | "keep"
  | "merge"
  | "roundabout"
  | "ferry"
  | "transit"
  | "transfer"
  | "enter"
  | "leave"
  | "vertical"
  | "stairs"
  | "other";

/** Which icon a step shows: from its `type`, and for turns, ramps and exits its `modifier`. */
export function stepIconName(step: Pick<RouteStep, "type" | "modifier">): StepIconName {
  switch (step.type) {
    case "depart":
      return "depart";
    case "arrive":
      return "arrive";
    case "uturn":
      return step.modifier === "right" ? "uturn-right" : "uturn-left";
    case "keep":
      return "keep";
    case "merge":
      return "merge";
    case "roundabout":
    case "roundabout_exit":
      return "roundabout";
    case "ferry":
    case "ferry_exit":
      return "ferry";
    case "transit":
    case "transit_stay_on":
      return "transit";
    case "transit_transfer":
    case "station_transfer":
      return "transfer";
    case "station_enter":
    case "building_enter":
      return "enter";
    case "station_exit":
    case "building_exit":
      return "leave";
    case "elevator":
    case "escalator":
      return "vertical";
    case "stairs":
      return "stairs";
    case "other":
      return "other";
    default:
      // turn, continue, name_change, ramp and exit point the way they go.
      switch (step.modifier) {
        case "left":
        case "sharp_left":
          return "left";
        case "right":
        case "sharp_right":
          return "right";
        case "slight_left":
          return "slight-left";
        case "slight_right":
          return "slight-right";
        default:
          return "straight";
      }
  }
}

/**
 * A step's distance for display: metres to the nearest 10 under a kilometre, then kilometres with
 * one decimal under 10 km and none above, with a decimal comma in French. Empty for a step with no
 * length, such as an arrival.
 */
export function formatStepDistance(metres: number, lang: "en" | "fr"): string {
  if (!(metres > 0)) return "";
  const rounded = Math.max(10, Math.round(metres / 10) * 10);
  if (rounded < 1000) return `${rounded} m`;
  const km = (metres / 1000).toFixed(metres < 10_000 ? 1 : 0);
  return `${lang === "fr" ? km.replace(".", ",") : km} km`;
}

/** The stretch of the route line a step covers. Empty when it is a single point, as an arrival is. */
export function stepLine(coordinates: Position[], step: Pick<RouteStep, "geometryRange">): Position[] {
  const [start, end] = step.geometryRange;
  const line = coordinates.slice(Math.max(0, start), end + 1);
  return line.length >= 2 ? line : [];
}

/** The bounds of a step's stretch, or of its start point when it has no length. */
export function stepBounds(
  coordinates: Position[],
  step: Pick<RouteStep, "geometryRange" | "location">,
): [Position, Position] {
  const line = stepLine(coordinates, step);
  const points: Position[] = line.length > 0 ? line : [step.location];
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}
// --- end route-steps helpers ---

const ICONS: Record<StepIconName, LucideIcon> = {
  depart: Navigation,
  arrive: Flag,
  straight: ArrowUp,
  left: CornerUpLeft,
  right: CornerUpRight,
  "slight-left": ArrowUpLeft,
  "slight-right": ArrowUpRight,
  "uturn-left": Undo2,
  "uturn-right": Redo2,
  keep: Split,
  merge: Merge,
  roundabout: RotateCw,
  ferry: Ship,
  transit: Bus,
  transfer: ArrowRightLeft,
  enter: LogIn,
  leave: LogOut,
  vertical: ArrowUpDown,
  stairs: Footprints,
  other: Signpost,
};

export interface RouteStepsProps {
  /** The route's `steps`, from a route requested with `steps: true`. */
  steps: RouteStep[];
  /** The route's `geometry.coordinates`: every step's `geometryRange` indexes into this line. */
  coordinates: [number, number][];
  /** Map id when multiple maps share a page. Defaults to "default". */
  mapId?: string;
  /** Language of the list's label and distances. The instructions come from the API. Defaults to English. */
  lang?: "en" | "fr";
  /** Concrete MapLibre colour for the highlighted stretch. Defaults to the route's own colour. */
  highlightColor?: string;
  /** Called when a step is chosen, by click or keyboard, after the map frames it. */
  onSelect?: (step: RouteStep, index: number) => void;
  className?: string;
}

export function RouteSteps({ steps, coordinates, mapId, lang = "en", highlightColor, onSelect, className }: RouteStepsProps) {
  const map = useMap(mapId);
  // The step whose stretch is drawn: the one hovered, else the one focused.
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const shown = hovered ?? focused;
  const highlight = shown === null || !steps[shown] ? [] : stepLine(coordinates, steps[shown]!);

  function select(index: number) {
    const step = steps[index];
    if (!step) return;
    map?.fitBounds(stepBounds(coordinates, step), {
      padding: 64,
      maxZoom: 17,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 600,
    });
    onSelect?.(step, index);
  }

  return (
    <>
      <ol
        aria-label={lang === "fr" ? "Indications" : "Directions"}
        className={cn("flex w-full min-w-0 flex-col", className)}
        data-unmap-route-steps=""
      >
        {steps.map((step, index) => {
          const Icon = ICONS[stepIconName(step)];
          const distance = formatStepDistance(step.distanceMeters, lang);
          return (
            <li key={index}>
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full items-start justify-start gap-3 py-2 text-left whitespace-normal"
                data-step-type={step.type}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setFocused(index)}
                onBlur={() => setFocused(null)}
                onClick={() => select(index)}
              >
                <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm">{step.instruction}</span>
                  {distance ? <span className="text-xs text-muted-foreground">{distance}</span> : null}
                </span>
              </Button>
            </li>
          );
        })}
      </ol>
      {highlight.length > 0 ? (
        <RouteLine id="unmap-route-step" mapId={mapId} coordinates={highlight} color={highlightColor} width={9} beforeId={null} />
      ) : null}
    </>
  );
}
