"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { copyText } from "./clipboard";

/** A read-only command with a copy button, e.g. `npx @unmap/cli add map`. */
export function CopyCommand({ command, label, copyLabel, copiedLabel }: { command: string; label: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <InputGroup>
      <InputGroupInput readOnly value={command} aria-label={label} className="font-mono text-xs" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={copied ? copiedLabel : `${copyLabel}: ${label}`}
          onClick={async () => {
            if (await copyText(command)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
