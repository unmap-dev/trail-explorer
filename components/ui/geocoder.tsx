"use client";

/**
 * <Geocoder> - an unmap search box.
 *
 * Calls the unmap gateway geocode API through `@unmap/geocoding` and flies the shared map
 * (from `map-context`) to the chosen result. Server results are rendered through the official
 * Base UI shadcn Combobox so pointer, keyboard, and screen-reader behavior stay aligned.
 *
 * Coordinates typed into the box (`51.05, -114.07`, or `-114.07, 51.05`) are reverse geocoded
 * rather than searched; `reverseGeocode={false}` turns that off. `bbox` keeps results inside a
 * rectangle, `proximity` prefers results near a point (or the map's centre, with `"map"`), and
 * `renderResult` draws each option your way.
 *
 * Copied into your project by `npx shadcn add`. Edit freely.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Geocoder as GeocoderClient, type GeocodeResult } from "@unmap/geocoding";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { useMap } from "@/lib/map-context";

// --- coordinate helpers (kept identical across both lanes) ---

/** Autocomplete has no server-side box, so a `bbox` search asks for this many times `limit`. */
export const BBOX_OVERFETCH = 4;

/**
 * Coordinates typed into the search box, as [longitude, latitude], or null when the text is not a
 * pair. Read as `lat, lng` (the order Google and Mapbox use), except that a first number beyond 90,
 * or a negative first and a positive second, is read as `lng, lat`: all of Canada has a positive
 * latitude and a negative longitude, so `-114.07, 51.05` and `51.05, -114.07` are both Calgary.
 *
 * Two numbers split by a comma, a semicolon, or spaces. A decimal point or a French decimal comma
 * both work, but not mixed in one pair. The comma is the hard case:
 * - Spaces alone split a pair only when a number has a decimal, so "10 12" stays a text search.
 * - A comma with no space around it between two unsigned whole numbers is a decimal comma:
 *   "51,05" and "12,5" are one number, not a pair, and stay a text search. "12, 5" is a pair.
 * - Decimal commas split by a comma parse only as "51,05, -114,07": both numbers with a decimal
 *   comma and a space after the separating comma, the one spelling with a single reading.
 *   "51,05,-114,07" and "51,05, -114" are null. Use a space or ";" to be sure: "51,05; -114,07".
 * U+2212, the minus sign Wikipedia prints, counts as "-". Degrees-minutes-seconds stay text.
 */
export function parseCoordinates(text: string): [number, number] | null {
  const match = /^\s*([+-]?\d+(?:[.,]\d+)?)(\s*[,;]\s*|\s+)([+-]?\d+(?:[.,]\d+)?)\s*$/.exec(
    text.replace(/\u2212/g, "-"),
  );
  if (!match) return null;
  const [, first, separator, second] = match as unknown as [string, string, string, string];
  const mark = separator.trim();
  const dot = first.includes(".") || second.includes(".");
  const commaDecimals = Number(first.includes(",")) + Number(second.includes(","));
  if (dot && commaDecimals) return null;
  if (!mark && !dot && !commaDecimals) return null;
  if (mark === ",") {
    if (commaDecimals && (commaDecimals < 2 || !/,\s/.test(separator))) return null;
    if (separator === "," && !dot && !/^[+-]/.test(second)) return null;
  }
  const a = Number(first.replace(",", "."));
  const b = Number(second.replace(",", "."));
  const [lng, lat] = Math.abs(a) > 90 || (a < 0 && b > 0) ? [a, b] : [b, a];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lng, lat] : null;
}

/** True when a point lies inside `bbox` ([west, south, east, north]), edges included. */
export function inBox(point: { lng: number; lat: number }, bbox: [number, number, number, number]): boolean {
  const [west, south, east, north] = bbox;
  return point.lng >= west && point.lng <= east && point.lat >= south && point.lat <= north;
}

/** A `proximity` prop as a primitive, so an inline tuple does not search again on every render. */
export function proximityKey(proximity: [number, number] | "map" | undefined): string {
  return proximity === "map" ? "map" : proximity ? proximity.join(",") : "";
}

/**
 * The `focus` to send for a `proximityKey`: `"map"` reads the map's centre now, `"lng,lat"` is that
 * point, and `""` is none.
 */
