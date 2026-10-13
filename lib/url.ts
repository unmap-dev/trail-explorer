/**
 * The shareable link: `?trail=<id>` opens on that trail; other keys (such as `lang`) are kept.
 * Pure functions; the app owns history. Unit-tested in test/url.test.ts.
 */

const ID = /^[a-z0-9-]{1,80}$/;

export function parseTrail(search: string): string | null {
  const id = new URLSearchParams(search).get("trail");
  return id && ID.test(id) ? id : null;
}

export function writeTrail(search: string, id: string | null): string {
  const q = new URLSearchParams(search);
  if (id) q.set("trail", id);
  else q.delete("trail");
  const s = q.toString();
  return s ? `?${s}` : "";
}
