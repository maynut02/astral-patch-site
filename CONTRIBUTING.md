# 기여 가이드

## 브랜치

```text
develop ──PR + ci──▶ release ──(merge 시 production 자동 배포)──▶ 운영 확인 ──PR + ci──▶ master
```

| 브랜치 | 용도 |
| --- | --- |
| `develop` | 기본 브랜치. 일상 개발과 커밋 |
| `release` | production 배포 대상 |
| `master` | 운영 확인을 마친 안정 버전 |

- `release`, `master`에는 직접 push하지 않습니다. 두 브랜치는 PR과 `ci` 통과가 필수이고 force push·삭제가 막혀 있습니다.
- 자동 배포는 같은 저장소의 `develop → release` PR이 merge될 때만 실행됩니다.

## 작업 순서

1. `develop`에서 작업합니다.
2. 변경 목적과 무관한 포맷·리팩터링을 섞지 않습니다.
3. `pnpm check`를 통과시킵니다.
4. 배포할 시점에 `develop → release` PR을 엽니다.

## 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/) 형식을 사용하고 한 커밋에는 한 가지 목적만 담습니다.

```text
feat: add party chat picture-in-picture
fix: keep drafts when another tab loads empty storage
refactor: split editor dictionary state
docs: rewrite deployment guide
```

## 코드 규칙

- 의도하지 않은 UI·사용자 흐름 변경을 만들지 않습니다.
- `any`를 추가하지 않습니다. 클라이언트와 서버가 함께 쓰는 타입·상수는 `shared/types`에 둡니다.
- API handler는 입력 파싱과 응답만 담당하고 규칙·쿼리는 `server/utils`에 둡니다.
- 큰 페이지는 기능 단위 composable·component로 나눕니다. 부작용 없는 로직은 `app/utils`에 둡니다.
- 역할 문자열은 `shared/types/user.ts`의 `UserRole`을 사용합니다.
- 주석은 이유가 필요한 곳에만 짧게 씁니다.
- 임시 파일·백업 파일을 커밋하지 않습니다.

API·DB 변경 시 지켜야 할 규칙은 [개발 가이드](docs/development.md#api-규칙)와 [데이터베이스](docs/database.md)를 따릅니다.

## 테스트

- 서버 없이 실행되는 테스트는 `scripts/test-*.mjs`에 있고 `pnpm test:unit`에 등록합니다.
- 버그 수정은 수정 전 실패하고 수정 후 통과하는 테스트를 함께 추가하는 것을 원칙으로 합니다.
- 구현 세부나 문구를 고정하는 테스트는 만들지 않습니다.

## PR 체크리스트

- [ ] `pnpm check` 통과
- [ ] DB 변경이 있으면 새 migration 추가 (기존 migration 수정 금지)
- [ ] 환경변수 추가·변경 시 `.env.example`과 문서 갱신
- [ ] 동작이 바뀌면 `docs/` 갱신
