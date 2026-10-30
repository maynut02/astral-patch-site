# 개발 가이드

## 요구사항

- Node.js `^22.23.4 || ^24.22.1 || >=26.12.1` (`package.json`의 `engines`, `.nvmrc`)
- pnpm 11
- 개발 DB: SSH로 접근 가능한 서버의 PostgreSQL, 또는 migration을 적용한 별도 PostgreSQL

## 설정

```bash
pnpm install
cp .env.example .env
```

`.env.example`은 세 구역으로 나뉩니다: **1. 로컬 개발**(`.env`), **2. GitHub Secrets**, **3. 서버 운영 환경**. 로컬에서는 1번 구역만 채웁니다.

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | ✓ | `pnpm dev` 사용 시 `127.0.0.1`/`localhost`의 `ASTRAL_DEV_DB_LOCAL_PORT`를 가리켜야 함 |
| `NUXT_SESSION_PASSWORD` | ✓ | 32자 이상 임의 값 |
| `NUXT_OAUTH_GOOGLE_CLIENT_ID`, `NUXT_OAUTH_GOOGLE_CLIENT_SECRET` | ✓ | Google OAuth. redirect URI `http://localhost:3000/auth/google` 등록 |
| `ASTRAL_SSH_HOST` | `pnpm dev` | 터널 대상 서버 |
| `ASTRAL_SSH_USER`, `ASTRAL_SSH_PORT`, `ASTRAL_SSH_KEY_PATH` | | 기본 `ubuntu`, `22`, 기본 키/agent |
| `ASTRAL_DEV_DB_LOCAL_PORT`, `ASTRAL_DEV_DB_REMOTE_HOST`, `ASTRAL_DEV_DB_REMOTE_PORT` | | 기본 `55433`, `127.0.0.1`, `5433` |
| `NUXT_ANDROID_CERTIFICATE_SHA256` | | `/.well-known/assetlinks.json`의 서명 지문 |
| `AI_API_KEY`, `AI_BASE_URL` | | AI 번역 |
| `GITHUB_TOKEN` | | GitHub API rate limit 완화 (릴리즈 피드, 모드 허브) |
| `ASTRAL_WS_ALLOWED_ORIGINS` | | `/ws`, `/ws/party`에 추가로 허용할 Origin (쉼표 구분) |
| `ASTRAL_WS_MAX_*`, `ASTRAL_WS_*_MS`, `ASTRAL_WS_*_BYTES` | | 공용 `/ws` 허브 제한값. 미설정 시 기본값 (파티 채팅 제한은 코드 고정) |
| `ASTRAL_TRUST_PROXY` | | `true`면 `X-Real-IP`를 클라이언트 IP로 신뢰 (Nginx 뒤에서만) |

## 실행

```bash
pnpm dev
```

`scripts/dev-with-tunnel.mjs`가 SSH local forwarding(`127.0.0.1:<local> → 서버 127.0.0.1:5433`)을 연 뒤 Nuxt를 시작합니다. 터널이 끊기면 Nuxt도 종료합니다.

> [!WARNING]
> 기본 터널 대상은 운영 서버의 PostgreSQL입니다. 로컬에서 실행한 쓰기 요청과 통합 테스트(`test:party`, `test:party:storage`)는 실제 데이터에 기록됩니다.

로컬 PostgreSQL을 쓰려면 `DATABASE_URL`을 그 DB로 바꾸고 `pnpm dev:nuxt`를 실행합니다. 새 DB는 먼저 migration을 적용합니다([database.md](database.md)).

빌드 결과(`.output`)를 직접 실행할 때 DB 주소는 `NUXT_DATABASE_URL` → 빌드 시점 `DATABASE_URL` → 실행 시점 `DATABASE_URL` 순서로 정해집니다. 빌드 때와 다른 DB를 쓰려면 `NUXT_DATABASE_URL`을 지정합니다.

## 테스트

