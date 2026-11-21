import { setRequestLocale } from "next-intl/server";
import { OpportunitiesBrowser } from "@/components/discover/OpportunitiesBrowser";
import { getOpportunitiesResult } from "@/lib/api/places";

// Always fresh: an admin edit must show on the next visit.
export const dynamic = "force-dynamic";

export default async function OpportunitiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const result = await getOpportunitiesResult();
  return <OpportunitiesBrowser items={result.data} loadFailed={result.status === "error"} />;
}