export function focusOf(
  proximity: string,
  map: { getCenter(): { lng: number; lat: number } } | null,
): [number, number] | undefined {
  if (proximity === "map") {
    const centre = map?.getCenter();
    return centre ? [wrapLongitude(centre.lng), centre.lat] : undefined;
  }
  if (!proximity) return undefined;
  const [lng, lat] = proximity.split(",").map(Number);
  return [wrapLongitude(lng!), lat!];
}

/**
 * A longitude brought back into [-180, 180]. MapLibre can report a centre past the antimeridian
 * after a pan or `flyTo`, and the gateway rejects such a `focus` with a 400.
 */
function wrapLongitude(lng: number): number {
  return lng >= -180 && lng <= 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** The gateway's answer for a point outside Canada: status 422, code `outside_coverage`. */
export function isOutsideCoverage(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "outside_coverage";
}
// --- end coordinate helpers ---

export interface GeocoderProps {
  /** unmap API key. */
  apiKey: string;
  /** Gateway base URL. Defaults to the unmap production gateway. */
  gateway?: string;
  /** Map id to control when multiple maps share a page. Defaults to "default". */
  mapId?: string;
  /** Placeholder text. */
  placeholder?: string;
  /** Max suggestions to request. Defaults to 5. */
  limit?: number;
  /** Result language. */
  lang?: "en" | "fr";
  /** Zoom level to fly to on selection. Defaults to 15. */
  flyToZoom?: number;
  /** Called after a result is chosen (before the map flies). */
  onSelect?: (result: GeocodeResult) => void;
  /** Reverse geocode coordinates typed into the box instead of searching for them. Defaults to true. */
  reverseGeocode?: boolean;
  /**
   * [west, south, east, north]: only results inside it are shown. Autocomplete has no server-side
   * box, so more suggestions are requested and filtered here, and fewer than `limit` can show. A
   * typed coordinate is looked up wherever it is.
   */
  bbox?: [number, number, number, number];
  /**
   * Prefer results near [lng, lat], or near the map's centre at the moment of each search with
   * `"map"`. Moves the ranking only; nothing is excluded.
   */
  proximity?: [number, number] | "map";
  /** Draws an option's content. Defaults to the name over the city. */
  renderResult?: (result: GeocodeResult) => ReactNode;
  /** What the list says when a search finds nothing. Defaults to a line saying search covers Canada. */
  emptyText?: string;
  /**
   * What the list says when a search fails, from the error (a gateway error carries `status` and
   * `code`). Defaults to the outside-Canada line for a point abroad, else a generic failure line.
   */
  errorText?: (error: unknown) => string;
  className?: string;
}

export function Geocoder({
  apiKey,
  gateway,
  mapId,
  placeholder = "Search places",
  limit = 5,
  lang,
  flyToZoom = 15,
  onSelect,
  reverseGeocode = true,
  bbox,
  proximity,
  renderResult,
  emptyText,
  errorText,
  className,
}: GeocoderProps) {
  const map = useMap(mapId);
  // Read when a search fires, so `proximity="map"` sees the centre then and a new map object is
  // never a reason to search again.
  const mapRef = useRef(map);
  mapRef.current = map;
  // Read when a search fails, so an inline errorText is never a reason to search again.
  const errorTextRef = useRef(errorText);
  errorTextRef.current = errorText;
  const client = useMemo(() => new GeocoderClient({ key: apiKey, gateway }), [apiKey, gateway]);

  const [inputValue, setInputValue] = useState("");
  const [requestQuery, setRequestQuery] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dismissedRef = useRef(false);
  const requestRef = useRef(0);
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coverageHint = lang === "fr" ? "La recherche couvre le Canada." : "Search covers Canada.";
  const emptyHint =
    lang === "fr"
      ? "Aucun lieu trouvé. La recherche couvre le Canada."
      : "No places found. Search covers Canada.";
  const outsideHint =
    lang === "fr"
      ? "Ce point est hors du Canada. La recherche couvre le Canada."
      : "That point is outside Canada. Search covers Canada.";
  const boxKey = bbox ? bbox.join(",") : "";
  const focusKey = proximityKey(proximity);

  useEffect(() => {
    const q = requestQuery.trim();
    const request = ++requestRef.current;
    abortRef.current?.abort();

    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      setOpen(false);
      return;
    }

    setResults([]);
    setLoading(true);
    setError(null);
    setOpen(true);
    const coordinates = reverseGeocode ? parseCoordinates(q) : null;
    const box = boxKey ? (boxKey.split(",").map(Number) as [number, number, number, number]) : undefined;
    let controller: AbortController | null = null;

    const timer = setTimeout(async () => {
      controller = new AbortController();
      abortRef.current = controller;
      try {
        let hits: GeocodeResult[];
        if (coordinates) {
          hits = await client.reverse(coordinates[0], coordinates[1], { limit, lang, signal: controller.signal });
        } else {
          const focus = focusOf(focusKey, mapRef.current);
          const found = await client.autocomplete(q, {
            limit: box ? Math.min(50, limit * BBOX_OVERFETCH) : limit,
            lang,
            ...(focus ? { focus } : {}),
            signal: controller.signal,
          });
          hits = box ? found.filter((hit) => inBox(hit, box)).slice(0, limit) : found;
        }
        if (request !== requestRef.current) return;
        setResults(hits);
        setOpen(true);
        setLoading(false);
      } catch (err) {
        if (request !== requestRef.current || (err as Error)?.name === "AbortError") return;
        setResults([]);
        setError(
          errorTextRef.current?.(err) ??
            (isOutsideCoverage(err)
              ? outsideHint
              : lang === "fr"
                ? "La recherche a échoué. Vérifiez la clé d'API et réessayez."
                : "Search failed. Check the API key and try again."),
        );
        setLoading(false);
        setOpen(true);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller?.abort();
    };
  }, [requestQuery, requestVersion, client, limit, lang, reverseGeocode, boxKey, focusKey, outsideHint]);

  function dismiss() {
    dismissedRef.current = true;
    requestRef.current += 1;
    abortRef.current?.abort();
    setLoading(false);
    setOpen(false);
  }

  function reopen() {
    if (inputValue.trim().length < 2) return;
    setOpen(true);
    if (dismissedRef.current) {
      dismissedRef.current = false;
      setRequestQuery(inputValue);
      setRequestVersion((version) => version + 1);
    }
  }

  function choose(result: GeocodeResult) {
    requestRef.current += 1;
    abortRef.current?.abort();
    setInputValue(result.name);
    setRequestQuery("");
    setResults([]);
    setLoading(false);
    setError(null);
    setOpen(false);
    onSelect?.(result);
    map?.flyTo({
      center: [result.lng, result.lat],
      zoom: flyToZoom,
      duration: reducedMotion ? 0 : 600,
    });
  }

  return (
    <div
      className={className}
      data-unmap-geocoder=""
      style={{ width: "100%", minWidth: 0 }}
      onClickCapture={reopen}
      onFocusCapture={reopen}
      onKeyDownCapture={(event) => {
        if (event.key === "ArrowDown" || event.key === "Enter") reopen();
      }}
    >
      <Combobox
        items={results}
        filter={null}
        inputValue={inputValue}
        open={open}
        itemToStringLabel={(result: GeocodeResult) => result.name}
        itemToStringValue={(result: GeocodeResult) => result.id}
        isItemEqualToValue={(item: GeocodeResult, value: GeocodeResult) => item.id === value.id}
        onInputValueChange={(next, details) => {
          if (details.reason === "input-change" || details.reason === "clear-press") {
            setInputValue(next);
            dismissedRef.current = false;
            setRequestQuery(next);
          }
        }}
        onOpenChange={(next) => {
          if (next) reopen();
          else dismiss();
        }}
        onValueChange={(result) => result && choose(result)}
      >
        <ComboboxInput
          aria-label={placeholder}
          autoComplete="off"
          placeholder={placeholder}
          showTrigger={false}
          className="w-full"
          onBlur={dismiss}
        />
        <ComboboxContent className={reducedMotion ? "animate-none duration-0" : undefined}>
          <ComboboxList>
            {results.map((result) => (
              <ComboboxItem key={result.id} value={result}>
                {renderResult ? (
                  renderResult(result)
                ) : (
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{result.name}</span>
                    {result.address?.city && (
                      <span className="truncate text-xs text-muted-foreground">
                        {result.address.city}
                      </span>
                    )}
                  </span>
                )}
              </ComboboxItem>
            ))}
          </ComboboxList>
          <ComboboxEmpty>
            {loading ? (
              <span role="status">{lang === "fr" ? "Recherche..." : "Searching..."}</span>
            ) : error ? (
              <span role="alert">{error}</span>
            ) : (
              (emptyText ?? emptyHint)
            )}
          </ComboboxEmpty>
        </ComboboxContent>
      </Combobox>
      <p className="mt-1 text-xs text-muted-foreground">{coverageHint}</p>
    </div>
  );
}
