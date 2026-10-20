# 파티 채팅

파티 채팅은 인게임 방 ID를 공유하는 사용자를 위한 텍스트 채팅 기능이다. `/party`에서 숫자 6자리 방 ID와 닉네임을 입력하고 입장 버튼을 누르면 해당 방으로 이동해 채팅에 연결된다. 방이 없으면 새로 열리고, 있으면 기존 방을 사용한다. 방 목록과 비밀번호 방은 제공하지 않는다.

방의 참여자와 최근 메시지는 Nuxt 프로세스 메모리에 보관한다. 모든 채팅과 입·퇴장 알림은 PostgreSQL에도 저장하며, 각 방에는 재사용 가능한 6자리 ID와 별도로 고유한 세션 ID가 있다. 참여자 프로필과 재접속 토큰의 SHA-256 해시도 DB에 저장하므로, 재배포 등으로 프로세스가 재시작되어도 만료 전 세션의 기록과 참여자를 그대로 복원한다. 재시작 중 끊긴 클라이언트는 몇 초 안에 자동으로 다시 연결되어 같은 참여자 ID로 이어지며 입·퇴장 알림은 생기지 않는다. 참여자 연결 상태는 프로세스 간 공유하지 않으므로 앱은 단일 프로세스로 운영해야 한다.

## PiP 채팅 창

Document Picture-in-Picture 지원 브라우저에서는 방 상단의 PiP 버튼으로 채팅을 다른 창 위에 표시할 수 있다. 기존 Vue 화면을 이동하므로 웹소켓 연결, 닉네임, 작성 중인 메시지가 유지되며 창을 닫으면 원래 페이지로 돌아온다. 원래 탭을 닫거나 다른 페이지로 이동하면 PiP도 닫힌다.

API를 지원하지 않는 브라우저에서는 PiP 버튼을 숨긴다. PiP 요청이 거부되면 오류를 표시한다. PiP는 HTTPS 또는 localhost에서 사용하며, 게임의 독점 전체 화면 위에 표시되는지는 브라우저와 OS에 따라 직접 확인해야 한다.

## HTTP API

`POST /api/party/rooms`는 JSON `{ "roomId": "001234", "nickname": "닉네임", "reconnectToken": "optional-token" }`를 받는다. 닉네임과 토큰은 선택사항이다. 닉네임이 사용 중이면 유효한 토큰이 그 닉네임의 소유자임을 확인한 경우에만 요청을 허용하고, 그렇지 않으면 `409`를 반환한다. 이 사전 확인은 WebSocket `JOIN`에서 다시 검증한다. 방이 없으면 생성하고, 이미 있으면 기존 방 요약을 반환한다. 공유 링크로 `/party/:roomId`를 직접 열 때도 닉네임 없이 이 API를 사용한다. 응답 형태는 다음과 같다.

```json
{
  "roomId": "001234",
  "participantCount": 2,
  "createdAt": "2026-09-15T12:00:00.000Z"
}
```

`roomId`는 앞뒤 공백을 제거한 숫자 6자리 문자열이어야 한다. 숫자로 변환하지 않아 앞자리 0이 유지된다. 잘못된 ID·닉네임과 비밀번호 필드를 포함한 요청은 `400`, IP당 1분 12회를 넘는 요청은 `429`, 방 수가 200개에 도달한 상태에서 새 방을 열면 `503`을 반환한다. 기존 방 요청은 방 수 제한에 걸리지 않는다. 동시 입장 경합에 대비해 WebSocket `JOIN`에서도 닉네임 중복을 다시 검사한다.

방 목록을 반환하는 `GET /api/party/rooms`와 개별 조회 `GET /api/party/rooms/:roomId`는 제공하지 않는다. 공유 웹소켓의 `party:rooms` 구독도 제거했다.

## WebSocket

클라이언트는 `ws(s)://<host>/ws/party`에 연결한다. 브라우저 Origin은 기본 사이트(`https://astral.maynutlab.com`), `ASTRAL_WS_ALLOWED_ORIGINS`에 지정한 Origin, 개발 환경의 localhost만 허용한다.

