import { cn } from "@/lib/utils";

/** Parks Canada's summer scale: Easy, Moderate, Difficult, Most difficult. */
const SCALE = 4;

/**
 * A rating as its words with its place on the scale beside it: filled pips, not a colour, so it
 * reads in any theme and without colour vision. The words carry the meaning; the pips are for the
 * eye scanning a list, and are hidden from screen readers.
 */
export function DifficultyLevel({ label, level, className }: { label: string; level: number | null; className?: string }) {
  const steps = level && level > 0 ? Math.max(SCALE, level) : 0;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} data-difficulty-level={level ?? undefined}>
      {steps ? (
        <span aria-hidden="true" className="inline-flex gap-0.5">
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} className={cn("size-1.5 rounded-full", i < level! ? "bg-foreground" : "bg-foreground/15")} />
          ))}
        </span>
      ) : null}
      <span>{label}</span>
    </span>
  );
}
