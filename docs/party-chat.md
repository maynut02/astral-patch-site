# 파티 채팅

파티 채팅은 인게임 방 ID를 공유하는 사용자를 위한 텍스트 채팅 기능이다. `/party`에서 숫자 6자리 방 ID와 닉네임을 입력하고 입장 버튼을 누르면 해당 방으로 이동해 채팅에 연결된다. 방이 없으면 새로 열리고, 있으면 기존 방을 사용한다. 방 목록과 비밀번호 방은 제공하지 않는다.

방의 참여자와 최근 메시지는 Nuxt 프로세스 메모리에 보관한다. 모든 채팅과 입·퇴장 알림은 PostgreSQL에도 저장하며, 각 방에는 재사용 가능한 6자리 ID와 별도로 고유한 세션 ID가 있다. 프로세스가 재시작되어도 만료 전 세션의 최근 기록을 다시 읽을 수 있다. 참여자 연결 상태는 프로세스 간 공유하지 않으므로 앱은 단일 프로세스로 운영해야 한다.

## PiP 채팅 창

Document Picture-in-Picture 지원 브라우저에서는 방 상단의 PiP 버튼으로 채팅을 다른 창 위에 표시할 수 있다. 기존 Vue 화면을 이동하므로 웹소켓 연결, 닉네임, 작성 중인 메시지가 유지되며 창을 닫으면 원래 페이지로 돌아온다. 원래 탭을 닫거나 다른 페이지로 이동하면 PiP도 닫힌다.

API를 지원하지 않는 브라우저에서는 PiP 버튼을 숨긴다. PiP 요청이 거부되면 오류를 표시한다. PiP는 HTTPS 또는 localhost에서 사용하며, 게임의 독점 전체 화면 위에 표시되는지는 브라우저와 OS에 따라 직접 확인해야 한다.

## HTTP API

`POST /api/party/rooms`는 JSON `{ "roomId": "001234", "nickname": "닉네임" }`를 받는다. 닉네임은 선택사항이며, 입력 화면에서 제출할 때는 함께 보내 같은 방에서 사용 중인지 확인한다. 중복이면 `409`를 반환하고 입력칸 아래에 오류를 표시한다. 방이 없으면 생성하고, 이미 있으면 기존 방 요약을 반환한다. 공유 링크로 `/party/:roomId`를 직접 열 때도 닉네임 없이 이 API를 사용한다. 응답 형태는 다음과 같다.

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

닉네임은 방 ID 입력란 아래에서 받고, 방 화면은 전달된 닉네임으로 바로 입장한다. 같은 방에서 이미 사용 중인 닉네임은 대소문자와 유니코드 정규화 차이를 무시하고 거부하며 `NICKNAME_TAKEN` 오류를 반환한다. 다른 방에서는 같은 닉네임을 사용할 수 있다. 공유 링크로 방을 직접 방문하면 방 화면 위의 모달에서 닉네임을 입력받으며, 저장된 닉네임이 있다면 미리 채운다. 중복 닉네임 오류도 모달 입력칸에 표시한다. 기본 입장 캐릭터는 항상 `spectator`(관전)이고 순서는 `null`이다. 방 헤더에서 캐릭터와 순서(`P1`~`P4`)를 변경한다. 관전 중에는 순서를 선택할 수 없고, 관전에서 캐릭터로 바꾸면 순서는 `P1`부터 시작한다. 캐릭터 사이에서 변경하면 기존 순서를 유지한다. 순서는 여러 참가자가 중복 선택할 수 있다. 캐릭터 ID는 문자열이며 `shared/types/party.ts`의 `PARTY_CHARACTER_IDS`에 `101`~`129`, `301`~`306` 총 35개를 명시한다. 서버는 입장과 변경 요청에서 이 목록과 `spectator`를 검증한다.

`GET /api/party/characters`는 `{ id, name, nickname, image }` 배열을 반환한다. DB의 `kind=str`, `namespace=STRCharacter`에서 `unit_key={id}0`은 이름, `{id}1`은 별명이다. 승인된 한국어 번역을 우선하고, 번역이 비어 있으면 영어·중국어 원문 순서로 사용한다. 조회 결과는 5분간 캐시되며 검토 중인 번역은 노출하지 않는다. 이미지는 `https://file.maynutlab.com/character/UT_Item_Hero_{id}.png`를 사용한다.

클라이언트 이벤트:

```json
{ "type": "JOIN", "roomId": "001234", "nickname": "닉네임", "characterId": "spectator", "order": null }
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
  "room": { "roomId": "001234", "participantCount": 1, "createdAt": "..." },
  "messages": [],
  "participants": []
}
```