| 명령 | 서버 필요 | 대상 |
| --- | --- | --- |
| `pnpm test:security` | | 로컬 패치한 `node-forge`, `braces` 회귀 |
| `pnpm test:mods` | | 모드 GitHub 연동, 마크다운 렌더링, 권한·관리 |
| `pnpm test:glossary` | PostgreSQL 사례만 별도 DB 필요 | 다국어 용어 검증·매칭, 개인 용어집 보존, 제안·검토 권한, 중복 제출, 리비전 경쟁 승인·이력 |
| `pnpm test:translation-pack` | PostgreSQL 사례만 별도 DB 필요 | 번역 팩 배포·이력 연결·실패 롤백·동시 승인 경계 및 실시간 갱신 경합. `TEST_DATABASE_URL`이 없으면 PostgreSQL 사례만 건너뜀 |
| `pnpm test:party:rooms` | | 방 생명주기, TTL, 메시지 순서 |
| `pnpm test:party:route` | | 파티 WebSocket·HTTP 핸들러 (재접속 승계, 종료 사유, 오류 응답) |
| `pnpm test:party:client` | | 재접속 클라이언트 상태 머신 |
| `pnpm test:party:adapter` | | WebSocket 어댑터 통합 |
| `pnpm test:party [url]` | ✓ | HTTP·WebSocket 통합 (기본 `http://localhost:3000`) |
| `pnpm test:party:storage [url]` | ✓ | DB 저장과 과거 기록 조회 |

`pnpm test:unit`은 서버가 필요 없는 위 묶음과 번역 팩 회귀 스크립트를 실행하고, `pnpm check`는 여기에 `db:check`, `lint`, `typecheck`, `build`를 더합니다.

번역 팩 DB 회귀는 기존 `postgres` 의존성으로 실제 PostgreSQL에서 실행합니다. `.env`나 `DATABASE_URL`을 사용하지 않으며, 명시적으로 `TEST_DATABASE_URL`을 지정해야 합니다. **운영 DB가 아닌 별도 테스트 DB**를 사용하세요. 각 테스트는 임의 이름의 schema를 만들고 필요한 migration을 적용한 뒤 삭제합니다. R2·WebSocket 경계만 대체하므로 실제 파일 업로드나 알림 전송은 없습니다. 실시간 갱신 회귀는 DB 없이도 실행되며, 배포 전체 갱신과 개별 변경 갱신이 겹쳐도 이력을 누락하지 않는지 확인합니다.

```bash
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/astral_test pnpm test:translation-pack
```

## CI

`.github/workflows/ci.yml`은 `release`/`master` 대상 PR(열림, 새 커밋 push, 다시 열림)과 수동 실행에서 실행됩니다. `develop` push만으로는 실행되지 않으므로, PR 없이 확인하려면 Actions에서 수동 실행합니다.

1. `pnpm run db:check`
2. 실제 PostgreSQL 컨테이너에 migration 두 번 적용 (두 번째 실행은 적용 기록을 보고 모두 건너뛰어야 성공)
3. `lint` → `test:unit` → `typecheck` → `build`
4. `test:security` 후 `audit:prod`

CI의 단위 테스트 단계는 전용 컨테이너의 호스트 포트로 `TEST_DATABASE_URL`을 지정하므로 용어집·번역 팩 PostgreSQL 사례도 실제 실행합니다. 로컬 실행에서는 테스트 DB 주소를 명시하지 않으면 해당 DB 사례가 skip으로 표시됩니다.

## API 규칙

- 변경 요청은 `readJsonBody`(same-origin + JSON + 크기 검사) 또는 본문 없는 요청이면 `assertMutationRequest`를 먼저 호출합니다.
- 로그인이 필요하면 `requireCurrentSessionUser`, 관리자는 `requireAdminSession` 등 `server/utils/auth-user.ts`의 헬퍼를 사용합니다.
- 사용자 입력 검증은 `server/utils/validation.ts`를 재사용합니다.
- 쿼리는 `postgres` 태그드 템플릿으로만 작성합니다.
- 새 엔드포인트는 실제 호출하는 화면이 있을 때만 추가합니다.

## 디버깅 팁

- 서버 오류는 `server/utils/server-log.ts`의 `logServerError(scope, message, error)`로 `[scope] message` 형식으로 남깁니다.
- 파티 채팅 끊김은 `party_chat_connection_events` 테이블로 분석합니다([party-chat.md](party-chat.md#연결-로그)).
