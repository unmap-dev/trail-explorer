"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircleIcon, DatabaseIcon, NavigationIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ElevationProfile, formatDistance as formatLength, type ProfilePoint, type ProfileStats } from "@/components/ui/elevation-profile";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { RouteSteps } from "@/components/ui/route-steps";
import { Spinner } from "@/components/ui/spinner";
import { useDirections } from "@/hooks/use-directions";
import { TrailsNotFetched, useTrailData } from "@/hooks/use-trail-data";
import { availableFilters, filterTrails, NO_FILTERS, type Filters } from "@/lib/filters";
import { lineLength } from "@/lib/geo";
import { longestLine, type GpxTrack } from "@/lib/gpx";
import { API_KEY, GATEWAY } from "@/lib/kit/config";
import { DemoHeader } from "@/lib/kit/demo-header";
import { format, formatNumber, type Lang } from "@/lib/kit/i18n";
import { MissingKey } from "@/lib/kit/missing-key";
import { useLang } from "@/lib/kit/use-lang";
import { MANIFEST } from "@/lib/manifest";
import { TEXT } from "@/lib/text";
import { cn } from "@/lib/utils";
import { TrailDataError, profileLine, type Trail } from "@/lib/trails";
import { parseTrail, writeTrail } from "@/lib/url";
import { Directions, OriginSearch, type Origin } from "./directions";
import { GpxImport } from "./gpx-import";
import { TrailDetails, type LiveClimb } from "./trail-details";
import { TrailFilters } from "./trail-filters";
import { TrailList } from "./trail-list";
import { TrailsMap } from "./trails-map";

