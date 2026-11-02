# 의존성 보안

## 정책

- CI는 production 의존성의 High·Critical 취약점이 있으면 실패합니다(`pnpm run audit:prod`, `scripts/audit-prod-deps.mjs`).
- 공식 수정 버전이 있으면 버전을 올리거나 `pnpm overrides`로 고정합니다. 이 경우 audit 예외를 만들지 않습니다.
- 수정 버전이 없을 때만 `pnpm patchedDependencies`로 코드를 직접 고치고, 해당 GHSA만 audit 예외로 등록합니다. 예외를 쓰기 전에 CI는 `pnpm test:security`로 설치된 패키지가 공격 입력을 거부하고 정상 입력은 그대로 처리하는지 검증합니다. 패치가 빠지거나 회귀하면 CI가 실패합니다.
- 패치 파일과 해시는 `pnpm-lock.yaml`에 고정되고, Docker 빌드도 설치 전에 패치 파일을 복사합니다.
- pnpm 11의 JSON `metadata.vulnerabilities`에는 예외 항목도 집계됩니다. `audit:prod`는 필터링된 `advisories` 목록으로 High·Critical 수를 세고(목록이 없으면 metadata 집계 사용), 원본 보고서를 CI 로그에 그대로 출력해 예외 내역을 숨기지 않습니다.
- 예외는 명시한 GHSA에만 적용됩니다. 공식 수정 릴리스가 나오면 버전을 올리고 로컬 패치·예외·회귀 테스트를 함께 정리합니다.

## 현재 로컬 패치 (audit 예외)

| 패키지 | 보완 내용 | 근거 | 테스트 |
| --- | --- | --- | --- |
| `braces@3.0.3` | 파서와 AST walker의 중첩 깊이를 100으로 제한 | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [issue #70](https://github.com/micromatch/braces/issues/70)의 권고와 미병합 수정안 [PR #78 (`97308a0`)](https://github.com/thaibaole89/braces/commit/97308a01d091b211cf015314a2d0696da28a5392)·[PR #72 (`28d440b5`)](https://github.com/FSDevelop/braces/commit/28d440b5dd449dbf1fe6f3506cf94ecca4d02660) | `scripts/test-security-braces.mjs` |

## 호환성 패치

| 패키지 | 내용 |
| --- | --- |
| `@nuxt/devtools@3.4.2` | 보안 수정 버전 `simple-git@4.0.2`의 named export를 쓰도록 import 한 줄 수정. 3.x의 default export가 4.x에서 제거되어 버전을 올리려면 필요 |

## 버전 고정 (overrides)

`pnpm-workspace.yaml`의 `overrides`입니다.

| 대상 | 고정 버전 | 근거 | 경로 |
| --- | --- | --- | --- |
| `'@nuxt/devtools>simple-git'` | `4.0.2` | 보안 수정 버전 (위 호환성 패치와 한 묶음) | `@nuxt/devtools → simple-git` |
| `node-forge@>=1.0.0 <1.4.1` | `1.4.1` | [공식 수정 릴리스](https://www.npmjs.com/package/node-forge/v/1.4.1). RSA DigestInfo 기존 예외와 신규 High 5건을 해소하고 로컬 패치·예외 제거. `test-security-forge.mjs`의 공격 입력·정상 서명 회귀 검증 유지 | `nuxt → @nuxt/cli → listhen → node-forge` |
| `seroval@>=1.0.0 <1.6.8` | `1.6.8` | [공식 수정 릴리스](https://www.npmjs.com/package/seroval/v/1.6.8). 역직렬화 관련 High 3건 해소 | 전이 의존성 |
| `brace-expansion@>=2.0.0 <2.1.6`, `prosemirror-view@<1.42.3`, `source-map-js@>=1.0.0 <1.2.2` | `2.1.6`, `1.42.3`, `1.2.2` | 2026-10-06 의존성 취약점 정리·보안 CI 복구 commit `d9f7989`에서 추가 | 전이 의존성 |
| `undici@>=8.0.0 <8.12.2` | `8.12.2` | [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c) (High) | `nuxt`, `@nuxt/fonts → unifont`, `nuxt-og-image → unifont` |
| `zod@>=4.0.0 <4.6.6` | `4.6.6` | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (High) | `@nuxt/ui`, `nuxt → @unhead/vue → … → @devframes/json-render` |
| `shell-quote@>=1.8.4 <1.11.0` | `1.11.0` | [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) | `@nuxt/devtools → launch-editor → shell-quote` |
| `launch-editor@<2.14.2` | `2.14.2` | [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) (High) | `nuxt → @nuxt/devtools → launch-editor` |
| `vite@>=8.2.0 <8.2.4` | `8.2.4` | 같은 advisory (`vite@8.2.2`가 `launch-editor` 포함) | Nuxt 모듈 경로의 `vite` |
| `'fontless>esbuild'`, `@tiptap/core` | `0.28.2`, `3.31.3` | 보안 목적이 아닌 버전 정렬 | |

## Node.js 런타임

Docker 기본 이미지는 패치 버전까지 고정합니다. `docker compose up --build`는 로컬에 있는 움직이는 태그를 다시 받지 않아, `node:22-alpine` 같은 태그만으로는 운영 서버가 수정 버전으로 갱신되지 않기 때문입니다.

| 위치 | 현재 값 |
| --- | --- |
| `Dockerfile` builder·runner, `Dockerfile.r2-backup` (`FROM` 3곳) | `node:22.23.4-alpine` |
| `package.json` `engines.node` | `^22.23.4 \|\| ^24.22.1 \|\| >=26.12.1` (지원 계열별 수정 버전 이상) |

다음 Node.js 보안 릴리스 때 세 `FROM` 줄과 `engines`를 함께 올립니다.

## 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-10-06 | 수정 릴리스가 없는 `node-forge`, `braces`를 `patchedDependencies`로 보완하고 두 GHSA를 audit 예외로 등록. `@nuxt/devtools` 호환성 패치 |
| 2026-10-07 | CI에서 `shell-quote@1.10.0`의 GHSA-pqg4-j6r4-53mv 감지 → `1.11.0` override |
| 2026-10-22 | CI에서 `launch-editor@2.14.1`·`vite@8.2.2`의 GHSA-587h-7wmj-h5pm(High) 감지 → `2.14.2`·`8.2.4` override |
| 2026-10-22 | Node.js [2026-10-21 보안 릴리스](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)(High: Brotli 디코더 범위 밖 쓰기, TLS 인증서 호스트 이름 검증 우회 등, 번들 Undici·OpenSSL·c-ares 갱신) 대응: 기본 이미지 `node:22-alpine` → `node:22.23.4-alpine`, `engines.node`를 `22.23.4`·`24.22.1`·`26.12.1` 이상으로 상향 |
| 2026-10-24 | CI에서 `undici@8.10.2`의 GHSA-xjj6-f33q-929c, `zod@4.4.3`의 GHSA-mrhx-c7xc-m3w5(모두 High) 감지 → `8.12.2`·`4.6.6` override |
| 2026-10-31 | 용어집 배포 후보 CI에서 감지한 High 8건을 공식 `node-forge@1.4.1`·`seroval@1.6.8`로 수정. 기존 Forge 로컬 패치·audit 예외 제거, 보안 회귀 테스트 유지 |
