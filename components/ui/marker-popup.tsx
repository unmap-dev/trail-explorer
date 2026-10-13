"use client";

/**
 * <Marker> + <Popup> + <MarkerTooltip> + <MarkerLabel> - declarative pins for an unmap map.
 *
 * All attach to the shared map from `map-context` via `useMap()`. `<Marker>` places a pin at
 * a coordinate (optionally rendering custom React content into the marker element); `<Popup>`
 * shows an anchored bubble, either standalone or nested inside a `<Marker>` for click-to-open.
 * `<Popup trigger="hover">` opens on hover; `<MarkerTooltip>` is a small hover popup that sits
 * beside a click popup. `<MarkerLabel>` writes always-visible text beside the pin.
 * A `draggable` pin reports where it was dropped through `onDragEnd`.
 *
 * Copied into your project by `npx shadcn add`. Edit freely.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { maplibregl } from "@unmap/maps";
import { useMap, useMapGeneration } from "@/lib/map-context";
import { cn } from "@/lib/utils";

type MarkerHandle = InstanceType<typeof maplibregl.Marker>;
type PopupHandle = InstanceType<typeof maplibregl.Popup>;


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

/**
 * The pin colour. Explicit prop first. Then, under `accent="theme"`, the theme's marker colour
 * before `--primary`; under `accent="system"`, `--primary` before the theme's colour. Magenta only
 * when nothing else exists.
 */
function markerColor(map: MapLike | null, explicit: string | undefined): string {
  if (explicit) return explicit;
  const host = hostOf(map);
  const themed = concrete(themeMeta(map).marker?.color);
  const system = () => resolveToken(host, "--primary");
  return (accentOf(host) === "system" ? system() ?? themed : themed ?? system()) ?? FALLBACK_ACCENT;
}

/**
 * Repaint MapLibre's default pin without rebuilding it, so a popup open on it stays open. The pin
 * colour sits on the one element whose `fill` is the colour it was drawn with; the shadow, border
 * and icon carry fixed fills. False when there is not exactly one such element (a pin drawn in
 * one of those fixed colours, or a MapLibre that builds its pin differently); the caller then
 * recreates the marker.
 */
function recolourPin(element: HTMLElement, from: string, to: string): boolean {
  const painted = Array.from(element.querySelectorAll("[fill]")).filter((node) => node.getAttribute("fill") === from);
  if (painted.length !== 1) return false;
  painted[0]!.setAttribute("fill", to);
  return true;
}

/** The `<Popup>` bound to a pin: whether it is open, and whether it opens on hover. */
type BoundPopup = { open: boolean; hover: boolean };

const NO_POPUP: BoundPopup = { open: false, hover: false };

/** What a `<Marker>` shares with the popups, tooltip and label nested in it. */
type MarkerState = {
  marker: MarkerHandle | null;
  /** True while a mouse or pen is over the pin or it has keyboard focus; false while it is dragged. */
  hovered: boolean;
  /** Where the pin is: its `lngLat`, or where a drag left it. */
  lngLat: [number, number];
  /** The bound `<Popup>`, so a tooltip gives way to it. */
  popup: BoundPopup;
  setPopup: Dispatch<SetStateAction<BoundPopup>> | null;
};

const MarkerContext = createContext<MarkerState>({
  marker: null,
  hovered: false,
  lngLat: [0, 0],
  popup: NO_POPUP,
  setPopup: null,
});

export interface MarkerProps {
  /** Pin position as [longitude, latitude]. Changing the coordinates moves the pin. */
  lngLat: [number, number];
  /** Map id when multiple maps share a page. Defaults to "default". */
  mapId?: string;
  /** Pin colour. Defaults to the theme's marker colour or your design system's --primary, per the Map's accent. */
  color?: string;
  /**
   * Let the reader drag the pin. It stays where it is dropped; `lngLat` moves it again whenever
   * its coordinates change, so feed `onDragEnd` back into state if you keep one.
   * To reject a drop, set `lngLat` to a different value; setting it to the value it already had is not a change and leaves the pin where it was dropped.
   */
  draggable?: boolean;
  /** Fired when the marker element is clicked. Not fired for the click that ends a drag. */
  onClick?: () => void;
  /** Fired once a drag ends, with the pin's new [longitude, latitude]. */
  onDragEnd?: (lngLat: [number, number]) => void;
  /**
   * Custom marker content portalled into the marker element. Omit it to retain MapLibre's
   * default pin; nested popup children are intentionally separate.
   */
  markerContent?: ReactNode;
  /** Nested map behavior, typically a `<Popup>`. */
  children?: ReactNode;
}

