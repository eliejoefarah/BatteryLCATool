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

// Constant-time string comparison, so response timing doesn't leak how much
// of the secret a guess got right.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // ── Shared-secret verification ──────────────────────────────────────────────
  // Fails closed: this endpoint is publicly reachable (/functions/v1/), so an
  // unset secret must reject everything rather than accept everything.
  if (!WEBHOOK_SECRET) {
    console.error("on_user_created: WEBHOOK_SECRET is not set, rejecting request");
    return json({ error: "Server Error: webhook not configured" }, 500);
  }
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!timingSafeEqual(token, WEBHOOK_SECRET)) {
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

  // ── Insert app_user (never overwrite) ───────────────────────────────────────
  // The role is NOT taken from raw_user_meta_data: that is user_metadata, which
  // the user supplies themselves at sign-up, so trusting it would let anyone
  // who can create an account make themselves admin. New accounts get the
  // least-privileged role; invite_user writes the admin's chosen role to
  // app_user itself (service role). ignoreDuplicates keeps that row whichever
  // of the two runs first.
  const svc = adminClient();
  const { error } = await svc
    .from("app_user")
    .upsert(
      {
        user_id:      userId,
        email:        email,
        display_name: displayName ?? null,
        role:         "manufacturer",
        is_active:    true,
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    );

  if (error) {
    console.error("on_user_created: upsert failed:", error);
    return json({ error: error.message }, 500);
  }

  console.log(`on_user_created: app_user ensured for ${userId} (${email})`);
  return json({ ok: true, user_id: userId });
});