/** The chosen trail, kept in `?trail=` so a link opens on it. */
function useTrailParam(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    // The URL only exists after mount in a static export.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setId(parseTrail(window.location.search));
  }, []);
  const update = useCallback((next: string | null) => {
    setId(next);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${writeTrail(window.location.search, next)}`);
  }, []);
  return [id, update];
}

/** The always-visible notice the brief asks for (spec §6): not live, maybe incomplete, not for safety. */
function Notice({ lang }: { lang: Lang }) {
  const t = TEXT[lang];
  return (
    <Alert data-notice="">
      <TriangleAlertIcon />
      <AlertTitle>{t.noticeTitle}</AlertTitle>
      <AlertDescription>{t.notice}</AlertDescription>
    </Alert>
  );
}

/** What the panel shows when the trail data is not there or not usable. Never sample trails. */
function DataProblem({ error, lang, onRetry }: { error: unknown; lang: Lang; onRetry: () => void }) {
  const t = TEXT[lang];
  if (error instanceof TrailsNotFetched)
    return (
      <Empty className="border" data-trails-missing="">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <DatabaseIcon />
          </EmptyMedia>
          <EmptyTitle>{t.missingTitle}</EmptyTitle>
          <EmptyDescription>{t.missingBody}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <code className="font-mono text-xs">node scripts/fetch-trails.mjs</code>
        </EmptyContent>
      </Empty>
    );
  if (error instanceof TrailDataError)
    return (
      <Alert variant="destructive" data-trails-invalid="">
        <AlertCircleIcon />
        <AlertTitle>{t.invalidTitle}</AlertTitle>
        <AlertDescription>
          <ul className="list-disc pl-4">
            {error.problems.slice(0, 8).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    );
  return (
    <Alert variant="destructive" data-trails-error="">
      <AlertCircleIcon />
      <AlertDescription>{t.loadFailed}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t.retry}
        </Button>
      </AlertAction>
    </Alert>
  );
}

/** Where the pointer is along the profile, on the chart or on the map: the two stay in step. */
function HoverReadout({ point, lang, className }: { point: ProfilePoint | null; lang: Lang; className?: string }) {
  const t = TEXT[lang];
  return (
    <p className={cn("text-xs tabular-nums text-muted-foreground", className)} data-profile-hover={point ? point.index : undefined}>
      {point ? format(t.hoverAt, { distance: formatLength(point.distance, lang), elevation: point.elevation === null ? t.noHeight : `${formatNumber(point.elevation, lang)} m` }) : ""}
    </p>
  );
}

/**
 * Trails: day hikes around Banff and Lake Louise from Parks Canada's open trail data, on a live
 * Unmap outdoor map. The trails are a dataset loaded from data/trails.geojson and filtered here;
 * the map, elevation profiles, place search and road directions are live Unmap.
 */
export function TrailsApp() {
  const [lang, setLang] = useLang();
  const t = TEXT[lang];
  const [data, retryData] = useTrailData();
  const [selectedId, setSelectedId] = useTrailParam();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [file, setFile] = useState<GpxTrack | null>(null);
  const [view, setView] = useState<"trail" | "file">("trail");
  const [fileProfile, setFileProfile] = useState(false);
  const [showDirections, setShowDirections] = useState(false);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [profileTarget, setProfileTarget] = useState<HTMLDivElement | null>(null);
  const [fileProfileTarget, setFileProfileTarget] = useState<HTMLDivElement | null>(null);
  const [geocoderTarget, setGeocoderTarget] = useState<HTMLDivElement | null>(null);
  const [stepsTarget, setStepsTarget] = useState<HTMLDivElement | null>(null);
  // Profiles already fetched: going back to a trail asks the API nothing.
  const [profileCache] = useState(() => new Map<string, ProfilePoint[]>());
  // The point under the pointer on the chart or on the line, read out under the profile.
  const [hover, setHover] = useState<ProfilePoint | null>(null);
  // The climb the profile measured, for the trail it measured: shown when the data carries none.
  const [measured, setMeasured] = useState<{ id: string; stats: ProfileStats | null } | null>(null);


  const all = useMemo(() => (data.status === "done" ? data.data.trails : []), [data]);
  const available = useMemo(() => availableFilters(all), [all]);
  // A filter the data cannot answer is hidden, and its value must not linger either.
  const active: Filters = useMemo(() => ({ ...filters, gain: available.gain ? filters.gain : [], difficulty: filters.difficulty.filter((d) => available.difficulties.some((o) => o.value === d)) }), [filters, available]);
  const trails = useMemo(() => filterTrails(all, active), [all, active]);
  const current: Trail | null = all.find((x) => x.id === selectedId) ?? null;
  const fileActive = view === "file" && !!file;

  const [route, retryRoute] = useDirections(origin?.coordinates ?? null, current?.trailhead.coordinates ?? null, lang, showDirections && !fileActive && !!API_KEY);

  const select = (id: string | null) => {
    setSelectedId(id);
    setView("trail");
    setShowDirections(false);
  };

  const profileFor = fileActive ? (fileProfile ? longestLine(file!) : null) : current ? profileLine(current) : null;
  const profileSlot = fileActive ? fileProfileTarget : profileTarget;
  const mainPart = current && current.lines.length > 1 ? { main: lineLength(current.lines[0]!), total: current.length.metres } : null;
  const liveClimb: LiveClimb = !API_KEY || !current ? null : measured?.id === current.id ? measured.stats : undefined;

  return (
    <div className="flex h-dvh flex-col">
      <DemoHeader manifest={MANIFEST} lang={lang} onLang={setLang} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="order-last flex min-h-0 flex-1 flex-col overflow-y-auto border-t lg:order-first lg:w-[420px] lg:flex-none lg:border-t-0 lg:border-r">
          <div className="flex flex-col gap-3 p-3">
            <Notice lang={lang} />
            {data.status === "loading" || data.status === "idle" ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                <Spinner /> {t.loading}
              </p>
            ) : data.status === "error" ? (
              <DataProblem error={data.error} lang={lang} onRetry={retryData} />
            ) : (
              <>
                {current && !fileActive ? (
                  <TrailDetails
                    trail={current}
                    lang={lang}
                    liveClimb={liveClimb}
                    directions={
                      showDirections ? (
                        <Directions origin={origin} onOrigin={setOrigin} state={route} lang={lang} onRetry={retryRoute} geocoderSlot={setGeocoderTarget} stepsSlot={setStepsTarget} />
                      ) : null
                    }
                    onClose={() => select(null)}
                    actions={
                      API_KEY ? (
                        <Button size="sm" variant={showDirections ? "secondary" : "default"} aria-expanded={showDirections} onClick={() => setShowDirections((v) => !v)}>
                          <NavigationIcon />
                          {showDirections ? t.hideDirections : t.directions}
                        </Button>
                      ) : null
                    }
                  >
                    <section aria-label={t.profile} className="flex flex-col gap-2" data-profile="">
                      {/* The readout sits beside the heading, so following the line never moves the chart. */}
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="text-xs font-medium text-muted-foreground">{t.profile}</h3>
                        <HoverReadout point={hover} lang={lang} />
                      </div>
                      {API_KEY ? <div ref={setProfileTarget} className="min-h-40" /> : <p className="text-xs text-muted-foreground">{t.profileNeedsKey}</p>}
                      <p className="text-xs text-muted-foreground">
                        {t.profileNote}
                        {mainPart ? ` ${format(t.profilePart, { main: formatLength(mainPart.main, lang), total: formatLength(mainPart.total, lang) })}` : ""}
                      </p>
                    </section>
                  </TrailDetails>
                ) : null}
                <TrailFilters value={filters} onChange={setFilters} gain={available.gain} difficulties={available.difficulties} lang={lang} />
                <p className="text-xs text-muted-foreground" aria-live="polite" data-trail-count="">
                  {trails.length === all.length ? (all.length === 1 ? t.countOne : format(t.count, { n: all.length })) : format(t.countOf, { n: trails.length, total: all.length })}
                </p>
                {active.gain.length && all.some((x) => !x.elevation) ? <p className="text-xs text-muted-foreground">{t.gainNullNote}</p> : null}
              </>
            )}
          </div>
          {data.status === "done" ? (
            trails.length ? (
              <TrailList trails={trails} selected={fileActive ? null : selectedId} lang={lang} onSelect={select} />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyDescription>{t.noneMatch}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" size="sm" onClick={() => setFilters(NO_FILTERS)}>
                    {t.clearFilters}
                  </Button>
                </EmptyContent>
              </Empty>
            )
          ) : null}
          <div className="flex flex-col gap-3 border-t p-3">
            <GpxImport
              track={file}
              active={fileActive}
              lang={lang}
              canProfile={!!API_KEY}
              profileRequested={fileProfile}
              onLoad={(track) => {
                setFile(track);
                setFileProfile(false);
                setView("file");
                setShowDirections(false);
              }}
              onRemove={() => {
                setFile(null);
                setFileProfile(false);
                setView("trail");
              }}
              onShow={() => setView("file")}
              onProfile={() => setFileProfile(true)}
            >
              {fileProfile ? (
                <>
                  <div ref={setFileProfileTarget} className="min-h-40" />
                  <HoverReadout point={hover} lang={lang} className="min-h-4" />
                </>
              ) : null}
            </GpxImport>
            {data.status === "done" ? (
              <p className="text-xs text-muted-foreground" data-attribution="">
                {format(t.attribution, { attribution: data.data.provenance.attribution })}
              </p>
            ) : null}
          </div>
        </aside>
        <main className="h-[45dvh] shrink-0 lg:h-auto lg:min-w-0 lg:flex-1">
          {API_KEY ? (
            <TrailsMap
              trails={trails}
              selected={current}
              file={file}
              fileActive={fileActive}
              origin={showDirections ? origin : null}
              route={showDirections && route.status === "done" ? route.data : null}
              onSelect={select}
              lang={lang}
            >
              {profileFor && profileSlot
                ? createPortal(
                    <ElevationProfile
                      apiKey={API_KEY}
                      gateway={GATEWAY}
                      id="trail-profile"
                      line={profileFor}
                      lang={lang}
                      cache={profileCache}
                      onHover={setHover}
                      onProfile={(profile) => {
                        if (!fileActive && current) setMeasured({ id: current.id, stats: profile?.stats ?? null });
                      }}
                    />,
                    profileSlot,
                  )
                : null}
              {showDirections && !fileActive ? <OriginSearch target={geocoderTarget} onOrigin={setOrigin} lang={lang} /> : null}
              {showDirections && route.status === "done" && route.data.steps?.length && stepsTarget
                ? createPortal(<RouteSteps steps={route.data.steps} coordinates={route.data.geometry.coordinates as [number, number][]} lang={lang} />, stepsTarget)
                : null}
            </TrailsMap>
          ) : (
            <MissingKey lang={lang} />
          )}
        </main>
      </div>
    </div>
  );
}
