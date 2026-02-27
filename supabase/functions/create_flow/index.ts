// =============================================================================
// create_flow — Battery LCA Tool Edge Function
// =============================================================================
// Inserts one flow into flow_catalog, then inserts one flow_allowed_unit row
// for every unit in unit_catalog whose dimension matches the flow's dimension.
//
// Auth: any authenticated user with an active session.
//
// POST /functions/v1/create_flow
// Authorization: Bearer <user-jwt>
// {
//   "catalog_set_id":     "<uuid>",           // required
//   "canonical_name":     "CO2",              // required
//   "display_name":       "Carbon dioxide",   // optional
//   "kind":               "emission",         // required; flow_kind_enum value
//   "dimension":          "mass",             // optional; flow_dimension_enum value
//   "default_unit":       "kg",               // optional; symbol string
//   "is_elementary_flow": true,               // optional; default false
//   "cas_number":         "124-38-9"          // optional
// }
//
// Response 200:
// { "ok": true, "flow_id": "<uuid>", "allowed_units_added": 3 }
//
// Env vars:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_ANON_KEY         (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// =============================================================================

import { adminClient, handleCors, json, requireAuth } from "../_shared/utils.ts";

const VALID_KINDS = ["material", "energy", "emission", "waste", "water", "service"] as const;
const VALID_DIMS  = [
  "mass", "energy", "volume", "area", "length",
  "count", "transport", "radioactivity", "time", "other",
] as const;

type FlowKind = typeof VALID_KINDS[number];
type FlowDim  = typeof VALID_DIMS[number];

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // ── Auth (any authenticated user) ─────────────────────────────────────────
  const authResult = requireAuth(req.headers.get("Authorization"));
  if (authResult instanceof Response) return authResult;

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: {
    catalog_set_id?:     string;
    canonical_name?:     string;
    display_name?:       string;
    kind?:               string;
    dimension?:          string;
    default_unit?:       string;
    is_elementary_flow?: boolean;
    cas_number?:         string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad Request: invalid JSON" }, 400);
  }

  const catalogSetId     = (body.catalog_set_id ?? "").trim();
  const canonicalName    = (body.canonical_name ?? "").trim();
  const displayName      = (body.display_name ?? "").trim() || null;
  const kind             = (body.kind ?? "").trim() as FlowKind;
  const dimension        = (body.dimension ?? "").trim();
  const defaultUnit      = (body.default_unit ?? "").trim() || null;
  const isElementaryFlow = body.is_elementary_flow === true;
  const casNumber        = (body.cas_number ?? "").trim() || null;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!catalogSetId)  return json({ error: "Bad Request: catalog_set_id is required" }, 400);
  if (!canonicalName) return json({ error: "Bad Request: canonical_name is required" }, 400);
  if (!VALID_KINDS.includes(kind)) {
    return json({ error: `Bad Request: kind must be one of: ${VALID_KINDS.join(", ")}` }, 400);
  }
  if (dimension && !VALID_DIMS.includes(dimension as FlowDim)) {
    return json({ error: `Bad Request: dimension must be one of: ${VALID_DIMS.join(", ")}` }, 400);
  }

  const svc = adminClient();

  // ── Verify catalog_set exists ─────────────────────────────────────────────
  const { error: csErr } = await svc
    .from("catalog_set")
    .select("catalog_set_id")
    .eq("catalog_set_id", catalogSetId)
    .single();
  if (csErr) {
    return json({ error: "Bad Request: catalog_set_id does not exist" }, 400);
  }

  // ── Insert flow_catalog ───────────────────────────────────────────────────
  const { data: flow, error: flowErr } = await svc
    .from("flow_catalog")
    .insert({
      catalog_set_id:     catalogSetId,
      canonical_name:     canonicalName,
      display_name:       displayName,
      kind:               kind,
      dimension:          dimension || null,
      default_unit:       defaultUnit,
      is_elementary_flow: isElementaryFlow,
      cas_number:         casNumber,
    })
    .select("flow_id")
    .single();

  if (flowErr || !flow) {
    if (flowErr?.code === "23505") {
      return json({
        error: `Conflict: a flow with canonical_name="${canonicalName}" and kind="${kind}" already exists in this catalog_set`,
      }, 409);
    }
    console.error("create_flow: flow_catalog insert failed:", flowErr);
    return json({ error: flowErr?.message ?? "Failed to insert flow" }, 500);
  }

  const flowId = flow.flow_id as string;

  // ── Insert flow_allowed_unit for all units matching the dimension ──────────
  let allowedUnitsAdded = 0;
  if (dimension) {
    const { data: units, error: unitsErr } = await svc
      .from("unit_catalog")
      .select("unit_id")
      .eq("dimension", dimension);

    if (unitsErr) {
      console.error("create_flow: unit_catalog query failed:", unitsErr);
      // Non-fatal: flow is inserted; units can be added manually later.
    } else if (units && units.length > 0) {
      const unitRows = (units as { unit_id: string }[]).map((u) => ({
        flow_id: flowId,
        unit_id: u.unit_id,
      }));

      const { error: unitInsertErr } = await svc
        .from("flow_allowed_unit")
        .insert(unitRows);

      if (unitInsertErr) {
        console.error("create_flow: flow_allowed_unit insert failed:", unitInsertErr);
      } else {
        allowedUnitsAdded = unitRows.length;
      }
    }
  }

  console.log(
    `create_flow: flow_id=${flowId} canonical_name="${canonicalName}" ` +
    `kind=${kind} dimension=${dimension || "null"} allowed_units=${allowedUnitsAdded}`,
  );
  return json({ ok: true, flow_id: flowId, allowed_units_added: allowedUnitsAdded });
});
