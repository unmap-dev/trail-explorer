/**
 * Where an app talks to, and with which key. Read from the environment at build time:
 *
 *   NEXT_PUBLIC_UNMAP_KEY      your browser key (um_live_… or um_test_…), required
 *   NEXT_PUBLIC_UNMAP_GATEWAY  optional, defaults to https://api.unmap.dev
 *   NEXT_PUBLIC_BASE_PATH      optional, the path the app is served under (set by apps/apps-host)
 *
 * The key ships in the browser bundle, so it should be a browser key restricted to your origins in
 * the unmap dashboard. There is no fallback key: an app without one shows how to get one.
 */
export const GATEWAY = (process.env.NEXT_PUBLIC_UNMAP_GATEWAY || "https://api.unmap.dev").replace(/\/+$/, "");

export const API_KEY = process.env.NEXT_PUBLIC_UNMAP_KEY || "";

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** Where a visitor gets their own free key. */
export const SIGNUP_URL = "https://unmap.dev/signin";

/** The docs root every API link hangs off. */
export const DOCS_URL = "https://unmap.dev/docs";

/** Where a team that wants this built for them writes to. */
export const CONTACT_URL = "mailto:hello@unmap.dev";
