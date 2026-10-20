import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import SEO from "@/components/SEO";
import { ArrowLeft, Globe, Instagram, Twitter, Linkedin, Mail, MapPin, Calendar, FileText } from "lucide-react";

type Profile = {
  user_id: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  affiliation: string | null;
  website: string | null;
  social_instagram: string | null;
  social_twitter: string | null;
  social_linkedin: string | null;
  public_email: string | null;
  reality_id: string | null;
  member_type: string | null;
  role_collective: string | null;
  role_real_life: string | null;
  figure_category: string | null;
};

type RealityRef = { id: string; name: string; city: string; region: string };

type Post = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  published_at: string;
};

const AutoreProfilo = () => {
  const { userId } = useParams<{ userId: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reality, setReality] = useState<RealityRef | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data: p } = await supabase
        .from("profiles")
        .select("user_id, display_name, bio, avatar_url, affiliation, website, social_instagram, social_twitter, social_linkedin, public_email, reality_id, member_type, role_collective, role_real_life, figure_category, consent_public")
        .eq("user_id", userId)
        .eq("consent_public", true)
        .maybeSingle();
      if (cancelled) return;
      if (!p) { setNotFound(true); setLoading(false); return; }
      setProfile(p as Profile);

      const [{ data: r }, { data: ps }] = await Promise.all([
        p.reality_id
          ? supabase.from("realities").select("id, name, city, region").eq("id", p.reality_id).eq("confirmed_status", "confermato").maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("blog_posts")
          .select("id, slug, title, excerpt, category, published_at")
          .eq("user_id", userId)
          .eq("status", "published")
          .order("published_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setReality((r as RealityRef) ?? null);
      setPosts((ps as Post[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) {
    return <div className="py-20 text-center text-muted-foreground font-body">Caricamento…</div>;
  }
  if (notFound || !profile) {
    return (
      <div className="py-20 editorial-container text-center">
        <p className="font-body text-muted-foreground mb-4">Autore non più presente o profilo non pubblico.</p>
        <Link to="/la-rete" className="text-primary hover:underline font-body text-sm">
          ← Torna a La rete
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-background py-16 md:py-20">
      <SEO
        title={profile.display_name}
        description={profile.bio || `Profilo di ${profile.display_name} su Il Bel Paese.`}
        type="profile"
        canonicalPath={`/autori/${profile.user_id}`}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Person",
          name: profile.display_name,
          description: profile.bio || undefined,
          image: profile.avatar_url || undefined,
          url: profile.website || undefined,
          affiliation: reality?.name || profile.affiliation || undefined,
        }}
      />
      <div className="editorial-container max-w-4xl">
        <Link
          to="/la-rete"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary font-body mb-8"
        >
          <ArrowLeft size={14} /> La rete
        </Link>

        <header className="mb-12 pb-12 border-b border-border">
          <div className="flex flex-col sm:flex-row gap-8 items-start">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="w-28 h-28 rounded-full object-cover bg-muted shrink-0"
              />
            ) : (
              <div className="w-28 h-28 rounded-full bg-primary/10 flex items-center justify-center text-primary font-display font-bold text-4xl shrink-0">
                {profile.display_name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-bold mb-2 break-words leading-tight">{profile.display_name}</h1>
              {(profile.role_collective || profile.role_real_life) && (
                <p className="font-body text-muted-foreground text-sm mb-2">
                  {[profile.role_collective, profile.role_real_life].filter(Boolean).join(" · ")}
                </p>
              )}
              {(reality || profile.affiliation) && (
                <p className="font-body text-muted-foreground">
                  {reality ? (
                    <Link to={`/realta/${reality.id}`} className="inline-flex items-center gap-1.5 hover:text-primary transition-colors">
                      <MapPin size={14} /> {reality.name} · {reality.city}
                    </Link>
                  ) : (
                    profile.affiliation
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">

            {profile.public_email && (
              <a
                href={`mailto:${profile.public_email}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm font-body hover:bg-muted/70 transition-colors"
              >
                <Mail size={14} /> Email
              </a>
            )}
            {profile.website && (
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm font-body hover:bg-muted/70 transition-colors"
              >
                <Globe size={14} /> Sito
              </a>
            )}
            {profile.social_linkedin && (
              <a
                href={profile.social_linkedin.startsWith("http") ? profile.social_linkedin : `https://linkedin.com/in/${profile.social_linkedin.replace(/^@/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm font-body hover:bg-muted/70 transition-colors"
              >
                <Linkedin size={14} /> LinkedIn
              </a>
            )}
            {profile.social_instagram && (
              <a
                href={profile.social_instagram.startsWith("http") ? profile.social_instagram : `https://instagram.com/${profile.social_instagram.replace(/^@/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm font-body hover:bg-muted/70 transition-colors"
              >
                <Instagram size={14} /> Instagram
              </a>
            )}
            {profile.social_twitter && (
              <a
                href={profile.social_twitter.startsWith("http") ? profile.social_twitter : `https://twitter.com/${profile.social_twitter.replace(/^@/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted text-sm font-body hover:bg-muted/70 transition-colors"
              >
                <Twitter size={14} /> Twitter
              </a>
            )}
          </div>
        </header>

        {profile.bio && (
          <section aria-labelledby="bio-heading" className="mb-12 p-6 md:p-8 rounded-lg bg-card border border-border">
            <h2 id="bio-heading" className="font-display text-2xl font-semibold mb-4">Biografia</h2>
            <div className="h-[2px] w-12 bg-foreground mb-5" />
            <p className="font-body text-foreground/90 leading-relaxed whitespace-pre-line text-justify hyphens-auto max-w-3xl">
              {profile.bio}
            </p>
          </section>
        )}



        <section aria-labelledby="articoli-heading">
          <h2 id="articoli-heading" className="font-display text-2xl font-semibold mb-6 flex items-center gap-2">
            <FileText size={20} /> Articoli pubblicati
          </h2>
          {posts.length === 0 ? (
            <p className="text-muted-foreground font-body italic">Nessun articolo pubblicato ancora.</p>
          ) : (
            <div className="grid gap-4">
              {posts.map((post) => (
                <Link
                  key={post.id}
                  to={`/bollettino/${post.slug}`}
                  className="block p-5 rounded-lg border border-border hover:border-primary/40 transition-colors group"
                >
                  <div className="flex items-center gap-3 text-xs text-muted-foreground font-body mb-2">
                    <span className="uppercase tracking-wider text-primary">{post.category}</span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar size={12} />
                      {new Date(post.published_at).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })}
                    </span>
                  </div>
                  <h3 className="font-display font-semibold text-lg group-hover:text-primary transition-colors">{post.title}</h3>
                  {post.excerpt && <p className="text-sm text-muted-foreground font-body mt-1.5 line-clamp-2">{post.excerpt}</p>}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AutoreProfilo;
