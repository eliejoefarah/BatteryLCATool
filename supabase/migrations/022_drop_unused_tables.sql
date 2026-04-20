-- =============================================================================
-- 022_drop_unused_tables.sql
-- Drop four tables that were designed but never used in the application.
-- See docs/PROGRESS.md "Dead Tables" section for rationale.
-- =============================================================================

-- bw_mapping_selection.candidate_id referenced bw_mapping_candidate but was
-- never populated (replaced by bw_catalog_id in migration 017). Drop the
-- column before dropping the table so nothing is left dangling.
ALTER TABLE bw_mapping_selection DROP COLUMN IF EXISTS candidate_id;

-- Drop the four unused tables. CASCADE removes dependent RLS policies.
DROP TABLE IF EXISTS template_expected_exchange CASCADE;
DROP TABLE IF EXISTS bw_mapping_candidate CASCADE;
DROP TABLE IF EXISTS mapping_job CASCADE;
DROP TABLE IF EXISTS process_link CASCADE;
