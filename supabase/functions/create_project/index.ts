// =============================================================================
// create_project — Battery LCA Tool Edge Function
// =============================================================================
// Creates a new project and adds the specified users as project members.
// The creating admin is automatically added as a project-level 'admin' member.
// All other member_ids are added as 'manufacturer' by default.
//
// Auth: caller must be authenticated AND have role = 'admin' in app_user.
//
// POST /functions/v1/create_project
// Authorization: Bearer <user-jwt>
// {
//   "name":        "NMC 2025 Study",        // required
//   "description": "Phase 1 scope ...",     // optional
//   "member_ids":  ["<uuid>", "<uuid>"]     // optional; additional users to add
// }
//
// Response 200: { "ok": true, "project_id": "<uuid>" }
//
// Env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_ANON_KEY         (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// =============================================================================

import { adminClient, handleCors, json, requireAdmin } from "../_shared/utils.ts";

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
  let body: { name?: string; description?: string; member_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad Request: invalid JSON" }, 400);
  }

  const name        = (body.name ?? "").trim();
  const description = (body.description ?? "").trim() || null;
  const memberIds   = Array.isArray(body.member_ids) ? body.member_ids : [];

  if (!name) {
    return json({ error: "Bad Request: 'name' is required" }, 400);
  }

  // ── Validate member_ids are real app_user rows ────────────────────────────
  if (memberIds.length > 0) {
    const { data: users, error: usersErr } = await svc
      .from("app_user")
      .select("user_id")
      .in("user_id", memberIds);

    if (usersErr) {
      console.error("create_project: member lookup failed:", usersErr);
      return json({ error: "Failed to validate member_ids" }, 500);
    }

    const foundIds = new Set((users ?? []).map((u: { user_id: string }) => u.user_id));
    const missing  = memberIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return json({ error: `Bad Request: unknown member_ids: ${missing.join(", ")}` }, 400);
    }
  }

  // ── Insert project ────────────────────────────────────────────────────────
  const { data: project, error: projectErr } = await svc
    .from("project")
    .insert({ name, description, created_by: callerId })
    .select("project_id")
    .single();

  if (projectErr || !project) {
    console.error("create_project: project insert failed:", projectErr);
    return json({ error: projectErr?.message ?? "Failed to create project" }, 500);
  }

  const projectId = project.project_id as string;

  // ── Build project_member rows ─────────────────────────────────────────────
  // Creator → 'admin' member.  Additional member_ids → 'manufacturer'.
  const memberRows: Array<{
    project_id:  string;
    user_id:     string;
    role:        string;
    assigned_by: string;
  }> = [
    { project_id: projectId, user_id: callerId, role: "admin", assigned_by: callerId },
  ];

  for (const uid of memberIds) {
    // Skip if the admin is also in the member_ids list (already added above).
    if (uid === callerId) continue;
    memberRows.push({
      project_id:  projectId,
      user_id:     uid,
      role:        "manufacturer",
      assigned_by: callerId,
    });
  }

  const { error: memberErr } = await svc.from("project_member").insert(memberRows);

  if (memberErr) {
    console.error("create_project: project_member insert failed:", memberErr);
    // Attempt rollback by deleting the project.
    await svc.from("project").delete().eq("project_id", projectId);
    return json({ error: "Failed to add project members; project creation rolled back" }, 500);
  }

  console.log(
    `create_project: project_id=${projectId} name="${name}" members=${memberRows.length} ` +
    `created_by=${callerId}`,
  );
  return json({ ok: true, project_id: projectId });
});
