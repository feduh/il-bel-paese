import { useEffect } from "react";
import { SITE_URL } from "@/lib/site";

type SEOProps = {
  title: string;
  description?: string;
  image?: string;
  type?: "website" | "article" | "profile";
  canonicalPath?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
};

const SITE_NAME = "Il Bel Paese";
const DEFAULT_IMAGE = `${SITE_URL}/og-default.jpg`;
const JSONLD_ID = "ibp-jsonld";

const upsertMeta = (selector: string, attrName: "name" | "property", attrValue: string, content: string) => {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attrName, attrValue);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
};

const upsertCanonical = (href: string) => {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
};

const SEO = ({ title, description, image, type = "website", canonicalPath, jsonLd }: SEOProps) => {
  useEffect(() => {
    const suffix = ` — ${SITE_NAME}`;
    const MAX = 60;
    let trimmedTitle: string;
    if (title.includes(SITE_NAME)) {
      trimmedTitle = title.length > MAX ? title.slice(0, MAX - 1).trimEnd() + "…" : title;
    } else if (title.length + suffix.length <= MAX) {
      trimmedTitle = `${title}${suffix}`;
    } else {
      const room = MAX - suffix.length - 1; // 1 char for ellipsis
      trimmedTitle = `${title.slice(0, room).trimEnd()}…${suffix}`;
    }

    const desc = (description ?? "Mappatura delle realtà artistiche italiane indipendenti.").slice(0, 160);
    const path = canonicalPath ?? (typeof window !== "undefined" ? window.location.pathname : "/");
    const url = `${SITE_URL}${path}`;
    const img = image ?? DEFAULT_IMAGE;

    document.title = trimmedTitle;
    upsertMeta('meta[name="description"]', "name", "description", desc);
    upsertCanonical(url);

    upsertMeta('meta[property="og:title"]', "property", "og:title", trimmedTitle);
    upsertMeta('meta[property="og:description"]', "property", "og:description", desc);
    upsertMeta('meta[property="og:type"]', "property", "og:type", type);
    upsertMeta('meta[property="og:url"]', "property", "og:url", url);
    upsertMeta('meta[property="og:image"]', "property", "og:image", img);
    upsertMeta('meta[property="og:site_name"]', "property", "og:site_name", SITE_NAME);

    upsertMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
    upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", trimmedTitle);
    upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", desc);
    upsertMeta('meta[name="twitter:image"]', "name", "twitter:image", img);

    // JSON-LD
    const existing = document.getElementById(JSONLD_ID);
    if (existing) existing.remove();
    if (jsonLd) {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.id = JSONLD_ID;
      script.text = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }
  }, [title, description, image, type, canonicalPath, jsonLd]);

  return null;
};

export default SEO;
