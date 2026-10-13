"use client";

import { useState, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, ExternalLinkIcon, LinkIcon, XIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatDistance as formatLength, type ProfileStats } from "@/components/ui/elevation-profile";
import { Separator } from "@/components/ui/separator";
import { copyText } from "@/lib/kit/clipboard";
import { format, formatNumber, type Lang } from "@/lib/kit/i18n";
import { ProvenanceBadge } from "@/lib/kit/provenance-badge";
import { FIELD_LABELS, TEXT } from "@/lib/text";
import { difficultyText, trailName, type Trail } from "@/lib/trails";
import { DifficultyLevel } from "./difficulty";

const coord = (n: number) => n.toFixed(5);

/**
 * The climb the profile measured for a trail whose data carries none: `undefined` while it loads,
 * `null` when there is no measurement (no key, or the profile failed).
 */
export type LiveClimb = ProfileStats | null | undefined;

/** One of the three figures across the top: a small label over the value. */
function Figure({ label, children, stat }: { label: string; children: ReactNode; stat: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-medium tabular-nums" data-stat={stat}>
        {children}
      </dd>
    </div>
  );
}

/**
 * A published attribute's values for display: in the source's own order, "None" left out when the
 * trail has something else (a bridge on one segment is the news), widths as a range in metres.
 */
function factValues(field: string, values: string[], lang: Lang): string[] {
  const unit = FIELD_LABELS[field]?.unit;
  if (unit && values.every((v) => Number.isFinite(Number(v)))) {
    const n = values.map(Number).sort((a, b) => a - b);
    const lo = formatNumber(n[0]!, lang);
    const hi = formatNumber(n[n.length - 1]!, lang);
    return [`${lo === hi ? lo : `${lo}–${hi}`} ${unit}`];
  }
  const some = values.filter((v) => !/^(none|aucun)$/i.test(v.trim()));
  return some.length ? some : values;
}

/**
 * A chosen trail: the three figures a hiker decides on, its actions and the road directions they
 * open, the conditions the source publishes, a slot for the live elevation profile (`children`),
 * how each number was worked out (folded away), and where it all came from.
 */
export function TrailDetails({
  trail,
  lang,
  onClose,
  actions,
  directions,
  liveClimb = null,
  children,
}: {
  trail: Trail;
  lang: Lang;
  onClose: () => void;
  actions?: ReactNode;
  /** Opened by an action, so shown right under the actions rather than below the profile. */
  directions?: ReactNode;
  liveClimb?: LiveClimb;
  children?: ReactNode;
}) {
  const t = TEXT[lang];
  const [copied, setCopied] = useState(false);
  const name = trailName(trail, lang);
  const other = lang === "fr" ? (trail.nameFr ? trail.name : null) : trail.nameFr;
  // The stored climb when the data has one; otherwise the one the live profile measured.
  const e = trail.elevation ?? liveClimb;
  const [lng, lat] = trail.trailhead.coordinates;
  const info = trail.moreInfo ? (lang === "fr" ? trail.moreInfo.fr ?? trail.moreInfo.en : trail.moreInfo.en ?? trail.moreInfo.fr) : undefined;
  const known = Object.keys(FIELD_LABELS).filter((f) => trail.published[f]);
  const facts = [...known, ...Object.keys(trail.published).filter((f) => !FIELD_LABELS[f])];
  const share = async () => {
    if (await copyText(window.location.href)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <Card size="sm" data-trail-details={trail.id}>
      <CardHeader>
        <CardTitle className="text-base">{name}</CardTitle>
        {other || trail.area ? <CardDescription>{[other, trail.area].filter(Boolean).join(" · ")}</CardDescription> : null}
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label={t.close} onClick={onClose}>
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-3 gap-3" data-trail-stats="">
          <Figure label={t.length} stat="length">
            {formatLength(trail.length.metres, lang)}
          </Figure>
          <Figure label={t.climb} stat="climb">
            {e ? (
              <>
                {format(t.rowGain, { gain: formatNumber(e.gain, lang) })}{" "}
                <span className="block text-xs font-normal whitespace-nowrap text-muted-foreground">{format(t.lossValue, { loss: formatNumber(e.loss, lang) })}</span>
              </>
            ) : (
              <span className="text-sm font-normal text-muted-foreground">{liveClimb === undefined ? t.measuring : t.notSampled}</span>
            )}
          </Figure>
          <Figure label={t.difficulty} stat="difficulty">
            {trail.difficulty ? (
              <DifficultyLevel label={difficultyText(trail.difficulty, lang)} level={trail.difficulty.level} />
            ) : (
              <span className="text-sm font-normal text-muted-foreground">{t.notInSource}</span>
            )}
          </Figure>
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <Button size="sm" variant="outline" onClick={share} aria-live="polite">
            {copied ? <CheckIcon /> : <LinkIcon />}
            {copied ? t.shared : t.share}
          </Button>
          {info ? (
            <a href={info} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "link", size: "sm" })}>
              {t.moreInfo}
              <ExternalLinkIcon />
            </a>
          ) : null}
        </div>
        {directions}
        <section aria-label={t.facts} className="flex flex-col gap-1.5" data-trail-facts="">
          <h3 className="text-xs font-medium text-muted-foreground">{t.facts}</h3>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5">
            {facts.map((field) => (
              <div key={field} className="contents" data-fact={field}>
                <dt className="text-muted-foreground">{FIELD_LABELS[field]?.[lang] ?? field}</dt>
                <dd className="flex flex-col">
                  {factValues(field, trail.published[field]![lang], lang).map((v) => (
                    <span key={v}>{v}</span>
                  ))}
                </dd>
              </div>
            ))}
            <dt className="text-muted-foreground">{t.trailhead}</dt>
            <dd className="font-mono text-xs leading-5 tabular-nums" data-stat="trailhead">
              {coord(lat)}, {coord(lng)}
            </dd>
          </dl>
        </section>
        {children}
        <Separator />
        <Collapsible className="flex flex-col gap-2" data-methods="">
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="group/method -mx-2 self-start" />}>
            {t.methodToggle}
            <ChevronDownIcon className="transition-transform group-data-[panel-open]/method:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">{t.length}:</span> {trail.length.method}
            </p>
            <p>
              <span className="font-medium text-foreground">{t.climb}:</span> {trail.elevation ? trail.elevation.method : liveClimb ? t.climbLive : trail.elevationNote ?? t.notSampled}
            </p>
            <p>
              <span className="font-medium text-foreground">{t.difficulty}:</span>{" "}
              {[trail.difficulty?.source, trail.difficultyNote].filter(Boolean).join(". ") || t.notInSource}
            </p>
            <p>
              <span className="font-medium text-foreground">{t.trailhead}:</span> {trail.trailhead.method}
            </p>
            {facts.length ? (
              <p>
                <span className="font-medium text-foreground">{t.facts}:</span> {t.factsMethod}
              </p>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-trail-source="">
          <ProvenanceBadge kind="dataset" lang={lang} title={trail.attribution} />
          <span>
            <a href={trail.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              {trail.source}
            </a>{" "}
            · {trail.licence} · {trail.retrievedAt.slice(0, 10)}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
