import type { Lang } from "./i18n";

/** What went wrong, in terms a demo can act on. */
export type ApiProblemKind = "key" | "addon" | "bad-request" | "not-found" | "coverage" | "rate" | "unavailable" | "network" | "unknown";

export interface ApiProblem {
  kind: ApiProblemKind;
  /** HTTP status, 0 when the request never got an answer. */
  status: number;
  title: string;
  detail: string;
  /** Whether trying again later could succeed. */
  retryable: boolean;
}

const TEXT: Record<ApiProblemKind, Record<Lang, [string, string]>> = {
  key: {
    en: ["The API key was refused", "This key is missing, revoked or not allowed on this site. Check NEXT_PUBLIC_UNMAP_KEY and the key's allowed origins."],
    fr: ["La clé d'API a été refusée", "Cette clé est absente, révoquée ou non autorisée sur ce site. Vérifiez NEXT_PUBLIC_UNMAP_KEY et les origines permises de la clé."],
  },
  addon: {
    en: ["This needs an add-on", "The key does not include the add-on this data belongs to."],
    fr: ["Un module complémentaire est requis", "La clé n'inclut pas le module complémentaire dont relèvent ces données."],
  },
  "bad-request": {
    en: ["The request was not accepted", "The API rejected the request as sent."],
    fr: ["La requête n'a pas été acceptée", "L'API a refusé la requête telle qu'envoyée."],
  },
  "not-found": {
    en: ["Not found", "The API has nothing at that address."],
    fr: ["Introuvable", "L'API n'a rien à cette adresse."],
  },
  coverage: {
    en: ["Outside coverage", "This place or trip is outside what the API covers. Routing and search cover Canada."],
    fr: ["Hors couverture", "Ce lieu ou ce trajet est hors de la couverture de l'API. L'itinéraire et la recherche couvrent le Canada."],
  },
  rate: {
    en: ["Too many requests", "The rate limit was reached. Try again in a moment."],
    fr: ["Trop de requêtes", "La limite de débit est atteinte. Réessayez dans un instant."],
  },
  unavailable: {
    en: ["Service unavailable", "The service did not answer. Try again in a moment."],
    fr: ["Service indisponible", "Le service n'a pas répondu. Réessayez dans un instant."],
  },
  network: {
    en: ["No connection", "The request did not reach the API. Check your connection."],
    fr: ["Aucune connexion", "La requête n'a pas atteint l'API. Vérifiez votre connexion."],
  },
  unknown: {
    en: ["Something went wrong", "The API call failed."],
    fr: ["Une erreur est survenue", "L'appel à l'API a échoué."],
  },
};

function kindOf(status: number, code: string | undefined): ApiProblemKind {
  if (status === 0) return "network";
  if (status === 401) return "key";
  if (status === 403) return code && /addon|add_on|entitle/i.test(code) ? "addon" : "key";
  if (status === 404) return "not-found";
  if (status === 422 || code === "outside_coverage") return "coverage";
  if (status === 429) return "rate";
  if (status >= 500) return "unavailable";
  if (status >= 400) return "bad-request";
  return "unknown";
}

/**
 * An SDK error (or anything thrown) as a problem a demo can show: the gateway's own message as the
 * detail when it sent one, a sentence in the reader's language otherwise. Never invents a result.
 */
export function describeError(error: unknown, lang: Lang): ApiProblem {
  const e = (error && typeof error === "object" ? error : {}) as { status?: unknown; code?: unknown; message?: unknown; name?: unknown };
  const aborted = e.name === "AbortError";
  const status = typeof e.status === "number" ? e.status : aborted ? 0 : error instanceof TypeError ? 0 : -1;
  const code = typeof e.code === "string" ? e.code : undefined;
  const kind = status === -1 ? "unknown" : kindOf(status, code);
  const [title, fallback] = TEXT[kind][lang];
  const message = typeof e.message === "string" && e.message.trim() && status > 0 ? e.message.trim() : "";
  return {
    kind,
    status: Math.max(status, 0),
    title,
    // The gateway's message is English; in French the sentence leads and the API's words follow.
    detail: message ? (lang === "fr" ? `${fallback} (${message})` : message) : fallback,
    retryable: status === 0 || status === 429 || status === 502 || status === 503,
  };
}

/** Whether an error is only a cancelled request, which a demo ignores rather than shows. */
export function isAbort(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError";
}