export function Marker({
  lngLat,
  mapId,
  color,
  draggable = false,
  onClick,
  onDragEnd,
  markerContent,
  children,
}: MarkerProps) {
  const map = useMap(mapId);
  const generation = useMapGeneration(mapId);
  const [marker, setMarker] = useState<MarkerHandle | null>(null);
  const [markerElement, setMarkerElement] = useState<HTMLDivElement | null>(null);
  const hasCustomMarker = markerContent != null;
  // Bumped only when an in-place recolour cannot find the pin, to force a rebuild.
  const [rebuild, setRebuild] = useState(0);
  // The colour the live default pin is drawn in; null for a custom-content marker.
  const painted = useRef<string | null>(null);
  const [lng, lat] = lngLat;
  // Where the pin is: the last `lngLat` coordinates, or where a drag left it. A rebuild draws it here.
  const position = useRef<[number, number]>([lng, lat]);
  // The live marker, read by the position effect, which must not re-run when a rebuild replaces it.
  const markerRef = useRef<MarkerHandle | null>(null);
  // Latest handlers, so an inline arrow never re-binds the listeners (and never loses a drag flag).
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  const [hovered, setHovered] = useState(false);
  // Where the pin is, for a tooltip that has to follow it; `position` is the same, without a render.
  const [where, setWhere] = useState<[number, number]>([lng, lat]);
  const [popup, setPopup] = useState<BoundPopup>(NO_POPUP);

  // Resolved once per style generation (or when the caller's own inputs change), not on every
  // render. A new colour is painted onto the existing pin (below), so a swap, including a
  // dark-mode toggle that changes `--primary`, keeps the marker and any popup open on it. Only a
  // new `scale` rebuilds the marker, since MapLibre sizes its pin once, at construction.
  const pin = useMemo(
    () => (map && !hasCustomMarker ? markerColor(map, color) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `generation`: the style's theme is read afresh per swap.
    [map, color, hasCustomMarker, generation],
  );
  const scale = useMemo(
    () => (map && !hasCustomMarker ? themeMeta(map).marker?.scale : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, hasCustomMarker, generation],
  );

  useEffect(() => {
    if (!map) return;
    const el = hasCustomMarker ? document.createElement("div") : undefined;
    if (el) {
      el.style.cursor = "pointer";
      setMarkerElement(el);
    }
    const fill = pin ?? FALLBACK_ACCENT;
    const m = new maplibregl.Marker(el ? { element: el } : { color: fill, ...(scale != null ? { scale } : {}) })
      .setLngLat(position.current)
      .addTo(map);
    painted.current = el ? null : fill;
    markerRef.current = m;
    setMarker(m);
    return () => {
      m.remove();
      if (markerRef.current === m) markerRef.current = null;
      setMarker((current) => (current === m ? null : current));
      setMarkerElement((current) => (current === el ? null : current));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new `pin` is painted in place by the effect below; the position effect moves the marker.
  }, [map, scale, hasCustomMarker, rebuild]);

  useEffect(() => {
    const from = painted.current;
    if (!marker || pin == null || from == null || pin === from) return;
    if (recolourPin(marker.getElement(), from, pin)) painted.current = pin;
    else setRebuild((count) => count + 1);
  }, [marker, pin]);

  // Applied to every marker, the rebuilt ones included.
  useEffect(() => {
    marker?.setDraggable(draggable);
  }, [marker, draggable]);

  useEffect(() => {
    if (!marker) return;
    const element = marker.getElement();
    // A drag ends with the pointer released over the pin; a click the browser sends after it is
    // not a click. The flag clears on the next pointer-down, which starts every real click.
    // A real or keyboard drag often gets no click at all, so the flag can stay set until the next
    // pointer-down; a click with no pointer-down before it (assistive tech, element.click()) is
    // swallowed once.
    let dragged = false;
    const handleDragEnd = () => {
      const { lng: droppedLng, lat: droppedLat } = marker.getLngLat();
      position.current = [droppedLng, droppedLat];
      setWhere((current) =>
        current[0] === droppedLng && current[1] === droppedLat ? current : [droppedLng, droppedLat],
      );
      dragged = true;
      onDragEndRef.current?.([droppedLng, droppedLat]);
    };
    const handlePointerDown = () => {
      dragged = false;
    };
    const handleClick = () => {
      if (dragged) {
        dragged = false;
        return;
      }
      onClickRef.current?.();
    };
    marker.on("dragend", handleDragEnd);
    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("click", handleClick);
    return () => {
      marker.off("dragend", handleDragEnd);
      element.removeEventListener("pointerdown", handlePointerDown);
      element.removeEventListener("click", handleClick);
    };
  }, [marker]);

  // Hover state for a `trigger="hover"` popup and a tooltip. Touch has no hover: a tap is a
  // click. MapLibre turns pointer events off on the pin while it moves, so a drag clears the
  // pointer until it enters again.
  useEffect(() => {
    if (!marker) return;
    const element = marker.getElement();
    let pointer = false;
    let focus = false;
    let dragging = false;
    // A press focuses the pin (a popup or `draggable` gives it a tab stop) without reading as
    // hover: on touch the tap would show a tooltip that sticks, and a hover popup would open on
    // the focus and be closed again by MapLibre's click toggle. Only focus that arrives without
    // a press, from the keyboard, counts.
    let pressed = false;
    const sync = () => setHovered((pointer || focus) && !dragging);
    const handleEnter = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer = true;
      sync();
    };
    const handleLeave = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer = false;
      sync();
    };
    const handlePress = () => {
      pressed = true;
    };
    // A press's focus arrives before its click, so a press that ends first (a touch that became a
    // map pan, or a pin that cannot take focus) must not swallow the keyboard focus after it.
    const handleRelease = () => {
      pressed = false;
    };
    const handleFocusIn = () => {
      if (pressed) return;
      focus = true;
      sync();
    };
    const handleFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
      pressed = false;
      focus = false;
      sync();
    };
    const handleDragStart = () => {
      dragging = true;
      sync();
    };
    // A touch drag ends with no click and no focus, so it clears its own press.
    const handleDragEnd = () => {
      dragging = false;
      pointer = false;
      pressed = false;
      sync();
    };
    element.addEventListener("pointerenter", handleEnter);
    element.addEventListener("pointerleave", handleLeave);
    element.addEventListener("pointerdown", handlePress);
    element.addEventListener("pointercancel", handleRelease);
    element.addEventListener("click", handleRelease);
    element.addEventListener("focusin", handleFocusIn);
    element.addEventListener("focusout", handleFocusOut);
    marker.on("dragstart", handleDragStart);
    marker.on("dragend", handleDragEnd);
    return () => {
      element.removeEventListener("pointerenter", handleEnter);
      element.removeEventListener("pointerleave", handleLeave);
      element.removeEventListener("pointerdown", handlePress);
      element.removeEventListener("pointercancel", handleRelease);
      element.removeEventListener("click", handleRelease);
      element.removeEventListener("focusin", handleFocusIn);
      element.removeEventListener("focusout", handleFocusOut);
      marker.off("dragstart", handleDragStart);
      marker.off("dragend", handleDragEnd);
      setHovered(false);
    };
  }, [marker]);

  const state = useMemo<MarkerState>(
    () => ({ marker, hovered, lngLat: where, popup, setPopup }),
    [marker, hovered, where, popup],
  );

  // Keep position reactive without recreating the marker. Keyed on the numbers, not the array:
  // an inline `lngLat={[lng, lat]}` is a new array on every render, and following it would pull a
  // dropped pin back to where it started whenever the parent re-rendered.
  useEffect(() => {
    position.current = [lng, lat];
    markerRef.current?.setLngLat([lng, lat]);
    setWhere((current) => (current[0] === lng && current[1] === lat ? current : [lng, lat]));
  }, [lng, lat]);

  return (
    <MarkerContext.Provider value={state}>
      {markerElement && markerContent ? createPortal(markerContent, markerElement) : null}
      {children}
    </MarkerContext.Provider>
  );
}

