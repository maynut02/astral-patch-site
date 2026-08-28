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

`.env.example`은 로컬/GitHub/서버 설정을 한 파일에 구분해 둔 참조 문서이므로 서버에서는 전체를 그대로 복사하지 않습니다. 서버용 값은 `.env.example`의 `3. 서버 운영 환경` 구역을 기준으로 `.env`를 작성합니다.

```bash
cd /home/ubuntu/astral-patch-site
install -m 600 /dev/null .env
nano .env
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

`astral_schema_migrations` 테이블이 생성되고 이미 적용된 migration은 이후 자동으로 건너뜁니다.

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

기존 Neon DB는 `astral_schema_migrations`를 사용하지 않았으므로, **복원한 dump가 현재 저장소의 모든 migration을 이미 포함한다는 것을 확인한 뒤에만** migration history를 adopt합니다.

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

기본값은 매일 03:45에 실행하며 최대 30분 randomized delay가 있습니다. 로컬 보존 기간은 14일입니다. 자동 배포도 migration 직전에 같은 backup service를 실행하므로 배포 전 스냅샷이 하나 더 생성됩니다.

백업 산출물:

```text
/var/backups/astral-patch/astral-<UTC timestamp>.dump
/var/backups/astral-patch/astral-<UTC timestamp>.globals.sql
/var/backups/astral-patch/astral-<UTC timestamp>.sha256
```

Cloudflare R2 원격 백업을 사용할 경우 서버 `.env`에 별도의 private bucket과 bucket-scoped Object Read & Write token을 설정합니다.

```dotenv
R2_BACKUP_ACCOUNT_ID=<Cloudflare account id>
R2_BACKUP_ACCESS_KEY_ID=<bucket-scoped access key>
R2_BACKUP_SECRET_ACCESS_KEY=<bucket-scoped secret key>
R2_BACKUP_BUCKET_NAME=astral-patch-db-backups
R2_BACKUP_PREFIX=postgres
R2_BACKUP_ENDPOINT=
```

R2 업로드는 `/etc/default/astral-patch`의 다음 값으로 켭니다.

```text
ASTRAL_R2_BACKUP_ENABLED=true
```

초기 bootstrap부터 활성화하려면 다음 변수를 함께 전달합니다.

```bash
sudo env \
  ASTRAL_DOMAIN=astral.example.com \
  ASTRAL_CERTBOT_EMAIL=admin@example.com \
  ASTRAL_APP_PORT=3001 \
  ASTRAL_APP_DIR=/home/ubuntu/astral-patch-site \
  ASTRAL_PATCH_REPO_DIR=/home/ubuntu/astral-party-korean-patch \
  ASTRAL_R2_BACKUP_ENABLED=true \
  bash deploy/bootstrap-server.sh
```

이미 bootstrap을 끝낸 서버는 `/etc/default/astral-patch`에서 값을 변경한 뒤 backup image를 한 번 빌드하면 됩니다.

```bash
sudo sed -i 's/^ASTRAL_R2_BACKUP_ENABLED=.*/ASTRAL_R2_BACKUP_ENABLED=true/' /etc/default/astral-patch
docker compose -p astral-patch --profile backup build r2-backup
```

백업 상태와 수동 실행:

```bash
systemctl list-timers astral-patch-db-backup.timer
sudo systemctl start astral-patch-db-backup.service
sudo journalctl -u astral-patch-db-backup.service -n 100 --no-pager
sudo ls -lh /var/backups/astral-patch/
```

R2가 활성화되어 있으면 journal에 `[r2-backup] uploaded ...`가 함께 출력됩니다.

## 7. 로컬 `pnpm dev`와 서버 DB

로컬 개발은 별도 PostgreSQL을 띄우지 않고 SSH local forwarding으로 운영 DB에 연결합니다. `pnpm dev`가 터널을 열고 Nuxt를 시작하며, Nuxt 종료 시 SSH child process도 함께 종료합니다.

기본 연결:

```text
로컬 127.0.0.1:55433
        ↓ SSH
