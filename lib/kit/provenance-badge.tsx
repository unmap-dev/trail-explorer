"use client";

import { Badge } from "@/components/ui/badge";
import type { Lang } from "./i18n";
import type { ProvenanceKind } from "./provenance";
import { KIT_TEXT } from "./strings";

/**
 * A label for where something comes from, placed next to it: "Sample data", "Simulated",
 * "Open dataset". Live unmap responses carry no badge unless `showLive` is set.
 */
export function ProvenanceBadge({ kind, lang, title, showLive = false }: { kind: ProvenanceKind; lang: Lang; title?: string; showLive?: boolean }) {
  if (kind === "live" && !showLive) return null;
  const t = KIT_TEXT[lang];
  const label = kind === "sample" ? t.sample : kind === "simulated" ? t.simulated : kind === "dataset" ? t.dataset : t.live;
  return (
    <Badge variant={kind === "live" ? "secondary" : "outline"} title={title} data-provenance={kind}>
      {label}
    </Badge>
  );
}
