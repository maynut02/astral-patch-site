# 기여 가이드

## 작업 순서

1. `develop`에서 변경 목적을 확인하고 작업합니다.
2. 기능과 무관한 포맷 변경을 섞지 않습니다.
3. `pnpm check`를 통과시킵니다.
4. 배포할 변경은 `develop → release` PR로 올립니다.
5. production 확인 후 `release → master` PR로 안정 버전을 반영합니다.

`release`와 `master`에는 직접 push하지 않습니다.

## 코드 기준

- 기존 UI와 사용자 흐름을 의도 없이 변경하지 않습니다.
- 중복 타입과 상수는 공용 모듈로 통합합니다.
- 페이지가 커지면 기능 단위 composable/component로 분리합니다.
- 서버 API에서 도메인 규칙을 직접 중복 구현하지 않습니다.
- DB schema 변경은 `astral-party-korean-patch` migration에서 처리합니다.
- 주석은 주요 로직의 이유만 한국어 한 줄로 남깁니다.

## 커밋

한 커밋에는 하나의 목적만 담는 것을 권장합니다. 예:

```text
refactor: split editor dictionary state
 docs: document project architecture
fix: prevent stale translation approval
```

## 검증

```bash
pnpm lint
pnpm typecheck
pnpm build
```
