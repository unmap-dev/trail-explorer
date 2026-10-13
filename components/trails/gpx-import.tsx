"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { AlertCircleIcon, FileUpIcon, MountainIcon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDistance as formatLength } from "@/components/ui/elevation-profile";
import { format, formatNumber, type Lang } from "@/lib/kit/i18n";
import { GpxError, MAX_GPX_BYTES, parseGpx, type GpxTrack } from "@/lib/gpx";
import { TEXT } from "@/lib/text";

/**
 * Open a GPX file and see it on the map, labelled "Your file". It is read here, in the browser,
 * and sent nowhere; the elevation profile is only fetched when asked, and then only the points it
 * samples go to Unmap Elevation. A file that does not validate is refused with the reason.
 */
export function GpxImport({
  track,
  active,
  lang,
  canProfile,
  profileRequested,
  onLoad,
  onRemove,
  onShow,
  onProfile,
  children,
}: {
  track: GpxTrack | null;
  active: boolean;
  lang: Lang;
  canProfile: boolean;
  profileRequested: boolean;
  onLoad: (track: GpxTrack) => void;
  onRemove: () => void;
  onShow: () => void;
  onProfile: () => void;
  children?: ReactNode;
}) {
  const t = TEXT[lang];
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<{ code: keyof typeof t.gpxErrors; where?: string } | null>(null);

  const open = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_GPX_BYTES) return setError({ code: "too-large" });
    try {
      onLoad(parseGpx(await file.text()));
    } catch (caught) {
      setError(caught instanceof GpxError ? { code: caught.code, where: caught.where } : { code: "read" });
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2" data-gpx="">
      <h2 id={`${id}-title`} className="text-sm font-medium">
        {t.gpxTitle}
      </h2>
      {track ? (
        <Card size="sm" data-gpx-track="">
          <CardContent className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t.gpxYourFile}</Badge>
            <span className="min-w-0 flex-1 truncate font-medium">{track.name ?? t.gpxUnnamed}</span>
            <Button variant="ghost" size="icon-sm" aria-label={t.gpxRemove} onClick={onRemove}>
              <Trash2Icon />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {format(t.gpxSummary, { distance: formatLength(track.metres, lang), points: formatNumber(track.points, lang) })}
            {track.waypoints.length ? ` · ${track.waypoints.length === 1 ? t.gpxWaypointsOne : format(t.gpxWaypoints, { n: track.waypoints.length })}` : ""}
          </p>
          {!active ? (
            <Button size="sm" variant="outline" className="self-start" onClick={onShow}>
              {t.gpxShow}
            </Button>
          ) : track.lines.length && canProfile && !profileRequested ? (
            <div className="flex flex-col gap-1">
              <Button size="sm" variant="outline" className="self-start" onClick={onProfile}>
                <MountainIcon />
                {t.gpxProfile}
              </Button>
              <p className="text-xs text-muted-foreground">{t.gpxProfileNote}</p>
            </div>
          ) : null}
          {active ? children : null}
          </CardContent>
        </Card>
      ) : (
        <p className="text-xs text-muted-foreground">{t.gpxIntro}</p>
      )}
      {/* The browser's own file control reads "Choose File / No file chosen" in the OS language;
          a Button opens it instead, so the section speaks the page's language and looks like it. */}
      <input ref={input} id={`${id}-file`} type="file" accept=".gpx,application/gpx+xml" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void open(e.currentTarget)} data-gpx-input="" />
      <Button variant="outline" size="sm" className="self-start" onClick={() => input.current?.click()}>
        <FileUpIcon />
        {track ? t.gpxReplace : t.gpxChoose}
      </Button>
      {error ? (
        <Alert variant="destructive" data-gpx-error={error.code}>
          <AlertCircleIcon />
          <AlertDescription>{format(t.gpxErrors[error.code], { where: error.where ?? "" })}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
