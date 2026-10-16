"use client";

import { KeyRoundIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SIGNUP_URL } from "./config";
import type { Lang } from "./i18n";
import { KIT_TEXT } from "./strings";

/** What an app shows instead of calling the API when no key is configured. */
export function MissingKey({ lang }: { lang: Lang }) {
  const t = KIT_TEXT[lang];
  return (
    <Empty className="h-full" data-missing-key="">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRoundIcon />
        </EmptyMedia>
        <EmptyTitle>{t.missingKeyTitle}</EmptyTitle>
        <EmptyDescription>{t.missingKeyBody}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <a href={SIGNUP_URL} className={buttonVariants()}>
          {t.buildYourOwn}
        </a>
      </EmptyContent>
    </Empty>
  );
}
