<script setup lang="ts">
import {
  PARTY_MAX_NICKNAME_LENGTH,
  PARTY_MAX_TEXT_LENGTH,
  PARTY_ORDERS,
  PARTY_ROOM_ID_PATTERN,
  PARTY_SPECTATOR_ID,
  PARTY_UNSELECTED_ID,
  getPartyCharacterImage,
  getPartyTextLength,
  type PartyCharacter,
  type PartyCharacterId,
  type PartyOrder,
  type PartyRoomSummary
} from '#shared/types/party'
import { readBrowserStorage, writeBrowserStorage } from '~/utils/browser-storage'
import { getRequestErrorMessage } from '~/utils/request-error'

definePageMeta({ partyChat: true, key: route => route.path })
const route = useRoute()
const roomId = String(route.params.roomId)
useAstralPageSeo(() => `${roomId} · 파티 채팅`, '게임을 플레이하며 파티원과 대화하세요.')
useSeoMeta({ robots: 'noindex, nofollow' })

const enteredRoom = useState<PartyRoomSummary | null>('party-room-handoff', () => null)
const handoff = enteredRoom.value?.roomId === roomId ? enteredRoom.value : null
enteredRoom.value = null
const enteredNickname = useState<string | null>('party-nickname-handoff', () => null)
const providedNickname = enteredNickname.value
enteredNickname.value = null
const room = ref<PartyRoomSummary | null>(handoff)
const roomError = ref<{ statusCode?: number, message?: string } | null>(null)
const roomStatus = ref<'idle' | 'pending' | 'success' | 'error'>(handoff ? 'success' : 'idle')
const { data: characters, error: charactersError, status: charactersStatus, refresh: refreshCharacters } = await useFetch<PartyCharacter[]>('/api/party/characters', { default: () => [] })
const { status, messages, participants, participantId, activeCharacterId, activeOrder, error, errorCode, joined, loadingOlder, hasOlder, historyError, join, send, takeLocalMessage, loadOlder, changeCharacter, changeOrder } = usePartyChat(roomId)
const nickname = ref(providedNickname || '')
const nicknameError = ref('')
const submittingNickname = ref(false)
const showNicknameModal = ref(!providedNickname && PARTY_ROOM_ID_PATTERN.test(roomId))
const characterId = ref<PartyCharacterId>(PARTY_SPECTATOR_ID)
const order = ref<PartyOrder | null>(null)
const characterSearch = ref('')
const characterError = ref('')
const orderError = ref('')
const profileReady = ref(false)
const showCharacterPicker = ref(false)
const draft = ref('')
const formError = ref('')
const copied = ref(false)
const showParticipants = ref(false)
const messageList = useTemplateRef<HTMLElement>('messageList')
const input = useTemplateRef<HTMLTextAreaElement>('chatInput')
const { supported: pipSupported, target: pipTarget, opening: pipOpening, error: pipError, open: openPip, close: closePip } = usePartyPictureInPicture()
const { showToast } = useAppToast()
// The default portal uses the main page. Disable it while chat is in the PiP document.
const useDefaultOverlayPortal = computed(() => !pipTarget.value)
const nearBottom = ref(true)
const unread = ref(0)
const isComposerFocused = ref(false)
const isComposingInput = ref(false)
let visualViewport: VisualViewport | null = null
let copyTimer: ReturnType<typeof setTimeout> | undefined
let historyScrollAnchor: { before: string, top: number, height: number } | null = null
let isPageUnmounted = false
let roomRequestGeneration = 0
let roomRequestController: AbortController | undefined
let nicknameRequestController: AbortController | undefined

function focusComposer() {
  input.value?.focus()
}

