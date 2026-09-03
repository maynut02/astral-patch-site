# Astral Patch Site

Astral Party 한국어 번역을 조회·제안·검토하는 Nuxt 4 웹 애플리케이션입니다. 이 저장소는 웹 UI와 사용자·번역 제안·검토 기능, DB schema migration을 담당합니다. 형제 프로젝트 `astral-party-korean-patch`는 번역 원문 동기화와 패치 생성을, `astral-party-auto-patcher`는 Windows/Android 패치 도구 배포를 담당합니다.

## 기술 스택

- Nuxt 4 / Vue 3 / TypeScript
- Nuxt UI / Tailwind CSS 4
- PostgreSQL / `postgres`
- `nuxt-auth-utils` + Google OAuth
- Docker Compose / Nginx / GitHub Actions

## 주요 기능

- 번역 진행도와 원문 변경 이력 조회
- 번역 편집, 임시저장, 일괄 저장
- 번역 제안 승인·반려 및 확인 필요 처리
- AI 번역
- 사용자 용어집
- 공개 프로필과 사용자 설정

## 시작하기

Node.js 22.19 이상(22.x) 또는 Nuxt가 지원하는 상위 버전과 pnpm 11을 사용합니다.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev`는 운영 DB에 직접 연결하지 않고 SSH local forwarding을 사용합니다. 터널 없이 Nuxt만 실행하려면 `pnpm dev:nuxt`를 사용합니다.

검증:

```bash
pnpm check
```

개별 명령은 `pnpm lint`, `pnpm typecheck`, `pnpm build`입니다.

## 브랜치 운영

```text
develop → release → master
```

GitHub 기본 브랜치는 `develop`로 사용하고 평소 개발도 여기서 진행합니다. `develop → release` PR이 merge되면 production에 자동 배포하고, 운영 확인이 끝난 버전은 `release → master` PR로 반영합니다. `release`와 `master`에는 직접 push하지 않습니다.

## 환경변수

`.env.example`은 다음 세 구역으로 나뉩니다.

1. 로컬 개발 환경
2. GitHub Repository secrets
3. 서버 운영 환경

실제 비밀값은 `.env`와 GitHub Secrets, 서버 환경에만 저장합니다.

## 프로젝트 구조

```text
app/                    Nuxt 클라이언트
  components/           공용 및 에디터 UI
  composables/          브라우저 상태와 기능 단위 로직
  pages/                페이지와 라우트
  utils/                순수 UI 헬퍼
server/
  api/                   JSON API
  routes/auth/           OAuth 라우트
  utils/                 DB, 인증, 에디터 도메인 로직
shared/types/            클라이언트·서버 공용 타입
scripts/                 로컬 개발·백업 스크립트
database/migrations/     순서대로 적용되는 PostgreSQL schema migration
deploy/                  Docker/Nginx/systemd 배포 파일
docs/                    구조와 개발 문서
```

## 핵심 규칙

- DB schema와 migration의 단일 소유자는 이 저장소입니다.
- 웹 요청에서는 DDL을 실행하지 않습니다.
- 승인된 번역은 `translations`, 제안과 검토 이력은 `translation_changes`에 저장합니다.
- `verified`와 `admin`만 번역을 승인·반려할 수 있습니다.
- 원문이 바뀌어도 마지막 승인 번역은 유지되며 UI에서 `확인 필요` 상태로 표시할 수 있습니다.

## 문서

- [아키텍처](docs/architecture.md)
- [개발 가이드](docs/development.md)
- [서버 배포](deploy/README.md)
- [기여 가이드](CONTRIBUTING.md)
- [보안 정책](SECURITY.md)

## 라이선스

[LICENSE](LICENSE)를 따릅니다.
