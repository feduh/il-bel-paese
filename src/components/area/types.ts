export type AreaProfile = {
  id: string;
  user_id: string;
  display_name: string;
  bio: string;
  author_bio: string;

  avatar_url: string | null;
  website: string | null;
  social_instagram: string | null;
  social_twitter: string | null;
  social_linkedin: string | null;
  reality_id: string | null;
  affiliation: string | null;
  public_email: string | null;
  consent_public: boolean;
  member_type: string | null;
  role_collective: string | null;
  role_real_life: string | null;
  figure_category: string | null;
};

export type AreaPostStatus = "draft" | "pending" | "scheduled" | "rejected" | "published";

export type AreaPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  status: AreaPostStatus;
  category: string;
  cover_image_url: string | null;
  published_at: string;
  scheduled_for: string | null;
  submitted_at?: string | null;
  rejection_note?: string | null;
};

export type AreaModerationPost = AreaPost & { author_name: string; user_id: string };

export type AreaRealityRef = { id: string; name: string };

export type AreaPendingReality = {
  id: string;
  name: string;
  city: string;
  region: string | null;
  auto_confirm_at: string | null;
  created_at: string;
};