function resizeComposer() {
  const el = input.value
  if (!el || isComposingInput.value) return
  el.style.height = 'auto'
  const view = el.ownerDocument.defaultView ?? window
  const styles = view.getComputedStyle(el)
  const lineHeight = Number.parseFloat(styles.lineHeight) || 20
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0
  const maxHeight = lineHeight * 6 + paddingTop + paddingBottom
  const nextHeight = Math.min(el.scrollHeight, maxHeight)
  el.style.height = `${Math.max(nextHeight, lineHeight + paddingTop + paddingBottom)}px`
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

function onComposerInput() {
  if (!isComposingInput.value) {
    resizeComposer()
  }
}

function onComposerCompositionStart() {
  isComposingInput.value = true
}

function onComposerCompositionEnd() {
  isComposingInput.value = false
  requestAnimationFrame(resizeComposer)
}

watch(draft, (value) => {
  if (!value && input.value && !isComposingInput.value) {
    input.value.style.height = 'auto'
    input.value.style.overflowY = 'hidden'
  }
})

async function refreshRoom() {
  if (isPageUnmounted) return
  const generation = ++roomRequestGeneration
  roomRequestController?.abort()
  const controller = new AbortController()
  roomRequestController = controller
  roomStatus.value = 'pending'
  roomError.value = null
  try {
    const fetched = await $fetch<PartyRoomSummary>('/api/party/rooms', {
      method: 'POST',
      body: { roomId },
      signal: controller.signal
    })
    if (isPageUnmounted || generation !== roomRequestGeneration) return
    room.value = fetched
    roomError.value = null
    roomStatus.value = 'success'
  } catch (cause) {
    if (isPageUnmounted || controller.signal.aborted || generation !== roomRequestGeneration) return
    if (room.value || joined.value) return
    const statusCode = (cause as { statusCode?: number, data?: { statusCode?: number } })?.statusCode
      ?? (cause as { data?: { statusCode?: number } })?.data?.statusCode
    roomError.value = {
      statusCode,
      message: getRequestErrorMessage(cause, '채팅방을 열지 못했습니다.')
    }
    roomStatus.value = 'error'
  }
}

const orderColors: Record<PartyOrder, string> = {
  P1: 'bg-error/15 text-error',
  P2: 'bg-success/15 text-success',
  P3: 'bg-info/15 text-info',
  P4: 'bg-warning/15 text-warning'
}
const orderHoverColors: Record<PartyOrder, string> = {
  P1: 'enabled:hover:bg-error/15',
  P2: 'enabled:hover:bg-success/15',
  P3: 'enabled:hover:bg-info/15',
  P4: 'enabled:hover:bg-warning/15'
}
const characterNames = computed(() => new Map<PartyCharacterId, string>(characters.value.map(character => [character.id, character.name])))
const selectedCharacterName = computed(() => characterName(characterId.value))
const activeParticipantIds = computed(() => new Set(participants.value.map(participant => participant.id)))
const visibleCharacters = computed(() => {
  const query = characterSearch.value.trim().toLocaleLowerCase()
  const options: { id: PartyCharacterId, name: string, nickname: string, image: string }[] = [
    { id: PARTY_SPECTATOR_ID, name: '관전', nickname: '', image: '' },
    ...characters.value
  ]
  return options.filter(character => `${character.id} ${character.name} ${character.nickname}`.toLocaleLowerCase().includes(query))
})
const connecting = computed(() => status.value === 'connecting' || status.value === 'reconnecting')
const statusLabel = computed(() => status.value === 'idle'
  ? '입장 대기'
  : ({ connecting: '연결 중', connected: '온라인', reconnecting: '재연결 중', error: '연결 실패' })[status.value])
const statusColor = computed(() => status.value === 'idle'
  ? 'bg-warning'
  : status.value === 'connected' ? 'bg-success' : status.value === 'error' ? 'bg-error' : 'bg-warning')
const canSend = computed(() => {
  const trimmed = draft.value.trim()
  return status.value === 'connected' && Boolean(trimmed) && getPartyTextLength(trimmed) <= PARTY_MAX_TEXT_LENGTH
})
const pipButtonLabel = computed(() => pipTarget.value ? '원래 페이지로 돌아가기' : '항상 위에 표시 (PiP)')

watch([room, profileReady], ([value, ready]) => {
  if (value && ready && !joined.value && status.value === 'idle') enterRoom()
}, { immediate: true })

watch(errorCode, (code) => {
  if (code !== 'NICKNAME_TAKEN') return
  profileReady.value = false
  nicknameError.value = error.value || '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.'
  showNicknameModal.value = true
})

watch(nickname, () => {
  nicknameError.value = ''
  formError.value = ''
}, { flush: 'sync' })

watch(pipTarget, async () => {
  showParticipants.value = false
  showCharacterPicker.value = false
  const scrollTop = messageList.value?.scrollTop ?? 0
  await nextTick()
  if (messageList.value) messageList.value.scrollTop = scrollTop
  resizeComposer()
  if (pipTarget.value) focusComposer()
  else handleViewportResize()
})

onMounted(() => {
  visualViewport = window.visualViewport
  window.addEventListener('resize', handleViewportResize)
  visualViewport?.addEventListener('resize', handleViewportResize)

  if (!providedNickname) nickname.value = readBrowserStorage('party-nickname') || ''
  const trimmedNickname = nickname.value.trim()
  if (providedNickname && trimmedNickname && getPartyTextLength(trimmedNickname) <= PARTY_MAX_NICKNAME_LENGTH) profileReady.value = true
  else showNicknameModal.value = PARTY_ROOM_ID_PATTERN.test(roomId)
  if (!room.value) void refreshRoom()
})
onBeforeUnmount(() => {
  isPageUnmounted = true
  roomRequestController?.abort()
  nicknameRequestController?.abort()
  clearTimeout(copyTimer)
  window.removeEventListener('resize', handleViewportResize)
  visualViewport?.removeEventListener('resize', handleViewportResize)
})

function handleViewportResize() {
  if (isComposerFocused.value && nearBottom.value && !isComposingInput.value) {
    void scrollToBottom()
  }
}

function handleComposerFocus() {
  isComposerFocused.value = true
  if (nearBottom.value && !isComposingInput.value) {
    requestAnimationFrame(() => void scrollToBottom())
  }
}

function handleComposerBlur() {
  isComposerFocused.value = false
}

function enterRoom() {
  if (isPageUnmounted || connecting.value) return
  formError.value = ''
  const trimmed = nickname.value.trim()
  if (!trimmed || getPartyTextLength(trimmed) > PARTY_MAX_NICKNAME_LENGTH) {
    formError.value = '20자 이내의 닉네임을 입력해 주세요.'
    return
  }
  nickname.value = trimmed
  join({ nickname: nickname.value, characterId: PARTY_SPECTATOR_ID, order: null })
}

function isNicknameTakenResponse(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false
  const response = cause as { statusCode?: unknown, data?: { statusCode?: unknown } }
  return response.statusCode === 409 || response.data?.statusCode === 409
}

async function submitNickname() {
  if (submittingNickname.value || isPageUnmounted) return
  const name = nickname.value.trim()
  if (!name || getPartyTextLength(name) > PARTY_MAX_NICKNAME_LENGTH) {
    nicknameError.value = '20자 이내의 닉네임을 입력해 주세요.'
    return
  }

  nicknameError.value = ''
  formError.value = ''
  submittingNickname.value = true
  const generation = ++roomRequestGeneration
  roomRequestController?.abort()
  nicknameRequestController?.abort()
  const controller = new AbortController()
  nicknameRequestController = controller
  try {
    const fetched = await $fetch<PartyRoomSummary>('/api/party/rooms', {
      method: 'POST',
      body: { roomId, nickname: name },
      signal: controller.signal
    })
    if (isPageUnmounted || controller.signal.aborted || generation !== roomRequestGeneration) return
    room.value = fetched
    roomError.value = null
    roomStatus.value = 'success'
    nickname.value = name
    showNicknameModal.value = false
    profileReady.value = true
    enterRoom()
  } catch (cause) {
    if (isPageUnmounted || controller.signal.aborted) return
    if (isNicknameTakenResponse(cause)) {
      nicknameError.value = '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.'
    } else {
      formError.value = getRequestErrorMessage(cause, '채팅방에 들어가지 못했습니다. 다시 시도해 주세요.')
    }
  } finally {
    if (nicknameRequestController === controller) {
      submittingNickname.value = false
    }
  }
}

function openNicknameModal() {
  profileReady.value = false
  formError.value = ''
  showNicknameModal.value = true
}

watch(joined, async (value) => {
  if (!value) {
    showParticipants.value = false
    showCharacterPicker.value = false
    return
  }
  writeBrowserStorage('party-nickname', nickname.value)
  await scrollToBottom()
  focusComposer()
})

watch(activeCharacterId, (value) => {
  if (!value) return
  characterId.value = value
  characterError.value = ''
})

watch(activeOrder, (value) => {
  order.value = value
  orderError.value = ''
})

watch(showCharacterPicker, (open) => {
  if (!open) characterSearch.value = ''
})

function selectCharacter(id: PartyCharacterId) {
  if (id !== characterId.value && !changeCharacter(id)) {
    characterError.value = '연결된 후 캐릭터를 변경할 수 있습니다.'
    return
  }
  characterError.value = ''
}

function selectOrder(value: PartyOrder) {
  if (characterId.value === PARTY_SPECTATOR_ID) return
  if (value !== order.value && !changeOrder(value)) {
    orderError.value = '연결된 후 순서를 변경할 수 있습니다.'
    return
  }
  orderError.value = ''
}

function toggleCharacterPicker() {
  showCharacterPicker.value = !showCharacterPicker.value
  characterError.value = ''
  orderError.value = ''
}

function submitMessage() {
  if (!canSend.value || !send(draft.value)) return
  draft.value = ''
  if (input.value) {
    input.value.style.height = 'auto'
    input.value.style.overflowY = 'hidden'
  }
  void scrollToBottom().then(() => focusComposer())
}

function onInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !isComposingInput.value && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault()
    submitMessage()
  }
}

