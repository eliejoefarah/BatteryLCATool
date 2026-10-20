// =============================================================================
// _shared/utils.ts — Battery LCA Tool Edge Functions
// Shared helpers imported by every Edge Function.
// =============================================================================

// Explicit npm: specifier (not the deno.json import-map alias) so the import
// resolves on the self-hosted Edge Runtime, which doesn't read deno.json.
// Exact version: the VM can't download packages, so ship.sh caches exactly
// this one (see deploy/README.md, "Updating"). Keep in sync with deno.json.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.98.0";

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
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info",
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

/**
 * Client that acts as the caller (their JWT), so RLS decides what they can
 * see. Use it for access checks instead of re-implementing the RLS rules.
 */
export function userClient(authHeader: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Verify a bearer token via Supabase Auth (server-side, works with ES256 and
 * HS256). Uses an anon client so it goes through the normal auth verification
 * path and returns the verified user object.
 */
async function _verifyToken(jwt: string): Promise<string | null> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

/**
 * Extract the bearer token from an Authorization header and return the
 * verified caller's user_id. Uses auth.getUser() for full server-side
 * signature verification (ES256 + HS256 compatible).
 */
export async function resolveCallerId(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null;
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  return await _verifyToken(jwt);
}

async function account(
  svc: SupabaseClient,
  userId: string,
): Promise<{ role: string; is_active: boolean } | null> {
  const { data, error } = await svc
    .from("app_user")
    .select("role, is_active")
    .eq("user_id", userId)
    .single();
  return error || !data ? null : (data as { role: string; is_active: boolean });
}

/**
 * Return true when the given user_id is an active admin in app_user.
 * Uses the service-role client to bypass RLS.
 */
export async function isAdmin(
  svc: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const a = await account(svc, userId);
  return !!a && a.is_active && a.role === "admin";
}

/**
 * Convenience: resolve caller and enforce admin.
 * Returns { callerId } on success, or a Response on failure (401 / 403).
 */
export async function requireAdmin(
  authHeader: string | null,
  svc: SupabaseClient,
): Promise<{ callerId: string } | Response> {
  const callerId = await resolveCallerId(authHeader);
  if (!callerId) return json({ error: "Unauthorized: missing or invalid token" }, 401);
  const a = await account(svc, callerId);
  if (!a?.is_active) return json({ error: "Forbidden: this account is deactivated" }, 403);
  if (a.role !== "admin") return json({ error: "Forbidden: admin role required" }, 403);
  return { callerId };
}

/**
 * Convenience: resolve caller and require an active account, no role check.
 * Returns { callerId } on success, or a 401 / 403 Response on failure.
 */
export async function requireAuth(
  authHeader: string | null,
): Promise<{ callerId: string } | Response> {
  const callerId = await resolveCallerId(authHeader);
  if (!callerId) return json({ error: "Unauthorized: missing or invalid token" }, 401);
  const a = await account(adminClient(), callerId);
  if (!a?.is_active) return json({ error: "Forbidden: this account is deactivated" }, 403);
  return { callerId };
}
