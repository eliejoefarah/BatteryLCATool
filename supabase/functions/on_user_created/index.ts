// =============================================================================
// on_user_created — Battery LCA Tool Edge Function
// =============================================================================
// Triggered by a Supabase Auth webhook on every auth.users INSERT.
// Creates the corresponding app_user row with role = 'editor'.
//
// Auth: shared secret (not a user JWT — this is a server-to-server webhook).
// The secret is sent in the Authorization: Bearer <secret> header by Supabase.
//
// Register in Supabase Dashboard → Database → Webhooks:
//   Table   : auth.users        Events : INSERT
//   URL     : <project-url>/functions/v1/on_user_created
//   Headers : Authorization: Bearer <WEBHOOK_SECRET value>
//
// Env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   WEBHOOK_SECRET            (set manually in Dashboard → Secrets)
// =============================================================================

import { adminClient, json } from "../_shared/utils.ts";

interface AuthRecord {
  id: string;
  email?: string;
  raw_user_meta_data?: {
    display_name?: string;
    full_name?: string;
    role?: string;
  };
}

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // ── Shared-secret verification ──────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (WEBHOOK_SECRET && token !== WEBHOOK_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  // ── Parse payload ───────────────────────────────────────────────────────────
  let payload: { record?: AuthRecord };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Bad Request: invalid JSON" }, 400);
  }

  const record = payload?.record;
  if (!record?.id) {
    return json({ error: "Bad Request: missing record.id" }, 400);
  }

  const userId = record.id;
  const email  = record.email ?? "";

  // Prefer display_name from invite metadata; fall back to full_name or email prefix.
  const displayName =
    record.raw_user_meta_data?.display_name ??
    record.raw_user_meta_data?.full_name ??
    (email ? email.split("@")[0] : null);

  // The invite_user function may have pre-set a role in metadata.
  const requestedRole = record.raw_user_meta_data?.role;
  const VALID_ROLES = ["admin", "manufacturer", "reviewer"];
  const role = VALID_ROLES.includes(requestedRole ?? "") ? requestedRole! : "manufacturer";

  // ── Upsert into app_user ────────────────────────────────────────────────────
  const svc = adminClient();
  const { error } = await svc
    .from("app_user")
    .upsert(
      {
        user_id:      userId,
        email:        email,
        display_name: displayName ?? null,
        role:         role,
        is_active:    true,
      },
      { onConflict: "user_id" },
    );

  if (error) {
    console.error("on_user_created: upsert failed:", error);
    return json({ error: error.message }, 500);
  }

  console.log(`on_user_created: app_user created for ${userId} (${email}, role=${role})`);
  return json({ ok: true, user_id: userId });
});