VM 127.0.0.1:5433
        ↓
Astral PostgreSQL container :5432
```

Resonance 개발 터널의 로컬 포트와 충돌하지 않도록 Astral은 `55433`을 사용합니다.

로컬 `.env` 예시:

```dotenv
DATABASE_URL=postgresql://astral_patch:<URL-encoded password>@127.0.0.1:55433/astral_patch

ASTRAL_SSH_HOST=<VM public IP or SSH hostname>
ASTRAL_SSH_USER=ubuntu
ASTRAL_SSH_KEY_PATH=C:\Users\<you>\.ssh\<private-key>
ASTRAL_SSH_PORT=22
ASTRAL_DEV_DB_LOCAL_PORT=55433
ASTRAL_DEV_DB_REMOTE_HOST=127.0.0.1
ASTRAL_DEV_DB_REMOTE_PORT=5433
```

`ASTRAL_SSH_KEY_PATH`를 비워 두면 시스템 기본 SSH key/agent를 사용합니다.

실행:

```bash
pnpm dev
```

터널 없이 Nuxt만 직접 실행해야 하는 특수한 경우에는 다음을 사용합니다.

```bash
pnpm dev:nuxt
```

`pnpm dev`는 안전을 위해 `DATABASE_URL`의 host가 localhost/127.0.0.1이고 port가 `ASTRAL_DEV_DB_LOCAL_PORT`와 같은지 검증합니다. 따라서 실수로 공개 DB host에 직접 연결하는 구성을 허용하지 않습니다.

## 8. GitHub Actions의 Patch DB 접근

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

known_hosts 값은 신뢰할 수 있는 환경에서 서버의 SSH host key를 확인해 등록합니다. `DB_SSH_HOST`에 IP를 사용하면 known_hosts entry도 같은 IP를 사용해야 합니다.

DB host port 5433을 UFW에 추가로 열 필요는 없습니다.

## 9. 사이트 자동 배포

`.github/workflows/deploy.yml`은 `master`의 `ci` workflow가 성공한 뒤 자동 실행되며, 필요할 때는 수동 `workflow_dispatch`도 사용할 수 있습니다. CI를 통과한 commit SHA를 서버에 정확히 checkout하고 같은 production concurrency group으로 직렬화하므로, 검증되지 않은 commit이나 두 개의 동시 migration/build가 배포되지 않습니다.

사이트 저장소 Actions Secrets:

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

`SERVER_SSH_FINGERPRINT`는 서버에서 SSH host key를 직접 확인해 등록합니다.

```bash
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256 | awk '{print $2}'
```

출력되는 `SHA256:...` 값을 GitHub Actions secret으로 저장합니다.

배포 순서:

```text
site master 최신화
→ patch main 최신화
→ PostgreSQL healthy 보장
→ backup service/timer 파일 최신화
→ R2 uploader image build
→ 배포 전 DB backup
→ migration 실행
→ Nuxt image build/restart
→ 127.0.0.1:3001 health check
```

`SERVER_USER`는 passwordless `sudo`로 systemd unit 설치와 backup service 실행이 가능해야 합니다. 일반 Ubuntu cloud VM의 기본 `ubuntu` 계정 구성을 전제로 합니다.

## 10. 운영 확인

```bash
docker compose -p astral-patch ps
docker compose -p cbcrr-db ps
ss -lntp | grep -E ':(3000|3001|5432|5433)\b'
curl -I http://127.0.0.1:3001/
nginx -t
systemctl list-timers | grep -E 'cbcrr|astral'
sudo journalctl -u astral-patch-db-backup.service -n 100 --no-pager
```

정상 상태에서는 3000/3001/5432/5433 모두 `127.0.0.1`에만 listen하고 외부에는 Nginx의 80/443만 노출됩니다.
