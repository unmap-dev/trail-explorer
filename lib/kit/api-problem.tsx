"use client";

import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describeError } from "./errors";
import type { Lang } from "./i18n";
import { KIT_TEXT } from "./strings";

/**
 * An API failure, said plainly where the result would have been: what went wrong in the reader's
 * language, the gateway's own message, and a retry when trying again could help. Never a made-up
 * result in its place.
 */
export function ApiProblemAlert({ error, lang, onRetry, className }: { error: unknown; lang: Lang; onRetry?: () => void; className?: string }) {
  const problem = describeError(error, lang);
  return (
    <Alert variant="destructive" className={className} data-problem={problem.kind}>
      <AlertCircleIcon />
      <AlertTitle>{problem.title}</AlertTitle>
      <AlertDescription>{problem.detail}</AlertDescription>
      {onRetry && problem.retryable ? (
        <AlertAction>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {KIT_TEXT[lang].retry}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