닉네임은 방 ID 입력란 아래에서 받고, 방 화면은 전달된 닉네임으로 바로 입장한다. 같은 방에서 이미 사용 중인 닉네임은 대소문자와 유니코드 정규화 차이를 무시하고 거부하며 `NICKNAME_TAKEN` 오류를 반환한다. 다른 방에서는 같은 닉네임을 사용할 수 있다. 공유 링크로 방을 직접 방문하면 방 화면 위의 모달에서 닉네임을 입력받으며, 저장된 닉네임이 있다면 미리 채운다. 중복 닉네임 오류도 모달 입력칸에 표시한다. 웹의 기본 입장 캐릭터는 `spectator`(관전)이고 순서는 `null`이다. 방 헤더에서 캐릭터와 순서(`P1`~`P4`)를 변경한다. 관전 중에는 순서를 선택할 수 없고, 관전에서 캐릭터 또는 미선택 상태로 바꾸면 순서는 `P1`부터 시작한다. 플레이어 상태 사이에서 변경하면 기존 순서를 유지한다. 순서는 여러 참가자가 중복 선택할 수 있다. 캐릭터 ID는 문자열이며 `shared/types/party.ts`의 `PARTY_CHARACTER_IDS`에 `101`~`129`, `301`~`306` 총 35개를 명시한다. 서버는 입장과 변경 요청에서 이 목록과 `spectator`, `unselected`를 검증한다.

`unselected`는 게임에 참가했지만 캐릭터를 아직 선택하지 않은 플레이어를 뜻한다. `spectator`와 달리 `P1`~`P4` 순서를 갖고 `SET_ORDER`를 사용할 수 있다. `JOIN.order`를 생략하면 기존 플레이어 규약과 같이 `P1`로 시작하며, 명시적인 `null` 또는 잘못된 순서는 `INVALID_ORDER`로 거절한다. 미선택과 선택된 캐릭터 사이를 전환하면 순서를 유지하고, 관전으로 전환하면 순서를 `null`로 비운다. 웹은 수신한 미선택을 '미선택'과 기본 아이콘으로 표시하고 이미지 URL을 만들지 않는다. `unselected`는 웹의 캐릭터 선택 옵션에 추가하지 않으며 두 특수 상태는 게임 캐릭터 목록 API에 포함하지 않는다. DB의 `character_id`는 문자열이고 기존 제약은 관전 여부와 순서만 확인하므로 추가 마이그레이션은 필요하지 않다.

`GET /api/party/characters`는 `{ id, name, nickname, image }` 배열을 반환한다. DB의 `kind=str`, `namespace=STRCharacter`에서 `unit_key={id}0`은 이름, `{id}1`은 별명이다. 승인된 한국어 번역을 우선하고, 번역이 비어 있으면 영어·중국어 원문 순서로 사용한다. 조회 결과는 5분간 캐시되며 검토 중인 번역은 노출하지 않는다. 이미지는 `https://file.maynutlab.com/character/UT_Item_Hero_{id}.png`를 사용한다.

클라이언트 이벤트:

```json
{ "type": "JOIN", "roomId": "001234", "nickname": "닉네임", "characterId": "spectator", "order": null, "reconnectToken": "optional-token", "diagnostics": { "attempt": 1, "lastCloseCode": 1006, "lastCloseAgoMs": 1200, "hiddenAtClose": false, "onlineAtClose": true } }
{ "type": "JOIN", "roomId": "001234", "nickname": "미선택 플레이어", "characterId": "unselected", "order": "P3" }
{ "type": "SET_CHARACTER", "characterId": "unselected" }
{ "type": "SET_CHARACTER", "characterId": "306" }
{ "type": "SET_ORDER", "order": "P2" }
{ "type": "CHAT", "text": "안녕하세요", "clientMessageId": "local-id" }
{ "type": "HISTORY", "before": "현재 화면에서 가장 오래된 메시지의 UUID" }
{ "type": "PING" }
```

`JOIN`이 성공하면 다음 메시지를 받는다.

```json
{
  "type": "JOINED",
  "sessionId": "uuid",
  "participantId": "uuid",
  "reconnectToken": "uuid",
  "room": { "roomId": "001234", "participantCount": 1, "createdAt": "..." },
  "messages": [],
  "participants": []
}
```