export interface PopupProps {
  /**
   * Popup position as [longitude, latitude]. Omit when nested inside a `<Marker>`: the popup
   * binds to the marker and opens on click.
   */
  lngLat?: [number, number];
  /** Map id when multiple maps share a page. Defaults to "default". */
  mapId?: string;
  /** Offset in pixels from the anchor. Defaults to 24. */
  offset?: number;
  /** Show a close button. Defaults to true, except on a hover popup nested in a `<Marker>`, which cannot be reached to click it. */
  closeButton?: boolean;
  /**
   * How a popup nested in a `<Marker>` opens. `"click"` (the default) opens and closes it on a
   * click or tap. `"hover"` opens it while the pointer is over the pin or the pin has focus; a
   * click, a tap or Enter still toggles it, which is how it opens on a touch screen. Ignored by a
   * standalone popup. A hover popup closes when the pointer or focus leaves the pin, so its
   * content cannot be reached: keep it read-only, and use the default click trigger for anything
   * interactive.
   */
  trigger?: "click" | "hover";
  children?: ReactNode;
}

export function Popup({ lngLat, mapId, offset = 24, closeButton, trigger = "click", children }: PopupProps) {
  const map = useMap(mapId);
  const { marker, hovered, setPopup: publish } = useContext(MarkerContext);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [handle, setHandle] = useState<PopupHandle | null>(null);
  const popupRef = useRef<PopupHandle | null>(null);
  const standaloneAttachedRef = useRef(false);
  const hover = trigger === "hover";
  const showClose = closeButton ?? !(marker && hover);

  useEffect(() => {
    setContent(document.createElement("div"));
  }, []);

  useEffect(() => {
    if (!map || !content) return;
    // A hover popup must not pull focus to its close button as the pointer passes over the pin.
    const popup: PopupHandle = new maplibregl.Popup({
      offset,
      closeButton: showClose,
      className: "unmap-popup",
      ...(hover ? { focusAfterOpen: false } : {}),
    }).setDOMContent(content);
    popupRef.current = popup;
    setHandle(popup);
    // Tells the pin's tooltip when this popup opens and closes, however it was opened.
    const sync = () => publish?.({ open: popup.isOpen(), hover });
    if (marker) {
      marker.setPopup(popup);
      popup.on("open", sync);
      popup.on("close", sync);
      sync();
    } else if (lngLat) {
      popup.setLngLat(lngLat).addTo(map);
      standaloneAttachedRef.current = true;
    }
    return () => {
      popup.off("open", sync);
      popup.off("close", sync);
      if (marker) publish?.(NO_POPUP);
      popup.remove();
      standaloneAttachedRef.current = false;
      if (marker) marker.setPopup(undefined);
      if (popupRef.current === popup) popupRef.current = null;
      setHandle((current) => (current === popup ? null : current));
    };
  }, [map, marker, publish, content, offset, showClose, hover]);

  // Keep a standalone popup's position reactive.
  useEffect(() => {
    const popup = popupRef.current;
    if (marker || !popup) return;
    if (lngLat) {
      popup.setLngLat(lngLat);
      if (!standaloneAttachedRef.current && map) {
        popup.addTo(map);
        standaloneAttachedRef.current = true;
      }
    } else if (standaloneAttachedRef.current) {
      popup.remove();
      standaloneAttachedRef.current = false;
    }
  }, [map, marker, lngLat]);

  // A hover popup follows the pin's hover state. It stays bound with `setPopup`, so MapLibre
  // keeps it on the pin through drags and moves, and a click, a tap or Enter still toggles it.
  useEffect(() => {
    if (!marker || !handle || !hover) return;
    if (hovered !== handle.isOpen()) marker.togglePopup();
  }, [marker, handle, hover, hovered]);

  return content ? createPortal(children, content) : null;
}

