-- =============================================================================
-- 026_password_lockout.sql  —  Battery LCA Tool
-- =============================================================================
-- Account lockout for password sign-in. After LOCK_AFTER (6) consecutive
-- failed password attempts, password sign-in for that account is refused for
-- LOCK_FOR (1 hour), even with the right password. The user can still sign in
-- with an emailed link or reset their password, either of which clears the
-- lock (trigger in deploy/init.sql); otherwise it clears after the hour.
--
-- Counting per account, not per IP, means it works however many addresses an
-- attacker uses, and needs nothing from the F5. Someone who knows an email can
-- lock its password sign-in, but never the account: email sign-in still works.
--
-- GoTrue calls hook_password_verification_attempt on every password attempt
-- (GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_*, docker-compose.battery-lci.yml).
-- Everything lives in app_private, which PostgREST doesn't expose, so the
-- table can't be read and the function can't be called from the browser.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_private TO supabase_auth_admin;

CREATE TABLE IF NOT EXISTS app_private.password_lockout (
    user_id       uuid        PRIMARY KEY,
    failed_count  int         NOT NULL DEFAULT 0,
    last_failed   timestamptz,
    locked_until  timestamptz
);
REVOKE ALL ON app_private.password_lockout FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.password_lockout TO supabase_auth_admin;


CREATE OR REPLACE FUNCTION app_private.hook_password_verification_attempt(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    lock_after   constant int      := 6;
    lock_for     constant interval := interval '1 hour';
    uid          uuid := (event ->> 'user_id')::uuid;
    valid        boolean := (event ->> 'valid')::boolean;
    rec          app_private.password_lockout%ROWTYPE;
    locked_msg   constant text :=
        'Too many failed password attempts. Sign in with an email link or reset '
        'your password, or try again in an hour.';
BEGIN
    SELECT * INTO rec FROM app_private.password_lockout WHERE user_id = uid FOR UPDATE;

    -- Locked: refuse even the right password until the lock clears
    IF rec.locked_until IS NOT NULL AND rec.locked_until > now() THEN
        RETURN jsonb_build_object('decision', 'reject', 'message', locked_msg);
    END IF;

    IF valid THEN
        DELETE FROM app_private.password_lockout WHERE user_id = uid;
        RETURN jsonb_build_object('decision', 'continue');
    END IF;

    -- Failed attempt (an expired lock starts the count again)
    INSERT INTO app_private.password_lockout AS l (user_id, failed_count, last_failed, locked_until)
    VALUES (uid, 1, now(), NULL)
    ON CONFLICT (user_id) DO UPDATE
        SET failed_count = CASE WHEN l.locked_until IS NOT NULL THEN 1 ELSE l.failed_count + 1 END,
            last_failed  = now(),
            locked_until = NULL
    RETURNING * INTO rec;

    IF rec.failed_count >= lock_after THEN
        UPDATE app_private.password_lockout
           SET locked_until = now() + lock_for, failed_count = 0
         WHERE user_id = uid;
        RETURN jsonb_build_object('decision', 'reject', 'message', locked_msg);
    END IF;

    -- Not locked yet: GoTrue answers "Invalid login credentials" as usual
    RETURN jsonb_build_object('decision', 'continue');
END;
$$;

REVOKE ALL ON FUNCTION app_private.hook_password_verification_attempt(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.hook_password_verification_attempt(jsonb) TO supabase_auth_admin;


-- Called by the trigger on auth.users (deploy/init.sql) when the user signs in
-- by other means or changes their password: clears any lock and count.
CREATE OR REPLACE FUNCTION app_private.clear_password_lockout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM app_private.password_lockout WHERE user_id = NEW.id;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.clear_password_lockout() FROM PUBLIC, anon, authenticated;
