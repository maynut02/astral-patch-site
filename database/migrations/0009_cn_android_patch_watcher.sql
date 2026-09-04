ALTER TABLE patch_watch_routes
DROP CONSTRAINT IF EXISTS patch_watch_routes_route_check;

ALTER TABLE patch_watch_routes
ADD CONSTRAINT patch_watch_routes_route_check
CHECK (route IN ('INT_STEAM', 'CN_STEAM', 'INT_ANDROID', 'CN_ANDROID'));

ALTER TABLE patch_watch_run_routes
DROP CONSTRAINT IF EXISTS patch_watch_run_routes_route_check;

ALTER TABLE patch_watch_run_routes
ADD CONSTRAINT patch_watch_run_routes_route_check
CHECK (route IN ('INT_STEAM', 'CN_STEAM', 'INT_ANDROID', 'CN_ANDROID'));

INSERT INTO patch_watch_routes (route)
VALUES ('CN_ANDROID')
ON CONFLICT (route) DO NOTHING;
