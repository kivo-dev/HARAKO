import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { DiscoverBrowser } from "@/components/discover/DiscoverBrowser";
import { getCategories, getPlacesResult } from "@/lib/api/places";

// Always fresh: a place edited in the admin panel must show on the next visit (no 5-minute cache).
export const dynamic = "force-dynamic";

export default async function DiscoverPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [result, categories] = await Promise.all([getPlacesResult(), getCategories()]);

  return (
    <Suspense fallback={null}>
      <DiscoverBrowser places={result.data} categories={categories} initialStatus={result.status} />
    </Suspense>
  );
}