export interface MarkerTooltipProps {
  /** Map id when multiple maps share a page. Defaults to "default". */
  mapId?: string;
  /** Offset in pixels from the pin. Defaults to 24. */
  offset?: number;
  children?: ReactNode;
}

/**
 * A small popup shown while the pointer is over the parent `<Marker>`'s pin, or while the pin has
 * focus. It sits beside a `<Popup>`, which keeps opening on click, and steps aside while that popup
 * is open; beside a `trigger="hover"` popup, which opens on the same hover, it never shows. Touch
 * screens have no hover, so it never shows there: keep anything essential in a `<MarkerLabel>` or
 * a `<Popup>`. A pin is focusable only when it has a `<Popup>` or is `draggable` (a default pin),
 * so on a pin with neither the tooltip is hover-only and keyboard users do not get it.
 */
export function MarkerTooltip({ mapId, offset = 24, children }: MarkerTooltipProps) {
  const map = useMap(mapId);
  const { marker, hovered, lngLat, popup } = useContext(MarkerContext);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<PopupHandle | null>(null);
  // The pin's popup wins: a hover one opens on this same hover, a click one covers the pin.
  const shown = hovered && !popup.open && !popup.hover;

  useEffect(() => {
    setContent(document.createElement("div"));
  }, []);

  useEffect(() => {
    if (!content) return;
    // Not bound with `setPopup` (a marker holds one popup), and never focused or closed by a click.
    const created: PopupHandle = new maplibregl.Popup({
      offset,
      closeButton: false,
      closeOnClick: false,
      focusAfterOpen: false,
      className: "unmap-popup unmap-tooltip",
    }).setDOMContent(content);
    setTooltip(created);
    return () => {
      created.remove();
      setTooltip((current) => (current === created ? null : current));
    };
  }, [content, offset]);

  useEffect(() => {
    if (!map || !marker || !tooltip) return;
    // Shown at the pin, and moved with it while shown.
    if (shown) tooltip.setLngLat(lngLat).addTo(map);
    else tooltip.remove();
  }, [map, marker, tooltip, shown, lngLat]);

  return content ? createPortal(children, content) : null;
}

