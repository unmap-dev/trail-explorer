"use client";

import { Button } from "@/components/ui/button";
import { formatDistance as formatLength } from "@/components/ui/elevation-profile";
import { format, formatNumber, type Lang } from "@/lib/kit/i18n";
import { TEXT } from "@/lib/text";
import { difficultyText, trailName, type Trail } from "@/lib/trails";
import { DifficultyLevel } from "./difficulty";

/** The trails as a list, in step with the map (one shared `selected` id). */
export function TrailList({ trails, selected, lang, onSelect }: { trails: readonly Trail[]; selected: string | null; lang: Lang; onSelect: (id: string) => void }) {
  const t = TEXT[lang];
  return (
    <ol aria-label={t.listLabel} className="flex flex-col">
      {trails.map((trail) => (
        <li key={trail.id} className="border-b last:border-b-0">
          <Button
            variant="ghost"
            aria-pressed={selected === trail.id}
            onClick={() => onSelect(trail.id)}
            data-trail-row={trail.id}
            className="flex h-auto w-full flex-col items-stretch gap-1 rounded-none px-3 py-2.5 text-left font-normal whitespace-normal aria-pressed:bg-muted"
          >
            <span className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 truncate font-medium">{trailName(trail, lang)}</span>
              {trail.difficulty ? <DifficultyLevel className="shrink-0 text-xs text-muted-foreground" label={difficultyText(trail.difficulty, lang)} level={trail.difficulty.level} /> : null}
            </span>
            {trail.area ? <span className="truncate text-xs text-muted-foreground">{trail.area}</span> : null}
            <span className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
              <span>{formatLength(trail.length.metres, lang)}</span>
              {trail.elevation ? <span>{format(t.rowGain, { gain: formatNumber(trail.elevation.gain, lang) })}</span> : null}
            </span>
          </Button>
        </li>
      ))}
    </ol>
  );
}
