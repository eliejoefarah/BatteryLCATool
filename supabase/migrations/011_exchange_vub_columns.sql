-- =============================================================================
-- 011_exchange_vub_columns.sql  —  Battery LCA Tool
-- Add VUB-template extra columns to process_exchange
-- =============================================================================
-- The VUB LCI template carries four extra columns per exchange row that were
-- previously discarded on import:
--   col F  Function/use (inputs) | Treatment/destination (outputs) | Mode of
--          transport (transport)  → comment
--   col G  Details / range info                                    → details
--   col H  Cost (€ per unit)                                       → cost_per_unit
--   col J  Observations / supplier / recycled-content notes        → observations
--
-- 'comment' was already added in migration 006; the remaining three are new.
-- =============================================================================

ALTER TABLE process_exchange
    ADD COLUMN IF NOT EXISTS details       TEXT,
    ADD COLUMN IF NOT EXISTS cost_per_unit NUMERIC,
    ADD COLUMN IF NOT EXISTS observations  TEXT;
