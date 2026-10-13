"use client";

import type { ReactNode } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BuiltWith } from "./built-with";
import { format, LANGS, type Lang } from "./i18n";
import type { DemoManifest } from "./provenance";
import { ProvenanceBadge } from "./provenance-badge";
import { KIT_TEXT } from "./strings";
import { useDocumentTitle } from "./use-lang";

/**
 * The bar across the top of every demo: its name and tagline, a badge for each kind of non-live
 * data on screen, the demo's own controls (`actions`), the language switch and the
 * "Built with Unmap" panel. It also keeps the tab title in the page's language.
 */
export function DemoHeader({ manifest, lang, onLang, actions }: { manifest: DemoManifest; lang: Lang; onLang: (lang: Lang) => void; actions?: ReactNode }) {
  useDocumentTitle(format(KIT_TEXT[lang].pageTitle, { name: manifest.name[lang] }));
  const kinds = [...new Set(manifest.provenance.map((p) => p.kind).filter((k) => k !== "live"))];
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
      {/* Shrinks (and truncates) before the controls wrap; wraps only below 12rem. */}
      <div className="flex min-w-0 flex-1 basis-48 flex-col">
        <h1 className="truncate text-sm font-semibold">{manifest.name[lang]}</h1>
        <p className="truncate text-xs text-muted-foreground max-sm:hidden">{manifest.tagline[lang]}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((kind) => (
          <ProvenanceBadge key={kind} kind={kind} lang={lang} />
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {actions}
        <ToggleGroup variant="outline" size="sm" spacing={0} value={[lang]} onValueChange={(v) => v[0] && onLang(v[0] as Lang)} aria-label={KIT_TEXT[lang].language}>
          {LANGS.map((l) => (
            <ToggleGroupItem key={l} value={l} aria-label={l === "en" ? "English" : "Français"}>
              {l.toUpperCase()}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <BuiltWith manifest={manifest} lang={lang} />
      </div>
    </header>
  );
}
