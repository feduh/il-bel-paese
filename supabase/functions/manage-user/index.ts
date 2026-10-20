import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type AppRole =
  | "admin"
  | "moderator"
  | "coordinatore"
  | "author"
  | "editor_chief"
  | "guest_editor";
const ALL_ROLES: AppRole[] = [
  "admin",
  "moderator",
  "coordinatore",
  "author",
  "editor_chief",
  "guest_editor",
];

const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("list_users") }),
  z.object({ op: z.literal("list_authors") }),
  z.object({
    op: z.literal("update_roles"),
    user_id: z.string().uuid(),
    roles: z.array(
      z.enum([
        "admin",
        "moderator",
        "coordinatore",
        "author",
        "editor_chief",
        "guest_editor",
      ]),
    ),
  }),
  z.object({
    op: z.literal("reset_password"),
    user_id: z.string().uuid(),
    new_password: z
      .string()
      .min(10, "Almeno 10 caratteri")
      .max(72)
      .regex(/[A-Z]/, "Serve almeno una maiuscola")
      .regex(/[a-z]/, "Serve almeno una minuscola")
      .regex(/[0-9]/, "Serve almeno un numero")
      .regex(/[^A-Za-z0-9]/, "Serve almeno un simbolo"),
  }),
  z.object({
    op: z.literal("set_banned"),
    user_id: z.string().uuid(),
    banned: z.boolean(),
  }),
  z.object({
    op: z.literal("delete_user"),
    user_id: z.string().uuid(),
    mode: z.enum(["keep", "all"], {
      errorMap: () => ({ message: "Scegli un'opzione di eliminazione" }),
    }),
  }),
  z.object({
    op: z.literal("delete_user_preview"),
    user_id: z.string().uuid(),
  }),
  z.object({
    op: z.literal("update_user"),
    user_id: z.string().uuid(),
    email: z.string().trim().email("Email non valida").max(255).optional(),
    display_name: z.string().trim().min(1, "Nome obbligatorio").max(120).optional(),
    affiliation: z.string().trim().max(255).nullable().optional(),
  }),
  z.object({
    op: z.literal("set_affiliation"),
    user_id: z.string().uuid(),
    affiliation: z.string().trim().max(255).nullable(),
  }),
  z.object({
    op: z.literal("set_reality"),
    user_id: z.string().uuid(),
    reality_id: z.string().uuid().nullable(),
  }),
  z.object({ op: z.literal("list_realities_lite") }),
]);


