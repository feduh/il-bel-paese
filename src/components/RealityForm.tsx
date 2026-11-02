import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/invokeFunction";
import { MapPin, Loader2, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { realitySchema, fieldErrors, type FieldErrors } from "@/lib/validation";
import FieldError from "@/components/FieldError";
import { REALITY_CATEGORIES } from "@/lib/categories";

const GEOCODING_ENABLED = import.meta.env.VITE_ENABLE_GEOCODING === "true";

type RealityType = "con-sede" | "nomade" | "scomparsa";
type ConfirmedStatus = "pendente" | "confermato" | "storico";

const inputCls =
  "w-full px-4 py-2.5 rounded-md border border-input bg-background font-body text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const inputErrCls = "border-destructive focus:ring-destructive";

// Capitalizza la prima lettera di ogni parola, mantenendo minuscole le particelle italiane (di, del, ecc.)
const TITLE_LOWER = new Set([
  "di","del","della","dello","dei","degli","delle",
  "da","dal","dalla","dallo","dai","dagli","dalle",
  "de","e","la","lo","il","i","gli","le",
  "in","su","a","ai","alle","alla","allo","con","per",
]);
const toTitleCase = (s: string): string => {
  if (!s) return s;
  const tokens = s.toLowerCase().split(/(\s+)/);
  let wordIdx = 0;
  return tokens
    .map((tok) => {
      if (/^\s+$/.test(tok) || tok === "") return tok;
      const isFirst = wordIdx === 0;
      wordIdx++;
      if (!isFirst && TITLE_LOWER.has(tok)) return tok;
      // Maiuscola dopo apostrofi (d'angelo -> D'Angelo) e a inizio parola
      return tok
        .replace(/(^|[-'’])([\p{L}])/gu, (_m, sep, ch) => sep + ch.toUpperCase());
    })
    .join("");
};

type FormMode = "admin" | "coordinatore";

const RealityForm = ({
  onCreated,
  mode = "admin",
  editingId,
  onCancel,
}: {
  onCreated?: () => void;
  mode?: FormMode;
  editingId?: string;
  onCancel?: () => void;
}) => {
  const { t } = useTranslation();
  const isCollaborator = mode === "coordinatore";
  const isEditing = !!editingId;

  const [name, setName] = useState("");
  const [type, setType] = useState<RealityType>("con-sede");
  const [country, setCountry] = useState("Italia");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [region, setRegion] = useState("");
  const [lat, setLat] = useState<string>("");
  const [lng, setLng] = useState<string>("");
  const [yearFounded, setYearFounded] = useState<string>("");
  const [yearClosed, setYearClosed] = useState<string>("");
  const [website, setWebsite] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [description, setDescription] = useState("");
  const [history, setHistory] = useState("");
  const [ig, setIg] = useState("");
  const [fb, setFb] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [vimeo, setVimeo] = useState("");
  const [confirmedStatus, setConfirmedStatus] = useState<ConfirmedStatus>("pendente");
  const [categories, setCategories] = useState<string[]>([]);

  const toggleCategory = (c: string) => {
    setCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  const [geocoding, setGeocoding] = useState(false);
  const [geocoded, setGeocoded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [errs, setErrs] = useState<FieldErrors>({});
  const [loadingEdit, setLoadingEdit] = useState(isEditing);

  // --- Photon autocomplete (indirizzo) ---
  type PhotonFeature = {
    properties: {
      name?: string; street?: string; housenumber?: string;
      city?: string; postcode?: string; state?: string;
      country?: string; countrycode?: string; type?: string;
    };
    geometry: { coordinates: [number, number] };
  };
  const [addrSuggestions, setAddrSuggestions] = useState<PhotonFeature[]>([]);
  const [addrOpen, setAddrOpen] = useState(false);
  const [addrLoading, setAddrLoading] = useState(false);
  const addrDebounce = useRef<number | null>(null);
  const addrSkipFetch = useRef(false);

  useEffect(() => {
    if (addrSkipFetch.current) { addrSkipFetch.current = false; return; }
    if (addrDebounce.current) window.clearTimeout(addrDebounce.current);
    const q = address.trim();
    // Suggerimenti di indirizzo (Photon/Komoot, servizio esterno): solo se la geocodifica è attivata.
    if (!GEOCODING_ENABLED || q.length < 3) { setAddrSuggestions([]); setAddrOpen(false); return; }
    addrDebounce.current = window.setTimeout(async () => {
      try {
        setAddrLoading(true);
        const url = new URL("https://photon.komoot.io/api/");
        const fullQ = city ? `${q}, ${city}` : q;
        url.searchParams.set("q", fullQ);
        url.searchParams.set("limit", "6");
        const r = await fetch(url.toString());
        if (!r.ok) return;
        const j = await r.json();
        const feats = (j.features as PhotonFeature[] | undefined) ?? [];
        // Preferisci risultati italiani e con via/civico
        const filtered = feats.filter(
          (f) => (f.properties.countrycode ?? "").toLowerCase() === "it" || !f.properties.countrycode,
        );
        setAddrSuggestions(filtered.length ? filtered : feats);
        setAddrOpen(true);
      } finally {
        setAddrLoading(false);
      }
    }, 300);
    return () => { if (addrDebounce.current) window.clearTimeout(addrDebounce.current); };
  }, [address, city]);

  const formatSuggestion = (f: PhotonFeature) => {
    const p = f.properties;
    const street = [p.street ?? p.name, p.housenumber].filter(Boolean).join(" ");
    const loc = [p.postcode, p.city, p.state].filter(Boolean).join(" ");
    return [street, loc].filter(Boolean).join(" — ");
  };

  const pickSuggestion = (f: PhotonFeature) => {
    const p = f.properties;
    const street = toTitleCase([p.street ?? p.name ?? "", p.housenumber ?? ""].filter(Boolean).join(" "));
    addrSkipFetch.current = true;
    setAddress(street);
    if (p.city) setCity(toTitleCase(p.city));
    if (p.postcode) setZipCode(p.postcode);
    if (p.state) setRegion(p.state);
    if (p.country) setCountry(p.country);
    const [lon, latN] = f.geometry.coordinates;
    setLat(String(latN));
    setLng(String(lon));
    setGeocoded(true);
    setAddrOpen(false);
    setAddrSuggestions([]);
  };

  useEffect(() => {
    if (!editingId) return;
    let alive = true;
    (async () => {
      setLoadingEdit(true);
      const { data, error: e } = await supabase
        .from("realities")
        .select("*")
        .eq("id", editingId)
        .maybeSingle();
      if (!alive) return;
      if (e || !data) {
        setError(e?.message || "Realtà non trovata");
        setLoadingEdit(false);
        return;
      }
      setName(data.name ?? "");
      setType((data.type as RealityType) ?? "con-sede");
      setCountry(data.country ?? "Italia");
      setCity(data.city ?? "");
      setAddress(data.address ?? "");
      setZipCode(data.zip_code ?? "");
      setRegion(data.region ?? "");
      setLat(data.lat != null ? String(data.lat) : "");
      setLng(data.lng != null ? String(data.lng) : "");
      setYearFounded(data.year_founded != null ? String(data.year_founded) : "");
      setYearClosed(data.year_closed != null ? String(data.year_closed) : "");
      setWebsite(data.website ?? "");
      setContactEmail(data.contact_email ?? "");
      setContactPhone((data as any).contact_phone ?? "");
      setDescription(data.description ?? "");
      setHistory(data.history ?? "");
      setIg(data.ig_link ?? "");
      setFb(data.fb_link ?? "");
      setLinkedin(data.linkedin_link ?? "");
      setVimeo((data as any).social_vimeo ?? "");
      setConfirmedStatus((data.confirmed_status as ConfirmedStatus) ?? "pendente");
      setCategories(data.categories ?? (data.category ? [data.category] : []));
      setGeocoded(!!(data.lat && data.lng));
      setLoadingEdit(false);
    })();
    return () => { alive = false; };
  }, [editingId]);

  const cls = (k: string) => `${inputCls} ${errs[k] ? inputErrCls : ""}`;
  const aria = (k: string) =>
    errs[k] ? { "aria-invalid": true as const, "aria-describedby": `err-${k}` } : {};

  const runGeocode = async () => {
    // Geocodifica disattivata di default: contatterebbe un servizio esterno (Nominatim).
    if (!GEOCODING_ENABLED || !address || !city) return;
    setGeocoding(true);
    setGeocoded(false);
    setError("");
    try {
      const { data, error: fnError } = await invokeFunction<any>("geocode-address", {
        address,
        city,
        country,
      });
      if (fnError) {
        setError(fnError);
        return;
      }
      if (data.zip_code) setZipCode(data.zip_code);
      if (data.region) setRegion(data.region);
      setLat(String(data.lat));
      setLng(String(data.lng));
      setGeocoded(true);
      if (data.approximate) {
        setError("⚠️ Indirizzo esatto non trovato: ho usato il centro città. Controlla e correggi lat/lng manualmente se serve.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGeocoding(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setErrs({});

    const parsed = realitySchema(t).safeParse({
      name, type, country, city, address, zipCode, region,
      lat, lng, yearFounded, yearClosed, website, contactEmail, contactPhone,
      description, history, ig, fb, linkedin, vimeo, confirmedStatus,
    });

    if (!parsed.success) {
      setErrs(fieldErrors(parsed.error));
      setError(t("validation.fixErrors"));
      return;
    }

    setSubmitting(true);
    const v = parsed.data;
    const { data: { user } } = await supabase.auth.getUser();
    const effectiveStatus = isCollaborator ? "pendente" : v.confirmedStatus;

    const payload = {
      name: v.name,
      type: v.type,
      country: v.country,
      city: v.city,
      address: v.address,
      zip_code: v.zipCode || null,
      region: v.region ?? "",
      lat: v.lat,
      lng: v.lng,
      year_founded: v.yearFounded,
      year_closed: v.yearClosed ?? null,
      website: v.website ?? null,
      contact_email: v.contactEmail,
      contact_phone: v.contactPhone ?? null,
      description: v.description ?? "",
      history: v.history ?? "",
      ig_link: v.ig ?? null,
      fb_link: v.fb ?? null,
      linkedin_link: v.linkedin ?? null,
      social_vimeo: v.vimeo ?? null,
      confirmed_status: effectiveStatus,
      status: effectiveStatus === "storico" ? "archiviato" : "attivo",
      categories,
      category: categories[0] ?? null,
    };

    let opError: { message: string } | null = null;
    if (isEditing) {
      const { error: updError } = await supabase
        .from("realities")
        .update(payload as any)
        .eq("id", editingId!);
      opError = updError;
    } else {
      const autoConfirmAt = effectiveStatus === "pendente"
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : null;
      const { error: insertError } = await supabase.from("realities").insert({
        ...payload,
        created_by: user?.id ?? null,
        auto_confirm_at: autoConfirmAt,
      } as any);
      opError = insertError;
    }

    if (opError) {
      setError(opError.message);
    } else {
      setSuccess(isEditing ? `✅ Realtà "${v.name}" aggiornata.` : `✅ Realtà "${v.name}" salvata.`);
      if (!isEditing) {
        setName(""); setAddress(""); setCity(""); setZipCode(""); setRegion("");
        setLat(""); setLng(""); setYearFounded(""); setYearClosed("");
        setWebsite(""); setContactEmail(""); setContactPhone(""); setDescription(""); setHistory("");
        setIg(""); setFb(""); setLinkedin(""); setVimeo(""); setGeocoded(false); setCategories([]);
      }
      onCreated?.();
    }
    setSubmitting(false);
  };

  if (loadingEdit) {
    return <div className="py-10 text-center text-sm text-muted-foreground font-body">Caricamento realtà…</div>;
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {error && <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">{error}</div>}
      {success && <div className="p-3 rounded-md bg-secondary/10 text-foreground text-sm border border-secondary/20" role="status">{success}</div>}

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Nome *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={cls("name")} {...aria("name")} />
          <FieldError id="err-name" message={errs.name} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Tipo *</label>
          <select value={type} onChange={(e) => setType(e.target.value as RealityType)} className={cls("type")} {...aria("type")}>
            <option value="con-sede">Spazio (con sede)</option>
            <option value="nomade">Spazio senza spazio (itinerante)</option>
            <option value="scomparsa">Spazio che fu</option>
          </select>
          <FieldError id="err-type" message={errs.type} />
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-2">
          <label className="block text-sm font-medium">Categorie artistiche</label>
          <span className="text-xs text-muted-foreground">
            {categories.length === 0 ? "Nessuna selezionata" : `${categories.length} selezionate`}
          </span>
        </div>
        <div className="rounded-md border border-input bg-background p-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
          {REALITY_CATEGORIES.map((c) => {
            const checked = categories.includes(c);
            return (
              <label
                key={c}
                className={`flex items-center gap-2 text-sm font-body cursor-pointer px-2 py-1.5 rounded transition-colors ${
                  checked ? "bg-primary/10 text-foreground" : "hover:bg-muted/50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCategory(c)}
                  className="accent-primary"
                />
                <span className="leading-tight">{c}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Puoi selezionarne più di una. La prima selezionata sarà quella principale.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Paese</label>
          <input value={country} onChange={(e) => setCountry(e.target.value)} className={cls("country")} {...aria("country")} />
          <FieldError id="err-country" message={errs.country} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Città *</label>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onBlur={(e) => { const v = toTitleCase(e.target.value); setCity(v); if (v && address) runGeocode(); }}
            className={cls("city")}
            {...aria("city")}
          />
          <FieldError id="err-city" message={errs.city} />
        </div>
        <div className="relative">
          <label className="block text-sm font-medium mb-2">Indirizzo *</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={() => { if (addrSuggestions.length) setAddrOpen(true); }}
            onBlur={(e) => {
              // chiudo il dropdown con un piccolo delay per permettere il click su una voce
              setTimeout(() => setAddrOpen(false), 150);
              const v = toTitleCase(e.target.value);
              if (v !== address) setAddress(v);
            }}
            placeholder="es. Via Torino 40"
            autoComplete="off"
            className={cls("address")}
            {...aria("address")}
          />
          {addrOpen && (addrLoading || addrSuggestions.length > 0) && (
            <ul className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md text-sm font-body">
              {addrLoading && (
                <li className="px-3 py-2 text-muted-foreground flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Ricerca…
                </li>
              )}
              {!addrLoading && addrSuggestions.map((f, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => pickSuggestion(f)}
                    className="w-full text-left px-3 py-2 hover:bg-muted/60"
                  >
                    {formatSuggestion(f)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <FieldError id="err-address" message={errs.address} />
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium flex items-center gap-2">
            <MapPin size={14} /> {GEOCODING_ENABLED ? "Geocodifica automatica" : "Posizione"}
            {geocoding && <Loader2 size={14} className="animate-spin" />}
            {geocoded && <Check size={14} className="text-secondary" />}
          </p>
          {GEOCODING_ENABLED ? (
            <button type="button" onClick={runGeocode} className="text-xs underline text-muted-foreground hover:text-foreground">
              Ricalcola
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">Inserisci CAP, regione e coordinate a mano</span>
          )}
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">CAP</label>
            <input value={zipCode} onChange={(e) => setZipCode(e.target.value)} className={cls("zipCode")} {...aria("zipCode")} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Regione</label>
            <input value={region} onChange={(e) => setRegion(e.target.value)} className={cls("region")} {...aria("region")} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Lat *</label>
            <input value={lat} onChange={(e) => setLat(e.target.value)} className={cls("lat")} {...aria("lat")} />
            <FieldError id="err-lat" message={errs.lat} />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Lng *</label>
            <input value={lng} onChange={(e) => setLng(e.target.value)} className={cls("lng")} {...aria("lng")} />
            <FieldError id="err-lng" message={errs.lng} />
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Anno di fondazione *</label>
          <input type="number" value={yearFounded} onChange={(e) => setYearFounded(e.target.value)} className={cls("yearFounded")} {...aria("yearFounded")} />
          <FieldError id="err-yearFounded" message={errs.yearFounded} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Anno di chiusura</label>
          <input type="number" value={yearClosed} onChange={(e) => setYearClosed(e.target.value)} className={cls("yearClosed")} {...aria("yearClosed")} />
          <FieldError id="err-yearClosed" message={errs.yearClosed} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Descrizione</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={cls("description")} {...aria("description")} placeholder="Chi siete, cosa fate, cosa vi caratterizza." />
        <FieldError id="err-description" message={errs.description} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-2">Storia <span className="text-muted-foreground font-normal">(opzionale)</span></label>
        <textarea value={history} onChange={(e) => setHistory(e.target.value)} rows={3} className={cls("history")} {...aria("history")} placeholder="Compila solo se la storia della realtà è distinta dalla descrizione (es. anni, tappe, momenti chiave)." />
        <FieldError id="err-history" message={errs.history} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Sito web</label>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." className={cls("website")} {...aria("website")} />
          <FieldError id="err-website" message={errs.website} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Email di contatto *</label>
          <input type="email" required value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="info@esempio.it" className={cls("contactEmail")} {...aria("contactEmail")} />
          <FieldError id="err-contactEmail" message={errs.contactEmail} />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Telefono <span className="text-muted-foreground font-normal">(opzionale)</span></label>
          <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+39 …" className={cls("contactPhone")} {...aria("contactPhone")} />
          <FieldError id="err-contactPhone" message={errs.contactPhone} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Vimeo <span className="text-muted-foreground font-normal">(opzionale)</span></label>
          <input value={vimeo} onChange={(e) => setVimeo(e.target.value)} placeholder="https://vimeo.com/…" className={cls("vimeo")} {...aria("vimeo")} />
          <FieldError id="err-vimeo" message={errs.vimeo} />
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Instagram</label>
          <input value={ig} onChange={(e) => setIg(e.target.value)} placeholder="https://instagram.com/..." className={cls("ig")} {...aria("ig")} />
          <FieldError id="err-ig" message={errs.ig} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Facebook</label>
          <input value={fb} onChange={(e) => setFb(e.target.value)} placeholder="https://facebook.com/..." className={cls("fb")} {...aria("fb")} />
          <FieldError id="err-fb" message={errs.fb} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">LinkedIn</label>
          <input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/..." className={cls("linkedin")} {...aria("linkedin")} />
          <FieldError id="err-linkedin" message={errs.linkedin} />
        </div>
      </div>


      {!isCollaborator && (
        <div>
          <label className="block text-sm font-medium mb-2">Stato di conferma</label>
          <select value={confirmedStatus} onChange={(e) => setConfirmedStatus(e.target.value as ConfirmedStatus)} className={cls("confirmedStatus")} {...aria("confirmedStatus")}>
            <option value="pendente">Pendente</option>
            <option value="confermato">Confermato</option>
            <option value="storico">Storico</option>
          </select>
        </div>
      )}

      {isCollaborator && !isEditing && (
        <div className="p-4 rounded-md bg-amber-500/10 border border-amber-500/30 text-sm font-body">
          ⏳ La realtà che proponi resterà <strong>in verifica per 24 ore</strong>: in questa finestra puoi correggerla o eliminarla. Trascorso il tempo verrà <strong>pubblicata automaticamente</strong> sulla mappa. Ricontrolla bene tutti i contatti prima di salvare.
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button type="submit" disabled={submitting} className="px-6 py-3 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50">
          {submitting ? "Salvataggio..." : isEditing ? "Aggiorna realtà" : isCollaborator ? "Proponi realtà" : "Salva realtà"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-md border border-border font-body text-sm hover:bg-muted/50">
            Annulla
          </button>
        )}
      </div>
    </form>
  );
};

export default RealityForm;
