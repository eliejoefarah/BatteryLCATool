// =============================================================================
// invite_user — Battery LCA Tool Edge Function
// =============================================================================
// Allows an admin to invite a new user by email.
// Uses Supabase Auth Admin API to send the invite email; no separate mailer needed.
//
// Auth: caller must be authenticated AND have role = 'admin' in app_user.
//
// POST /functions/v1/invite_user
// Authorization: Bearer <user-jwt>
// {
//   "email":        "user@example.com",   // required
//   "role":         "editor",             // optional; "editor" | "admin". default: "editor"
//   "display_name": "Jane Smith"          // optional
// }
//
// Response 200: { "ok": true, "user_id": "<uuid>" }
//
// Env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_ANON_KEY         (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   APP_BASE_URL              (e.g. "https://your-app.vercel.app")
// =============================================================================

import { adminClient, handleCors, json, requireAdmin } from "../_shared/utils.ts";

const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "";

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
  let body: { email?: string; role?: string; display_name?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad Request: invalid JSON" }, 400);
  }

  const email       = (body.email ?? "").trim().toLowerCase();
  const role        = body.role === "admin" ? "admin" : "editor";
  const displayName = (body.display_name ?? "").trim() || null;

  if (!email || !email.includes("@")) {
    return json({ error: "Bad Request: valid email is required" }, 400);
  }

  // ── Send invite via Supabase Auth Admin API ───────────────────────────────
  // inviteUserByEmail sends the built-in invite email and creates the auth.users row.
  // role is stored in user_metadata so on_user_created can read it.
  const { data, error } = await svc.auth.admin.inviteUserByEmail(email, {
    redirectTo: APP_BASE_URL ? `${APP_BASE_URL}/auth/callback` : undefined,
    data: {
      display_name: displayName ?? email.split("@")[0],
      role,
    },
  });

  if (error || !data?.user) {
    console.error("invite_user: inviteUserByEmail failed:", error);
    return json({ error: error?.message ?? "Failed to send invite" }, 500);
  }

  const newUserId = data.user.id;

  // ── Pre-create app_user row ───────────────────────────────────────────────
  // on_user_created will also upsert on first login; this makes the row
  // immediately visible in the admin UI before the invite is accepted.
  const { error: upsertErr } = await svc.from("app_user").upsert(
    {
      user_id:      newUserId,
      email:        email,
      display_name: displayName ?? email.split("@")[0],
      role:         role,
      is_active:    true,
    },
    { onConflict: "user_id" },
  );
  if (upsertErr) {
    // Non-fatal: on_user_created will retry on first login.
    console.warn("invite_user: pre-create app_user failed:", upsertErr);
  }

  console.log(
    `invite_user: invited ${email} → user_id=${newUserId} role=${role} by admin=${callerId}`,
  );
  return json({ ok: true, user_id: newUserId });
});
