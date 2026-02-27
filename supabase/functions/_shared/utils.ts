// =============================================================================
// _shared/utils.ts — Battery LCA Tool Edge Functions
// Shared helpers imported by every Edge Function.
// =============================================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Env vars — resolved once at module load (available in every invocation).
// ---------------------------------------------------------------------------
export const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
export const SUPABASE_ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY")!;
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ---------------------------------------------------------------------------
// CORS — required for browser → Edge Function calls.
// Webhook functions (on_user_created) don't need these.
// ---------------------------------------------------------------------------
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

/**
 * Handle CORS preflight. Call at the top of every handler that serves browsers.
 * Returns a 204 Response if this is an OPTIONS request; null otherwise.
 */
export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return null;
}

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ---------------------------------------------------------------------------
// Supabase clients
// ---------------------------------------------------------------------------

/** Service-role client — bypasses RLS. Use only after auth + authz checks. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Decode a JWT payload without verifying the signature.
 * Safe because:
 *   - In production: the Supabase API gateway verifies the signature before
 *     the Edge Function is invoked (verify_jwt = true by default).
 *   - In local dev: verify_jwt = false in config.toml; signature checking is
 *     skipped at the runtime level, so we just need the sub claim.
 *
 * Returns the user_id (sub claim) or null if the token is malformed / expired.
 */
function _decodeJwtSub(jwt: string): string | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;

    // Base64url → base64 → decode
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64));

    // Reject expired tokens
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract the bearer token from an Authorization header and return the
 * caller's user_id (JWT sub claim).
 * Returns null when the token is absent, malformed, or expired.
 */
export function resolveCallerId(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  return _decodeJwtSub(jwt);
}

/**
 * Return true when the given user_id has role = 'admin' in app_user.
 * Uses the service-role client to bypass RLS.
 */
export async function isAdmin(
  svc: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await svc
    .from("app_user")
    .select("role")
    .eq("user_id", userId)
    .single();
  if (error || !data) return false;
  return (data as { role: string }).role === "admin";
}

/**
 * Convenience: resolve caller and enforce admin.
 * Returns { callerId } on success, or a Response on failure (401 / 403).
 */
export async function requireAdmin(
  authHeader: string | null,
  svc: SupabaseClient,
): Promise<{ callerId: string } | Response> {
  const callerId = resolveCallerId(authHeader);
  if (!callerId) return json({ error: "Unauthorized: missing or invalid token" }, 401);
  if (!(await isAdmin(svc, callerId))) return json({ error: "Forbidden: admin role required" }, 403);
  return { callerId };
}

/**
 * Convenience: resolve caller, no role check.
 * Returns { callerId } on success, or a 401 Response on failure.
 */
export function requireAuth(
  authHeader: string | null,
): { callerId: string } | Response {
  const callerId = resolveCallerId(authHeader);
  if (!callerId) return json({ error: "Unauthorized: missing or invalid token" }, 401);
  return { callerId };
}
