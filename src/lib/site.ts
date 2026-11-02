/** Indirizzo pubblico del sito. Si imposta con VITE_SITE_URL (es. https://ilbelpaese.it) al momento della build. */
export const SITE_URL = (import.meta.env.VITE_SITE_URL || "https://il-bel-paese.lovable.app").replace(/\/$/, "");
