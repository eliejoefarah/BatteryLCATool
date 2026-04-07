-- =============================================================================
-- 014_deferred_flows.sql  —  Battery LCA Tool
-- =============================================================================
-- Inserts the 25 deferred flow_catalog entries documented in
-- MoreData/flow_catalog_flags.md (WARN-1, WARN-2, WARN-3).
--
-- Corrections applied vs. the provisional values in the flags file:
--   WARN-2  aluminium hydroxide factory construction  → kind=infrastructure, unit=unit
--   WARN-2  chemical factory construction, organics   → kind=infrastructure, unit=unit
--   WARN-2  compressed air production, 1200 kPa …    → unit=m3  (not kg)
-- All other provisional values were confirmed as correct.
-- =============================================================================

-- =============================================================================
-- WARN-1 — Elementary flows with compartment context (9 entries)
-- =============================================================================

-- Natural resource / in ground (material)
INSERT INTO flow_catalog
  (flow_id, catalog_set_id, canonical_name, kind, is_elementary_flow, dimension, default_unit)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'Cobalt [natural resource/in ground]',    'material'::flow_kind_enum, TRUE, 'mass'::flow_dimension_enum, 'kg'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'Copper [natural resource/in ground]',    'material'::flow_kind_enum, TRUE, 'mass'::flow_dimension_enum, 'kg'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'Nickel [natural resource/in ground]',    'material'::flow_kind_enum, TRUE, 'mass'::flow_dimension_enum, 'kg'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'Manganese [natural resource/in ground]', 'material'::flow_kind_enum, TRUE, 'mass'::flow_dimension_enum, 'kg')
ON CONFLICT DO NOTHING;

-- Emission flows (precious metals → air; others → water)
INSERT INTO flow_catalog
  (flow_id, catalog_set_id, canonical_name, kind, is_elementary_flow, dimension, default_unit)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'Gold [water/unspecified]',      'emission'::flow_kind_enum, TRUE, 'mass'::flow_dimension_enum, 'kg'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'Iron [water/freshwater]',       'emission'::flow_kind_enum, TRUE, 'mass'::flow_dimension_enum, 'kg'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'Palladium [air/unspecified]',   'emission'::flow_kind_enum, TRUE, 'mass'::flow_dimension_enum, 'kg'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'Platinum [air/unspecified]',    'emission'::flow_kind_enum, TRUE, 'mass'::flow_dimension_enum, 'kg'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'Rhodium [air/unspecified]',     'emission'::flow_kind_enum, TRUE, 'mass'::flow_dimension_enum, 'kg')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- WARN-2 — Ecoinvent process names used as intermediate flows (13 entries)
-- =============================================================================

-- Heat production flows — kind=energy, unit=MJ
INSERT INTO flow_catalog
  (flow_id, catalog_set_id, canonical_name, kind, is_elementary_flow, dimension, default_unit)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'heat production, heavy fuel oil, at industrial furnace 1MW',
   'energy'::flow_kind_enum, FALSE, 'energy'::flow_dimension_enum, 'MJ'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'heat production, light fuel oil, at industrial furnace 1MW',
   'energy'::flow_kind_enum, FALSE, 'energy'::flow_dimension_enum, 'MJ'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'heat production, natural gas, at industrial furnace >100kW',
   'energy'::flow_kind_enum, FALSE, 'energy'::flow_dimension_enum, 'MJ'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'heat production, wood chips from industry, at furnace 5000kW, state-of-the-art 2014',
   'energy'::flow_kind_enum, FALSE, 'energy'::flow_dimension_enum, 'MJ'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'heat production, untreated waste wood, at furnace 1000-5000 kW, state-of-the-art 2014',
   'energy'::flow_kind_enum, FALSE, 'energy'::flow_dimension_enum, 'MJ'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'heat production, air-water heat pump 10kW',
   'energy'::flow_kind_enum, FALSE, 'energy'::flow_dimension_enum, 'MJ'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'heat production, at hard coal industrial furnace 1-10MW',
   'energy'::flow_kind_enum, FALSE, 'energy'::flow_dimension_enum, 'MJ'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'heat, from municipal waste incineration to generic market for heat district or industrial, other than natural gas',
   'energy'::flow_kind_enum, FALSE, 'energy'::flow_dimension_enum, 'MJ')
ON CONFLICT DO NOTHING;

-- Factory construction flows — kind=infrastructure, unit=unit  [USER CORRECTION]
INSERT INTO flow_catalog
  (flow_id, catalog_set_id, canonical_name, kind, is_elementary_flow, dimension, default_unit)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'aluminium hydroxide factory construction',
   'infrastructure'::flow_kind_enum, FALSE, 'count'::flow_dimension_enum, 'unit'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'chemical factory construction, organics',
   'infrastructure'::flow_kind_enum, FALSE, 'count'::flow_dimension_enum, 'unit')
ON CONFLICT DO NOTHING;

-- Compressed air — kind=material, unit=m3  [USER CORRECTION: was kg]
INSERT INTO flow_catalog
  (flow_id, catalog_set_id, canonical_name, kind, is_elementary_flow, dimension, default_unit)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'compressed air production, 1200 kPa gauge, <30kW, average generation',
   'material'::flow_kind_enum, FALSE, 'volume'::flow_dimension_enum, 'm3')
