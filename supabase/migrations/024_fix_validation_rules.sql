-- =============================================================================
-- 024_fix_validation_rules.sql
-- =============================================================================
-- Aligns the validation_rule catalog with what the engine in
-- validate_router.py actually checks:
--
--   1. Rename UNMAPPED_FLOW → UNLINKED_FLOW  (engine uses UNLINKED_FLOW)
--   2. Fix UNIT_MISMATCH severity: error → warning  (engine emits warning)
--   3. Insert three missing rules: NO_PROCESSES, EMPTY_PROCESS,
--      MASS_BALANCE_WARNING
-- =============================================================================

-- 1. UNMAPPED_FLOW → UNLINKED_FLOW
UPDATE validation_rule
SET code        = 'UNLINKED_FLOW',
    description = 'A foreground exchange is not linked to any entry in the flow catalog.'
WHERE code = 'UNMAPPED_FLOW';

-- 2. UNIT_MISMATCH: engine emits warning, not error
UPDATE validation_rule
SET severity = 'warning'
WHERE code = 'UNIT_MISMATCH';

-- 3. Missing rules — use 00000001-… namespace (00000000000a / b / c)
INSERT INTO validation_rule (rule_id, code, severity, description) VALUES
    (
        '00000001-0000-0000-0000-00000000000a',
        'NO_PROCESSES',
        'info',
        'The revision has no processes at all. Import or create processes before validating.'
    ),
    (
        '00000001-0000-0000-0000-00000000000b',
        'EMPTY_PROCESS',
        'warning',
        'A foreground process has no exchanges defined.'
    ),
    (
        '00000001-0000-0000-0000-00000000000c',
        'MASS_BALANCE_WARNING',
        'warning',
        'Total mass inputs and outputs differ by more than 1% for a foreground process.'
    )
ON CONFLICT (code) DO NOTHING;
