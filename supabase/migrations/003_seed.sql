-- =============================================================================
-- 003_seed.sql  —  Battery LCA Tool  —  Bootstrap seed data
-- =============================================================================
-- All inserts use ON CONFLICT DO NOTHING for full idempotency.
-- Safe to run multiple times; subsequent runs are no-ops.
-- =============================================================================


-- =============================================================================
-- BLOCK 0 — System seed user  →  DEFAULT catalog_set
-- =============================================================================
-- catalog_set.created_by is NOT NULL → requires a valid app_user FK.
-- We bootstrap a non-interactive system user (no password, cannot log in)
-- to satisfy the FK and record authorship of the DEFAULT catalog set.
--
-- System user UUIDs use the reserved 00000000-… namespace so they are
-- instantly recognisable as synthetic rows, not real accounts.
--
-- catalog_set_id '00000000-0000-0000-0001-000000000001'
--   corresponds to the logical identifier 'cat-0001' in design documents.
-- =============================================================================

INSERT INTO auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'seed@system.internal',
    '',         -- empty hash: user cannot authenticate via password
    NOW(),
    NOW(),
    NOW()
) ON CONFLICT DO NOTHING;

INSERT INTO app_user (user_id, email, display_name, role)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'seed@system.internal',
    'System Seed User',
    'admin'
) ON CONFLICT DO NOTHING;

INSERT INTO catalog_set (catalog_set_id, name, description, created_by)
VALUES (
    '00000000-0000-0000-0001-000000000001',
    'DEFAULT',
    'Default ecoinvent-compatible catalog set shipped with the application.',
    '00000000-0000-0000-0000-000000000001'
) ON CONFLICT DO NOTHING;


-- =============================================================================
-- BLOCK 1 — unit_catalog  (21 rows)
-- =============================================================================
-- Pre-seeded with the confirmed ecoinvent exchange units used in the LCA tool.
-- factor_to_si converts one unit of the symbol to the SI base unit:
--   mass → kg,  energy → J,  volume → m³,  area → m²,  length → m,
--   radioactivity → Bq,  time → s.
-- Compound/integration units (m²·year, kg·day, etc.) use their natural SI
-- equivalent (e.g. kg·s) for the conversion factor.
-- =============================================================================

INSERT INTO unit_catalog (unit_id, symbol, dimension, factor_to_si, description) VALUES
    ('u-001', 'kg',            'mass',          1.0,       'Kilogram — SI base unit of mass'),
    ('u-002', 'unit',          'count',          1.0,       'Dimensionless count of discrete items'),
    ('u-003', 'kWh',           'energy',   3600000.0,      'Kilowatt-hour; 1 kWh = 3 600 000 J'),
    ('u-004', 'm3',            'volume',         1.0,       'Cubic metre — SI base unit of volume'),
    ('u-005', 'MJ',            'energy',   1000000.0,      'Megajoule; 1 MJ = 1 000 000 J'),
    ('u-006', 'metric ton*km', 'transport',    1000.0,     'Tonne-kilometre; 1 t·km = 1 000 kg·km'),
    ('u-007', 'm2',            'area',           1.0,       'Square metre — SI base unit of area'),
    ('u-008', 'm2*year',       'other',          1.0,       'Square metre-year; land-use integration unit'),
    ('u-009', 'ha',            'area',       10000.0,      'Hectare; 1 ha = 10 000 m²'),
    ('u-010', 'km',            'length',      1000.0,      'Kilometre; 1 km = 1 000 m'),
    ('u-011', 'm',             'length',         1.0,       'Metre — SI base unit of length'),
    ('u-012', 'kBq',           'radioactivity', 1000.0,   'Kilobecquerel; 1 kBq = 1 000 Bq'),
    ('u-013', 'hour',          'time',         3600.0,     'Hour; 1 h = 3 600 s'),
    ('u-014', 'm*year',        'other',          1.0,       'Metre-year; linear infrastructure use integration unit'),
    ('u-015', 'm3*year',       'other',          1.0,       'Cubic metre-year; volume-use integration unit'),
    ('u-016', 'Sm3',           'volume',         1.0,       'Standard cubic metre (0 °C, 101 325 Pa)'),
    ('u-017', 'l',             'volume',         0.001,     'Litre; 1 L = 0.001 m³'),
    ('u-018', 'kg*day',        'other',       86400.0,     'Kilogram-day; 1 kg·day = 86 400 kg·s'),
    ('u-019', 'person*km',     'transport',      1.0,       'Person-kilometre; passenger transport functional unit'),
    ('u-020', 'km*year',       'other',          1.0,       'Kilometre-year; route-length use integration unit'),
    ('u-021', 'guest night',   'count',          1.0,       'Guest-night; accommodation service functional unit')
