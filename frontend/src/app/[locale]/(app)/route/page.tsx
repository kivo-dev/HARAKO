import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { RouteView } from "@/components/map/RouteView";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense fallback={null}>
      <RouteView />
    </Suspense>
  );
}
