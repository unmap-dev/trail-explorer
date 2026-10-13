"use client";

import { useId, type ReactNode } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Lang } from "@/lib/kit/i18n";
import { isFiltered, NO_FILTERS, type DifficultyOption, type DistanceBucket, type Filters, type GainBucket } from "@/lib/filters";
import { TEXT } from "@/lib/text";

/** One filter: its name beside its choices, so the groups take a short row each. */
function Group({ legend, children, ...data }: { legend: string; children: ReactNode; "data-filter"?: string }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="grid grid-cols-[4.5rem_1fr] items-start gap-x-2" {...data}>
      <span id={id} className="pt-1 text-xs text-muted-foreground">
        {legend}
      </span>
      {children}
    </div>
  );
}

/**
 * Search and filters over the loaded trails. The climb and difficulty groups only appear when the
 * data carries those fields for at least one trail; a filter the data cannot answer is not shown.
 */
export function TrailFilters({ value, onChange, gain, difficulties, lang }: { value: Filters; onChange: (f: Filters) => void; gain: boolean; difficulties: DifficultyOption[]; lang: Lang }) {
  const t = TEXT[lang];
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-2.5" data-filters="">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput type="search" value={value.query} onChange={(e) => set({ query: e.target.value })} placeholder={t.searchPlaceholder} aria-label={t.searchLabel} />
      </InputGroup>
      <Group legend={t.distance}>
        <ToggleGroup multiple variant="outline" size="sm" value={value.distance} onValueChange={(v) => set({ distance: v as DistanceBucket[] })} aria-label={t.distance} className="flex-wrap">
          <ToggleGroupItem value="short" aria-label={t.distanceShort}>{t.distanceShortTag}</ToggleGroupItem>
          <ToggleGroupItem value="medium" aria-label={t.distanceMedium}>{t.distanceMediumTag}</ToggleGroupItem>
          <ToggleGroupItem value="long" aria-label={t.distanceLong}>{t.distanceLongTag}</ToggleGroupItem>
        </ToggleGroup>
      </Group>
      {gain ? (
        <Group legend={t.gain} data-filter="gain">
          <ToggleGroup multiple variant="outline" size="sm" value={value.gain} onValueChange={(v) => set({ gain: v as GainBucket[] })} aria-label={t.gain} className="flex-wrap">
            <ToggleGroupItem value="low" aria-label={t.gainLow}>{t.gainLowTag}</ToggleGroupItem>
            <ToggleGroupItem value="mid" aria-label={t.gainMid}>{t.gainMidTag}</ToggleGroupItem>
            <ToggleGroupItem value="high" aria-label={t.gainHigh}>{t.gainHighTag}</ToggleGroupItem>
          </ToggleGroup>
        </Group>
      ) : null}
      {difficulties.length ? (
        <Group legend={t.difficulty} data-filter="difficulty">
          <ToggleGroup multiple variant="outline" size="sm" value={value.difficulty} onValueChange={(v) => set({ difficulty: v as string[] })} aria-label={t.difficulty} className="flex-wrap">
            {difficulties.map((d) => (
              <ToggleGroupItem key={d.value} value={d.value}>
                {d.label[lang]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Group>
      ) : null}
      {isFiltered(value) ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => onChange(NO_FILTERS)}>
          {t.clearFilters}
        </Button>
      ) : null}
    </div>
  );
}
