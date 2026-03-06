-- Migration 009: add 'validated' to model_status_enum
-- Revisions that pass validation (no errors) are automatically marked 'validated'.
-- Re-running validation with errors reverts them to 'draft'.

ALTER TYPE model_status_enum ADD VALUE IF NOT EXISTS 'validated';
