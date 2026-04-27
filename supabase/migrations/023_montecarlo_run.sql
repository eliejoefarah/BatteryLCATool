-- =============================================================================
-- 023_montecarlo_run.sql  —  Battery LCA Tool
-- =============================================================================
-- Adds the montecarlo_run table which stores the results of Monte Carlo
-- uncertainty analysis runs triggered by admins against validated/frozen
-- revisions.  Each row holds run metadata and a JSONB results blob containing
-- per-flow statistics, histogram bin data, and Spearman sensitivity rankings.
--
-- Access is restricted to admin users only via RLS.
-- =============================================================================


CREATE TABLE montecarlo_run (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id     uuid        NOT NULL REFERENCES battery_model_revision(revision_id) ON DELETE CASCADE,
    triggered_by    uuid        NOT NULL REFERENCES app_user(user_id),
    n_runs          integer     NOT NULL,
    status          text        NOT NULL DEFAULT 'running'
                                    CHECK (status IN ('running', 'completed', 'failed')),
    error_message   text,
    results         jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz
);

ALTER TABLE montecarlo_run ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all" ON montecarlo_run
    FOR ALL TO authenticated
    USING (
        (SELECT role FROM app_user WHERE user_id = auth.uid()) = 'admin'
    );
