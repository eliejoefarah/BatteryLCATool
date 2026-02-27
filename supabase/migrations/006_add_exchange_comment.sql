-- =============================================================================
-- 006_add_exchange_comment.sql  —  Battery LCA Tool
-- Add comment column to process_exchange
-- =============================================================================
-- The Ali_2025_Parametric_LCA_battery_SI2.xlsx import file (and the broader
-- ecoinvent Excel spreadsheet format) carries an optional free-text comment
-- column on each exchange row (e.g. "primary route", "from cobalt production").
-- This column must be preserved on import so the original annotation is never
-- lost, and displayed in the AG Grid exchange table as a read-only audit field.
-- =============================================================================

ALTER TABLE process_exchange
    ADD COLUMN IF NOT EXISTS comment TEXT;