ON CONFLICT DO NOTHING;


-- =============================================================================
-- BLOCK 2 — region_catalog  (20 representative rows)
-- =============================================================================
-- NOTE: The full 541-row dataset must be generated from the ecoinvent
-- Geographies.xml file.  Run the helper script and apply its output:
--
--   python scripts/generate_regions.py --xml path/to/Geographies.xml \
--       > /tmp/regions_insert.sql
--   psql "$DATABASE_URL" -f /tmp/regions_insert.sql
--
-- The script sets is_ecoinvent_shortcut = TRUE for virtual geographies
-- (GLO, RoW, RER, and similar multi-country aggregates).
-- =============================================================================

INSERT INTO region_catalog (code, name, is_ecoinvent_shortcut) VALUES
    ('DE',  'Germany',        FALSE),
    ('CN',  'China',          FALSE),
    ('US',  'United States',  FALSE),
    ('GLO', 'Global',         TRUE),   -- ecoinvent virtual geography
    ('RER', 'Europe',         TRUE),   -- ecoinvent virtual geography
    ('RoW', 'Rest of World',  TRUE),   -- ecoinvent virtual geography
    ('NO',  'Norway',         FALSE),
    ('JP',  'Japan',          FALSE),
    ('KR',  'South Korea',    FALSE),
    ('IN',  'India',          FALSE),
    ('AU',  'Australia',      FALSE),
    ('BR',  'Brazil',         FALSE),
    ('CA',  'Canada',         FALSE),
    ('FR',  'France',         FALSE),
    ('GB',  'United Kingdom', FALSE),
    ('IT',  'Italy',          FALSE),
    ('ES',  'Spain',          FALSE),
    ('SE',  'Sweden',         FALSE),
    ('FI',  'Finland',        FALSE),
    ('CH',  'Switzerland',    FALSE)
ON CONFLICT DO NOTHING;


-- =============================================================================
-- BLOCK 3 — data_origin_catalog  (5 rows)
-- =============================================================================

INSERT INTO data_origin_catalog (code, label, description) VALUES
    ('measured',   'Measured',   'Value obtained from direct physical measurement or metering'),
    ('datasheet',  'Datasheet',  'Value taken from a manufacturer or supplier data sheet'),
    ('literature', 'Literature', 'Value sourced from a peer-reviewed publication or technical report'),
    ('estimate',   'Estimate',   'Engineering estimate or expert judgement in the absence of data'),
    ('default',    'Default',    'Default fallback value applied when no other source is available')
ON CONFLICT DO NOTHING;


-- =============================================================================
-- BLOCK 4 — validation_rule  (9 rows)
-- =============================================================================
-- rule_id uses the 00000001-… reserved namespace for stable, seed-defined rules.
-- rule_json is left as the column default '{}'; rule logic is implemented in
-- the validation engine (api/app/services/validation.py) keyed by code.
-- =============================================================================

INSERT INTO validation_rule (rule_id, code, severity, description) VALUES
    (
        '00000001-0000-0000-0000-000000000001',
        'MISSING_REF_FLOW',
        'error',
        'A foreground process has no output exchange flagged as reference product.'
    ),
    (
        '00000001-0000-0000-0000-000000000002',
        'UNMAPPED_FLOW',
        'warning',
        'A background flow has no confirmed Brightway mapping selection.'
    ),
    (
        '00000001-0000-0000-0000-000000000003',
        'UNIT_MISMATCH',
        'error',
        'The user-supplied unit is not in the allowed-unit list for the matched flow.'
    ),
    (
        '00000001-0000-0000-0000-000000000004',
        'NEGATIVE_FOREGROUND_QTY',
        'error',
        'A foreground exchange quantity is negative where a positive value is expected.'
    ),
    (
        '00000001-0000-0000-0000-000000000005',
        'NEGATIVE_REF_PRODUCT',
        'error',
        'The reference product output amount is zero or negative.'
    ),
    (
        '00000001-0000-0000-0000-000000000006',
        'PARAM_RANGE',
        'warning',
        'A model parameter value lies outside its declared min/max bounds.'
    ),
    (
        '00000001-0000-0000-0000-000000000007',
        'FORMULA_PRESERVED',
        'info',
        'An exchange amount was supplied as a formula string; the formula was retained as-is for export.'
    ),
    (
        '00000001-0000-0000-0000-000000000008',
        'FOREGROUND_CONFIRMED',
        'info',
        'All foreground exchanges in the revision have been reviewed and confirmed.'
    ),
    (
        '00000001-0000-0000-0000-000000000009',
        'ECOINVENT_NEGATIVE_AMT',
        'info',
        'A background exchange carries a negative amount per ecoinvent sign convention; this is expected behaviour.'
    )
ON CONFLICT DO NOTHING;
