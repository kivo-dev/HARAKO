import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { MapView } from "@/components/map/MapView";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense fallback={null}>
      <MapView />
    </Suspense>
  );
}