`JOINED`의 재접속 토큰은 서버가 SHA-256 해시로만 DB와 메모리에 보관한다. 같은 방 세션에서 정규화된 닉네임과 유효한 토큰을 제시하면 살아 있는 참가자 또는 연결 종료 후 유예 중인 참가자를 같은 ID와 토큰으로 승계하고 이전 소켓을 정리한다. 연결 종료 시 실시간 참가자 목록에서 즉시 제거되고 IP 연결 할당량도 반환되지만, 닉네임·토큰은 종료 종류에 따라 다음 시간 동안 예약된다.

| 종료 | 판별 | 퇴장 알림 |
| --- | --- | --- |
| 명시적 퇴장(나가기, 다른 페이지로 이동) | close `1000` / `leave-room` | 즉시 |
| 창 닫기·새로고침 | close `4001` / `page-hide`(클라이언트 `pagehide`) 또는 브라우저의 `1001` | 15초 뒤. 그 안에 새로고침으로 돌아오면 없음 |
| 그 밖의 단절(네트워크 전환, 모바일 백그라운드 등) | 위에 해당하지 않는 모든 종료. 클라이언트가 응답 없는 소켓을 포기한 `4002`도 포함 | 서버가 종료를 알게 된 시점부터 60초 뒤. heartbeat 만료도 감지 시점부터 60초 |
| 서버 종료(재배포) | SIGTERM/SIGINT 수신 뒤의 모든 종료 | 없음. 재시작 후 복원된 참여자에게 다시 60초 유예 |

유예 중 재접속은 새 입장·퇴장 알림을 만들지 않는다. 유예 만료 시 토큰을 무효화하고 퇴장 알림을 한 번 기록·발행하며 DB의 `left_at`을 채운다. 재시작 후에는 방을 처음 조회할 때 `left_at`이 비어 있고 토큰 해시가 있는 참여자를 유예 상태로 복원한다. 브라우저의 재접속 토큰은 같은 탭의 `sessionStorage`에 보관된다.

입장에 성공하면 `{ "type": "JOIN_NOTICE", "notice": { "kind": "join", "id": "uuid", "nickname": "닉네임", "createdAt": "..." } }`가 같은 방 참가자에게 전달되고 최근 기록에 남는다. 명시적 퇴장이 아닌 연결 종료는 유예 만료 때 `{ "type": "LEAVE_NOTICE", "notice": { "kind": "leave", "id": "uuid", "nickname": "닉네임", "createdAt": "..." } }`를 기록·발행한다. 화면에는 각각 `닉네임님이 채팅방에 입장했습니다.`, `닉네임님이 채팅방에서 나갔습니다.`로 표시한다. `JOINED.messages`에는 이전 채팅과 입·퇴장 알림이 시간순으로 들어간다. 채팅은 `{ "type": "CHAT", "message": { "kind": "chat", "id": "uuid", "clientMessageId": "local-id", "participant": { "characterId": "spectator", "order": null }, "text": "...", "createdAt": "..." } }`로 전달된다. `clientMessageId`는 선택사항이며 생략하면 서버가 생성한다. 같은 참가자가 동일한 `clientMessageId`로 다시 보낸 메시지는 중복 저장하지 않고 기존 메시지를 반환한다. 이 보장은 DB의 부분 고유 인덱스로 서버 재시작 뒤에도 유지된다. 입장·퇴장·캐릭터·순서 변경 때 `PARTICIPANTS`가 전달되고, 변경 시 해당 참가자의 최근 채팅 캐릭터와 순서도 갱신된다. `PING`에는 `PONG`으로 응답한다.

