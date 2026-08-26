# Astral Patch Site

Astral Party 한국어 번역을 조회·제안·검토하기 위한 Nuxt 4 웹 애플리케이션입니다.

## 역할

- `user`: 번역 제안, AI 번역, 사전 기능 사용
- `verified`: `user` 권한 + 번역 승인/반려
- `admin`: 전체 관리 권한. 역할 부여는 현재 DB에서 직접 수행
- `bot`: 자동화 전용 예약 계정. 로그인할 수 없으며 원문 동기화 같은 자동 작업의 작성자로 사용

새 Google 사용자는 항상 `user`로 생성됩니다. 로그인 과정에서 role을 자동 승격하거나 강등하지 않습니다.

## 번역 상태 모델

`translations`에는 패치에 실제 사용되는 마지막 승인 번역이 저장됩니다. 원문이 변경되어도 이 번역은 제거되지 않으며 패치에 계속 사용됩니다.

새 번역 제안은 `translation_changes`에 `pending`으로 저장됩니다. 같은 항목에 여러 사용자가 서로 다른 pending 제안을 동시에 만들 수 있습니다. `verified` 또는 `admin`이 하나를 승인하면 같은 항목·locale의 나머지 pending 제안은 `superseded`로 자동 종료됩니다.

기존 승인 번역의 `approved_source_version_id`가 현재 원문과 다르면 UI에서 `확인 필요`로 표시합니다. 이때 `유지`를 누르면 기존 번역 텍스트를 그대로 현재 source version 대상으로 다시 pending에 올릴 수 있습니다.

## 데이터베이스

DB schema의 단일 소유자는 형제 프로젝트 `astral-party-korean-patch`입니다.

- migration: `../astral-party-korean-patch/database/migrations`
- 원문/source history: `astral-party-korean-patch` 자동화가 기록
- 웹 앱: 이미 migration된 schema를 조회하고 번역/사용자/사전 데이터만 기록
- 웹 요청 중 `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX` 같은 DDL은 실행하지 않음

초기 baseline에는 웹 앱에서 사용하는 `app_users`, `editor_dictionaries`, `editor_dictionary_entries`, `request_rate_limit_counters`도 포함됩니다.

## 환경변수

`.env.example`을 참고해 `.env`를 구성합니다. 실제 비밀값은 Git에 커밋하지 않습니다.

필수 항목:

```text
NUXT_SESSION_PASSWORD
NUXT_OAUTH_GOOGLE_CLIENT_ID
NUXT_OAUTH_GOOGLE_CLIENT_SECRET
DATABASE_URL
```

AI 번역을 사용할 경우 다음 항목도 설정합니다.

```text
AI_API_KEY
AI_BASE_URL
```

## 개발

```bash
pnpm install
pnpm dev
```

검증:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## 새 DB 구축 순서

DB를 새로 만들 때는 웹 앱을 먼저 실행해서 테이블을 만들지 않습니다.

1. `astral-party-korean-patch`의 migration을 새 DB에 적용합니다.
2. patch 자동화로 canonical source인 `INT_STEAM` 원문을 동기화합니다.
3. 웹 앱의 `DATABASE_URL`을 새 DB로 연결합니다.
4. 에디터/로그인/승인 흐름을 검증합니다.
5. 과거 번역 DB import는 새 schema와 자동화 검증이 끝난 뒤 별도 단계로 수행합니다.

## 주요 디렉터리

```text
app/pages/translate/editor.vue       번역 에디터
app/components/editor/               에디터 UI 구성요소
app/composables/editor-drafts.ts     브라우저 임시저장
server/api/editor/                   에디터 API
server/utils/editor-*.ts             에디터 DB/권한 로직
shared/types/                        클라이언트·서버 공용 타입
```

Draft의 내부 식별자는 translation unit UUID를 사용해 충돌을 막지만, 사용자에게 보이는 항목 식별자는 계속 `category + unitKey`를 사용합니다.
