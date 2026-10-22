# 아키텍처

## 구성

```text
Browser
  ↓ Nuxt pages/components
Nitro API
  ↓ server/utils
PostgreSQL
  ↑ schema migrations       ↑ source sync / patch releases
astral-patch-site           astral-party-korean-patch
        ↑ release API       astral-party-auto-patcher
```

`astral-patch-site`는 웹 애플리케이션, 사용자 상호작용과 DB migration을 담당합니다. 원문 동기화와 패치 생성은 `astral-party-korean-patch`가 담당하고, Windows/Android 패치 도구의 릴리즈와 배포 인덱스는 `astral-party-auto-patcher`가 담당합니다.

## 계층별 책임

| 경로 | 책임 |
| --- | --- |
| `app/pages` | 페이지 상태, 라우팅, 화면 조합 |
| `app/components` | 재사용 UI |
| `app/composables` | 브라우저 상태와 기능 단위 로직 |
| `app/utils` | 부작용 없는 포맷·검증·diff 헬퍼 |
| `server/api` | 요청 입력과 HTTP 응답 |
| `server/utils` | 인증, 권한, 트랜잭션, DB 조회 |
| `shared/types` | 클라이언트·서버 공용 타입 |

API 파일은 가능한 한 얇게 유지하고 실제 규칙은 `server/utils`에 둡니다.

## 인증과 역할

Google OAuth는 `nuxt-auth-utils`를 사용합니다. 첫 로그인 시 `app_users`에 `user` 역할로 저장하고 handle이 없으면 `/setup`으로 이동합니다.

| 역할 | 권한 |
| --- | --- |
| `user` | 번역 제안, AI 번역, 용어집 |
| `verified` | `user` 권한 + 승인·반려 |
| `admin` | 전체 관리 권한 |
| `bot` | 자동화 전용 예약 계정 |

민감한 작업은 세션 값만 신뢰하지 않고 DB에서 현재 계정 정보를 다시 확인합니다.

## 번역 흐름

```text
원문 동기화
  ↓
translation_units / source_versions
  ↓
번역 제안 → translation_changes(pending)
  ↓ verified/admin 검토
승인 → translations 갱신
반려 → translation_changes 상태 변경
```

- 같은 항목에 여러 pending 제안이 존재할 수 있습니다.
- 하나를 승인하면 같은 항목·locale의 나머지 pending 제안은 `superseded`로 종료합니다.
- `translations`에는 패치가 사용하는 마지막 승인 번역을 유지합니다.
- 승인 당시 원문과 현재 원문이 다르면 UI에서 `확인 필요`로 표시합니다.
- `유지`는 기존 승인 문구를 현재 원문 버전에 대한 `retain_confirmation` 제안으로 등록합니다.
- 실제 번역 수정은 `translation_edit`로 기록하며, 승인 페이지에서 유지 확인 요청과 분리해 검토합니다.
- 관리자 페이지의 `번역 팩 배포`는 `translations`의 `ko` 행 전체를 R2 `translation-pack/`에 gzip 팩으로 올립니다. 팩 번호는 `translation_pack_number_seq`에서 받아 누적되며, 플러그인은 `latest.json`의 번호만 비교합니다.

## 에디터 상태

`/translate/editor`는 다음 상태를 조합합니다.

- 서버 목록과 진행도: `useFetch`
- 미저장 번역: `useEditorDraftStorage`
- 표시 언어와 diff 방식: `useEditorPreferences`
- 용어집 CRUD: `useEditorDictionaries`
- 검색/필터/선택 상태: 페이지 라우트와 로컬 상태

임시저장 키는 translation unit UUID를 사용합니다. `category + unitKey`가 같아도 서로 다른 DB 항목이 충돌하지 않습니다.

## 주요 API

| 그룹 | 엔드포인트 |
| --- | --- |
| 번역 목록 | `GET /api/editor/items`, `GET /api/editor/overview`, `GET /api/editor/filters` |
| 번역 수정 | `PATCH /api/editor/items/:id`, `PATCH /api/editor/items/batch`, `POST /api/editor/items/:id/retain` |
| AI 번역 | `POST /api/editor/items/:id/ai-translation` |
| 검토 | `PATCH /api/editor/changes/:id` |
| 이력 | `GET /api/editor/items/:id/history`, `/api/editor/log/*` |
| 용어집 | `/api/editor/dictionaries/*` |
| 프로필 | `/api/profile`, `GET /api/users/:handle` |
| 인증 | `/auth/login`, `/auth/google`, `/auth/continue` |
| 관리자 | `/api/admin/users`, `/api/admin/patch-watcher`, `GET /api/admin/translation-pack`, `POST /api/admin/translation-pack/publish` |

## 데이터베이스

Schema migration은 이 저장소의 `database/migrations`에서만 관리합니다.

주요 테이블:

- 번역: `translation_units`, `source_versions`, `translations`, `translation_changes`, `translation_change_groups`, `translation_pack_publications`
- 원문 이력: `source_changes`, `source_revision_change_summary`, `version_items`
- 사용자: `app_users`, `app_user_social_links`
- 용어집: `editor_dictionaries`, `editor_dictionary_entries`
- 제한: `request_rate_limit_counters`

웹 서버는 실행 중 `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX` 같은 DDL을 실행하지 않습니다.

## 요청 보안

변경 요청에는 다음 검사가 적용됩니다.

- same-origin 검사
- JSON body 최대 128 KiB
- JSON content type 검사
- 사용자별 editor mutation/review rate limit
- 세션 사용자와 DB 사용자 재검증
- SQL 값 파라미터화

Nuxt는 기본 보안 헤더를 응답에 추가하고, 운영 환경에서는 PostgreSQL을 loopback에만 바인딩합니다.

## 배포

브랜치는 `develop → release → master` 순서로 승격합니다. `ci`는 `develop` push와 `release`/`master` 대상 PR에서 migration 검증 → lint → typecheck → build → production dependency audit 순서로 실행됩니다.

production 자동 배포는 같은 저장소의 `develop → release` PR이 실제 merge된 경우에만 실행됩니다. 배포 workflow는 `release` 대상 `pull_request`의 `closed` 이벤트에서 merge 여부와 head branch를 검증하고, merge된 `release` commit만 서버에 checkout합니다. 운영 확인이 끝난 뒤 `release → master` PR로 안정 버전을 반영합니다.

운영 구성:

```text
Nginx :443
  ↓
Nuxt container :3000
  ↓
PostgreSQL container :5432

systemd timer → pg_dump → local backup → optional R2
```

상세 절차는 `deploy/README.md`를 참고합니다.