클라이언트는 같은 탭의 `sessionStorage`를 사용해 재연결 및 새로고침 복구를 시도하고, 내부 복구 중에는 닉네임 입력 모달을 강제로 열지 않는다. 재연결 대기 간격은 1초부터 두 배씩 늘어 최대 5초다. heartbeat(PING 2회 무응답·55초 무수신), `JOINED` 기한(20초), 화면 복귀·`online` 직후의 생존 확인(PING 뒤 5초 무수신)에 걸린 소켓은 `4002`와 사유 `heartbeat-timeout`/`join-timeout`/`liveness-timeout`으로 닫되, 브라우저의 `onclose`를 기다리지 않고 바로 재연결한다. 응답 없는 상대에게 `close()`를 부르면 브라우저가 종료 확인을 기다리느라(Chromium 최대 60초) `onclose`가 늦게 오기 때문이다. `pagehide`에서는 `4001`/`page-hide`로 소켓을 닫고 자동 재연결을 멈추며, bfcache 복원(`pageshow`의 `persisted`) 때 토큰으로 다시 연결한다. 같은 세션으로 재연결되면 확인받지 못한 메시지를 같은 `clientMessageId`로 자동 재전송한다. 모든 `JOIN`에는 직전 소켓의 종료 코드·사유, 종료 뒤 경과 시간, 종료 당시 화면 숨김·온라인 여부, 연속 시도 횟수, 첫 입장의 탐색 종류를 `diagnostics`로 싣는다. `retryAfterMs`가 있으면 그 기한보다 이른 온라인/가시성 이벤트가 재시도를 앞당기지 않는다. 세션 변경 시 미확정 전송은 보존한다. 이 계약 설명만으로 별도의 브라우저 실기기 검증을 주장하지 않는다.

메시지 텍스트는 trim 후 비어 있지 않아야 하며 최대 1,000자다. JSON 문자열만 받으므로 HTML을 실행하지 않고 화면에서는 텍스트로 렌더링한다. 서버는 채팅과 입·퇴장 알림을 합쳐 최근 최대 300개, 직렬화된 메시지 크기 합계 최대 256KiB만 메모리에 보관한다. 클라이언트는 전송 직후 입력칸을 비우고 메시지를 임시 표시한다. 전송 중에는 텍스트 밝기가 변하고, DB 저장 후 같은 `clientMessageId`로 받은 메시지로 교체된다. 서버 확인이 15초 안에 오지 않거나 연결이 끊기면 소켓을 닫지 않고 미확정 상태로 표시하며, 다시 연결되면 자동으로 재전송한다. 서버가 거절한 메시지에만 오류와 다시 입력 버튼을 표시한다. 연결 시에는 `JOINED` 수신까지 20초 기한을 둔다. 화면에서 위로 스크롤하면 이미 입장한 웹소켓 연결에서 `HISTORY`를 요청해 50개씩 가져오며, 서버 응답은 `{ "type": "HISTORY", "before": "요청한 UUID", "messages": [], "hasMore": false }` 형태다. 캐릭터·순서 변경은 DB에도 반영되어 과거 메시지에 최신 설정이 표시된다.

오류는 `{ "type": "ERROR", "code": "...", "message": "...", "clientMessageId": "...", "retryAfterMs": 1234 }` 형태다. `clientMessageId`와 `retryAfterMs`는 선택사항이며 `retryAfterMs`는 밀리초다. JOIN 고정 윈도우 제한과 유예 중 닉네임 점유는 남은 대기 시간을 알릴 수 있다. 실제 연결된 참가자와의 닉네임 충돌에는 재시도 힌트가 없다.

## 제한과 배포

- 방 최대 200개, 동시 연결 최대 500개, IP당 연결 최대 20개
- IP당 입장 시도 1분 12회, 연결당 메시지 1분 60회
- 마지막 참여자가 나간 뒤 3분이 지나면 방 세션과 DB 채팅 이력이 삭제됨. 같은 ID로 다시 입장하면 별도 세션이 열림. 비정상 종료 후 남은 만료 세션도 주기적으로 삭제됨
- 연결 heartbeat가 60초 동안 수신되지 않으면 정리됨(20초 주기 검사). 정리된 참여자는 그때부터 60초 유예 상태가 된다. 클라이언트는 약 20초마다 `PING`을 보내며, 서버는 연결된 참가자에게 약 20초마다 WebSocket ping 프레임을 보내 브라우저의 자동 pong 응답도 확인함
- 전송 버퍼가 1MiB를 넘는 느린 연결은 종료됨

Nginx는 `/ws/party`를 HTTP/1.1 Upgrade로 프록시해야 한다. 배포 템플릿에는 이 location이 포함되어 있다. 프록시 뒤에서 실제 IP별 제한을 사용하려면 Nginx가 덮어쓰는 `X-Real-IP`를 신뢰하도록 앱 환경에 `ASTRAL_TRUST_PROXY=true`를 설정한다. 저장소의 Docker Compose 배포 설정은 이 값을 `true`로 전달하며, 프록시 없이 직접 실행할 때의 기본값은 `false`다. 기본값에서는 직접 연결의 `peer.remoteAddress`만 사용하며, 클라이언트가 보낸 `X-Forwarded-For`는 사용하지 않는다.