function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Non autorizzato" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const publishableKey =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      "";
    if (!supabaseUrl || !serviceRoleKey || !publishableKey) {
      return json({ error: "Configurazione server mancante (chiavi Supabase)." }, 500);
    }

    const callerClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
    } = await callerClient.auth.getUser();
    if (!caller) return json({ error: "Non autorizzato" }, 401);

    const { data: isAdmin } = await callerClient.rpc("has_role", {
      _user_id: caller.id,
      _role: "admin",
    });
    const { data: isCoord } = await callerClient.rpc("has_role", {
      _user_id: caller.id,
      _role: "coordinatore",
    });

    const raw = await req.json();
    const parsed = opSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: parsed.error.errors.map((e) => e.message).join(", ") }, 400);
    }
    const data = parsed.data;

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ---------- Ops open to admin + coordinatore ----------
    if (data.op === "list_authors") {
      if (!isAdmin && !isCoord) {
        return json({ error: "Non autorizzato" }, 403);
      }
      const { data: profs, error: profErr } = await admin
        .from("profiles")
        .select("user_id, display_name, affiliation, reality_id, member_type")
        .in("member_type", ["autore", "coordinatore"])
        .order("display_name", { ascending: true });
      if (profErr) return json({ error: profErr.message }, 500);
      // Filter out deleted users (delete_user removes all user_roles entries)
      const ids = (profs ?? []).map((p) => p.user_id);
      let activeIds = new Set<string>(ids);
      if (ids.length > 0) {
        const { data: roles } = await admin
          .from("user_roles")
          .select("user_id")
          .in("user_id", ids);
        activeIds = new Set((roles ?? []).map((r: { user_id: string }) => r.user_id));
      }
      const filtered = (profs ?? []).filter((p) => activeIds.has(p.user_id));
      return json({ authors: filtered });
    }

    if (data.op === "set_affiliation") {
      if (!isAdmin && !isCoord) {
        return json({ error: "Non autorizzato" }, 403);
      }
      const value =
        data.affiliation && data.affiliation.trim().length > 0
          ? data.affiliation.trim()
          : null;
      const { error } = await admin
        .from("profiles")
        .update({ affiliation: value })
        .eq("user_id", data.user_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (data.op === "set_reality") {
      if (!isAdmin && !isCoord) {
        return json({ error: "Non autorizzato" }, 403);
      }
      const { error } = await admin
        .from("profiles")
        .update({ reality_id: data.reality_id })
        .eq("user_id", data.user_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (data.op === "list_realities_lite") {
      if (!isAdmin && !isCoord) {
        return json({ error: "Non autorizzato" }, 403);
      }
      const { data: rows, error } = await admin
        .from("realities")
        .select("id, name, city, confirmed_status")
        .order("name", { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ realities: rows ?? [] });
    }

    // ---------- Ops restricted to admin ----------
    if (!isAdmin) {
      return json({ error: "Solo gli admin possono gestire gli utenti" }, 403);
    }


    // ---------- LIST USERS ----------
    if (data.op === "list_users") {
      const { data: usersResp, error: usersErr } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (usersErr) return json({ error: usersErr.message }, 500);

      const ids = usersResp.users.map((u) => u.id);
      const [{ data: profs }, { data: roles }] = await Promise.all([
        admin.from("profiles").select("user_id, display_name, avatar_url, member_type, reality_id, affiliation, public_email").in("user_id", ids),
        admin.from("user_roles").select("user_id, role").in("user_id", ids),
      ]);

      const profileMap = new Map((profs ?? []).map((p) => [p.user_id, p]));
      const roleMap = new Map<string, AppRole[]>();
      for (const r of roles ?? []) {
        const list = roleMap.get(r.user_id) ?? [];
        list.push(r.role as AppRole);
        roleMap.set(r.user_id, list);
      }

      const users = usersResp.users.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        banned_until: (u as { banned_until?: string | null }).banned_until ?? null,
        profile: profileMap.get(u.id) ?? null,
        roles: roleMap.get(u.id) ?? [],
      }));
      return json({ users });
    }

    // Self-protection: caller can't act on themselves for risky ops
    const isSelf = data.user_id === caller.id;

    // ---------- UPDATE ROLES ----------
    if (data.op === "update_roles") {
      if (isSelf && !data.roles.includes("admin")) {
        return json({ error: "Non puoi rimuovere il tuo ruolo admin." }, 400);
      }
      const desired = new Set(data.roles);
      // Gli editor editoriali sono sempre anche autori
      if (desired.has("editor_chief") || desired.has("guest_editor")) {
        desired.add("author");
      }
      const { data: current } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user_id);
      const currentSet = new Set((current ?? []).map((r) => r.role as AppRole));

      const toAdd = [...desired].filter((r) => !currentSet.has(r));
      const toRemove = [...currentSet].filter((r) => !desired.has(r));

      if (toAdd.length) {
        const { error } = await admin
          .from("user_roles")
          .insert(toAdd.map((role) => ({ user_id: data.user_id, role })));
        if (error) return json({ error: error.message }, 500);
      }
      if (toRemove.length) {
        const { error } = await admin
          .from("user_roles")
          .delete()
          .eq("user_id", data.user_id)
          .in("role", toRemove);
        if (error) return json({ error: error.message }, 500);
      }
      return json({ ok: true });
    }

    // ---------- RESET PASSWORD ----------
    if (data.op === "reset_password") {
      const { error } = await admin.auth.admin.updateUserById(data.user_id, {
        password: data.new_password,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // ---------- BAN / UNBAN ----------
    if (data.op === "set_banned") {
      if (isSelf) return json({ error: "Non puoi sospendere il tuo account." }, 400);
      const { error } = await admin.auth.admin.updateUserById(data.user_id, {
        ban_duration: data.banned ? "876000h" : "none", // ~100 anni o sblocca
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // ---------- DELETE PREVIEW ----------
    if (data.op === "delete_user_preview") {
      const { data: preview, error } = await admin.rpc("admin_user_delete_preview", {
        _target: data.user_id,
      });
      if (error) return json({ error: error.message }, 500);
      return json({ preview });
    }

    // ---------- DELETE (two modes) ----------
    if (data.op === "delete_user") {
      if (isSelf) return json({ error: "Non puoi eliminare il tuo account." }, 400);
      const target = data.user_id;

      // 1. Sospensione (reversibile): blocca subito l'accesso
      const { error: banErr } = await admin.auth.admin.updateUserById(target, {
        ban_duration: "876000h",
      });
      if (banErr) {
        return json({ error: `Impossibile sospendere l'utente: ${banErr.message}` }, 400);
      }

      // 2. Contenuti + audit in un'unica transazione (idempotente)
      const { data: result, error: rpcErr } = await admin.rpc("admin_delete_user_content", {
        _target: target,
        _actor: caller.id,
        _mode: data.mode,
      });
      if (rpcErr) {
        await admin.auth.admin.updateUserById(target, { ban_duration: "none" });
        return json({ error: `Eliminazione annullata, nessun dato modificato: ${rpcErr.message}` }, 500);
      }

      // 3. Cancellazione account (profilo e ruoli residui in cascata)
      const { error: delErr } = await admin.auth.admin.deleteUser(target);
      if (delErr) {
        return json(
          {
            error:
              "Eliminazione incompleta: i contenuti sono stati gestiti e l'utente è sospeso, ma l'account non è stato rimosso. Riprova.",
          },
          500,
        );
      }
      await admin.from("profiles").delete().eq("user_id", target);

      // 4. Pulizia storage (non bloccante)
      const warnings: string[] = [];
      const buckets = data.mode === "all" ? ["avatars", "blog-covers"] : ["avatars"];
      for (const bucket of buckets) {
        try {
          const { data: files, error: listErr } = await admin.storage
            .from(bucket)
            .list(target, { limit: 1000 });
          if (listErr) throw listErr;
          const paths = (files ?? []).map((f) => `${target}/${f.name}`);
          if (paths.length) {
            const { error: rmErr } = await admin.storage.from(bucket).remove(paths);
            if (rmErr) throw rmErr;
          }
        } catch (e) {
          warnings.push(`File in "${bucket}" non rimossi: ${(e as Error).message}`);
        }
      }
      if (warnings.length) {
        await admin.rpc("admin_audit_note", {
          _target: target,
          _actor: caller.id,
          _note: `storage_cleanup_failed: ${warnings.join("; ")}`,
        });
      }

      return json({ ok: true, result, warnings });
    }

    // ---------- UPDATE USER (email / display name / affiliation) ----------
    if (data.op === "update_user") {
      const hasAffiliation = data.affiliation !== undefined;
      if (!data.email && !data.display_name && !hasAffiliation) {
        return json({ error: "Nessuna modifica indicata." }, 400);
      }
      if (data.email) {
        const { error } = await admin.auth.admin.updateUserById(data.user_id, {
          email: data.email,
          email_confirm: true,
        });
        if (error) return json({ error: error.message }, 400);
      }
      const profileUpdate: Record<string, unknown> = {};
      if (data.display_name) profileUpdate.display_name = data.display_name;
      if (hasAffiliation) {
        profileUpdate.affiliation = data.affiliation && data.affiliation.length > 0 ? data.affiliation : null;
      }
      if (Object.keys(profileUpdate).length > 0) {
        const { error } = await admin
          .from("profiles")
          .update(profileUpdate)
          .eq("user_id", data.user_id);
        if (error) return json({ error: error.message }, 500);
      }
      return json({ ok: true });
    }


    return json({ error: "Operazione sconosciuta" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
