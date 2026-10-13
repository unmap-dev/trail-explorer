"use client";

import dynamic from "next/dynamic";

// The map needs a browser, so the app renders on the client only; the shell paints first.
const Trails = dynamic(() => import("@/components/trails/client-entry"), {
  ssr: false,
  loading: () => <div className="h-dvh w-full bg-muted" aria-busy="true" aria-label="Loading" />,
});

export default function Page() {
  return <Trails />;
}
