# 의존성 보안 패치

CI는 production 의존성의 High·Critical 취약점을 차단한다. 2026-10-06 기준 수정된 npm 릴리스가 없는 아래 두 항목은 `pnpm patchedDependencies`로 코드를 보완했다. `pnpm audit`는 패치 내용 대신 패키지 버전을 조회하므로, 해당 GHSA 두 개만 예외로 등록한다.

예외를 사용하기 전에 CI는 `pnpm test:security`를 실행한다. 테스트는 실제 설치된 전이 의존성에서 공격 입력의 거부와 정상 동작을 검증한다. 패치 누락 또는 회귀가 발생하면 CI가 실패한다. 패치 파일과 해시는 `pnpm-lock.yaml`에 고정하고, Docker 빌드에서도 설치 전에 패치 파일을 복사한다.

pnpm 11의 JSON `metadata.vulnerabilities`에는 예외 처리한 항목도 남는다. CI는 필터링된 `advisories` 목록에서 High·Critical 개수를 계산하고, 목록이 없는 보고서에서는 기존 metadata 집계를 사용한다. 원본 보고서도 CI 로그에 출력해 예외 처리 내역을 숨기지 않는다.

| 패키지 | 보완 내용 | 근거 |
| --- | --- | --- |
| `node-forge@1.4.0` | RSA DigestInfo의 중첩 DigestAlgorithm 원소 수를 엄격하게 검사 | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [upstream PR #1152](https://github.com/digitalbazaar/forge/pull/1152), commit `ceba34402e329f0365134f23fe19898756527d65`의 `lib/rsa.js` 변경 |
| `braces@3.0.3` | 파서와 AST walker에서 중첩 깊이를 100으로 제한 | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [issue #70](https://github.com/micromatch/braces/issues/70)의 권고와 미병합 수정 제안 [PR #78 (`97308a0`)](https://github.com/thaibaole89/braces/commit/97308a01d091b211cf015314a2d0696da28a5392)·[PR #72 (`28d440b5`)](https://github.com/FSDevelop/braces/commit/28d440b5dd449dbf1fe6f3506cf94ecca4d02660)에 따른 로컬 수정 |

`@nuxt/devtools@3.4.2`의 패치는 보안 수정 버전인 `simple-git@4.0.2`의 named export를 사용하도록 import 한 줄을 바꾼다. 기존 3.x default export가 4.x에서 제거돼 버전 갱신에 이 호환성 수정이 필요하다.

2026-10-07 CI에서 `@nuxt/devtools → launch-editor → shell-quote@1.10.0`의 [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv)가 감지됐다. 공식 수정 버전 `1.11.0`이 있으므로 영향받는 `>=1.8.4 <1.11.0` 버전만 `pnpm overrides`로 `1.11.0`에 고정하고 lockfile을 갱신했다. 이 항목은 보안 검사 예외에 추가하지 않는다.

2026-10-22 CI에서 [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm)(High)이 `launch-editor@2.14.1`과 이를 포함한 `vite@8.2.2`에서 감지됐다. 경로는 `nuxt → @nuxt/devtools → launch-editor`와 Nuxt 모듈 경로의 `vite`다. 공식 수정 버전이 있으므로 `launch-editor@<2.14.2`는 `2.14.2`로, `vite@>=8.2.0 <8.2.4`는 `8.2.4`로 `pnpm overrides`에 고정하고 lockfile을 갱신했다. 이 항목은 보안 검사 예외에 추가하지 않는다.

공식 수정 릴리스가 나오면 해당 버전으로 갱신하고 로컬 패치, GHSA 예외, 관련 회귀 테스트를 함께 검토한다. 새 advisory나 다른 High·Critical 취약점에는 이 예외가 적용되지 않는다.
