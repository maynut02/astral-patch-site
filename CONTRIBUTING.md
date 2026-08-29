# 기여 가이드

## 작업 순서

1. 이슈 또는 변경 목적을 확인합니다.
2. 별도 브랜치에서 작업합니다.
3. 기능과 무관한 포맷 변경을 섞지 않습니다.
4. `pnpm check`를 통과시킵니다.
5. 변경 이유와 검증 방법을 PR에 작성합니다.

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
