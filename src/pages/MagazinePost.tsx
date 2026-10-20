import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Calendar, User, ArrowLeft, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SEO from "@/components/SEO";
import { PostDetailSkeleton } from "@/components/skeletons";
import SmartImage from "@/components/SmartImage";
import { parseCategories } from "@/lib/articleCategories";
import { fetchAuthorNames, resolveAuthorName } from "@/lib/authorNames";

type Post = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  author_name: string;
  user_id: string;
  author_deleted?: boolean;
  category: string;
  cover_image_url: string | null;
  published_at: string;
  status: string;
};

type AuthorBio = {
  user_id: string;
  display_name: string;
  author_bio: string | null;
  avatar_url: string | null;
  affiliation: string | null;
};


const MagazinePost = () => {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [authorBio, setAuthorBio] = useState<AuthorBio | null>(null);
  const [loading, setLoading] = useState(true);


  const readingTime = useMemo(() => {
    if (!post?.content) return 1;
    const text = post.content.replace(/[#>*_`\-\[\]()!]/g, "");
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  }, [post?.content]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("blog_posts")
        .select("*")
        .eq("slug", slug!)
        .maybeSingle();
      if (cancelled) return;
      const p = (data as Post | null) ?? null;
      setPost(p);

      const names = await fetchAuthorNames([p?.user_id]);
      if (!cancelled) setNameMap(names);

      if (p?.user_id && !p.author_deleted) {
        const { data: bioData } = await supabase
          .from("profiles")
          .select("user_id, display_name, author_bio, avatar_url, affiliation")
          .eq("user_id", p.user_id)
          .maybeSingle();
        if (!cancelled) setAuthorBio((bioData as unknown as AuthorBio | null) ?? null);

      } else {
        setAuthorBio(null);
      }

      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) return <PostDetailSkeleton />;

  if (!post) {
    return (
      <div className="py-20 text-center">
        <p className="font-body text-muted-foreground mb-6">{t("magazine.notFound")}</p>
        <Link to="/bollettino" className="text-primary underline font-body">
          {t("magazine.back")}
        </Link>
      </div>
    );
  }

  return (
    <article className="bg-background py-16 md:py-20">
      <SEO
        title={post.title}
        description={post.excerpt}
        image={post.cover_image_url ?? undefined}
        type="article"
        canonicalPath={`/bollettino/${post.slug}`}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: post.title,
          description: post.excerpt,
          image: post.cover_image_url ?? undefined,
          datePublished: post.published_at,
          author: { "@type": "Person", name: resolveAuthorName(nameMap, post.user_id, post.author_name) },
          publisher: { "@type": "Organization", name: "Il Bel Paese" },
          articleSection: post.category,
          inLanguage: "it-IT",
        }}
      />
      <div className="editorial-container max-w-3xl">
        <Link
          to="/bollettino"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary font-body mb-8"
        >
          <ArrowLeft size={14} /> {t("magazine.back")}
        </Link>

        <div className="flex flex-wrap items-center gap-2 mb-6">
          {parseCategories(post.category).map((c) => (
            <span key={c} className="text-xs font-medium px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
              {c}
            </span>
          ))}
        </div>

        <h1 className="font-display uppercase tracking-tight leading-[0.95] text-3xl sm:text-4xl md:text-5xl lg:text-6xl mb-6 break-words hyphens-auto" style={{ fontVariationSettings: "'wght' 700" }}>{post.title}</h1>

        <div className="flex items-center gap-5 text-sm text-muted-foreground font-body mb-10 pb-10 border-b border-border flex-wrap">
          {post.author_deleted ? (
            <span className="flex items-center gap-1.5">
              <User size={14} /> {post.author_name}
            </span>
          ) : (
            <Link
              to={`/autori/${post.user_id}`}
              className="flex items-center gap-1.5 hover:text-primary transition-colors"
            >
              <User size={14} /> <span className="underline decoration-dotted underline-offset-2">{resolveAuthorName(nameMap, post.user_id, post.author_name)}</span>
            </Link>
          )}

          <span className="flex items-center gap-1.5">
            <Calendar size={14} />
            {new Date(post.published_at).toLocaleDateString("it-IT", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock size={14} /> {readingTime} min di lettura
          </span>
        </div>

        {post.cover_image_url && (
          <SmartImage
            src={post.cover_image_url}
            alt={post.title}
            priority
            aspect="16/9"
            wrapperClassName="w-full rounded-lg mb-10"
            className="w-full h-full object-cover"
          />
        )}

        <p className="font-display text-xl text-foreground/90 italic leading-relaxed mb-10">
          {post.excerpt}
        </p>

        <div className="prose prose-lg max-w-none dark:prose-invert font-body prose-headings:font-display prose-a:text-primary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.content}</ReactMarkdown>
        </div>

        {/* Author bio card */}
        {authorBio && authorBio.author_bio && (
          <aside className="mt-14 pt-8 border-t border-border">
            <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-4">
              L'autore
            </div>
            <Link
              to={`/autori/${authorBio.user_id}`}
              className="flex items-start gap-4 group"
            >
              {authorBio.avatar_url ? (
                <img
                  src={authorBio.avatar_url}
                  alt={authorBio.display_name}
                  loading="lazy"
                  className="w-16 h-16 rounded-full object-cover border border-border shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center border border-border shrink-0">
                  <User size={22} className="text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <p className="font-display text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                  {authorBio.display_name}
                </p>
                {authorBio.affiliation && (
                  <p className="font-body text-xs text-muted-foreground italic mb-2">
                    {authorBio.affiliation}
                  </p>
                )}
                {authorBio.author_bio && (
                  <p className="font-body text-sm text-muted-foreground leading-relaxed whitespace-pre-line text-justify">
                    {authorBio.author_bio}
                  </p>
                )}

                <span className="inline-block mt-2 text-xs font-body text-primary group-hover:underline">
                  Leggi la bio completa →
                </span>
              </div>
            </Link>
          </aside>
        )}

      </div>
    </article>
  );
};

export default MagazinePost;