입장에 성공하면 `{ "type": "JOIN_NOTICE", "notice": { "kind": "join", "id": "uuid", "nickname": "닉네임", "createdAt": "..." } }`가 같은 방의 모든 참가자에게 전달되고 최근 기록에 남는다. 연결이 종료되면 `{ "type": "LEAVE_NOTICE", "notice": { "kind": "leave", "id": "uuid", "nickname": "닉네임", "createdAt": "..." } }`가 남은 참가자에게 전달되고 기록에 남는다. 화면에는 각각 `닉네임님이 채팅방에 입장했습니다.`, `닉네임님이 채팅방에서 나갔습니다.`로 표시한다. `JOINED.messages`에는 이전 채팅과 입·퇴장 알림이 시간순으로 들어간다. 채팅은 `{ "type": "CHAT", "message": { "kind": "chat", "id": "uuid", "clientMessageId": "local-id", "participant": { "characterId": "spectator", "order": null }, "text": "...", "createdAt": "..." } }`로 전달된다. `clientMessageId`는 선택사항이며 생략하면 서버가 생성한다. 입장·퇴장·캐릭터·순서 변경 때 `PARTICIPANTS`가 전달되고, 변경 시 해당 참가자의 최근 채팅 캐릭터와 순서도 갱신된다. `PING`에는 `PONG`으로 응답한다. 연결이 끊기면 클라이언트는 새 연결에서 같은 `JOIN` 정보를 다시 보내야 한다.

메시지 텍스트는 trim 후 비어 있지 않아야 하며 최대 1,000자다. JSON 문자열만 받으므로 HTML을 실행하지 않고, 화면에서는 텍스트로 렌더링해야 한다. 서버는 채팅과 입·퇴장 알림을 합쳐 최근 최대 300개, 직렬화된 메시지 크기 합계 최대 256KiB만 메모리에 보관한다. 클라이언트는 전송 직후 입력칸을 비우고 메시지를 임시로 표시한다. 전송 중에는 메시지 텍스트의 밝기가 변하며, 서버에서 DB 저장을 마친 뒤 돌아온 `clientMessageId`가 같은 메시지로 교체된다. 실패하면 임시 메시지에 오류와 다시 입력 버튼을 표시한다. 연결이 끊겨 결과를 확인할 수 없는 경우에는 중복 전송 가능성을 알려준다. 화면에서 위로 스크롤하면 이미 입장한 웹소켓 연결에서 `HISTORY`를 요청해 세션의 이전 기록을 50개씩 가져온다. 서버는 `{ "type": "HISTORY", "before": "요청한 UUID", "messages": [], "hasMore": false }` 형태로 응답한다. 캐릭터·순서 변경은 DB의 참여자 정보에도 반영하므로 과거 메시지에 최신 설정이 표시된다.

오류는 `{ "type": "ERROR", "code": "...", "message": "...", "clientMessageId": "..." }` 형태다.

## 제한과 배포

- 방 최대 200개, 동시 연결 최대 500개, IP당 연결 최대 20개
- IP당 입장 시도 1분 12회, 연결당 메시지 1분 60회
- 마지막 참여자가 나간 뒤 3분이 지나면 방 세션과 DB 채팅 이력이 삭제됨. 같은 ID로 다시 입장하면 별도 세션이 열림. 비정상 종료 후 남은 만료 세션도 주기적으로 삭제됨
- 연결 heartbeat가 90초 동안 수신되지 않으면 정리됨. 클라이언트는 약 20초마다 `PING`을 보내며, 서버는 연결된 참가자에게 약 30초마다 WebSocket ping 프레임을 보내 브라우저의 자동 pong 응답도 확인함
- 전송 버퍼가 1MiB를 넘는 느린 연결은 종료됨

Nginx는 `/ws/party`를 HTTP/1.1 Upgrade로 프록시해야 한다. 배포 템플릿에는 이 location이 포함되어 있다. 프록시 뒤에서 실제 IP별 제한을 사용하려면 Nginx가 덮어쓰는 `X-Real-IP`를 신뢰하도록 앱 환경에 `ASTRAL_TRUST_PROXY=true`를 설정한다. 저장소의 Docker Compose 배포 설정은 이 값을 `true`로 전달하며, 프록시 없이 직접 실행할 때의 기본값은 `false`다. 기본값에서는 직접 연결의 `peer.remoteAddress`만 사용하며, 클라이언트가 보낸 `X-Forwarded-For`는 사용하지 않는다.

로컬 서버를 실행한 뒤 `pnpm test:party`로 HTTP와 WebSocket 통합 테스트를 실행할 수 있다. 테스트 대상 URL을 바꾸려면 `pnpm test:party http://localhost:3000`처럼 지정한다. 방 생명주기와 TTL 정리는 서버 없이 `pnpm test:party:rooms`로 검증한다.
DB 저장과 과거 기록 조회는 마이그레이션을 적용한 로컬 서버에서 `pnpm test:party:storage http://localhost:3000`으로 검증한다.

배포 전에 `database/migrations/0012_party_chat_history.sql`까지 마이그레이션을 적용해야 한다. 실제 저장 용량은 `SELECT pg_size_pretty(pg_total_relation_size('party_chat_messages'));`로 확인할 수 있다.