ON CONFLICT DO NOTHING;

-- Remaining material flows — kind=material, unit=kg
INSERT INTO flow_catalog
  (flow_id, catalog_set_id, canonical_name, kind, is_elementary_flow, dimension, default_unit)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'silica sand production',
   'material'::flow_kind_enum, FALSE, 'mass'::flow_dimension_enum, 'kg'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'anode production, paste, for aluminium electrolysis',
   'material'::flow_kind_enum, FALSE, 'mass'::flow_dimension_enum, 'kg')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- WARN-3 — Land-use flows (area dimension) (3 entries)
-- =============================================================================

INSERT INTO flow_catalog
  (flow_id, catalog_set_id, canonical_name, kind, is_elementary_flow, dimension, default_unit)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'Transformation, to mineral extraction site',
   'material'::flow_kind_enum, TRUE, 'area'::flow_dimension_enum, 'm2'),
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'Transformation, from unknown',
   'material'::flow_kind_enum, TRUE, 'area'::flow_dimension_enum, 'm2'),
  -- 'other' dimension because m2*year is an integrated area-time unit, not pure area
  (gen_random_uuid(), '00000000-0000-0000-0001-000000000001',
   'Occupation, mineral extraction site',
   'material'::flow_kind_enum, TRUE, 'other'::flow_dimension_enum, 'm2*year')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- flow_allowed_unit — permitted units per flow
-- Use subqueries on canonical_name to avoid hard-coding gen_random_uuid() IDs.
-- =============================================================================

-- Mass flows → kg (u-001)
INSERT INTO flow_allowed_unit (flow_id, unit_id)
SELECT fc.flow_id, 'u-001'
FROM flow_catalog fc
WHERE fc.catalog_set_id = '00000000-0000-0000-0001-000000000001'
  AND fc.canonical_name IN (
    'Cobalt [natural resource/in ground]',
    'Copper [natural resource/in ground]',
    'Nickel [natural resource/in ground]',
    'Manganese [natural resource/in ground]',
    'Gold [water/unspecified]',
    'Iron [water/freshwater]',
    'Palladium [air/unspecified]',
    'Platinum [air/unspecified]',
    'Rhodium [air/unspecified]',
    'silica sand production',
    'anode production, paste, for aluminium electrolysis'
  )
ON CONFLICT DO NOTHING;

-- Energy flows → MJ (u-005)
INSERT INTO flow_allowed_unit (flow_id, unit_id)
SELECT fc.flow_id, 'u-005'
FROM flow_catalog fc
WHERE fc.catalog_set_id = '00000000-0000-0000-0001-000000000001'
  AND fc.canonical_name IN (
    'heat production, heavy fuel oil, at industrial furnace 1MW',
    'heat production, light fuel oil, at industrial furnace 1MW',
    'heat production, natural gas, at industrial furnace >100kW',
    'heat production, wood chips from industry, at furnace 5000kW, state-of-the-art 2014',
    'heat production, untreated waste wood, at furnace 1000-5000 kW, state-of-the-art 2014',
    'heat production, air-water heat pump 10kW',
    'heat production, at hard coal industrial furnace 1-10MW',
    'heat, from municipal waste incineration to generic market for heat district or industrial, other than natural gas'
  )
ON CONFLICT DO NOTHING;

-- Infrastructure flows → unit (u-002)
INSERT INTO flow_allowed_unit (flow_id, unit_id)
SELECT fc.flow_id, 'u-002'
FROM flow_catalog fc
WHERE fc.catalog_set_id = '00000000-0000-0000-0001-000000000001'
  AND fc.canonical_name IN (
    'aluminium hydroxide factory construction',
    'chemical factory construction, organics'
  )
ON CONFLICT DO NOTHING;

-- Compressed air → m3 (u-004)
INSERT INTO flow_allowed_unit (flow_id, unit_id)
SELECT fc.flow_id, 'u-004'
FROM flow_catalog fc
WHERE fc.catalog_set_id = '00000000-0000-0000-0001-000000000001'
  AND fc.canonical_name = 'compressed air production, 1200 kPa gauge, <30kW, average generation'
ON CONFLICT DO NOTHING;

-- Land transformation → m2 (u-007)
INSERT INTO flow_allowed_unit (flow_id, unit_id)
SELECT fc.flow_id, 'u-007'
FROM flow_catalog fc
WHERE fc.catalog_set_id = '00000000-0000-0000-0001-000000000001'
  AND fc.canonical_name IN (
    'Transformation, to mineral extraction site',
    'Transformation, from unknown'
  )
ON CONFLICT DO NOTHING;

-- Land occupation → m2*year (u-008)
INSERT INTO flow_allowed_unit (flow_id, unit_id)
SELECT fc.flow_id, 'u-008'
FROM flow_catalog fc
WHERE fc.catalog_set_id = '00000000-0000-0000-0001-000000000001'
  AND fc.canonical_name = 'Occupation, mineral extraction site'
ON CONFLICT DO NOTHING;
