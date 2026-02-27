// =============================================================================
// unfreeze_version — Battery LCA Tool Edge Function
// =============================================================================
// Reverts a frozen revision back to 'draft' status and records the event in
// the unfreeze_log JSONB audit array on battery_model_revision.
//
// Auth: caller must be authenticated AND have role = 'admin' in app_user.
//
// POST /functions/v1/unfreeze_version
// Authorization: Bearer <user-jwt>
// {
//   "revision_id": "<uuid>",                    // required
//   "reason":      "Fix typo in exchange amount" // required
// }
//
// Response 200: { "ok": true, "revision_id": "<uuid>" }
//
// Env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_ANON_KEY         (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// =============================================================================

import { adminClient, handleCors, json, requireAdmin } from "../_shared/utils.ts";

interface UnfreezeLogEntry {
  unfrozen_at: string;
  unfrozen_by: string;
  reason:      string;
}

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
  let body: { revision_id?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad Request: invalid JSON" }, 400);
  }

  const revisionId = (body.revision_id ?? "").trim();
  const reason     = (body.reason ?? "").trim();

  if (!revisionId) return json({ error: "Bad Request: revision_id is required" }, 400);
  if (!reason)     return json({ error: "Bad Request: reason is required" }, 400);

  // ── Fetch current revision ────────────────────────────────────────────────
  const { data: rev, error: fetchErr } = await svc
    .from("battery_model_revision")
    .select("revision_id, status, frozen_at, unfreeze_log")
    .eq("revision_id", revisionId)
    .single();

  if (fetchErr || !rev) {
    return json({ error: "Not Found: revision does not exist" }, 404);
  }

  const currentStatus = (rev as { status: string }).status;
  if (currentStatus !== "frozen") {
    return json({
      error: `Conflict: revision is '${currentStatus}'; only frozen revisions can be unfrozen`,
    }, 409);
  }

  // ── Append to unfreeze_log and clear frozen state ─────────────────────────
  const currentLog = ((rev as { unfreeze_log: unknown }).unfreeze_log ?? []) as UnfreezeLogEntry[];
  const updatedLog: UnfreezeLogEntry[] = [
    ...currentLog,
    { unfrozen_at: new Date().toISOString(), unfrozen_by: callerId, reason },
  ];

  const { error: updateErr } = await svc
    .from("battery_model_revision")
    .update({ status: "draft", frozen_at: null, unfreeze_log: updatedLog })
    .eq("revision_id", revisionId)
    .eq("status", "frozen"); // extra guard: only update if still frozen

  if (updateErr) {
    console.error("unfreeze_version: update failed:", updateErr);
    return json({ error: updateErr.message }, 500);
  }

  console.log(
    `unfreeze_version: revision_id=${revisionId} unfrozen_by=${callerId} reason="${reason}"`,
  );
  return json({ ok: true, revision_id: revisionId });
});