function restoreLocalMessage(clientMessageId: string) {
  if (draft.value) return
  const text = takeLocalMessage(clientMessageId)
  if (text === null) return
  draft.value = text
  nextTick(() => {
    resizeComposer()
    focusComposer()
  })
}

function onScroll() {
  const list = messageList.value
  if (!list) return
  nearBottom.value = list.scrollHeight - list.scrollTop - list.clientHeight < 80
  if (nearBottom.value) unread.value = 0
  if (hasOlder.value && list.scrollTop <= 80 && list.scrollHeight > list.clientHeight + 1) loadMoreHistory()
}

function loadMoreHistory() {
  const list = messageList.value
  const before = messages.value[0]?.id
  if (!list || !before || historyScrollAnchor || !loadOlder()) return
  historyScrollAnchor = { before, top: list.scrollTop, height: list.scrollHeight }
}

watch(() => messages.value[0]?.id, async (firstId) => {
  const anchor = historyScrollAnchor
  if (!anchor || !firstId || firstId === anchor.before) return
  await nextTick()
  const list = messageList.value
  if (list) list.scrollTop = anchor.top + list.scrollHeight - anchor.height
  historyScrollAnchor = null
})

watch(loadingOlder, (loading) => {
  if (!loading && historyScrollAnchor?.before === messages.value[0]?.id) historyScrollAnchor = null
})

