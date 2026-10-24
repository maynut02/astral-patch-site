// 같은 합성 루트를 새로 읽어도 방/연결 상태는 인스턴스마다 분리된다.
export async function loadPartyModuleUrls(transformModule, typesUrl, storageStubUrl) {
  const limitsUrl = await transformModule('server/utils/party-chat-limits.ts', {
    '../../shared/types/party.ts': typesUrl
  })
  const stateUrl = await transformModule('server/utils/party-chat-state.ts', {
    '../../shared/types/party.ts': typesUrl,
    './party-chat-storage.ts': storageStubUrl,
    './party-chat-limits.ts': limitsUrl
  })
  const imports = {
    '../../shared/types/party.ts': typesUrl,
    './party-chat-limits.ts': limitsUrl
  }
  const presenceUrl = await transformModule('server/utils/party-chat-presence.ts', imports)
  const admissionUrl = await transformModule('server/utils/party-chat-admission.ts', imports)
  const messagesUrl = await transformModule('server/utils/party-chat-messages.ts', imports)
  const partyChatUrl = await transformModule('server/utils/party-chat.ts', {
    './party-chat-state.ts': stateUrl,
    './party-chat-limits.ts': limitsUrl,
    './party-chat-presence.ts': presenceUrl,
    './party-chat-admission.ts': admissionUrl,
    './party-chat-messages.ts': messagesUrl
  })
  const originUrl = await transformModule('server/utils/ws-origin.ts')
  return { partyChatUrl, limitsUrl, originUrl }
}
