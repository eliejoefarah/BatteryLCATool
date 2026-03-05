// =============================================================================
// trigger_validation — Battery LCA Tool Edge Function
// =============================================================================
// Authenticates the caller then proxies the validation request to the FastAPI
// service. FastAPI handles the validation logic and writes validation_run +
// validation_issue rows. The triggered_by user_id is forwarded so FastAPI
// can record it in validation_run.triggered_by.
//
// Auth: any authenticated user.
//
// POST /functions/v1/trigger_validation
// Authorization: Bearer <user-jwt>
// { "revision_id": "<uuid>" }
//
// Response 200: FastAPI validation result JSON
//
// Env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_ANON_KEY         (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//   FASTAPI_URL               (e.g. "https://your-api.up.railway.app")
//   INTERNAL_API_SECRET       (shared secret forwarded to FastAPI to restrict /validate access)
// =============================================================================

import { CORS_HEADERS, handleCors, json, requireAuth } from "../_shared/utils.ts";

const FASTAPI_URL     = (Deno.env.get("FASTAPI_URL") ?? "").replace(/\/$/, "");
const INTERNAL_SECRET = Deno.env.get("INTERNAL_API_SECRET") ?? "";

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authResult = await requireAuth(req.headers.get("Authorization"));
  if (authResult instanceof Response) return authResult;
  const { callerId } = authResult;

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { revision_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad Request: invalid JSON" }, 400);
  }

  const revisionId = (body.revision_id ?? "").trim();
  if (!revisionId) {
    return json({ error: "Bad Request: revision_id is required" }, 400);
  }

  // ── Proxy to FastAPI /validate ────────────────────────────────────────────
  if (!FASTAPI_URL) {
    return json({ error: "Server Error: FASTAPI_URL is not configured" }, 500);
  }

  let fastapiRes: Response;
  try {
    const fastapiHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (INTERNAL_SECRET) fastapiHeaders["x-internal-secret"] = INTERNAL_SECRET;

    fastapiRes = await fetch(`${FASTAPI_URL}/validate`, {
      method:  "POST",
      headers: fastapiHeaders,
      body:    JSON.stringify({ revision_id: revisionId, triggered_by: callerId }),
    });
  } catch (fetchErr) {
    console.error("trigger_validation: fetch to FastAPI failed:", fetchErr);
    return json({ error: "Failed to reach the validation service" }, 502);
  }

  const responseBody = await fastapiRes.text();
  console.log(
    `trigger_validation: revision_id=${revisionId} ` +
    `fastapi_status=${fastapiRes.status} triggered_by=${callerId}`,
  );

  return new Response(responseBody, {
    status:  fastapiRes.status,
    headers: {
      "Content-Type": fastapiRes.headers.get("Content-Type") ?? "application/json",
      ...CORS_HEADERS,
    },
  });
});
