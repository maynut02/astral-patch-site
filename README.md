# Astral Patch Site

[![ci](https://github.com/maynut02/astral-patch-site/actions/workflows/ci.yml/badge.svg?event=pull_request)](https://github.com/maynut02/astral-patch-site/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Astral Party 한국어 패치 커뮤니티 사이트 — <https://astral.maynutlab.com>

번역을 함께 만들고 검토하는 웹 에디터, 패치 다운로드·릴리즈 안내, 파티 채팅, 모드 허브를 하나의 Nuxt 앱으로 제공합니다. 이 저장소는 웹 애플리케이션과 PostgreSQL schema migration을 소유합니다.

## 목차

- [기능](#기능)
- [기술 스택](#기술-스택)
- [빠르게 시작하기](#빠르게-시작하기)
- [명령어](#명령어)
- [프로젝트 구조](#프로젝트-구조)
- [관련 저장소](#관련-저장소)
- [문서](#문서)
- [기여](#기여)
- [라이선스](#라이선스)

## 기능

| 영역 | 경로 | 내용 |
| --- | --- | --- |
| 홈 | `/` | 설치 안내 마법사, 게임 서버 상태·공지, 번역 진행도와 최근 번역 |
| 다운로드·릴리즈 | `/download`, `/release`, `/android`, `/patcher/:route/:action` | 패치 도구 내려받기, GitHub 릴리즈 노트, 패치 앱 설치·제거 실행 링크(`astral://`, Android App Link) |
| 번역 | `/translate`, `/translate/editor`, `/translate/review` | 진행도 대시보드, 번역 편집·임시저장·일괄 저장, AI 번역, 용어집, 댓글, 제안 승인·반려 |
| 변경 기록 | `/change` | 원문 변경과 번역 변경 이력(실시간 갱신) |
| 파티 채팅 | `/party`, `/party/:roomId` | 인게임 방 ID 기반 WebSocket 채팅, PiP 창 |
| 모드 허브 | `/mod`, `/mod/:id` | GitHub 저장소 기반 모드 등록·조회·릴리즈 다운로드 |
| 커뮤니티 | `/notice`, `/contributor`, `/status`, `/@:handle` | 공지, 기여자, 패치 감시 상태, 공개 프로필 |
| 계정·관리 | `/setup`, `/setting`, `/admin` | Google 로그인 초기 설정, 계정 설정, 사용자 역할·패치 감시·번역 팩 배포 관리 |

## 기술 스택

- [Nuxt 4](https://nuxt.com) (Vue 3, Nitro, TypeScript)
- [Nuxt UI 4](https://ui.nuxt.com) · Tailwind CSS 4
- PostgreSQL 18 · [`postgres`](https://github.com/porsager/postgres) 클라이언트
- [`nuxt-auth-utils`](https://github.com/atinux/nuxt-auth-utils) + Google OAuth
- `nuxt-og-image` (Takumi 렌더러)
- Docker Compose · Nginx · systemd · GitHub Actions · Cloudflare R2

## 빠르게 시작하기

요구사항: Node.js `^22.23.4 || ^24.22.1 || >=26.12.1`(`.nvmrc`는 22), pnpm 11, 개발 DB에 접근할 SSH 계정.

```bash
pnpm install
cp .env.example .env   # 값 채우기: docs/development.md
pnpm dev               # SSH 터널을 열고 Nuxt 개발 서버 시작
```

`pnpm dev`는 `.env`의 SSH 설정으로 원격 PostgreSQL을 로컬 포트에 포워딩한 뒤 <http://localhost:3000>을 띄웁니다. 별도 PostgreSQL을 직접 쓰려면 `pnpm dev:nuxt`를 사용합니다. 자세한 내용은 [개발 가이드](docs/development.md)를 참고하세요.

## 명령어

| 명령 | 설명 |
| --- | --- |
| `pnpm dev` | SSH 터널 + Nuxt 개발 서버 |
| `pnpm dev:nuxt` | Nuxt 개발 서버만 실행 |
| `pnpm build` / `pnpm preview` | production 빌드 / 빌드 결과 실행 |
| `pnpm check` | `db:check` → `test:unit` → `lint` → `typecheck` → `build` (PR 전 필수) |
| `pnpm db:check` | migration 파일 번호·형식 검증 |
| `pnpm data:sync` / `pnpm data:sync --watch` | 운영 공개 번역을 별도 로컬 DB에 동기화 (watch: 15분 간격) |
| `pnpm glossary:seed` | 기존 번역 기반 기초 용어집 최초 등록 |
| `pnpm test:unit` | 서버 없이 실행하는 테스트 전체 (보안 패치, 모드, 파티 채팅) |
| `pnpm test:party` / `pnpm test:party:storage` | 실행 중인 서버 대상 파티 채팅 통합 테스트 |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm typecheck` | `nuxt typecheck` |
| `pnpm audit:prod` | production 의존성 High·Critical 취약점 검사 |

## 프로젝트 구조

```text
app/
  pages/              라우트별 화면
  components/         UI 컴포넌트 (editor/, mod/, party/, home/ …)
  composables/        브라우저 상태와 기능 로직
  utils/              부작용 없는 헬퍼
server/
  api/                JSON API
  routes/             OAuth, WebSocket(/ws, /ws/party), .well-known
  middleware/         세션 갱신, 캐시 헤더
  plugins/            파티 채팅 정리 작업
  utils/              인증·권한·DB·도메인 로직
shared/types/         클라이언트·서버 공용 타입과 상수
database/migrations/  PostgreSQL schema migration (0001부터 순서대로)
deploy/               migration 실행기, 백업, Nginx 템플릿, systemd, 서버 초기화
scripts/              개발 터널, migration 검사, 테스트, 백업 업로드
docs/                 설계·운영 문서
```

## 관련 저장소

| 저장소 | 역할 |
| --- | --- |
| `astral-party-korean-patch` | 원문 동기화, 패치 생성, 패치 감시 기록 |
| `astral-party-auto-patcher` | Windows/Android 패치 도구 릴리즈 |
| `astral-party-korean-plugin` | Windows 한글패치 플러그인, 번역 팩 소비자 |

세 저장소 모두 이 저장소가 관리하는 DB schema를 따릅니다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | 시스템 구성, 계층, 인증, 실시간, 요청 보안 |
| [docs/development.md](docs/development.md) | 로컬 환경, 환경변수, 테스트, 코드 규칙 |
| [docs/database.md](docs/database.md) | schema 소유권, migration 작성·실행 규칙 |
| [docs/translation.md](docs/translation.md) | 번역 제안·검토 흐름, 에디터, 번역 팩 |
| [docs/party-chat.md](docs/party-chat.md) | 파티 채팅 프로토콜, 재접속, 제한, 연결 로그 |
| [docs/mod-hub.md](docs/mod-hub.md) | 모드 허브 규칙과 GitHub 연동 |
| [docs/deployment.md](docs/deployment.md) | 서버 구성, 배포 파이프라인, 백업, 운영 점검 |
| [docs/dependency-security.md](docs/dependency-security.md) | 의존성 취약점 대응 기록 |

## 기여

[CONTRIBUTING.md](CONTRIBUTING.md)를 읽어 주세요. 보안 문제는 공개 이슈 대신 [SECURITY.md](SECURITY.md)의 절차를 따릅니다.

## 라이선스

[MIT](LICENSE)
