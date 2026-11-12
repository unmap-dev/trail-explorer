"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, type Lang } from "./i18n";
import { KIT_TEXT } from "./strings";

const MODES = [
  { id: "system", icon: MonitorIcon },
  { id: "light", icon: SunIcon },
  { id: "dark", icon: MoonIcon },
] as const;

const noop = () => () => {};

/**
 * One button that cycles system → light → dark. Until it mounts it shows "system", which is what
 * the static HTML was rendered with, so hydration matches whatever the visitor has stored.
 */
export function ModeToggle({ lang }: { lang: Lang }) {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const t = KIT_TEXT[lang];
  const index = mounted ? Math.max(0, MODES.findIndex((m) => m.id === theme)) : 0;
  const current = MODES[index]!;
  const next = MODES[(index + 1) % MODES.length]!;
  const label = t[`mode_${current.id}`];
  const Icon = current.icon;
  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={format(t.modeSwitch, { current: label, next: t[`mode_${next.id}`].toLowerCase() })}
      title={label}
      onClick={() => setTheme(next.id)}
    >
      <Icon />
    </Button>
  );
}
