-- =============================================================================
-- 016_bw_activity_catalog.sql  —  Battery LCA Tool
-- =============================================================================
-- Creates the bw_activity_catalog table — a read-only reference catalog of
-- Brightway / ecoinvent background activities used by the mapping panel.
--
-- Each row represents one ecoinvent activity in a specific version + system
-- model combination.  The table is populated by a one-off seed script (not
-- part of this migration) and is never written to by the application itself.
--
-- Key design choices:
--   • pg_trgm GIN index enables fast fuzzy full-text search across the three
--     most user-visible columns (activity_name, reference_product, location).
--   • UNIQUE (ecoinvent_version, system_model, code) prevents double-seeding.
--   • RLS: authenticated users may SELECT; writes go through the service role
--     key which bypasses RLS entirely (standard Supabase behaviour).
-- =============================================================================


-- =============================================================================
-- 1. pg_trgm extension (required for GIN trigram index)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- =============================================================================
-- 2. bw_activity_catalog table
-- =============================================================================

CREATE TABLE IF NOT EXISTS bw_activity_catalog (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    ecoinvent_version   text        NOT NULL,          -- e.g. '3.9', '3.10'
    system_model        text        NOT NULL,          -- e.g. 'cutoff', 'consequential', 'apos'
    code                text,                          -- ecoinvent UUID (version-specific, nullable)
    activity_name       text        NOT NULL,
    reference_product   text,
    location            text,
    unit                text,
    category            text,
    created_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT bw_activity_catalog_version_model_code_key
        UNIQUE (ecoinvent_version, system_model, code)
);


-- =============================================================================
-- 3. GIN trigram index for fuzzy text search
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_bw_activity_catalog_trgm
    ON bw_activity_catalog
    USING gin ((
        activity_name || ' ' ||
        coalesce(reference_product, '') || ' ' ||
        coalesce(location, '')
    ) gin_trgm_ops);


-- =============================================================================
-- 4. Row Level Security
-- =============================================================================

ALTER TABLE bw_activity_catalog ENABLE ROW LEVEL SECURITY;

-- All authenticated users may read the catalog (read-only reference data).
CREATE POLICY bw_activity_catalog_select ON bw_activity_catalog
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- Service role (used by seed scripts and Edge Functions) bypasses RLS entirely
-- in Supabase, but an explicit permissive policy is added here for clarity and
-- to support any future service-role-scoped tooling that checks policies.
CREATE POLICY bw_activity_catalog_service_role_all ON bw_activity_catalog
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
