// Runs before `vite dev` and `vite build` (predev/prebuild hooks); writes public/sitemap.xml and public/robots.txt.
import { writeFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = (process.env.VITE_SITE_URL || "https://il-bel-paese.lovable.app").replace(/\/$/, "");
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

const staticEntries: SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/mappatura", changefreq: "weekly", priority: "0.9" },
  { path: "/la-rete", changefreq: "weekly", priority: "0.8" },
  { path: "/bollettino", changefreq: "weekly", priority: "0.8" },
  { path: "/cosa-facciamo", changefreq: "monthly", priority: "0.7" },
  { path: "/la-vostra-voce", changefreq: "monthly", priority: "0.6" },
  { path: "/segnala-realta", changefreq: "monthly", priority: "0.6" },
  { path: "/contatti", changefreq: "monthly", priority: "0.5" },
  { path: "/privacy", changefreq: "yearly", priority: "0.3" },
  { path: "/cookie-policy", changefreq: "yearly", priority: "0.3" },
  { path: "/termini", changefreq: "yearly", priority: "0.3" },
];


async function fetchDynamicEntries(): Promise<SitemapEntry[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("[sitemap] Supabase env missing — skipping dynamic entries");
    return [];
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const entries: SitemapEntry[] = [];

  const { data: realities } = await supabase
    .from("realities")
    .select("id, updated_at")
    .limit(5000);
  realities?.forEach((r: { id: string; updated_at?: string }) => {
    entries.push({
      path: `/realta/${r.id}`,
      lastmod: r.updated_at?.slice(0, 10),
      changefreq: "monthly",
      priority: "0.6",
    });
  });

  const { data: posts } = await supabase
    .from("blog_posts")
    .select("slug, published_at")
    .not("published_at", "is", null)
    .limit(5000);
  posts?.forEach((p: { slug: string; published_at?: string }) => {
    entries.push({
      path: `/bollettino/${p.slug}`,
      lastmod: p.published_at?.slice(0, 10),
      changefreq: "monthly",
      priority: "0.6",
    });
  });

  const { data: authors } = await supabase
    .from("profiles")
    .select("user_id, updated_at")
    .eq("consent_public", true)
    .limit(5000);
  authors?.forEach((a: { user_id: string; updated_at?: string }) => {
    entries.push({
      path: `/autori/${a.user_id}`,
      lastmod: a.updated_at?.slice(0, 10),
      changefreq: "monthly",
      priority: "0.5",
    });
  });

  return entries;
}


function generate(entries: SitemapEntry[]) {
  const urls = entries.map((e) =>
    [
      `  <url>`,
      `    <loc>${BASE_URL}${e.path}</loc>`,
      e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
      e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
      e.priority ? `    <priority>${e.priority}</priority>` : null,
      `  </url>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n");
}

const robots = [
  "User-agent: *",
  "Allow: /",
  "Disallow: /area-personale",
  "Disallow: /login",
  "Disallow: /password-dimenticata",
  "Disallow: /reset-password",
  "",
  `Sitemap: ${BASE_URL}/sitemap.xml`,
  "",
].join("\n");

(async () => {
  writeFileSync(resolve("public/robots.txt"), robots);
  try {
    const dynamic = await fetchDynamicEntries();
    const all = [...staticEntries, ...dynamic];
    writeFileSync(resolve("public/sitemap.xml"), generate(all));
    console.log(`sitemap.xml written (${all.length} entries)`);
  } catch (err) {
    console.error("[sitemap] generation failed:", err);
    writeFileSync(resolve("public/sitemap.xml"), generate(staticEntries));
  }
})();