로컬 서버를 실행한 뒤 `pnpm test:party`로 HTTP와 WebSocket 통합 테스트를 실행할 수 있다. 테스트 대상 URL을 바꾸려면 `pnpm test:party http://localhost:3000`처럼 지정한다. 방 생명주기와 TTL 정리는 서버 없이 `pnpm test:party:rooms`로 검증한다.
DB 저장과 과거 기록 조회는 마이그레이션을 적용한 로컬 서버에서 `pnpm test:party:storage http://localhost:3000`으로 검증한다.

배포 전에 `database/migrations/0016_party_chat_reconnect.sql`까지 마이그레이션을 적용해야 한다. 0016 이전에 저장된 참여자는 토큰 해시가 없어 재시작 후 복원 대상에서 제외되므로, 0016을 처음 배포할 때만 접속 중인 사용자가 새 참여자로 한 번 다시 입장한다. 실제 저장 용량은 `SELECT pg_size_pretty(pg_total_relation_size('party_chat_messages'));`로 확인할 수 있다.

WebSocket 어댑터 통합 테스트는 서버 없이 `pnpm test:party:adapter`로 실행한다. 로컬에서 `.output`을 직접 실행할 때는 빌드 시점의 `.env` 값이 `runtimeConfig.databaseUrl`에 고정되므로, 다른 DB를 쓰려면 `NUXT_DATABASE_URL`로 덮어써야 한다.

## 연결 로그

끊김 원인 분석을 위해 `party_chat_connection_events`에 연결 이벤트를 저장한다. 방이 삭제되어도 남고, 30일이 지나면 정리 작업이 삭제한다. IP 주소는 저장하지 않는다. 기록은 채팅·입장 처리와 분리된 비동기 쓰기이며 실패해도 채팅에 영향을 주지 않는다.

| `event` | 시점 | 주요 값 |
| --- | --- | --- |
| `connect` | 소켓 연결 | `connection_id`, `detail.userAgent` |
| `join` | 입장·재입장 성공 | `detail.resumed`(유예·인계 승계), `detail.restored`(재시작 후 복원 승계), `detail.disconnectedMs`, `detail.diagnostics` |
| `join_rejected` | 입장 거절 | `detail.code` |
| `disconnect` | 소켓 종료 | `close_code`, `close_reason`, `departure`(`leave`, `page-hide`, `loss`, `replaced`, `shutdown`, `not-joined`), `connected_ms`, `detail.serverReason`(서버가 끊은 이유) |
| `leave_notice` | 퇴장 알림 발행 | `departure`(`leave`, `page-hide`, `loss`, `restored`) |
| `room_restored` | 재시작 후 방을 DB에서 다시 읽음 | `detail.participants` |
| `server_shutdown` | 서버 종료 | |

예시 쿼리:

```sql
-- 최근 24시간 종료 원인 분포
SELECT departure, close_code, detail->>'serverReason' AS server_reason, count(*)
FROM party_chat_connection_events
WHERE event = 'disconnect' AND created_at > now() - interval '24 hours'
GROUP BY 1, 2, 3 ORDER BY count(*) DESC;

-- 특정 방의 연결 이력
SELECT created_at, event, nickname, departure, close_code, close_reason, connected_ms, detail
FROM party_chat_connection_events
WHERE room_id = '001234' AND created_at > now() - interval '2 hours'
ORDER BY id;

-- 재연결 때 클라이언트가 보고한 직전 종료 정보(화면 숨김·오프라인 여부 포함)
SELECT created_at, room_id, nickname, detail->'diagnostics' AS diagnostics
FROM party_chat_connection_events
WHERE event = 'join' AND (detail->>'resumed')::boolean
ORDER BY id DESC LIMIT 100;

-- 유예 안에 돌아오지 못해 퇴장 처리된 사례
SELECT departure, count(*) FROM party_chat_connection_events
WHERE event = 'leave_notice' AND created_at > now() - interval '7 days'
GROUP BY 1;
```