async function scrollToBottom() {
  await nextTick()
  const list = messageList.value
  if (list) list.scrollTop = list.scrollHeight
  nearBottom.value = true
  unread.value = 0
}

watch(messages, (current, previous) => {
  const latest = current.at(-1)
  if (!latest) return
  const latestKey = latest.kind === 'chat' ? latest.clientMessageId : latest.id
  if (previous.some((message) => {
    const key = message.kind === 'chat' ? message.clientMessageId : message.id
    return key === latestKey
  })) return
  if (nearBottom.value) void scrollToBottom()
  else unread.value++
})

function characterImage(id: PartyCharacterId) {
  return getPartyCharacterImage(id)
}

function characterName(id: PartyCharacterId) {
  if (id === PARTY_UNSELECTED_ID) return '미선택'
  return id === PARTY_SPECTATOR_ID ? '관전' : characterNames.value.get(id) || `캐릭터 #${id}`
}

function characterIcon(id: PartyCharacterId) {
  if (id === PARTY_UNSELECTED_ID) return 'i-tabler-user-question'
  return id === PARTY_SPECTATOR_ID ? 'i-tabler-eye' : undefined
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

async function copyLink() {
  try {
    const activeNavigator = pipTarget.value?.ownerDocument.defaultView?.navigator ?? navigator
    await activeNavigator.clipboard.writeText(location.href)
    copied.value = true
    showToast({ id: 'party-room-link-copied', title: '복사가 완료되었습니다' })
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    error.value = '링크를 복사하지 못했습니다. 주소창의 URL을 복사해 주세요.'
  }
}

function togglePip() {
  if (pipTarget.value) void closePip()
  else void openPip()
}
</script>

<template>
  <div class="h-full min-h-0 overflow-hidden">
    <div v-if="pipTarget" class="flex h-full flex-col items-center justify-center p-6 text-center">
      <UIcon name="i-tabler-picture-in-picture" class="size-8 text-muted mb-2" />
      <h1 class="text-lg font-semibold mb-1">
        PiP 창에서 채팅 중입니다.
      </h1>
      <p class="text-sm text-muted mb-3">
        이 탭을 열어 두면 게임 중에도 채팅을 사용할 수 있습니다.
      </p>
      <div class="flex flex-wrap justify-center gap-2">
        <UButton
          label="PiP 창 보기"
          color="neutral"
          variant="soft"
          @click="openPip"
        />
        <UButton
          label="이 페이지로 가져오기"
          color="neutral"
          variant="soft"
          @click="closePip"
        />
      </div>
    </div>
    <Teleport :to="pipTarget || 'body'" :disabled="!pipTarget">
      <UToaster
        v-if="pipTarget"
        :portal="false"
        position="top-center"
        :expand="false"
      />
      <div class="flex h-full min-h-0 flex-col overflow-hidden bg-default">
        <header class="relative z-10 flex shrink-0 items-center gap-2 border-b border-default px-3 py-3 sm:px-5">
          <UTooltip
            text="방 나가기"
            :portal="useDefaultOverlayPortal"
            :delay-duration="0"
          >
            <UButton
              to="/party"
              icon="i-tabler-arrow-left"
              aria-label="방 나가기"
              color="neutral"
              variant="ghost"
            />
          </UTooltip>
          <div class="min-w-0 flex-1 ml-1">
            <div class="flex items-center gap-2">
              <h1 class="truncate font-mono text-sm font-semibold">
                {{ roomId }}
              </h1>
            </div>
            <div class="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              <UTooltip
                :text="statusLabel"
                :portal="useDefaultOverlayPortal"
                :delay-duration="0"
              >
                <span class="inline-flex shrink-0 items-center" role="status">
                  <span class="size-2 rounded-full" :class="statusColor" aria-hidden="true" />
                  <span class="sr-only">{{ statusLabel }}</span>
                </span>
              </UTooltip>
              <span v-if="joined">{{ participants.length }}명 참여 중</span>
              <span v-else-if="room">{{ room.participantCount }}명 참여 중</span>
            </div>
          </div>
          <UTooltip
            v-if="joined"
            :text="`사용자 설정 · ${selectedCharacterName}${order ? ` · ${order}` : ''}`"
            :portal="useDefaultOverlayPortal"
            :delay-duration="0"
          >
            <UButton
              aria-label="사용자 설정"
              aria-haspopup="dialog"
              :aria-expanded="showCharacterPicker"
              color="neutral"
              variant="outline"
              @click="toggleCharacterPicker"
            >
              <PartyCharacterImage
                :src="characterImage(characterId)"
                :icon="characterIcon(characterId)"
                alt=""
                class="size-5"
              />
              <span class="px-1 text-xs font-semibold" :class="order ? orderColors[order] : 'bg-muted text-muted'">{{ order || '관전' }}</span>
            </UButton>
          </UTooltip>
          <UTooltip
            :text="copied ? '복사됨' : '방 링크 복사'"
            :portal="useDefaultOverlayPortal"
            :delay-duration="0"
          >
            <UButton
              :icon="copied ? 'i-tabler-check' : 'i-tabler-link'"
              :aria-label="copied ? '링크 복사됨' : '방 링크 복사'"
              color="neutral"
              variant="ghost"
              @click="copyLink"
            />
          </UTooltip>
          <UTooltip
            v-if="(joined || pipTarget) && pipSupported"
            :text="pipButtonLabel"
            :portal="useDefaultOverlayPortal"
            :delay-duration="0"
          >
            <UButton
              :icon="pipTarget ? 'i-tabler-window-maximize' : 'i-tabler-window-minimize'"
              :aria-label="pipButtonLabel"
              :loading="pipOpening"
              color="neutral"
              variant="ghost"
              @click="togglePip"
            />
          </UTooltip>
          <UTooltip
            v-if="joined"
            text="참여자 목록"
            :portal="useDefaultOverlayPortal"
            :delay-duration="0"
          >
            <UButton
              icon="i-tabler-users"
              aria-label="참여자 목록"
              aria-haspopup="dialog"
              :aria-expanded="showParticipants"
              color="neutral"
              :variant="showParticipants ? 'soft' : 'ghost'"
              @click="showParticipants = !showParticipants"
            />
          </UTooltip>
        </header>

        <USlideover
          v-model:open="showCharacterPicker"
          title="사용자 설정"
          :portal="useDefaultOverlayPortal"
          :ui="{ overlay: 'z-50', content: 'z-50', body: 'min-h-0 flex flex-col overflow-hidden' }"
        >
          <template #body>
            <div class="flex min-h-0 flex-1 flex-col gap-5">
              <section aria-label="순서 선택" class="shrink-0">
                <h2 class="mb-2 text-sm font-medium">
                  순서
                </h2>
                <div class="grid grid-cols-4 gap-2">
                  <button
                    v-for="option in PARTY_ORDERS"
                    :key="option"
                    type="button"
                    :aria-pressed="order === option"
                    :disabled="characterId === PARTY_SPECTATOR_ID || status !== 'connected'"
                    class="border border-default px-2 py-2 text-center text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
                    :class="[orderHoverColors[option], order === option ? orderColors[option] : '']"
                    @click="selectOrder(option)"
                  >
                    {{ option }}
                  </button>
                </div>
                <p v-if="characterId === PARTY_SPECTATOR_ID" class="mt-2 text-xs text-muted">
                  관전 중에는 순서를 선택할 수 없습니다.
                </p>
                <p v-if="orderError" role="alert" class="mt-2 text-xs text-error">
                  {{ orderError }}
                </p>
              </section>

              <section aria-label="캐릭터 선택" class="flex min-h-0 flex-1 flex-col">
                <h2 class="mb-2 text-sm font-medium">
                  캐릭터
                </h2>
                <UFormField name="characterSearch" class="mb-2">
                  <UInput
                    v-model="characterSearch"
                    icon="i-tabler-search"
                    placeholder="이름, 별명, ID 검색"
                    aria-label="캐릭터 검색"
                    class="w-full"
                  />
                </UFormField>
                <div v-if="charactersError" role="alert" class="mb-2 flex items-center gap-2 text-xs text-error">
                  캐릭터 정보를 불러오지 못했습니다.
                  <UButton
                    label="다시 시도"
                    size="xs"
                    variant="outline"
                    :loading="charactersStatus === 'pending'"
                    @click="refreshCharacters()"
                  />
                </div>
                <p v-else-if="charactersStatus === 'pending'" role="status" class="mb-2 text-xs text-muted">
                  캐릭터를 불러오는 중입니다.
                </p>
                <p v-if="characterError" role="alert" class="mb-2 text-xs text-error">
                  {{ characterError }}
                </p>
                <div class="min-h-0 flex-1 overflow-y-auto border-y border-default">
                  <button
                    v-for="character in visibleCharacters"
                    :key="character.id"
                    type="button"
                    :aria-pressed="characterId === character.id"
                    :disabled="status !== 'connected'"
                    class="flex w-full items-center gap-2 border-b border-default p-2 text-left transition-colors last:border-b-0 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
                    @click="selectCharacter(character.id)"
                  >
                    <PartyCharacterImage
                      :src="character.image"
                      :icon="characterIcon(character.id)"
                      alt=""
                      class="size-10"
                    />
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate text-sm font-medium">{{ character.name }}</span>
                      <span v-if="character.nickname" class="truncate text-xs text-muted">{{ character.nickname }}</span>
                    </span>
                    <UIcon
                      v-if="characterId === character.id"
                      name="i-tabler-check"
                      class="size-5 text-toned"
                      aria-hidden="true"
                    />
                  </button>
                </div>
                <p v-if="charactersStatus !== 'pending' && !visibleCharacters.length" class="py-3 text-center text-xs text-muted">
                  검색 결과가 없습니다.
                </p>
              </section>
            </div>
          </template>
        </USlideover>

        <USlideover
          v-model:open="showParticipants"
          title="참여자 목록"
          :description="`${participants.length}명 참여 중`"
          :portal="useDefaultOverlayPortal"
          :ui="{ overlay: 'z-50', content: 'z-50' }"
        >
          <template #body>
            <ul class="flex flex-col gap-2">
              <li v-for="participant in participants" :key="participant.id" class="flex items-center gap-3 border border-default bg-muted px-3 py-2">
                <PartyCharacterImage
                  :src="characterImage(participant.characterId)"
                  :icon="characterIcon(participant.characterId)"
                  alt=""
                  class="size-10 shrink-0"
                />
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <span class="truncate text-sm font-medium">
                    {{ participant.nickname }}{{ participant.id === participantId ? ' (나)' : '' }}
                  </span>
                  <div class="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                    <span v-if="participant.order" class="shrink-0 px-1.5 py-0.5 font-semibold" :class="orderColors[participant.order]">{{ participant.order }}</span>
                    <span class="truncate">{{ characterName(participant.characterId) }}</span>
                  </div>
                </div>
              </li>
            </ul>
          </template>
        </USlideover>

        <div v-if="pipError" class="flex shrink-0 flex-wrap items-center gap-2 border-b border-default bg-muted px-4 py-2">
          <p role="alert" class="text-xs text-warning">
            {{ pipError }}
          </p>
        </div>

        <div v-if="!joined && !room && !roomError && (roomStatus === 'idle' || roomStatus === 'pending')" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" role="status">
          <p class="text-sm text-muted">
            채팅방을 여는 중입니다…
          </p>
        </div>
        <div v-else-if="!joined && !room" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <UIcon name="i-tabler-message-off" class="size-8 text-dimmed" />
          <h2 class="font-semibold">
            {{ roomError?.statusCode === 400 ? '올바르지 않은 방 ID입니다.' : '채팅방을 열지 못했습니다.' }}
          </h2>
          <p class="text-sm text-muted">
            방 ID를 확인하거나 잠시 후 다시 시도해 주세요.
          </p>
          <UButton
            label="다시 시도"
            variant="outline"
            @click="refreshRoom()"
          />
          <UButton :to="{ path: '/party', query: { roomId } }" label="방 ID와 닉네임 입력" variant="outline" />
        </div>

        <div v-else-if="!joined" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <UIcon name="i-tabler-message-circle" class="size-8 text-muted" />
          <p v-if="showNicknameModal" role="status" class="text-sm text-muted">
            닉네임을 입력하면 채팅방에 입장합니다.
          </p>
          <p v-else-if="connecting || status === 'idle'" role="status" class="text-sm text-muted">
            채팅방에 연결하는 중입니다…
          </p>
          <p v-if="formError || error" role="alert" class="text-sm text-error">
            {{ formError || error }}
          </p>
          <UButton
            v-if="(status === 'error' || formError) && errorCode !== 'NICKNAME_TAKEN'"
            label="다시 입장"
            color="info"
            variant="soft"
            @click="enterRoom"
          />
          <UButton label="닉네임 변경" variant="outline" @click="openNicknameModal" />
        </div>

        <template v-else>
          <div v-if="error" role="alert" class="shrink-0 border-b border-default bg-muted px-4 py-2 text-xs text-warning">
            {{ error }}
          </div>
          <div class="relative min-h-0 flex-1">
            <div
              ref="messageList"
              tabindex="0"
              class="h-full overflow-y-auto overscroll-contain px-3 pt-4 sm:px-5"
              @scroll="onScroll"
            >
              <div class="mx-auto flex min-h-full w-full max-w-4xl flex-col">
                <div
                  role="log"
                  aria-label="채팅 메시지"
                  aria-live="polite"
                  aria-relevant="additions"
                  class="flex flex-col gap-6 pb-6 px-2"
                >
                  <p v-if="loadingOlder" role="status" class="py-2 text-center text-xs text-dimmed">
                    이전 대화를 불러오는 중입니다…
                  </p>
                  <div v-else-if="historyError" class="flex flex-col items-center gap-2 py-2">
                    <p role="alert" class="text-center text-xs text-error">
                      {{ historyError }}
                    </p>
                    <UButton
                      label="다시 불러오기"
                      size="xs"
                      variant="outline"
                      @click="loadMoreHistory"
                    />
                  </div>
                  <p class="py-2 text-center text-xs text-dimmed">
                    {{ roomId }} 채팅방 · 파티원에게 인사를 건네 보세요.
                  </p>
                  <!-- <div v-if="!messages.length" class="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-muted">
                  <UIcon name="i-tabler-message-circle" class="size-7 text-dimmed" />
                  <p class="text-sm">
                    아직 메시지가 없습니다.
                  </p>
                </div> -->
                  <template v-for="message in messages" :key="message.id">
                    <p v-if="message.kind === 'join'" class="py-2 text-center text-xs text-dimmed">
                      {{ message.nickname }}님이 채팅방에 입장했습니다.
                    </p>
                    <p v-else-if="message.kind === 'leave'" class="py-2 text-center text-xs text-dimmed">
                      {{ message.nickname }}님이 채팅방에서 나갔습니다.
                    </p>
                    <article v-else class="flex items-start gap-2.5">
                      <div class="flex size-10 shrink-0 items-center justify-center overflow-hidden border border-default bg-muted">
                        <PartyCharacterImage
                          :src="characterImage(message.participant.characterId)"
                          :icon="characterIcon(message.participant.characterId)"
                          alt=""
                          class="size-full"
                        />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="mb-1 flex items-center gap-1.5">
                          <span class="shrink-0 px-1 py-px text-xs font-semibold" :class="message.participant.order ? orderColors[message.participant.order] : 'bg-muted text-muted'">{{ message.participant.order || '관전' }}</span>
                          <span class="truncate text-xs font-medium" :class="activeParticipantIds.has(message.participant.id) || 'delivery' in message ? 'text-toned' : 'text-dimmed'">{{ message.participant.nickname }}</span>
                          <UIcon
                            v-if="!activeParticipantIds.has(message.participant.id) && !('delivery' in message)"
                            name="i-tabler-plug-connected"
                            role="img"
                            aria-label="나간 사용자"
                            class="size-3 shrink-0 text-dimmed"
                          />
                          <time :datetime="message.createdAt" class="shrink-0 text-[10px] text-dimmed">{{ formatTime(message.createdAt) }}</time>
                        </div>
                        <p
                          class="whitespace-pre-wrap text-sm leading-relaxed wrap-anywhere"
                          :class="'delivery' in message && message.delivery === 'sending' ? 'motion-safe:animate-pulse' : undefined"
                        >
                          {{ message.text }}
                        </p>
                        <div v-if="'delivery' in message && message.delivery !== 'sending'" class="mt-1 flex items-center gap-2 text-xs" :class="message.delivery === 'failed' ? 'text-error' : 'text-warning'">
                          <span role="alert">{{ message.failureReason || '전송 실패' }}</span>
                          <UButton
                            label="다시 입력"
                            size="xs"
                            color="neutral"
                            variant="link"
                            :disabled="Boolean(draft)"
                            @click="restoreLocalMessage(message.clientMessageId)"
                          />
                        </div>
                      </div>
                    </article>
                  </template>
                </div>
                <form
                  class="sticky bottom-0 mt-auto flex flex-col pb-[max(0.75rem,env(safe-area-inset-bottom))]"
                  @submit.prevent="submitMessage"
                >
                  <UButton
                    v-if="unread"
                    type="button"
                    :label="`새 메시지 ${unread}개`"
                    icon="i-tabler-arrow-down"
                    size="sm"
                    color="warning"
                    variant="soft"
                    class="mb-2 self-center shadow-lg"
                    @click="scrollToBottom"
                  />
                  <div class="mx-auto w-full max-w-4xl bg-muted/80 backdrop-blur-md border border-default">
                    <div class="flex items-end gap-2">
                      <UFormField name="message" class="min-w-0 flex-1">
                        <textarea
                          ref="chatInput"
                          v-model="draft"
                          aria-label="채팅 메시지"
                          :placeholder="status === 'connected' ? '메시지 입력...' : '다시 연결되면 메시지를 보낼 수 있습니다.'"
                          :maxlength="2000"
                          :rows="1"
                          class="block w-full resize-none appearance-none border-0 bg-transparent p-4 text-base/5 text-highlighted placeholder:text-dimmed focus:outline-none md:text-sm"
                          @input="onComposerInput"
                          @compositionstart="onComposerCompositionStart"
                          @compositionend="onComposerCompositionEnd"
                          @focus="handleComposerFocus"
                          @blur="handleComposerBlur"
                          @keydown="onInputKeydown"
                        />
                      </UFormField>
                      <div class="flex pr-2.25 pb-2.25">
                        <UButton
                          type="submit"
                          icon="i-tabler-send"
                          aria-label="메시지 전송"
                          :disabled="!canSend"
                          color="neutral"
                        />
                      </div>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </template>
        <UModal
          v-model:open="showNicknameModal"
          :title="`채팅방 입장 - ${roomId}`"
          :portal="useDefaultOverlayPortal"
          :dismissible="false"
          :close="false"
          :ui="{ overlay: 'z-50', content: 'z-50', footer: 'justify-end' }"
        >
          <template #body>
            <form id="party-nickname-form" class="space-y-4" @submit.prevent="submitNickname">
              <UFormField
                label="닉네임"
                name="nickname"
                :error="nicknameError || undefined"
                required
              >
                <UInput
                  v-model="nickname"
                  placeholder="파티원에게 표시할 이름"
                  :maxlength="40"
                  required
                  autofocus
                  autocomplete="nickname"
                  color="neutral"
                  :disabled="submittingNickname"
                  class="w-full"
                />
              </UFormField>
              <p v-if="formError" role="alert" class="text-sm text-error">
                {{ formError }}
              </p>
            </form>
          </template>
          <template #footer>
            <UButton
              :to="{ path: '/party', query: { roomId } }"
              label="돌아가기"
              color="neutral"
              variant="ghost"
            />
            <UButton
              type="submit"
              form="party-nickname-form"
              label="입장"
              color="info"
              variant="soft"
              :loading="submittingNickname"
              :disabled="submittingNickname || !nickname.trim() || getPartyTextLength(nickname.trim()) > PARTY_MAX_NICKNAME_LENGTH"
            />
          </template>
        </UModal>
      </div>
    </Teleport>
  </div>
</template>
