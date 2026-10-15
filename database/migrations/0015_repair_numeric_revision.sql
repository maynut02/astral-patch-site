-- Repair numeric revisions misparsed after source URLs gained an extra path segment.
-- Scope audited on 2026-10-15: four routes at version 3.3.0, revision 012.
-- Keep /012/TmvW1l in source/catalog URLs and preserve UUIDs, foreign keys,
-- hashes, timestamps, and unpublished build records.
--
-- Pause discovery until the corrected builder and watcher have been deployed.
-- deploy/run-migrations.sh supplies the transaction and migration-history entry.
-- The single DO statement is atomic and safe to execute again.
DO $repair$
DECLARE
    bad_revision CONSTANT text := 'TmvW1l';
    corrected_revision CONSTANT text := '012';
    proven_version CONSTANT text := '3.3.0';
    proven_routes CONSTANT text[] := ARRAY[
        'INT_STEAM', 'CN_STEAM', 'INT_ANDROID', 'CN_ANDROID'
    ];
    -- Full HTTP(S) URLs only; no query, fragment, extra suffix, or empty segment.
    -- The origin/prefix is preserved; the route/version/revision/token suffix
    -- must match exactly. No network or catalog access is performed.
    source_prefix CONSTANT text := '^https?://[^/?#[:space:]]+(/[^/?#[:space:]]+)*/';
    source_suffix CONSTANT text := '/3[.]3[.]0/012/TmvW1l$';
    problem record;
    repaired_games bigint;
    repaired_observations bigint;
    repaired_dispatches bigint;
    repaired_history bigint;
    unexpected_rows bigint;
