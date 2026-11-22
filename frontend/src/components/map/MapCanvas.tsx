"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { mapConfigured } from "@/lib/map/config";
import type { LatLng } from "@/lib/map/coords";
import type { MapMarker } from "./MapLibreMap";

/** MapLibre touches `window`, so it is loaded in the browser only. */
const Inner = dynamic(() => import("./MapLibreMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-white/60" aria-hidden />,
});

/** The Neshan map, or a clear message when it cannot be shown. Nothing else is ever drawn in its place. */
export function MapCanvas(props: {
  markers: MapMarker[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  line?: LatLng[] | null;
  label: string;
}) {
  const t = useTranslations("Map");
  const [failed, setFailed] = useState(false);
  if (!mapConfigured || failed) {
    return (
      <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-1 bg-white p-6 text-center">
        <p className="font-semibold">{mapConfigured ? t("mapError") : t("notConfigured")}</p>
        <p className="max-w-xs text-sm text-ink-500">{mapConfigured ? t("mapErrorHint") : t("notConfiguredHint")}</p>
      </div>
    );
  }
  return <Inner {...props} onError={() => setFailed(true)} />;
}
