"use client";

import dynamic from "next/dynamic";

/** Leaflet touches `window`, so it is loaded in the browser only. */
export const MapCanvas = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-white/60" aria-hidden />,
});
