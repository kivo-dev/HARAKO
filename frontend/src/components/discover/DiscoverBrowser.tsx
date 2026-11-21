"use client";

import { LayoutGrid, RefreshCw, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { apiEnabled } from "@/lib/api/config";
import { fetchPlaces } from "@/lib/api/client";
import { isAbort } from "@/lib/api/errors";
import { categoryIcons, categoryKeys, type CategoryKey, type Category, type Place } from "@/lib/places";
import { DiscoverHero } from "./DiscoverHero";
import { PlaceCard } from "./PlaceCard";
import { Suggestions } from "./Suggestions";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const asCategory = (v: string | null): CategoryKey | "all" =>
  v && (categoryKeys as readonly string[]).includes(v) ? (v as CategoryKey) : "all";

/**
 * Search + category filter. The URL (?q=&category=) is the single source of truth, so a refresh, the back
 * button and a shared link all give the same list. Results come from the backend; each new request cancels
 * the previous one and a request counter makes sure a slow old answer can never overwrite a newer one.
 * Failure is shown as an error with a retry button, never as "no results".
 */
export function DiscoverBrowser({
  places,
  categories,
  initialStatus,
}: {
  places: Place[];
  categories: Category[];
  initialStatus: "ok" | "sample" | "error";
}) {
  const t = useTranslations("Discover");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const urlQuery = (params.get("q") ?? "").trim();
  const category = asCategory(params.get("category"));

  const [text, setText] = useState(params.get("q") ?? "");
  const debounced = useDebounced(text.trim(), 350);

  // Keep the box in step when the URL changes from outside (back button, a chip, "reset").
  const lastPushed = useRef(urlQuery);
  useEffect(() => {
    if (urlQuery !== lastPushed.current) {
      lastPushed.current = urlQuery;
      setText(params.get("q") ?? "");
    }
  }, [urlQuery, params]);

  const setUrl = (next: { q?: string; category?: CategoryKey | "all" }) => {
    const q = next.q ?? urlQuery;
    const c = next.category ?? category;
    const query: Record<string, string> = {};
    if (q) query.q = q;
    if (c !== "all") query.category = c;
    lastPushed.current = q;
    router.replace({ pathname, query }, { scroll: false });
  };

  // typing -> URL (debounced)
  useEffect(() => {
    if (debounced !== urlQuery) setUrl({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const [remote, setRemote] = useState<Place[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [reloadKey, setReloadKey] = useState(0);
  const requestId = useRef(0);

  // What the server rendered is valid only for "no filter" and only if it really got data.
  const serverListUsable = initialStatus === "ok" && category === "all" && !urlQuery && reloadKey === 0;

  useEffect(() => {
    if (!apiEnabled || serverListUsable) {
      setRemote(null);
      setStatus("idle");
      return;
    }
    const id = ++requestId.current;
    const ctrl = new AbortController();
    setStatus("loading");
    fetchPlaces({ category: category === "all" ? undefined : category, q: urlQuery || undefined, signal: ctrl.signal })
      .then(({ items }) => {
        if (id !== requestId.current) return; // an older answer arrived late
        setRemote(items);
        setStatus("idle");
      })
      .catch((e: unknown) => {
        if (isAbort(e) || id !== requestId.current) return;
        setRemote(null);
        setStatus("error");
      });
    return () => ctrl.abort();
  }, [category, urlQuery, reloadKey, serverListUsable]);

  // No backend configured: filter the built-in samples on the device.
  const local = useMemo(() => {
    const q = urlQuery.toLowerCase();
    return places.filter(
      (p) =>
        (category === "all" || p.category === category) &&
        (!q || [p.name.fa, p.name.en, p.area.fa, p.area.en].some((s) => s.toLowerCase().includes(q))),
    );
  }, [places, urlQuery, category]);

  const filtered = category !== "all" || urlQuery !== "";
  const visible = apiEnabled && !serverListUsable ? (remote ?? []) : apiEnabled ? places : local;
  const loading = status === "loading";
  const failed = status === "error" || (apiEnabled && initialStatus === "error" && !filtered && reloadKey === 0);
  const sampleData = visible.some((p) => p.source === "sample");
  const reset = () => {
    setText("");
    lastPushed.current = "";
    router.replace({ pathname }, { scroll: false });
  };

  return (
    <div>
      <DiscoverHero chip={t("location")} title1={t("title1")} title2={t("title2")}>
        <div
          role="search"
          className="mt-4 flex items-center gap-3 rounded-2xl bg-white px-4 shadow-soft focus-within:ring-2 focus-within:ring-lime-500 md:max-w-xl"
        >
          <Search className="size-5 shrink-0 text-forest-800" aria-hidden />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchLabel")}
            className="h-14 w-full bg-transparent text-base outline-none placeholder:text-ink-400"
          />
        </div>
      </DiscoverHero>

      <div className="px-5 md:px-10">
        <div className="mx-auto max-w-7xl">
          <Suggestions fallback={places} sampleMode={!apiEnabled} />

          <div className="no-scrollbar -mx-5 mt-6 flex gap-2 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
            {["all", ...categories.map((item) => item.key)].map((key) => {
              const item = categories.find((categoryItem) => categoryItem.key === key);
              const Icon = key === "all" ? LayoutGrid : (categoryIcons[key as CategoryKey] ?? LayoutGrid);
              const active = category === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setUrl({ category: key as CategoryKey | "all" })}
                  className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-5 text-sm font-medium transition ${
                    active ? "bg-forest-950 text-white" : "bg-white text-ink-700 hover:bg-mist-50"
                  }`}
                >
                  <Icon className="size-4" aria-hidden />
                  {key === "all" ? t("all") : item?.title[locale as "fa" | "en"] ?? key}
                </button>
              );
            })}
          </div>

          <div className="mb-3 mt-6 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">{t("results")}</h2>
            <span className="text-sm text-ink-500" aria-live="polite">
              {loading ? t("loading") : failed ? "" : t("count", { count: visible.length })}
            </span>
          </div>

          {failed && !loading ? (
            <div role="alert" className="rounded-4xl bg-white p-8 text-center shadow-soft">
              <p className="font-semibold">{t("apiError")}</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-ink-500">{t("apiErrorHint")}</p>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-lime-400 px-6 text-sm font-semibold text-forest-950 transition hover:bg-lime-300"
              >
                <RefreshCw className="size-4" aria-hidden />
                {t("retry")}
              </button>
            </div>
          ) : loading ? (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="aspect-[5/6] animate-pulse rounded-4xl bg-white/70" />
              ))}
            </ul>
          ) : visible.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
              {visible.map((place) => (
                <li key={place.id}>
                  <PlaceCard place={place} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-4xl bg-white p-8 text-center shadow-soft">
              <p className="font-semibold">{t("empty")}</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-ink-500">{t("emptyHint")}</p>
              <button
                type="button"
                onClick={reset}
                className="mt-5 h-11 rounded-full bg-lime-400 px-6 text-sm font-semibold text-forest-950 transition hover:bg-lime-300"
              >
                {t("reset")}
              </button>
            </div>
          )}

          {sampleData && <p className="mt-6 text-center text-xs text-ink-500">{t("sampleNote")}</p>}
        </div>
      </div>
    </div>
  );
}
