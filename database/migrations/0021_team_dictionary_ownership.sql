-- Normalize shared ownership before enforcing it. The trigger also supports the
-- previous app during migration-before-app deployment: it supplies the creator ID.
LOCK TABLE editor_dictionaries IN ACCESS EXCLUSIVE MODE;

UPDATE editor_dictionaries SET owner_id = 'bot' WHERE is_team AND owner_id <> 'bot';

CREATE FUNCTION enforce_team_dictionary_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.is_team THEN
        NEW.owner_id := 'bot';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER editor_team_dictionary_owner
BEFORE INSERT OR UPDATE OF owner_id, is_team ON editor_dictionaries
FOR EACH ROW EXECUTE FUNCTION enforce_team_dictionary_owner();

ALTER TABLE editor_dictionaries
    ADD CONSTRAINT editor_team_dictionary_owner_check CHECK (NOT is_team OR owner_id = 'bot'),
    DROP CONSTRAINT editor_dictionaries_owner_id_fkey,
    ADD CONSTRAINT editor_dictionaries_owner_id_fkey
        FOREIGN KEY (owner_id) REFERENCES app_users(google_sub) ON DELETE RESTRICT;
