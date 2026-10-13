"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { RouteResult } from "@unmap/sdk";
import { InfoIcon, LocateFixedIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Geocoder } from "@/components/ui/geocoder";
import { Spinner } from "@/components/ui/spinner";
import { ApiProblemAlert } from "@/lib/kit/api-problem";
import { API_KEY, GATEWAY } from "@/lib/kit/config";
import { format, formatDistance, formatDuration, type Lang } from "@/lib/kit/i18n";
import { TEXT } from "@/lib/text";
import type { AsyncState } from "@/lib/use-async";

export interface Origin {
  coordinates: [number, number];
  label: string;
}

/** Search results lean towards Banff. */
const BANFF: [number, number] = [-115.57, 51.18];

/**
 * The registry Geocoder (Unmap Geocoding, `/geocode/autocomplete`) for the starting place, rendered
 * inside the map's provider and portalled into the directions panel's slot.
 */
export function OriginSearch({ target, onOrigin, lang }: { target: HTMLElement | null; onOrigin: (origin: Origin) => void; lang: Lang }) {
  const t = TEXT[lang];
  if (!target) return null;
  return createPortal(
    <Geocoder
      apiKey={API_KEY}
      gateway={GATEWAY}
      lang={lang}
      limit={6}
      proximity={BANFF}
      placeholder={t.fromPlaceholder}
      emptyText={t.fromEmpty}
      onSelect={(r) => onOrigin({ coordinates: [r.lng, r.lat], label: r.name })}
    />,
    target,
  );
}

/**
 * Road directions to the trailhead: where from (the search box, rendered by OriginSearch into
 * `geocoderSlot`, or the browser's location), then the route's summary, any warning the API
 * attached, and a slot the map fills with the registry's turn-by-turn list. Says plainly that this
 * is road routing, not trail navigation, and what a failure probably means.
 */
export function Directions({
  origin,
  onOrigin,
  state,
  lang,
  onRetry,
  geocoderSlot,
  stepsSlot,
}: {
  origin: Origin | null;
  onOrigin: (origin: Origin | null) => void;
  state: AsyncState<RouteResult>;
  lang: Lang;
  onRetry: () => void;
  geocoderSlot: (el: HTMLDivElement | null) => void;
  stepsSlot: (el: HTMLDivElement | null) => void;
}) {
  const t = TEXT[lang];
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState(false);
  const locate = () => {
    if (!("geolocation" in navigator)) return setDenied(true);
    setLocating(true);
    setDenied(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onOrigin({ coordinates: [Number(pos.coords.longitude.toFixed(5)), Number(pos.coords.latitude.toFixed(5))], label: t.myLocation });
      },
      () => {
        setLocating(false);
        setDenied(true);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  return (
    <section aria-label={t.directions} className="flex flex-col gap-2" data-directions="">
      <p className="text-xs text-muted-foreground">{t.directionsNote}</p>
      <div role="search" aria-label={t.fromLabel} className="flex gap-2">
        <div ref={geocoderSlot} className="min-w-0 flex-1" />
        <Button variant="outline" size="icon" aria-label={locating ? t.locating : t.useLocation} title={t.useLocation} onClick={locate} disabled={locating}>
          <LocateFixedIcon />
        </Button>
      </div>
      {denied ? <p className="text-xs text-muted-foreground">{t.locationDenied}</p> : null}
      {origin ? (
        <p className="flex items-center gap-1 text-sm">
          <span className="min-w-0 truncate">{format(t.from, { place: origin.label })}</span>
          <Button variant="ghost" size="icon-xs" aria-label={t.clearOrigin} onClick={() => onOrigin(null)}>
            <XIcon />
          </Button>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t.pickOrigin}</p>
      )}
      {origin ? (
        state.status === "loading" || state.status === "idle" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Spinner /> {t.routeLoading}
          </p>
        ) : state.status === "error" ? (
          <div className="flex flex-col gap-1.5" data-route-error="">
            <ApiProblemAlert error={state.error} lang={lang} onRetry={onRetry} />
            <p className="text-xs text-muted-foreground">{t.routeFailed}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2" data-route="">
            <p className="text-sm font-medium tabular-nums" aria-live="polite">
              {format(t.routeSummary, { time: formatDuration(state.data.durationSeconds, lang), distance: formatDistance(state.data.distanceMeters, lang) })}
            </p>
            {state.data.warnings?.map((w) => (
              <Alert key={`${w.code}-${w.where ?? ""}`} data-warning={w.code}>
                <InfoIcon />
                <AlertTitle>{t.relocated}</AlertTitle>
                <AlertDescription>{w.message}</AlertDescription>
              </Alert>
            ))}
            {state.data.steps?.length ? (
              <section aria-label={t.steps}>
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t.steps}</h3>
                <div ref={stepsSlot} />
              </section>
            ) : null}
          </div>
        )
      ) : null}
    </section>
  );
}
