# 서버 배포

Ubuntu VM에서 Docker Compose + Nginx로 운영하는 기준입니다. Nuxt와 PostgreSQL은 loopback에만 바인딩하고 외부에는 Nginx 80/443만 공개합니다.

## 구성

```text
Nginx
  ↓ 127.0.0.1:3001
astral-patch-site
  ↓ postgres-db:5432
PostgreSQL

systemd timer
  ↓
pg_dump → /var/backups/astral-patch → optional Cloudflare R2
```

기본 host port:

- Nuxt: `127.0.0.1:3001`
- PostgreSQL: `127.0.0.1:5433`

권장 디렉터리:

```text
/home/ubuntu/astral-patch-site
/home/ubuntu/astral-party-korean-patch
```

DB migration 원본은 `astral-party-korean-patch/database/migrations`입니다.

## 서버 환경변수

사이트 저장소에 권한 600의 `.env`를 만듭니다.

```bash
cd /home/ubuntu/astral-patch-site
install -m 600 /dev/null .env
nano .env
```

최소 구성:

```dotenv
NUXT_SESSION_PASSWORD=<32자 이상의 임의 값>
NUXT_OAUTH_GOOGLE_CLIENT_ID=<google client id>
NUXT_OAUTH_GOOGLE_CLIENT_SECRET=<google client secret>

POSTGRES_DB=astral_patch
POSTGRES_USER=astral_patch
POSTGRES_PASSWORD=<strong password>
DATABASE_URL=postgresql://astral_patch:<URL-encoded password>@postgres-db:5432/astral_patch

ASTRAL_APP_PORT=3001
ASTRAL_DB_HOST_PORT=5433
ASTRAL_PATCH_REPO_DIR=/home/ubuntu/astral-party-korean-patch

AI_API_KEY=
AI_BASE_URL=https://factchat-cloud.mindlogic.ai/v1/gateway
GITHUB_TOKEN=<optional GitHub token>
```

전체 변수 목록은 `.env.example`의 `3. 서버 운영 환경` 구역을 사용합니다.

## 최초 배포

PostgreSQL 시작:

```bash
docker compose -p astral-patch up -d postgres-db
docker compose -p astral-patch ps
```

새 DB에 migration 적용:

```bash
docker compose -p astral-patch --profile migration run --rm db-migrate
```

앱 실행:

```bash
docker compose -p astral-patch up -d --build astral-patch-site
curl -I http://127.0.0.1:3001/
```

Nginx, HTTPS, backup timer 초기화:

```bash
sudo env \
  ASTRAL_DOMAIN=astral.example.com \
  ASTRAL_CERTBOT_EMAIL=admin@example.com \
  ASTRAL_APP_PORT=3001 \
  ASTRAL_APP_DIR=/home/ubuntu/astral-patch-site \
  ASTRAL_PATCH_REPO_DIR=/home/ubuntu/astral-party-korean-patch \
  bash deploy/bootstrap-server.sh
```

Google OAuth redirect URI에도 도메인을 등록합니다.

```text
https://astral.example.com/auth/google
```

## 기존 DB 이전

기존 DB를 옮길 때는 사이트와 patch workflow의 쓰기를 중지하고 현재 migration이 모두 적용된 상태인지 먼저 확인합니다.

Dump:

```bash
pg_dump "$NEON_DATABASE_URL_DIRECT" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=astral-neon.dump
```

복원:

```bash
cat astral-neon.dump | docker compose -p astral-patch exec -T postgres-db sh -c '\
  pg_restore \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists'
```

복원 DB가 현재 migration 전체를 이미 포함하는 경우에만 migration history를 adopt합니다.

```bash
ASTRAL_MIGRATION_ADOPT_CONFIRM=YES \
  docker compose -p astral-patch --profile migration run --rm \
  -e ASTRAL_MIGRATION_ADOPT_CONFIRM=YES \
  db-migrate adopt

docker compose -p astral-patch --profile migration run --rm db-migrate
```

마지막 명령에서 기존 migration이 모두 skip되는지 확인합니다.

## 자동 백업

기본 timer는 매일 03:45에 실행하며 로컬 백업은 14일 보존합니다. production 배포도 migration 직전에 같은 서비스를 실행합니다.

산출물:

