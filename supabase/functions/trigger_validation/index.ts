// =============================================================================
// trigger_validation — Battery LCA Tool Edge Function
// =============================================================================
// Authenticates the caller, verifies they have access to the revision, then
// proxies the validation request to the FastAPI service.
// FastAPI handles the validation logic and writes validation_run +
// validation_issue rows. The triggered_by user_id is forwarded so FastAPI
// can record it in validation_run.triggered_by.
//
// Auth: any authenticated user who is a member of the project owning the revision.
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
// =============================================================================

import { adminClient, handleCors, json, requireAuth } from "../_shared/utils.ts";

const FASTAPI_URL = (Deno.env.get("FASTAPI_URL") ?? "").replace(/\/$/, "");

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authResult = requireAuth(req.headers.get("Authorization"));
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

  const svc = adminClient();

  // ── Verify revision exists and caller has project membership ──────────────
  const { data: rev, error: revErr } = await svc
    .from("battery_model_revision")
    .select("revision_id, status, battery_model!inner(project_id)")
    .eq("revision_id", revisionId)
    .single();

  if (revErr || !rev) {
    return json({ error: "Not Found: revision does not exist" }, 404);
  }

  const projectId = (rev as { battery_model: { project_id: string } }).battery_model.project_id;

  const { data: membership } = await svc
    .from("project_member")
    .select("member_id")
    .eq("project_id", projectId)
    .eq("user_id", callerId)
    .maybeSingle();

  if (!membership) {
    return json({ error: "Forbidden: you are not a member of this project" }, 403);
  }

  // ── Proxy to FastAPI /validate ────────────────────────────────────────────
  if (!FASTAPI_URL) {
    return json({ error: "Server Error: FASTAPI_URL is not configured" }, 500);
  }

  let fastapiRes: Response;
  try {
    fastapiRes = await fetch(`${FASTAPI_URL}/validate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
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
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
});
