-- =============================================================================
-- 020_add_mapped_status.sql  —  Battery LCA Tool
-- =============================================================================
-- Adds 'mapped' to model_status_enum.
--
-- A revision transitions to 'mapped' once all input exchanges have been
-- confirmed or marked unmappable by the admin (ready_for_export = true).
-- The backend sets this automatically after each confirm / skip action.
-- The manufacturer sees a green "Mapped" badge instead of "Unmapped".
--
-- Separate migration from any DML that uses this value (PG ≤ 15 restriction).
-- =============================================================================

ALTER TYPE model_status_enum ADD VALUE IF NOT EXISTS 'mapped';
