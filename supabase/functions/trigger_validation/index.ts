// =============================================================================
// trigger_validation — Battery LCA Tool Edge Function
// =============================================================================
// Authenticates the caller then proxies the validation request to the FastAPI
// service. FastAPI handles the validation logic and writes validation_run +
// validation_issue rows. The triggered_by user_id is forwarded so FastAPI
// can record it in validation_run.triggered_by.
//
// Auth: the caller must be able to see the revision under RLS (project member
// or admin). Frozen revisions can only be re-validated by an admin.
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

import {
  adminClient, CORS_HEADERS, handleCors, isAdmin, json, requireAuth, userClient,
} from "../_shared/utils.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FASTAPI_URL     = (Deno.env.get("FASTAPI_URL") ?? "").replace(/\/$/, "");
const INTERNAL_SECRET = Deno.env.get("INTERNAL_API_SECRET") ?? "";

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  const authResult = await requireAuth(authHeader);
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
  if (!UUID_RE.test(revisionId)) {
    return json({ error: "Bad Request: revision_id must be a UUID" }, 400);
  }

  // ── Authorization ─────────────────────────────────────────────────────────
  // Look the revision up as the caller: RLS only returns it to admins and
  // members of its project. FastAPI /validate runs as the table owner and
  // checks nothing, so this is the only gate.
  const { data: revision, error: revErr } = await userClient(authHeader!)
    .from("battery_model_revision")
    .select("revision_id, frozen_at")
    .eq("revision_id", revisionId)
    .maybeSingle();
  if (revErr) {
    console.error("trigger_validation: revision lookup failed:", revErr);
    return json({ error: "Server Error: could not look up the revision" }, 500);
  }
  if (!revision) {
    return json({ error: "Not Found: revision not found or you do not have access" }, 404);
  }
  if (revision.frozen_at && !(await isAdmin(adminClient(), callerId))) {
    return json({ error: "Locked: this revision is frozen; only an admin can re-validate it" }, 423);
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
