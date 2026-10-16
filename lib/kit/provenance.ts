import type { Text } from "./i18n";

/**
 * Where something on screen comes from. Every app labels what is not a live unmap response where
 * it is seen (spec §2.5, §11): sample business data, simulated state, or a third-party dataset.
 */
export type ProvenanceKind = "live" | "sample" | "simulated" | "dataset";

export interface Provenance {
  kind: ProvenanceKind;
  /** What it is, e.g. "Store names, hours and services". */
  label: Text;
  /** Who publishes it, for `dataset`. */
  source?: string;
  /** Licence name, e.g. "Open Government Licence – Canada". */
  licence?: string;
  /** The attribution line the licence asks for. */
  attribution?: string;
  url?: string;
}

/** One unmap service an app uses, for the "Built with Unmap" panel. */
export interface ServiceUse {
  /** The service, e.g. "Routing". */
  name: string;
  /** What it does in this app, in both languages. */
  role: Text;
  /** The SDK calls the app makes, as they appear in its source. */
  calls: string[];
  /** The service's docs page. */
  docs: string;
}

/** What an app tells its "Built with Unmap" panel and header. */
export interface AppManifest {
  slug: string;
  name: Text;
  tagline: Text;
  services: ServiceUse[];
  /** Registry items on screen, by registry.json name. */
  items: string[];
  /** Everything on screen that is not a live unmap response. */
  provenance: Provenance[];
  /** The app's public source repository. */
  source: string;
}
