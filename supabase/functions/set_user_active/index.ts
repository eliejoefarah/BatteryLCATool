// =============================================================================
// set_user_active — Battery LCA Tool Edge Function
// =============================================================================
// Deactivates or reactivates a user account. Deactivating:
//   1. sets app_user.is_active = false, which RLS (migration 025), FastAPI
//      (app/auth.py) and the Edge Functions (_shared/utils.ts) all check, so
//      an open session loses access immediately;
//   2. bans the account in GoTrue, so it can't log in or refresh a session.
// Reactivating reverses both.
//
// Auth: caller must be an active admin. Admins can't deactivate themselves
// (avoids locking the last admin out by accident).
//
// POST /functions/v1/set_user_active
// Authorization: Bearer <user-jwt>
// { "user_id": "<uuid>", "active": false }
//
// Response 200: { "ok": true, "user_id": "<uuid>", "active": false }
//
// Env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_ANON_KEY         (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// =============================================================================

import { adminClient, handleCors, json, requireAdmin } from "../_shared/utils.ts";

// GoTrue has no permanent ban: ~100 years. "none" lifts a ban.
const BAN_DURATION = "876000h";

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // ── Auth + admin check ────────────────────────────────────────────────────
  const svc    = adminClient();
  const result = await requireAdmin(req.headers.get("Authorization"), svc);
  if (result instanceof Response) return result;
  const { callerId } = result;

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { user_id?: string; active?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad Request: invalid JSON" }, 400);
  }
  const userId = (body.user_id ?? "").trim();
  if (!userId || typeof body.active !== "boolean") {
    return json({ error: "Bad Request: user_id and active (boolean) are required" }, 400);
  }
  if (userId === callerId && !body.active) {
    return json({ error: "Bad Request: you can't deactivate your own account" }, 400);
  }

  // ── Ban / unban in GoTrue first ───────────────────────────────────────────
  // If this fails nothing has changed; if the app_user update below fails the
  // ban is reverted, so the two never disagree.
  const { error: banErr } = await svc.auth.admin.updateUserById(userId, {
    ban_duration: body.active ? "none" : BAN_DURATION,
  });
  if (banErr) {
    console.error("set_user_active: updating the auth user failed:", banErr);
    const status = banErr.status === 404 ? 404 : 500;
    return json({ error: `Could not update the account: ${banErr.message}` }, status);
  }

  const { data, error } = await svc
    .from("app_user")
    .update({ is_active: body.active })
    .eq("user_id", userId)
    .select("user_id");
  if (error || !data?.length) {
    console.error("set_user_active: app_user update failed:", error);
    await svc.auth.admin.updateUserById(userId, {
      ban_duration: body.active ? BAN_DURATION : "none",
    });
    return json({ error: error?.message ?? "Not Found: no app_user row for this user" }, error ? 500 : 404);
  }

  console.log(
    `set_user_active: ${userId} → ${body.active ? "active" : "deactivated"} by admin=${callerId}`,
  );
  return json({ ok: true, user_id: userId, active: body.active });
});
