-- =============================================================================
-- 015_add_unmapped_status.sql  —  Battery LCA Tool
-- =============================================================================
-- Adds 'unmapped' to model_status_enum.
--
-- A revision is set to 'unmapped' by the validation engine when all foreground
-- checks pass but some exchanges lack a confirmed Brightway background mapping.
-- The admin performs the mapping; re-running validation then promotes the
-- revision to 'validated'.
--
-- Separate migration from any DML that uses this value (PG ≤ 15 restriction).
-- =============================================================================

ALTER TYPE model_status_enum ADD VALUE IF NOT EXISTS 'unmapped';