```text
/var/backups/astral-patch/astral-<UTC timestamp>.dump
/var/backups/astral-patch/astral-<UTC timestamp>.globals.sql
/var/backups/astral-patch/astral-<UTC timestamp>.sha256
```

R2를 사용할 경우 서버 `.env`에 bucket 전용 자격 증명을 추가합니다.

```dotenv
R2_BACKUP_ACCOUNT_ID=
R2_BACKUP_ACCESS_KEY_ID=
R2_BACKUP_SECRET_ACCESS_KEY=
R2_BACKUP_BUCKET_NAME=astral-patch-db-backups
R2_BACKUP_PREFIX=postgres
R2_BACKUP_ENDPOINT=
```

`/etc/default/astral-patch`에서 업로드를 활성화합니다.

```text
ASTRAL_R2_BACKUP_ENABLED=true
```

그 다음 이미지를 한 번 갱신합니다.

```bash
docker compose -p astral-patch --profile backup build r2-backup
```

상태 확인:

```bash
systemctl list-timers astral-patch-db-backup.timer
sudo systemctl start astral-patch-db-backup.service
sudo journalctl -u astral-patch-db-backup.service -n 100 --no-pager
sudo ls -lh /var/backups/astral-patch/
```

## 로컬 개발 DB 터널

`pnpm dev`는 SSH local forwarding을 열고 Nuxt를 시작합니다.

```text
127.0.0.1:55433
  ↓ SSH
VM 127.0.0.1:5433
  ↓
PostgreSQL :5432
```

로컬 `.env` 예시:

```dotenv
DATABASE_URL=postgresql://astral_patch:<URL-encoded password>@127.0.0.1:55433/astral_patch
ASTRAL_SSH_HOST=<VM host>
ASTRAL_SSH_USER=ubuntu
ASTRAL_SSH_KEY_PATH=C:\Users\<you>\.ssh\<private-key>
ASTRAL_SSH_PORT=22
ASTRAL_DEV_DB_LOCAL_PORT=55433
ASTRAL_DEV_DB_REMOTE_HOST=127.0.0.1
ASTRAL_DEV_DB_REMOTE_PORT=5433
```

`ASTRAL_SSH_KEY_PATH`가 비어 있으면 기본 SSH key/agent를 사용합니다. `pnpm dev`는 `DATABASE_URL`이 지정된 localhost port를 사용하는지 검증합니다.

## GitHub Actions

사이트 저장소 Secrets:

```text
SERVER_HOST
SERVER_USER
SERVER_SSH_KEY
SERVER_SSH_FINGERPRINT
SERVER_SSH_PORT
SERVER_WORK_DIR
PATCH_SERVER_WORK_DIR
```

권장 경로:

```text
SERVER_USER=ubuntu
SERVER_SSH_PORT=22
SERVER_WORK_DIR=/home/ubuntu/astral-patch-site
PATCH_SERVER_WORK_DIR=/home/ubuntu/astral-party-korean-patch
```

SSH fingerprint 확인:

```bash
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256 | awk '{print $2}'
```

production 자동 배포는 같은 저장소의 `develop → release` PR이 merge된 경우에만 실행됩니다. `release` 또는 `master`에 직접 push해도 자동 배포하지 않습니다.

```text
develop → release PR
→ CI 통과
→ PR merge
→ release merge commit 검증/checkout
→ patch main 갱신
→ PostgreSQL 확인
→ backup service/timer 갱신
→ 배포 전 DB backup
→ migration
→ Nuxt build/restart
→ health check
```

GitHub Actions에서 `Deploy production`을 수동 실행하면 PR 이벤트와 무관하게 `origin/release`의 최신 commit을 다시 배포합니다.

Patch 저장소에서 이 DB에 접근할 때도 5433을 외부에 열지 않고 SSH tunnel을 사용합니다. 필요한 Secrets는 `ASTRAL_DATABASE_URL`, `DB_SSH_HOST`, `DB_SSH_USER`, `DB_SSH_PRIVATE_KEY`, `DB_SSH_KNOWN_HOSTS`입니다.

## 운영 확인

```bash
docker compose -p astral-patch ps
ss -lntp | grep -E ':(3001|5433)\b'
curl -I http://127.0.0.1:3001/
nginx -t
systemctl list-timers | grep astral
sudo journalctl -u astral-patch-db-backup.service -n 100 --no-pager
```
