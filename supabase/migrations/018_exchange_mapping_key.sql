-- =============================================================================
-- 018_exchange_mapping_key.sql  —  Battery LCA Tool
-- =============================================================================
-- Prepares bw_mapping_selection and process_exchange for the exchange-based
-- mapping workflow introduced in bw_mapping_router.py (endpoints 3-5).
--
-- Changes:
--   1. bw_mapping_selection.flow_id    — drop NOT NULL
--      The original design stored one mapping per (flow_catalog row, revision).
--      The new design stores one mapping per process_exchange row, which may
--      not yet be linked to a flow_catalog entry (raw_name only).
--
--   2. bw_mapping_selection.revision_id — drop NOT NULL
--      Same rationale: revision context is now carried by the exchange FK.
--
--   3. bw_mapping_selection.exchange_id — add as UNIQUE FK
--      The new upsert key. ON CONFLICT (exchange_id) DO UPDATE replaces the
--      old (flow_id, revision_id) conflict target for the confirm endpoint.
--
--   4. process_exchange.mapping_status — add mapping_status_enum column
--      Mirrors the authoritative status from bw_mapping_selection directly on
--      the exchange row for fast GROUP BY queries in the revision summary
--      endpoint without joining through bw_mapping_selection every time.
--
-- All changes are idempotent (IF NOT EXISTS / DROP NOT NULL is a no-op when
-- the column is already nullable).
-- =============================================================================


-- =============================================================================
-- 1. Relax NOT NULL on bw_mapping_selection.flow_id and .revision_id
-- =============================================================================

ALTER TABLE bw_mapping_selection
    ALTER COLUMN flow_id     DROP NOT NULL,
    ALTER COLUMN revision_id DROP NOT NULL;


-- =============================================================================
-- 2. Add exchange_id FK + unique constraint to bw_mapping_selection
-- =============================================================================

ALTER TABLE bw_mapping_selection
    ADD COLUMN IF NOT EXISTS exchange_id uuid
        REFERENCES process_exchange(exchange_id) ON DELETE CASCADE;

-- Partial unique index: only one confirmed mapping per exchange.
-- Partial (WHERE exchange_id IS NOT NULL) so that legacy rows without an
-- exchange_id do not conflict with each other.
CREATE UNIQUE INDEX IF NOT EXISTS bw_mapping_selection_exchange_id_key
    ON bw_mapping_selection (exchange_id)
    WHERE exchange_id IS NOT NULL;


-- =============================================================================
-- 3. Add mapping_status to process_exchange
-- =============================================================================

ALTER TABLE process_exchange
    ADD COLUMN IF NOT EXISTS mapping_status mapping_status_enum NOT NULL DEFAULT 'pending';
