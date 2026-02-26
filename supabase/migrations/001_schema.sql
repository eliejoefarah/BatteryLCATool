-- =============================================================================
-- 001_schema.sql  —  Battery LCA Tool  —  Complete schema (v6)
-- =============================================================================

-- =============================================================================
-- SECTION 0 — ENUM TYPES
-- PostgreSQL has no native CREATE TYPE IF NOT EXISTS; use DO-block guard instead.
-- =============================================================================

DO $$ BEGIN
    CREATE TYPE exchange_direction_enum AS ENUM ('input', 'output');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE output_type_enum AS ENUM ('reference', 'coproduct', 'waste_output', 'stock');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE system_boundary_enum AS ENUM ('foreground', 'background');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE flow_kind_enum AS ENUM ('material', 'energy', 'emission', 'waste', 'water', 'service');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE flow_dimension_enum AS ENUM (
        'mass', 'energy', 'volume', 'area', 'length',
        'count', 'transport', 'radioactivity', 'time', 'other'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE artifact_type_enum AS ENUM ('import', 'export', 'parameter_set', 'admin_export');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE model_status_enum AS ENUM ('draft', 'frozen');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE project_member_role_enum AS ENUM ('manufacturer', 'reviewer', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE validation_severity_enum AS ENUM ('error', 'warning', 'info');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE mapping_status_enum AS ENUM ('mapped', 'foreground', 'unmappable', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE param_type_enum AS ENUM ('scalar', 'lookup');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- =============================================================================
-- SECTION 1 — STATIC LOOKUP / BOOTSTRAP TABLES
-- (no user FKs; pre-seeded at deployment)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. app_user
-- Mirror of auth.users with application metadata (role, display name).
-- Populated by the on-user-created Edge Function webhook.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user (
    user_id       UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email         TEXT        NOT NULL,
    display_name  TEXT,
    role          TEXT        NOT NULL DEFAULT 'editor',  -- 'admin' | 'editor'
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. catalog_set
-- Named, versioned namespace for flows and rules.
-- Admin-only INSERT (enforced by RLS).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_set (
    catalog_set_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name           TEXT        NOT NULL UNIQUE,
    description    TEXT,
    created_by     UUID        NOT NULL REFERENCES app_user(user_id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. unit_catalog
-- Pre-seeded with 21 confirmed ecoinvent exchange units.
-- TEXT PK matches corpus-derived identifiers (u-001 … u-021).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unit_catalog (
    unit_id      TEXT               PRIMARY KEY,  -- e.g. 'u-001'
    symbol       TEXT               NOT NULL,
    dimension    flow_dimension_enum NOT NULL,
    factor_to_si NUMERIC            NOT NULL,
    description  TEXT,
    created_at   TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. region_catalog
-- Pre-seeded from ecoinvent Geographies.xml (541 entries).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS region_catalog (
    code                  TEXT        PRIMARY KEY,  -- e.g. 'DE', 'GLO', 'RER'
    name                  TEXT        NOT NULL,
    is_ecoinvent_shortcut BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5. data_origin_catalog
-- Provenance categories for exchange quantities.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_origin_catalog (
    code        TEXT        PRIMARY KEY,  -- e.g. 'measured', 'datasheet'
    label       TEXT        NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 6. flow_catalog
-- Master flow vocabulary. UNIQUE(catalog_set_id, canonical_name, kind) [FIX-02].
-- Starts empty; grows via create-flow Edge Function on import or manual entry.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flow_catalog (
    flow_id            UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_set_id     UUID               NOT NULL REFERENCES catalog_set(catalog_set_id),
    canonical_name     TEXT               NOT NULL,
    display_name       TEXT,
    kind               flow_kind_enum     NOT NULL,
    dimension          flow_dimension_enum,           -- nullable until inferred
    default_unit       TEXT,
    is_elementary_flow BOOLEAN            NOT NULL DEFAULT FALSE,
    cas_number         TEXT,
    created_at         TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    UNIQUE (catalog_set_id, canonical_name, kind)
);

-- ---------------------------------------------------------------------------
-- 7. flow_allowed_unit
-- Permitted units per flow; derived from flow.dimension + unit_catalog.dimension.
-- UNIQUE(flow_id, unit_id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flow_allowed_unit (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id    UUID        NOT NULL REFERENCES flow_catalog(flow_id),
    unit_id    TEXT        NOT NULL REFERENCES unit_catalog(unit_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (flow_id, unit_id)
);

-- ---------------------------------------------------------------------------
-- 8. validation_rule
-- Machine-readable constraint definitions read by the validation engine.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS validation_rule (
    rule_id     UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT                     NOT NULL UNIQUE,
    severity    validation_severity_enum NOT NULL,
    description TEXT,
    rule_json   JSONB                    NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 9. process_template
-- Named blueprint for a standard battery process stage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS process_template (
    template_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_set_id UUID        NOT NULL REFERENCES catalog_set(catalog_set_id),
    stage          TEXT        NOT NULL,  -- 'manufacturing' | 'use' | 'end_of_life'
    canonical_name TEXT        NOT NULL,
    ui_label       TEXT,
    ui_helptext    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 10. template_expected_exchange
-- One row per expected exchange slot in a process template.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS template_expected_exchange (
    expected_id   UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id   UUID                    NOT NULL REFERENCES process_template(template_id),
    flow_id       UUID                    NOT NULL REFERENCES flow_catalog(flow_id),
    direction     exchange_direction_enum NOT NULL,
    is_required   BOOLEAN                 NOT NULL DEFAULT TRUE,
    group_key     TEXT,
    min_occurs    INT                     NOT NULL DEFAULT 1,
    max_occurs    INT,                               -- NULL = unbounded
    display_order INT,
    ui_label      TEXT,
    created_at    TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- SECTION 2 — PROJECT & USER MANAGEMENT
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 11. project
-- Admin-created only; INSERT restricted to role = admin via RLS.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project (
    project_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    description TEXT,
    created_by  UUID        NOT NULL REFERENCES app_user(user_id),
    archived    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 12. project_member
-- Joins a user to a project with a scoped role.
-- assigned_by records the admin who made the assignment (audit trail).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_member (
    member_id   UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID                     NOT NULL REFERENCES project(project_id),
    user_id     UUID                     NOT NULL REFERENCES app_user(user_id),
    role        project_member_role_enum NOT NULL,
    assigned_by UUID                     NOT NULL REFERENCES app_user(user_id),
    created_at  TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- SECTION 3 — BATTERY MODEL & REVISION
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 13. battery_model
-- Stable identity of a battery dataset; lightweight header record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS battery_model (
    model_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID        NOT NULL REFERENCES project(project_id),
    name            TEXT        NOT NULL,
    chemistry       TEXT,
    functional_unit TEXT,
    created_by      UUID        NOT NULL REFERENCES app_user(user_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 14. battery_model_revision
-- Unit of work, validation, and export. Partial unique index enforces at most
-- one active revision per model.
-- unfreeze_log JSONB array records every admin unfreeze event for audit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS battery_model_revision (
    revision_id     UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id        UUID              NOT NULL REFERENCES battery_model(model_id),
    revision_number INT               NOT NULL,
    label           TEXT,
    is_active       BOOLEAN           NOT NULL DEFAULT TRUE,
    status          model_status_enum NOT NULL DEFAULT 'draft',
    created_by      UUID              NOT NULL REFERENCES app_user(user_id),
    created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    frozen_at       TIMESTAMPTZ,
    notes           TEXT,
    unfreeze_log    JSONB             NOT NULL DEFAULT '[]'
);

-- Exactly one active revision per model at any time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_battery_model_revision_active
    ON battery_model_revision (model_id)
    WHERE is_active = TRUE;


-- =============================================================================
-- SECTION 4 — DATA ENTRY TABLES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 15. model_parameter
-- Named scalar values referenced by formula strings in process_exchange.
-- UNIQUE(revision_id, name) prevents duplicate names within a revision.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_parameter (
    param_id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id       UUID            NOT NULL REFERENCES battery_model_revision(revision_id),
    name              TEXT            NOT NULL,
    description       TEXT,
    value             NUMERIC         NOT NULL,
    param_type        param_type_enum NOT NULL DEFAULT 'scalar',
    min_value         NUMERIC,
    max_value         NUMERIC,
    mode_value        NUMERIC,
    distribution_type TEXT,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (revision_id, name)
);

-- ---------------------------------------------------------------------------
-- 16. artifact
-- File metadata for any file associated with a revision (imported xlsx,
-- exported Brightway xlsx, Monte Carlo JSON, admin export JSON).
-- Binary data lives in Supabase Storage; only the path is stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifact (
    artifact_id     UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id     UUID               NOT NULL REFERENCES battery_model_revision(revision_id),
    artifact_type   artifact_type_enum NOT NULL,
    filename        TEXT               NOT NULL,
    storage_path    TEXT               NOT NULL,
    mime_type       TEXT,
    size_bytes      BIGINT,
    checksum_sha256 TEXT,
    created_at      TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 17. import_job
-- Tracks the parse operation for a file import (separate from artifact which
-- is just the file record). Exists even when parsing fails partway through.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_job (
    import_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id      UUID        NOT NULL REFERENCES battery_model_revision(revision_id),
    source_filename  TEXT        NOT NULL,
    source_format    TEXT        NOT NULL,
    imported_by      UUID        NOT NULL REFERENCES app_user(user_id),
    imported_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status           TEXT        NOT NULL DEFAULT 'running',  -- 'running'|'completed'|'failed'
    activities_count INT,
    exchanges_count  INT,
    warnings_count   INT         NOT NULL DEFAULT 0,
    errors_count     INT         NOT NULL DEFAULT 0,
    log_json         JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 18. process_instance
-- One foreground or background activity. system_boundary distinguishes
-- manufacturer-entered (foreground) from ecoinvent-sourced (background) rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS process_instance (
    process_id        UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id       UUID                 NOT NULL REFERENCES battery_model_revision(revision_id),
    name              TEXT                 NOT NULL,
    location          TEXT                 REFERENCES region_catalog(code),
    unit              TEXT,
    production_amount NUMERIC              NOT NULL DEFAULT 1.0,
    production_unit   TEXT,
    stage             TEXT,
    template_id       UUID                 REFERENCES process_template(template_id),
    system_boundary   system_boundary_enum NOT NULL DEFAULT 'foreground',
    comment           TEXT,
    created_at        TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 19. process_exchange
-- One quantified input or output of a foreground process (the densest table).
-- CHECK: output_type IS NOT NULL when exchange_direction = 'output'.
-- amount_is_ecoinvent_signed: TRUE preserves ecoinvent sign convention as-is;
--   FALSE (default) means manufacturer-entered positive magnitude.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS process_exchange (
    exchange_id                UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id                 UUID                    NOT NULL REFERENCES process_instance(process_id),
    flow_id                    UUID                    REFERENCES flow_catalog(flow_id),
    raw_name                   TEXT,
    quantity_user              NUMERIC,
    formula_user               TEXT,
    user_unit                  TEXT,
    exchange_direction         exchange_direction_enum NOT NULL,
    output_type                output_type_enum,                   -- NULL for input exchanges
    source_database            TEXT,
    source_location            TEXT,
    amount_is_ecoinvent_signed BOOLEAN                 NOT NULL DEFAULT FALSE,
    sort_order                 INT,
    created_at                 TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_output_type_required_for_outputs
        CHECK (exchange_direction <> 'output' OR output_type IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- 20. process_link
-- Explicit directed edges between foreground processes.
-- Optional: the export engine can infer most links by name matching.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS process_link (
    link_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id     UUID        NOT NULL REFERENCES battery_model_revision(revision_id),
    from_process_id UUID        NOT NULL REFERENCES process_instance(process_id),
    to_process_id   UUID        NOT NULL REFERENCES process_instance(process_id),
    flow_id         UUID        NOT NULL REFERENCES flow_catalog(flow_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- SECTION 5 — VALIDATION
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 21. validation_run
-- Snapshot record of one execution of the validation engine.
-- config_hash records which rule set was active (audit requirement).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS validation_run (
    validation_id UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id   UUID        NOT NULL REFERENCES battery_model_revision(revision_id),
    triggered_by  UUID        NOT NULL REFERENCES app_user(user_id),
    run_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status        TEXT        NOT NULL DEFAULT 'pass',  -- 'pass' | 'fail'
    issue_count   INT         NOT NULL DEFAULT 0,
    tool_version  TEXT,
    config_hash   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 22. validation_issue
-- One row per finding from a validation run.
-- process_id / exchange_id are nullable FKs: the engine points to the exact
-- entity in error (process-level, exchange-level, or revision-level = both NULL).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS validation_issue (
    issue_id      UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    validation_id UUID                     NOT NULL REFERENCES validation_run(validation_id),
    severity      validation_severity_enum NOT NULL,
    code          TEXT                     NOT NULL,
    message       TEXT                     NOT NULL,
    process_id    UUID                     REFERENCES process_instance(process_id),
    exchange_id   UUID                     REFERENCES process_exchange(exchange_id),
    suggestion    TEXT,
    created_at    TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- SECTION 6 — BRIGHTWAY MAPPING
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 23. mapping_job
-- Async tracker for TF-IDF fuzzy candidate generation.
-- Auto-triggered on import completion; can also be re-run manually.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mapping_job (
    mapping_job_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id            UUID        NOT NULL REFERENCES battery_model_revision(revision_id),
    triggered_by_import_id UUID        REFERENCES import_job(import_id),
    status                 TEXT        NOT NULL DEFAULT 'running',  -- 'running'|'completed'|'failed'
    flow_count             INT,
    matched_count          INT,
    generated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at           TIMESTAMPTZ,
    log_json               JSONB,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 24. bw_mapping_candidate
-- Automated BW match suggestions (multiple per flow, ranked by score).
-- Never deleted — preserved as audit trail of what options existed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bw_mapping_candidate (
    candidate_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id          UUID        NOT NULL REFERENCES flow_catalog(flow_id),
    bw_database      TEXT        NOT NULL,
    bw_activity_key  TEXT        NOT NULL,
    bw_activity_name TEXT,
    bw_location      TEXT,
    bw_unit          TEXT,
    match_score      NUMERIC     NOT NULL,
    match_method     TEXT,
    generated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 25. bw_mapping_selection
-- The authoritative confirmed mapping — one row per (flow, revision).
-- candidate_id is NULL for foreground and unmappable statuses.
-- UNIQUE(flow_id, revision_id) prevents conflicting selections.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bw_mapping_selection (
    mapping_id     UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_id        UUID                NOT NULL REFERENCES flow_catalog(flow_id),
    revision_id    UUID                NOT NULL REFERENCES battery_model_revision(revision_id),
    candidate_id   UUID                REFERENCES bw_mapping_candidate(candidate_id),
    mapping_status mapping_status_enum NOT NULL DEFAULT 'pending',
    confirmed_by   UUID                NOT NULL REFERENCES app_user(user_id),
    confirmed_at   TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    notes          TEXT,
    created_at     TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    UNIQUE (flow_id, revision_id)
);


-- =============================================================================
-- SECTION 7 — EXPORT
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 26. export_job
-- Tracks each Brightway export operation.
-- artifact_id is NULL until the file is successfully written to storage;
-- a failed export has no artifact row but the job row is preserved for audit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS export_job (
    export_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id         UUID        NOT NULL REFERENCES battery_model_revision(revision_id),
    format              TEXT        NOT NULL DEFAULT 'brightway_xlsx',
    exported_by         UUID        NOT NULL REFERENCES app_user(user_id),
    exported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status              TEXT        NOT NULL DEFAULT 'running',  -- 'running'|'completed'|'failed'
    activities_exported INT,
    exchanges_exported  INT,
    artifact_id         UUID        REFERENCES artifact(artifact_id),
    error_log           TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
