"use client";

import { BlocksIcon, ExternalLinkIcon, KeyRoundIcon, MessageCircleIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CONTACT_URL, SIGNUP_URL } from "./config";
import { CopyCommand } from "./copy-command";
import type { Lang } from "./i18n";
import type { DemoManifest } from "./provenance";
import { ProvenanceBadge } from "./provenance-badge";
import { KIT_TEXT } from "./strings";

const REGISTRY_DOCS = "https://unmap.dev/docs/frontend/components";

/**
 * The "Built with Unmap" panel (spec §10): which services the demo uses and what each contributes,
 * the SDK calls behind them, the registry components on screen with their install commands, every
 * non-live thing on screen with its source, and the way out to the code, a key and help. Kept in a
 * sheet so the app itself stays a clean customer-style interface.
 */
export function BuiltWith({ manifest, lang }: { manifest: DemoManifest; lang: Lang }) {
  const t = KIT_TEXT[lang];
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" size="sm" />}>
        <BlocksIcon />
        <span className="max-sm:sr-only">{t.builtWith}</span>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t.builtWithTitle}</SheetTitle>
          <SheetDescription>{t.builtWithIntro}</SheetDescription>
        </SheetHeader>

        <section aria-labelledby="built-with-services" className="flex flex-col gap-3 px-4">
          <h3 id="built-with-services" className="text-sm font-medium">{t.services}</h3>
          <ul className="flex flex-col gap-3">
            {manifest.services.map((service) => (
              <li key={service.name} className="flex flex-col gap-1 text-sm">
                <a href={service.docs} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
                  {service.name}
                  <ExternalLinkIcon className="size-3.5" aria-hidden />
                </a>
                <p className="text-muted-foreground">{service.role[lang]}</p>
                <ul aria-label={`${t.calls}: ${service.name}`} className="flex flex-col gap-0.5">
                  {service.calls.map((call) => (
                    <li key={call}>
                      <code className="font-mono text-xs">{call}</code>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>

        {manifest.items.length ? (
          <>
            <Separator />
            <section aria-labelledby="built-with-items" className="flex flex-col gap-3 px-4">
              <h3 id="built-with-items" className="text-sm font-medium">{t.components}</h3>
              <p className="text-sm text-muted-foreground">{t.componentsIntro}</p>
              <ul className="flex flex-col gap-3">
                {manifest.items.map((item) => (
                  <li key={item} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <code className="font-mono text-sm">{item}</code>
                      <a href={REGISTRY_DOCS} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "link", size: "sm" })}>
                        {t.reference}
                      </a>
                    </div>
                    <CopyCommand command={`npx @unmap/cli add ${item}`} label={item} copyLabel={t.copy} copiedLabel={t.copied} />
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}

        {manifest.provenance.length ? (
          <>
            <Separator />
            <section aria-labelledby="built-with-data" className="flex flex-col gap-3 px-4">
              <h3 id="built-with-data" className="text-sm font-medium">{t.dataOnScreen}</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {manifest.provenance.map((p) => (
                  <li key={p.label.en} className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <ProvenanceBadge kind={p.kind} lang={lang} showLive />
                      {p.label[lang]}
                    </span>
                    {p.attribution || p.source ? (
                      <span className="text-xs text-muted-foreground">
                        {[p.source, p.licence, p.attribution].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}

        <SheetFooter>
          <a href={manifest.source} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
            <ExternalLinkIcon />
            {t.source}
          </a>
          <a href={SIGNUP_URL} className={buttonVariants()}>
            <KeyRoundIcon />
            {t.buildYourOwn}
          </a>
          <a href={CONTACT_URL} className={buttonVariants({ variant: "link" })}>
            <MessageCircleIcon />
            {t.needHelp}
          </a>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
