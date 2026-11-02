import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import SEO from "@/components/SEO";
import { SITE_URL } from "@/lib/site";
import CountUp from "@/components/CountUp";
import DroneHero from "@/components/home/DroneHero";
import Marquee from "@/components/home/Marquee";

import { supabase } from "@/integrations/supabase/client";


const Index = () => {
  const { t } = useTranslation();

  const { data: liveStats } = useQuery({
    queryKey: ["home-stats"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_public_stats");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        mapped: row?.mapped ?? 0,
        regions: row?.regions ?? 0,
        members: row?.members ?? 0,
        articles: row?.articles ?? 0,
      };
    },
  });

  const { data: latest } = useQuery({
    queryKey: ["home-latest-realities"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("realities")
        .select("name, city, region")
        .eq("confirmed_status", "confermato")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error || !data) return [] as { name: string; city: string; region: string }[];
      return data as { name: string; city: string; region: string }[];
    },
  });

  const features = [
    { num: "01", key: "mapping", link: "/mappatura", inverted: false },
    { num: "02", key: "community", link: "/la-rete", inverted: true },
    { num: "03", key: "stories",   link: "/racconti", inverted: false },
  ] as const;

  const stats = [
    { num: liveStats?.mapped ?? null, key: "mapped", color: "text-foreground" },
    { num: liveStats?.regions ?? null, key: "regions", color: "text-primary" },
    { num: liveStats?.members ?? null, key: "members", color: "text-foreground" },
    { num: liveStats?.articles ?? null, key: "articles", color: "text-secondary" },
  ] as const;

  const tickerItems = latest ?? [];

  return (
    <div className="bg-background">
      <SEO
        title="Il Bel Paese — Mappatura delle realtà artistiche italiane"
        description={t("home.lead")}
        canonicalPath="/"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Il Bel Paese",
          url: SITE_URL,
          description: t("home.lead"),
          inLanguage: "it-IT",
        }}
      />

      {/* ============ HERO — DRONE POV FULL BLEED ============ */}
      <DroneHero />

      {/* ============ MARQUEE FULL-WIDTH (fuori dal container, come navbar/footer) ============ */}
      <section className="hidden md:block w-full border-y-2 border-foreground bg-foreground text-background py-4">
        <Marquee speedSec={60}>
          {tickerItems.map((r, i) => (
            <span key={i} className="flex items-center gap-4 whitespace-nowrap">
              <span className="text-secondary text-2xl" aria-hidden>✦</span>
              <span className="text-xl md:text-2xl uppercase" style={{ fontVariationSettings: "'wght' 700", letterSpacing: "-0.01em" }}>
                {r.name}
              </span>
              <span className="micro-label text-background/60">
                {r.city} · {r.region}
              </span>
            </span>
          ))}
        </Marquee>
      </section>

      <div className="editorial-container py-10 md:py-16 space-y-12 md:space-y-20">


        {/* ============ FEATURES ============ */}
        <section>
          <div className="flex items-end justify-between mb-8 border-b-2 border-foreground pb-4">
            <h2 className="editorial-subheading">
              {t("home.sectionTitle")}{" "}
              <span className="text-primary">{t("home.sectionTitleAccent")}</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {features.map((f) => (
              <Link
                key={f.key}
                to={f.link}
                className={`brutalist-card p-8 flex flex-col gap-5 group ${
                  f.inverted ? "bg-primary text-primary-foreground" : "bg-card"
                }`}
              >
                <div className={`micro-label ${f.inverted ? "text-secondary" : "text-primary"}`}>
                  {f.num} //
                </div>
                <h3 className="text-2xl md:text-2xl lg:text-3xl xl:text-4xl uppercase leading-[0.95] tracking-tight break-words hyphens-auto" style={{ fontVariationSettings: "'wght' 700" }}>
                  {t(`home.features.${f.key}.title`)}
                </h3>
                <p className={`text-sm leading-relaxed ${f.inverted ? "text-primary-foreground/90" : "text-foreground/80"}`}>
                  {t(`home.features.${f.key}.desc`)}
                </p>
                <div className={`h-[2px] w-full ${f.inverted ? "bg-primary-foreground/30" : "bg-foreground"}`} />
                <div className="flex items-center justify-between">
                  <span className="micro-label">{t("home.discover")}</span>
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>
            ))}
          </div>
        </section>


        {/* ============ STATS ============ */}

        <section className="border-y-2 border-foreground py-10 md:py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((s) => (
              <div key={s.key} className="flex flex-col">
                <span
                  className={`text-4xl md:text-6xl leading-none ${s.color}`}
                  style={{ fontVariationSettings: "'wght' 700", letterSpacing: "-0.04em" }}
                >
                  <CountUp end={s.num} />
                </span>
                <span className="micro-label mt-3 text-muted-foreground">
                  {t(`home.stats.${s.key}`)}
                </span>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
};

export default Index;