/** Where the label sits against the pin. Layout only: colour and type come from your tokens. */
const LABEL_POSITION = {
  right: "left-full top-1/2 ml-1 -translate-y-1/2",
  left: "right-full top-1/2 mr-1 -translate-y-1/2",
  top: "bottom-full left-1/2 mb-1 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-1 -translate-x-1/2",
} as const;

export interface MarkerLabelProps {
  /** Which side of the pin the label sits on. Defaults to "right". */
  position?: keyof typeof LABEL_POSITION;
  className?: string;
  children?: ReactNode;
}

/**
 * Text beside the parent `<Marker>`'s pin, always shown, on your `--background` and `--foreground`.
 * It is drawn into the marker element, so it moves with the pin and never catches the pointer.
 */
export function MarkerLabel({ position = "right", className, children }: MarkerLabelProps) {
  const { marker } = useContext(MarkerContext);
  const [host, setHost] = useState<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!marker) return;
    const span = document.createElement("span");
    span.setAttribute("data-unmap-marker-label", "");
    marker.getElement().appendChild(span);
    setHost(span);
    return () => {
      span.remove();
      setHost((current) => (current === span ? null : current));
    };
  }, [marker]);

  return host
    ? createPortal(
        <span
          className={cn(
            "pointer-events-none absolute whitespace-nowrap rounded-md bg-background/90 px-1.5 py-0.5 text-xs font-medium text-foreground",
            LABEL_POSITION[position],
            className,
          )}
        >
          {children}
        </span>,
        host,
      )
    : null;
}
