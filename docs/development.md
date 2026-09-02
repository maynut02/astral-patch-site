# 개발 가이드

## 요구사항

- Node.js 22.19 이상(22.x) 또는 Nuxt가 지원하는 상위 버전
- pnpm 11
- SSH로 접근 가능한 개발 DB 또는 별도 호환 PostgreSQL

버전은 `.nvmrc`와 `package.json`을 기준으로 합니다.

## 초기 설정

```bash
pnpm install
cp .env.example .env
```

로컬 `.env`에는 최소 다음 값이 필요합니다.

```text
DATABASE_URL
NUXT_SESSION_PASSWORD
NUXT_OAUTH_GOOGLE_CLIENT_ID
NUXT_OAUTH_GOOGLE_CLIENT_SECRET
ASTRAL_SSH_HOST
```

AI 번역 개발 시 `AI_API_KEY`, `AI_BASE_URL`도 설정합니다.

## 실행

```bash
pnpm dev
```

`pnpm dev`는 `scripts/dev-with-tunnel.mjs`가 SSH tunnel을 열고 Nuxt를 시작합니다. `DATABASE_URL`은 `127.0.0.1` 또는 `localhost`의 지정된 local port만 허용합니다.

Nuxt만 실행:

```bash
pnpm dev:nuxt
```

## 브랜치와 릴리스 흐름

브랜치는 다음 역할로 고정합니다.

```text
develop  개발 작업과 일반 커밋
release  production 배포 대상
master   배포 검증이 끝난 안정 버전
```

기본 흐름:

```text
develop
  ↓ PR + CI
release
  ↓ production 자동 배포
  ↓ 운영 확인 후 PR + CI
master
```

- GitHub 기본 브랜치는 `develop`로 사용합니다.
- 평소 코드는 `develop`에서 수정합니다.
- `develop → release` PR이 merge된 경우에만 production 자동 배포가 실행됩니다.
- 배포 확인 후 `release → master` PR로 안정 버전을 반영합니다.
- `release`, `master`에는 직접 push하지 않습니다.
- `release`, `master`는 PR과 `ci` 통과를 필수로 하고 force push와 삭제를 차단합니다.
- 수동 production 재배포는 GitHub Actions의 `Deploy production`에서 실행하며 항상 `release`의 최신 commit을 사용합니다.

## 검증

```bash
pnpm check
```

수정 가능한 lint 오류 정리:

```bash
pnpm lint:fix
```

PR 전 migration 검증, `lint`, `typecheck`, `build`가 모두 통과해야 합니다.

## 코드 규칙

- TypeScript 타입을 우선 사용하고 `any`를 추가하지 않습니다.
- 공용 타입은 `shared/types`에 둡니다.
- UI와 무관한 순수 로직은 `app/utils`로 분리합니다.
- 브라우저 상태나 재사용 가능한 기능 로직은 `app/composables`로 분리합니다.
- API handler는 입력 검증과 응답에 집중하고 DB 규칙은 `server/utils`로 분리합니다.
- 역할 문자열은 `shared/types/user.ts`의 `UserRole`을 사용합니다.
- 주석은 이유가 필요한 주요 로직에만 한국어 한 줄로 작성합니다.
- 기능과 무관한 백업 파일이나 임시 파일은 저장소에 추가하지 않습니다.

## DB 변경

DB 변경이 필요한 경우:

1. `database/migrations`에 다음 번호의 migration을 추가합니다.
2. 기존 migration을 수정하지 않고 새 DB와 기존 DB 양쪽에서 검증합니다.
3. 필요한 타입과 쿼리를 함께 반영합니다.
4. `pnpm check`를 실행합니다. CI에서는 실제 PostgreSQL에 migration을 두 번 적용해 재실행 안전성도 확인합니다.

## API 변경

변경 요청은 `readJsonBody` 또는 `assertMutationRequest`를 사용해 same-origin과 body 크기 검사를 유지합니다. 권한이 필요한 API는 `getCurrentSessionUser` 계열 검사를 사용합니다.

새 쿼리는 문자열 결합 대신 `postgres` 파라미터 바인딩을 사용합니다.

## 환경변수

`.env.example`의 세 구역을 기준으로 관리합니다.

- 로컬: `.env`
- GitHub: Repository secrets
- 서버: 서버 `.env` 및 `/etc/default/astral-patch`

실제 토큰, 비밀번호, 개인키는 커밋하지 않습니다.
