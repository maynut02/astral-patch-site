# 보안 정책

## 지원 범위

운영 중인 <https://astral.maynutlab.com>과 이 저장소의 `release` 브랜치가 대상입니다.

## 취약점 제보

공개 이슈에 취약점을 올리지 마세요. 저장소 소유자([@maynut02](https://github.com/maynut02))에게 비공개 채널로 알려 주세요.

다음 내용을 포함해 주시면 빠르게 확인할 수 있습니다.

- 영향 범위와 심각도
- 재현 절차와 필요한 최소 환경
- 기대하는 안전한 동작

실제 비밀값이나 다른 사용자의 개인정보는 첨부하지 마세요.

## 비밀정보

다음 값은 Git에 커밋하지 않습니다. 변수 이름과 예시는 `.env.example`에만 둡니다.

- `.env` 실제 값, `NUXT_SESSION_PASSWORD`
- Google OAuth client secret
- DB 비밀번호와 connection string
- SSH private key
- Cloudflare R2 access key/secret, AI API key, GitHub token

## 운영 원칙

- Nuxt와 PostgreSQL은 loopback에만 바인딩하고 외부에는 Nginx 80/443만 공개합니다.
- GitHub Actions의 SSH 접속은 host fingerprint를 검증합니다.
- production 배포는 `ci`를 통과해 `release`에 merge된 commit만 사용하며, migration 직전에 DB를 백업합니다.
- 변경 요청은 same-origin, JSON content type, body 크기, 사용자별 요청 제한, DB 계정 재확인을 거칩니다. 자세한 내용은 [docs/architecture.md](docs/architecture.md#요청-보안)를 참고하세요.
- CI는 production 의존성의 High·Critical 취약점을 차단합니다. 예외와 대응 기록은 [docs/dependency-security.md](docs/dependency-security.md)에 남깁니다.
