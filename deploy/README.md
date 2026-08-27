# Astral Patch 서버 배포

`resonance-site`와 같은 Ubuntu VM에서 별도 Docker Compose project로 운영하는 구성을 기준으로 합니다.

## 포트

- Astral Nuxt: `127.0.0.1:3001`
- Astral PostgreSQL: `127.0.0.1:5433`
- PostgreSQL container 내부: `5432`

두 포트 모두 외부에 공개하지 않습니다. 웹은 Nginx가 3001로 reverse proxy하고, GitHub Actions는 SSH local forwarding으로 5433에 접근합니다.

## 서버 디렉터리

두 저장소를 형제 디렉터리로 두는 것을 권장합니다.

```text
/home/ubuntu/astral-patch-site
/home/ubuntu/astral-party-korean-patch
```

DB migration 원본은 항상 `astral-party-korean-patch/database/migrations`입니다.

## 1. 서버 환경변수

```bash
cd /home/ubuntu/astral-patch-site
cp .env.example .env
chmod 600 .env
```

프로덕션 `.env` 예시:

```dotenv
NUXT_SESSION_PASSWORD=<long random value>
NUXT_OAUTH_GOOGLE_CLIENT_ID=<google client id>
NUXT_OAUTH_GOOGLE_CLIENT_SECRET=<google client secret>

POSTGRES_DB=astral_patch
POSTGRES_USER=astral_patch
POSTGRES_PASSWORD=<URL-safe strong password>
ASTRAL_APP_PORT=3001
ASTRAL_DB_HOST_PORT=5433
ASTRAL_PATCH_REPO_DIR=/home/ubuntu/astral-party-korean-patch
DATABASE_URL=postgresql://astral_patch:<same password>@postgres-db:5432/astral_patch

AI_API_KEY=
AI_BASE_URL=https://factchat-cloud.mindlogic.ai/v1/gateway
```

## 2. PostgreSQL 시작

```bash
docker compose -p astral-patch up -d postgres-db
docker compose -p astral-patch ps
```

DB host port는 `127.0.0.1:5433`에만 bind됩니다.

## 3A. 완전히 새 DB인 경우

모든 canonical migration을 순서대로 적용합니다.

```bash
docker compose -p astral-patch --profile migration run --rm db-migrate
```

`schema_migrations` 테이블이 생성되고 이미 적용된 migration은 이후 자동으로 건너뜁니다.

## 3B. Neon 기존 DB를 이전하는 경우

최종 전환 전에 사이트와 patch workflow의 DB 쓰기를 중지합니다. Neon에 현재 migration이 모두 적용되어 있는지 먼저 확인합니다.

Neon에서 custom dump를 생성합니다.

```bash
pg_dump "$NEON_DATABASE_URL_DIRECT" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=astral-neon.dump
```

파일을 VM으로 복사한 뒤 새 PostgreSQL에 복원합니다.

```bash
cd /home/ubuntu/astral-patch-site
cat astral-neon.dump | docker compose -p astral-patch exec -T postgres-db sh -c '\
  pg_restore \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists'
```

기존 Neon DB는 `schema_migrations`를 사용하지 않았으므로, **복원한 dump가 현재 저장소의 모든 migration을 이미 포함한다는 것을 확인한 뒤에만** migration history를 adopt합니다.

```bash
ASTRAL_MIGRATION_ADOPT_CONFIRM=YES \
  docker compose -p astral-patch --profile migration run --rm \
  -e ASTRAL_MIGRATION_ADOPT_CONFIRM=YES \
  db-migrate adopt
```

그 다음 일반 migration command가 모두 skip되는지 확인합니다.

```bash
docker compose -p astral-patch --profile migration run --rm db-migrate
```

## 4. 앱 실행

```bash
docker compose -p astral-patch up -d --build astral-patch-site
curl -I http://127.0.0.1:3001/
```

## 5. Nginx / HTTPS 초기화

Cloudflare DNS에서 Astral 도메인을 현재 VM으로 연결한 뒤 실행합니다.

```bash
cd /home/ubuntu/astral-patch-site
sudo env \
  ASTRAL_DOMAIN=astral.example.com \
  ASTRAL_CERTBOT_EMAIL=admin@example.com \
  ASTRAL_APP_PORT=3001 \
  ASTRAL_APP_DIR=/home/ubuntu/astral-patch-site \
  ASTRAL_PATCH_REPO_DIR=/home/ubuntu/astral-party-korean-patch \
  bash deploy/bootstrap-server.sh
```

기존 `resonance-site`의 UFW와 Cloudflare real-IP 설정은 그대로 유지합니다. 이 bootstrap은 새로운 Nginx server block, Let's Encrypt 인증서, Astral DB backup timer만 추가합니다.

Google Cloud Console의 OAuth redirect URI에도 새 도메인을 추가해야 합니다.

```text
https://astral.example.com/auth/google
```

## 6. 자동 백업

기본값은 매일 03:45에 실행하며 최대 30분 randomized delay가 있습니다. 로컬 보존 기간은 14일입니다.

```bash
systemctl list-timers astral-patch-db-backup.timer
sudo systemctl start astral-patch-db-backup.service
sudo journalctl -u astral-patch-db-backup.service -n 100 --no-pager
```

기본 백업 경로:

```text
/var/backups/astral-patch
```

## 7. GitHub Actions의 DB 접근

PostgreSQL 5433은 인터넷에 공개하지 않습니다. `astral-party-korean-patch` workflow가 SSH tunnel을 생성하고 GitHub runner의 `127.0.0.1:55432`를 VM의 `127.0.0.1:5433`으로 연결합니다.

패치 저장소에 필요한 Secrets:

```text
ASTRAL_DATABASE_URL
DB_SSH_HOST
DB_SSH_USER
DB_SSH_PRIVATE_KEY
DB_SSH_KNOWN_HOSTS
```

`ASTRAL_DATABASE_URL` 예시:

```text
postgresql://astral_patch:<URL-encoded password>@127.0.0.1:55432/astral_patch
```

known_hosts 값은 신뢰할 수 있는 환경에서 서버의 SSH host key를 확인해 등록합니다.

```bash
ssh-keyscan -H <server-host>
```

DB host port 5433을 UFW에 추가로 열 필요는 없습니다.

## 8. 운영 확인

```bash
docker compose -p astral-patch ps
docker compose -p cbcrr-db ps
ss -lntp | grep -E ':(3000|3001|5432|5433)\b'
curl -I http://127.0.0.1:3001/
nginx -t
systemctl list-timers | grep -E 'cbcrr|astral'
```

정상 상태에서는 3000/3001/5432/5433 모두 `127.0.0.1`에만 listen하고 외부에는 Nginx의 80/443만 노출됩니다.
