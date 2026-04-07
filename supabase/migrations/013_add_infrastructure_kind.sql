-- =============================================================================
-- 013_add_infrastructure_kind.sql  —  Battery LCA Tool
-- =============================================================================
-- Extends flow_kind_enum with 'infrastructure' to support factory/plant
-- construction flows (e.g. aluminium hydroxide factory construction).
--
-- Must be a separate migration from the INSERT statements that use this value
-- because ALTER TYPE … ADD VALUE cannot be combined with type-usage DML in
-- the same transaction on PostgreSQL ≤ 15.
-- =============================================================================

ALTER TYPE flow_kind_enum ADD VALUE IF NOT EXISTS 'infrastructure';
