#!/usr/bin/env sh
# Nginx 템플릿의 __ASTRAL_DOMAIN__/__ASTRAL_APP_PORT__를 치환해 표준 출력으로 내보낸다.
# 사용: render-nginx-config.sh <template> <domain> <port>
# bootstrap-server.sh와 배포 workflow가 같은 규칙으로 설정을 만들도록 공유한다.
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <template> <domain> <port>" >&2
  exit 2
fi

template_path="$1"
domain="$2"
port="$3"

case "$domain" in
  ''|*[!A-Za-z0-9.-]*)
    echo "Invalid domain: $domain" >&2
    exit 1
    ;;
esac

case "$port" in
  ''|*[!0-9]*)
    echo "Invalid ASTRAL_APP_PORT: $port" >&2
    exit 1
    ;;
esac

if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  echo "ASTRAL_APP_PORT must be between 1 and 65535: $port" >&2
  exit 1
fi

sed \
  -e "s|__ASTRAL_DOMAIN__|$domain|g" \
  -e "s|__ASTRAL_APP_PORT__|$port|g" \
  "$template_path"
