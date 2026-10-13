"use client";

import { useCallback, useEffect, useState } from "react";
import { resolveLang, type Lang } from "./i18n";

/**
 * The page's language, kept in `?lang=` so a shared link opens in the language it was shared in.
 * Starts in English on the server and settles on the reader's choice after mount, which is what a
 * static export can do without a flash of the wrong language on every load.
 */
export function useLang(): [Lang, (lang: Lang) => void] {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const initial = resolveLang(window.location.search, navigator.languages ?? []);
    // Reading the URL is a subscription to an external store that only exists after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLangState(initial);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "fr" ? "fr-CA" : "en-CA";
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    const url = new URL(window.location.href);
    if (next === "en") url.searchParams.delete("lang");
    else url.searchParams.set("lang", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  return [lang, setLang];
}

/**
 * The tab title, kept in the page's language. Next mounts the layout's metadata `<title>` in a
 * later commit than a demo's first effects, which writes the English title back over a French
 * one, so the title is put back whenever the head changes for as long as the page is open.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}
