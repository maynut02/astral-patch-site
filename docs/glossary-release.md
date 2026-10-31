# 공통 용어집 운영 반영

운영 앱은 기존 `DATABASE_URL`의 원문·승인 번역·사용자 권한을 사용합니다. 로컬 공개 API 사본이나 `ASTRAL_MIRROR_DATABASE_URL`, 별도 동기화 프로세스를 운영에 설정할 필요가 없습니다.

## 관리자 승인과 배포

1. 기여 PR을 검토해 upstream `develop`에 병합합니다. 첫 기여자의 CI가 실행 승인을 기다리면 GitHub Actions에서 승인한 뒤 결과를 확인합니다.
2. 같은 저장소의 `develop → release` PR을 만들고 `ci` 통과 후 관리자가 병합합니다.
3. 기존 Deploy workflow가 DB 백업, migration, 앱 이미지 빌드·재기동, Nginx 검사와 상태 확인을 수행합니다. 운영 자격 증명·승인 조건은 기존 설정을 유지합니다.

포크의 브랜치를 `release`에 바로 병합하면 기존 배포 보호 조건에 맞지 않습니다. 기여 PR을 `develop`으로 반영한 뒤 정식 release PR을 사용합니다.

## 배포에 포함되는 데이터

- `0019_editor_glossary.sql`: 기존 개인 용어집을 보존하며 공통 기준·제안·이력 구조를 추가합니다.
- `0020_base_glossary.sql`: 검토 데이터 `data/glossary-base.json`의 기초 용어 85개를 배포 DB에서 대조해 최초 등록합니다. 별도의 Node 스크립트 실행이나 데이터 가져오기는 필요 없습니다.
- 원문 Key·버전, 언어별 실제 표현, 현재 원문에 승인된 한국어 번역이 모두 일치하는 항목만 등록합니다. 중국어 의미 합의를 추정하지 않으며 대조 상태는 미기록입니다.
- 기존 공개 공통 용어집이 있으면 재사용합니다. 개인·비공개 용어집은 공통으로 승격하지 않습니다.
- 다른 공통 용어집의 기존 표기·보관 항목·대기·보류 제안이 같은 대응어를 다루면 건너뜁니다. 수동 수정과 검토 결과를 덮어쓰지 않습니다.
- 빈 DB나 근거가 변경된 항목은 등록하지 않습니다. 실행 로그의 `Base glossary: added ..., existing ..., skipped evidence ...`에서 결과를 확인할 수 있습니다.
- 용어집 테이블을 검토 처리 순서로 잠그며 조회는 허용합니다. 잠금 대기는 5초로 제한하고 실패하면 해당 migration 전체를 롤백합니다.
- 원문·승인 번역·번역 제안·코멘트·배포 팩은 수정하지 않습니다.

`pnpm db:check`는 migration과 검토 JSON의 일치도 검사합니다. 검토 데이터 변경 시 아직 배포하지 않은 migration은 `pnpm glossary:generate`로 생성합니다. 운영에 적용된 migration은 수정하지 않고 다음 번호를 추가합니다.

## 검증과 배포 산출물

CI는 develop push와 develop/release/master PR에서 migration 두 번 적용, 테스트, lint, typecheck, Nuxt 빌드, 의존성 검사, 실제 Linux 운영 이미지 빌드와 HTTP 검증을 실행합니다.

CI가 통과하면 `astral-site-<commit SHA>` artifact에 다음 파일을 보관합니다.

- 검토한 소스 archive와 실행 가능한 Docker 이미지 archive
- 이미지 ID, HTTP 검증 결과와 SHA256 체크섬
- 공통 용어집 migration과 이 문서

artifact의 SHA와 승인할 PR의 검증 커밋을 대조합니다. 운영 배포는 기존 workflow가 승인된 release 커밋을 체크아웃하는 방식으로 진행하며 artifact를 내려받아 수동 배포할 필요는 없습니다.

배포 후 `/translate/glossary`에서 기초 용어와 실제 Key, 사용처 검색을 확인합니다. `/translate/editor`의 일본어·중국어 원문에서 일치 표현을 눌러 같은 기준이 열리는지도 확인합니다. 신규 항목·수정·보관은 단건 제안과 검토 절차를 사용하며 일괄 추가·삭제·AI 추출 API는 제공하지 않습니다.

## 앱 버전 복구

0019는 컬럼·테이블 추가이고 0020은 기초 데이터 등록이므로 이전 앱이 조회하던 컬럼과 기존 번역은 유지됩니다. 앱만 이전 운영 커밋으로 되돌릴 수 있습니다. DB migration 파일·기록이나 기존 데이터를 삭제하지 않습니다.

앱 문제가 생기면 관리자가 기존 운영 디렉터리에서 직전 운영 SHA를 지정해 아래 작업을 수행할 수 있습니다. 현재 `.env`와 DB는 그대로 사용합니다.

```sh
PREVIOUS_SHA=<직전 운영 커밋 SHA>
ROLLBACK_DIR="$(mktemp -d /tmp/astral-site-rollback.XXXXXX)"
git archive "$PREVIOUS_SHA" | tar -x -C "$ROLLBACK_DIR"
APP_CONTAINER="$(docker compose -p astral-patch ps -a -q astral-patch-site)"
APP_IMAGE="$(docker inspect "$APP_CONTAINER" --format '{{.Config.Image}}')"
test -n "$APP_IMAGE"
docker build -t "$APP_IMAGE" "$ROLLBACK_DIR"
docker compose -p astral-patch up -d --no-build --no-deps --force-recreate astral-patch-site
```

복구 후 기존 운영 상태 확인 절차를 수행하고, 원인을 수정한 다음 정식 develop/release PR로 재배포합니다. DB 자체 복구가 필요한 사고는 기존 백업 복구 절차와 별도 관리자 승인을 따릅니다.
