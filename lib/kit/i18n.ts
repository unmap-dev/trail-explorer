/** The two languages every app ships in. */
export type Lang = "en" | "fr";

export const LANGS: readonly Lang[] = ["en", "fr"];

/** Text in both languages. */
export type Text = Record<Lang, string>;

/**
 * The language to start in: `?lang=` when it names one of ours, else the browser's first
 * preference by primary subtag (`fr-CA` is French), else English.
 */
export function resolveLang(search: string, preferred: readonly string[] = []): Lang {
  const asked = new URLSearchParams(search).get("lang");
  if (asked === "en" || asked === "fr") return asked;
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split("-")[0];
    if (primary === "fr") return "fr";
    if (primary === "en") return "en";
  }
  return "en";
}

/** `{name}` placeholders filled from `values`; an unknown placeholder is left as written. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

/** A number in the reader's locale (`1 234,5` in French). */
export function formatNumber(value: number, lang: Lang, digits = 0): string {
  return new Intl.NumberFormat(lang === "fr" ? "fr-CA" : "en-CA", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

/** Metres as `850 m` or `12.4 km`, in the reader's locale. */
export function formatDistance(metres: number, lang: Lang): string {
  if (metres < 950) return `${formatNumber(Math.round(metres / 10) * 10, lang)} m`;
  return `${formatNumber(metres / 1000, lang, metres < 9950 ? 1 : 0)} km`;
}

/** Seconds as `7 min` or `1 h 05` / `1 h 5 min`, in the reader's language. */
export function formatDuration(seconds: number, lang: Lang): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (lang === "fr") return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
