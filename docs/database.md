# 데이터베이스

PostgreSQL 18을 사용하며 schema의 유일한 소유자는 이 저장소의 `database/migrations`입니다. 같은 DB를 쓰는 다른 저장소(`astral-party-korean-patch` 등)와 웹 서버는 DDL을 실행하지 않습니다.

## 주요 테이블

| 영역 | 테이블 (뷰는 *기울임*) |
| --- | --- |
| 번역 | `translation_units`, `source_versions`, `translations`, `translation_changes`, `translation_change_groups`, `translation_pack_publications`, *`translation_workbench`*, *`translation_change_group_summary`*, *`current_source_texts`* |
| 원문·빌드 | `source_changes`, `game_revisions`, `builds`, `build_files`, `asset_locations`, *`source_revision_change_summary`* |
| 사용자 | `app_users`, `app_user_social_links` |
| 에디터 | `editor_comments`, `editor_dictionaries`, `editor_dictionary_entries`, `editor_dictionary_proposals` |
| 공지 | `notices` |
| 패치 감시 | `patch_watch_config`, `patch_watch_routes`, `patch_watch_runs`, `patch_watch_run_routes` |
| 파티 채팅 | `party_chat_sessions`, `party_chat_participants`, `party_chat_messages`, `party_chat_connection_events` |
| 모드 허브 | `mods` |
| 요청 제한 | `request_rate_limit_counters` |
| migration 기록 | `astral_schema_migrations` (실행기가 생성) |

정확한 정의는 해당 migration 파일을 기준으로 합니다.

`0019_editor_glossary.sql`은 기존 용어집에 `is_team`(기본 false), 항목에 metadata·revision을 추가합니다. 기존 행은 개인·공개 범위와 원문·번역을 유지합니다. 공개 공통 용어집의 제안 스냅샷·처리 이력은 별도 테이블에 저장하고 번역 테이블이나 팩 구조는 바꾸지 않습니다. 새 migration이 먼저 적용돼도 이전 앱은 기존 컬럼으로 계속 동작할 수 있습니다.

## Migration 규칙

파일 이름은 `NNNN_snake_case.sql`이고 `0001`부터 빈 번호 없이 이어집니다. 적용된 migration은 **절대 수정하거나 삭제하지 않고**, 변경이 필요하면 다음 번호의 새 파일을 추가합니다(forward-only).

1. 다음 번호로 파일을 만듭니다. 예: `0018_add_xxx.sql`
2. 파일 안에 `BEGIN`/`COMMIT`을 쓰지 않습니다. 실행기가 파일 전체와 기록 INSERT를 한 트랜잭션으로 감쌉니다. 따라서 `CREATE INDEX CONCURRENTLY`처럼 트랜잭션 안에서 실행할 수 없는 문은 사용할 수 없습니다.
3. 운영 데이터가 있는 테이블을 바꿀 때는 기존 행이 새 제약을 통과하는지, 실행 시간이 길어 잠금이 오래가지 않는지 확인합니다.
4. 관련 타입(`shared/types`)과 쿼리(`server/utils`)를 같은 PR에서 함께 바꿉니다.
5. `pnpm check`로 번호·형식을 검사합니다. CI는 빈 PostgreSQL에 전체 migration을 두 번 적용해 실제 실행 가능 여부와 재실행 시 건너뛰기를 확인합니다.

배포 순서상 migration이 새 앱보다 먼저 적용되고, 적용 직후에는 아직 이전 앱이 잠시 실행 중입니다. 컬럼 삭제·이름 변경처럼 이전 앱을 깨뜨리는 변경은 두 번의 배포로 나눕니다(먼저 코드에서 사용 중단 → 다음 배포에서 삭제).

## 실행기

`deploy/run-migrations.sh`는 `db-migrate` 서비스(`postgres:18-alpine`)에서 실행됩니다.

```bash
docker compose -p astral-patch --profile migration run --rm db-migrate        # run (기본)
docker compose -p astral-patch --profile migration run --rm \
  -e ASTRAL_MIGRATION_ADOPT_CONFIRM=YES db-migrate adopt                       # adopt
```

| 단계 | 동작 |
| --- | --- |
| 번호 검사 | `0001`부터 연속인지 확인. 아니면 즉시 실패 (`scripts/check-migrations.mjs`와 같은 규칙) |
| 대기 | `pg_isready`로 DB 준비 대기 |
| 기록 테이블 | `astral_schema_migrations(name, applied_at)`이 없으면 생성 |
| `run` | 기록에 없는 파일만 순서대로 `BEGIN; <파일>; INSERT 기록; COMMIT;`으로 적용. 하나라도 실패하면 중단 |
| `adopt` | 파일을 실행하지 않고 전부 적용된 것으로 기록. 이미 전체 schema가 들어 있는 DB를 복원했을 때만 사용 |

production 배포는 migration 직전에 DB 백업을 자동 실행합니다([deployment.md](deployment.md)).

## Migration 수가 늘어나는 것에 대해

번호가 계속 늘어나는 forward-only 방식은 Flyway, golang-migrate, Rails·Prisma·Django migration과 같은 표준 방식입니다. 파일 수 자체는 문제가 되지 않습니다. 이미 적용된 파일은 `astral_schema_migrations`를 보고 건너뛰므로 배포 시간에도 영향이 거의 없습니다.

파일이 매우 많아져 새 환경 구축이 느려지면 **baseline**을 고려할 수 있습니다: 현재 schema를 `pg_dump --schema-only`로 하나의 파일로 만들고, 새 DB는 baseline부터, 기존 DB는 `adopt`로 기록만 맞춥니다. 운영 DB가 하나인 현재 규모에서는 필요하지 않습니다.

## 유용한 쿼리

```sql
-- 적용된 migration
SELECT name, applied_at FROM astral_schema_migrations ORDER BY name;

-- 테이블 크기
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```
