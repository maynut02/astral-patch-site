# 보안 정책

## 취약점 제보

보안 취약점은 공개 이슈에 비밀값이나 재현용 자격 증명을 올리지 말고 저장소 소유자에게 비공개 채널로 전달해 주세요.

제보에는 다음 정보만 포함하면 됩니다.

- 영향 범위
- 재현 절차
- 필요한 최소 환경
- 예상되는 안전한 동작

## 비밀정보 관리

다음 값은 Git에 커밋하지 않습니다.

- `.env` 실제 값
- OAuth client secret
- DB 비밀번호와 connection string
- SSH private key
- R2 access key/secret
- 세션 비밀번호

예시 값과 변수명은 `.env.example`에만 유지합니다.

## 배포 원칙

- PostgreSQL은 외부에 직접 공개하지 않습니다.
- GitHub Actions SSH 연결은 host fingerprint를 검증합니다.
- migration 전 DB 백업을 수행합니다.
- production 배포는 CI 성공 commit만 사용합니다.