BEGIN
    -- tools/patch_watcher.py: LOCK_ID = 1_387_426_501, using the one-bigint
    -- pg_try_advisory_lock overload. Transaction locks conflict with that
    -- session lock and are released automatically on commit or rollback.
    PERFORM set_config('lock_timeout', '5s', true);
    PERFORM pg_advisory_xact_lock(1387426501::bigint);

    -- Block noncooperating sync/build/history writers while checking evidence
    -- and uniqueness. Ordinary readers can continue. Lock acquisition is bounded.
    LOCK TABLE public.game_revisions, public.patch_watch_routes,
        public.patch_watch_run_routes, public.builds
        IN SHARE ROW EXCLUSIVE MODE;

    -- Reject even embedded marker strings, NULL evidence, unknown routes, or
    -- another version/path. URL occurrences themselves are intentionally valid.
    SELECT candidate.field, candidate.row_key INTO problem
    FROM (
        SELECT 'game_revisions.revision' AS field, gr.id::text AS row_key,
            gr.route, gr.game_version, gr.revision, gr.source_url
        FROM public.game_revisions AS gr
        UNION ALL
        SELECT 'patch_watch_routes.revision', state.route,
            state.route, state.game_version, state.revision, state.source_url
        FROM public.patch_watch_routes AS state
        UNION ALL
        SELECT 'patch_watch_run_routes.revision', history.run_id::text || '/' || history.route,
            history.route, history.game_version, history.revision, history.source_url
        FROM public.patch_watch_run_routes AS history
    ) AS candidate
    WHERE strpos(candidate.revision, bad_revision) > 0
      AND (
          candidate.revision = bad_revision
          AND candidate.route = ANY(proven_routes)
          AND candidate.game_version = proven_version
          AND candidate.source_url ~ (source_prefix || candidate.route || source_suffix)
      ) IS NOT TRUE
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'revision repair: unproven marker in % at %',
            problem.field, problem.row_key;
    END IF;

    -- last_dispatched_* has no separate source URL. Require a matching
    -- route/version/catalog-hash fingerprint from a proven current observation
    -- or history row. A current URL alone cannot prove an older dispatch.
    SELECT state.route INTO problem
    FROM public.patch_watch_routes AS state
    WHERE strpos(state.last_dispatched_revision, bad_revision) > 0
      AND (
          state.last_dispatched_revision = bad_revision
          AND state.route = ANY(proven_routes)
          AND state.last_dispatched_game_version = proven_version
          AND EXISTS (
              SELECT 1
              FROM (
                  SELECT current_state.route, current_state.game_version,
                      current_state.revision, current_state.catalog_hash, current_state.source_url
                  FROM public.patch_watch_routes AS current_state
                  UNION ALL
                  SELECT history.route, history.game_version,
                      history.revision, history.catalog_hash, history.source_url
                  FROM public.patch_watch_run_routes AS history
              ) AS evidence
              WHERE evidence.route = state.route
                AND evidence.game_version = state.last_dispatched_game_version
                AND evidence.catalog_hash = state.last_dispatched_catalog_hash
                AND evidence.revision IN (bad_revision, corrected_revision)
                AND evidence.source_url ~ (source_prefix || evidence.route || source_suffix)
          )
      ) IS NOT TRUE
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'revision repair: unproven last-dispatched fingerprint for %', problem.route;
    END IF;

    -- Never delete, merge, remap an FK, or pick a winner in a uniqueness conflict.
    SELECT original.id AS original_id, existing.id AS existing_id INTO problem
    FROM public.game_revisions AS original
    JOIN public.game_revisions AS existing
      ON existing.route = original.route
     AND existing.game_version = original.game_version
     AND existing.revision = corrected_revision
    WHERE original.revision = bad_revision
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'revision repair: 012 collision between UUIDs % and %',
            problem.original_id, problem.existing_id;
    END IF;

    -- The audited builds were validated but unpublished. A release since that
    -- audit requires a new review of immutable external artifacts before repair.
    SELECT build.id INTO problem
    FROM public.builds AS build
    JOIN public.game_revisions AS gr ON gr.id = build.revision_id
    WHERE gr.revision = bad_revision
      AND (build.status = 'released' OR build.released_at IS NOT NULL)
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'revision repair: target UUID has a published build %', problem.id;
    END IF;

    -- Materialized expectations retain every original field, including UUIDs,
    -- URLs, hashes, timestamps and build-related data. Check complete returned
    -- rows, so an unexpected trigger changing any field also rolls everything back.
    WITH expected AS MATERIALIZED (
        SELECT gr.id,
            to_jsonb(gr) || jsonb_build_object('revision', corrected_revision) AS row_after
        FROM public.game_revisions AS gr
        WHERE gr.revision = bad_revision
          AND gr.route = ANY(proven_routes)
          AND gr.game_version = proven_version
          AND gr.source_url ~ (source_prefix || gr.route || source_suffix)
    ), repaired AS (
        UPDATE public.game_revisions AS gr
        SET revision = corrected_revision
        FROM expected
        WHERE gr.id = expected.id
        RETURNING to_jsonb(gr) = expected.row_after AS matches_expected
    )
    SELECT count(*), count(*) FILTER (WHERE matches_expected IS NOT TRUE)
    INTO repaired_games, unexpected_rows
    FROM repaired;

    IF unexpected_rows <> 0 THEN
        RAISE EXCEPTION 'revision repair: unexpected game_revisions field change';
    END IF;

    WITH expected AS MATERIALIZED (
        SELECT state.route,
            state.revision = bad_revision AS repair_observation,
            state.last_dispatched_revision = bad_revision AS repair_dispatch,
            to_jsonb(state) || jsonb_build_object(
                'revision', CASE WHEN state.revision = bad_revision
                    THEN corrected_revision ELSE state.revision END,
                'last_dispatched_revision', CASE WHEN state.last_dispatched_revision = bad_revision
                    THEN corrected_revision ELSE state.last_dispatched_revision END
            ) AS row_after
        FROM public.patch_watch_routes AS state
        WHERE state.route = ANY(proven_routes)
          AND (state.revision = bad_revision OR state.last_dispatched_revision = bad_revision)
    ), repaired AS (
        UPDATE public.patch_watch_routes AS state
        SET revision = CASE WHEN expected.repair_observation
                THEN corrected_revision ELSE state.revision END,
            last_dispatched_revision = CASE WHEN expected.repair_dispatch
                THEN corrected_revision ELSE state.last_dispatched_revision END
        FROM expected
        WHERE state.route = expected.route
        RETURNING to_jsonb(state) = expected.row_after AS matches_expected,
            expected.repair_observation, expected.repair_dispatch
    )
    SELECT count(*) FILTER (WHERE repair_observation),
        count(*) FILTER (WHERE repair_dispatch),
        count(*) FILTER (WHERE matches_expected IS NOT TRUE)
    INTO repaired_observations, repaired_dispatches, unexpected_rows
    FROM repaired;

    IF unexpected_rows <> 0 THEN
        RAISE EXCEPTION 'revision repair: unexpected patch_watch_routes field change';
    END IF;

    WITH expected AS MATERIALIZED (
        SELECT history.run_id, history.route,
            to_jsonb(history) || jsonb_build_object('revision', corrected_revision) AS row_after
        FROM public.patch_watch_run_routes AS history
        WHERE history.revision = bad_revision
          AND history.route = ANY(proven_routes)
          AND history.game_version = proven_version
          AND history.source_url ~ (source_prefix || history.route || source_suffix)
    ), repaired AS (
        UPDATE public.patch_watch_run_routes AS history
        SET revision = corrected_revision
        FROM expected
        WHERE history.run_id = expected.run_id AND history.route = expected.route
        RETURNING to_jsonb(history) = expected.row_after AS matches_expected
    )
    SELECT count(*), count(*) FILTER (WHERE matches_expected IS NOT TRUE)
    INTO repaired_history, unexpected_rows
    FROM repaired;

    IF unexpected_rows <> 0 THEN
        RAISE EXCEPTION 'revision repair: unexpected patch_watch_run_routes field change';
    END IF;

    -- A second application is a no-op. Unknown markers abort above, and even
    -- suppressed updates must not leave any marker in a revision field.
    IF EXISTS (
        SELECT 1 FROM public.game_revisions WHERE strpos(revision, bad_revision) > 0
        UNION ALL
        SELECT 1 FROM public.patch_watch_routes
        WHERE strpos(revision, bad_revision) > 0
           OR strpos(last_dispatched_revision, bad_revision) > 0
        UNION ALL
        SELECT 1 FROM public.patch_watch_run_routes WHERE strpos(revision, bad_revision) > 0
    ) THEN
        RAISE EXCEPTION 'revision repair: a revision marker remains after repair';
    END IF;

    RAISE NOTICE 'revision repair: game_revisions=%, observed=%, last_dispatched=%, history=%',
        repaired_games, repaired_observations, repaired_dispatches, repaired_history;
END;
$repair$;
