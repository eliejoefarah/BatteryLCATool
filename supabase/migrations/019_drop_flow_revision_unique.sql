-- =============================================================================
-- 019_drop_flow_revision_unique.sql  —  Battery LCA Tool
-- =============================================================================
-- The original bw_mapping_selection table had UNIQUE (flow_id, revision_id)
-- as its deduplication key (one mapping per flow per revision).
--
-- Migration 018 switched the model to one mapping per *exchange* (exchange_id
-- partial unique index).  The old (flow_id, revision_id) constraint was not
-- removed there, which means confirming a flow that appears in more than one
-- exchange within the same revision triggers a unique-constraint violation on
-- the second INSERT — causing a 500 that Railway returns without CORS headers.
--
-- This migration drops that stale constraint.  The exchange_id partial unique
-- index from 018 is now the sole deduplication key.
-- =============================================================================

ALTER TABLE bw_mapping_selection
    DROP CONSTRAINT IF EXISTS bw_mapping_selection_flow_id_revision_id_key;
