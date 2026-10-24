<script setup lang="ts">
import {
  PARTY_MAX_NICKNAME_LENGTH,
  PARTY_ROOM_ID_LENGTH,
  PARTY_ROOM_ID_PATTERN,
  type PartyRoomSummary
} from '#shared/types/party'
import { readBrowserStorage } from '~/utils/browser-storage'
import { getRequestErrorMessage, getRequestErrorStatus } from '~/utils/request-error'
import { validatePartyNickname } from '~/utils/party-nickname'
import { pastePartyNumber, sanitizePartyNumberInput } from '~/utils/party-number-input'

useAstralPageSeo('파티 채팅', '인게임 방 ID와 닉네임을 입력해 파티원과 대화하세요.')

const route = useRoute()
const roomId = ref(typeof route.query.roomId === 'string' && PARTY_ROOM_ID_PATTERN.test(route.query.roomId) ? route.query.roomId : '')
const nickname = ref('')
const nicknameValidation = computed(() => validatePartyNickname(nickname.value))
const submitting = ref(false)
const entryError = ref('')
const nicknameError = ref('')
const enteredRoom = useState<PartyRoomSummary | null>('party-room-handoff', () => null)
const enteredNickname = useState<string | null>('party-nickname-handoff', () => null)

onMounted(() => {
  nickname.value = enteredNickname.value ?? readBrowserStorage('party-nickname') ?? ''
  enteredNickname.value = null
})

watch([roomId, nickname], () => {
  entryError.value = ''
  nicknameError.value = ''
}, { flush: 'sync' })

async function enterRoom() {
  if (submitting.value) return
  const id = roomId.value
  if (!PARTY_ROOM_ID_PATTERN.test(id)) {
    entryError.value = '방 ID는 숫자 6자리로 입력해 주세요.'
    return
  }
  const { nickname: name, error: validationError } = nicknameValidation.value
  if (validationError) {
    nicknameError.value = validationError
    return
  }
  entryError.value = ''
  nicknameError.value = ''
  submitting.value = true
  try {
    const room = await $fetch<PartyRoomSummary>('/api/party/rooms', {
      method: 'POST',
      body: { roomId: id, nickname: name }
    })
    enteredRoom.value = room
    enteredNickname.value = name
    await navigateTo(`/party/${encodeURIComponent(id)}`)
  } catch (cause) {
    if (getRequestErrorStatus(cause) === 409) {
      nicknameError.value = '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.'
    } else {
      entryError.value = getRequestErrorMessage(cause, '채팅방에 들어가지 못했습니다. 다시 시도해 주세요.')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-md flex-col gap-6">
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <UIcon name="i-tabler-users-group" class="size-5" />
        <h1 class="text-xl font-semibold">
          파티 채팅
        </h1>
      </div>
    </div>

    <form class="flex flex-col gap-4" @submit.prevent="enterRoom">
      <UFormField label="방 ID" name="roomId" required>
        <UInput
          v-model="roomId"
          type="text"
          inputmode="numeric"
          :pattern="PARTY_ROOM_ID_PATTERN.source"
          placeholder="숫자 6자리"
          :minlength="PARTY_ROOM_ID_LENGTH"
          :maxlength="PARTY_ROOM_ID_LENGTH"
          required
          autocomplete="off"
          autofocus
          color="neutral"
          :disabled="submitting"
          class="w-full"
          @input.capture="sanitizePartyNumberInput"
          @paste="pastePartyNumber"
        />
      </UFormField>
      <UFormField
        label="닉네임"
        name="nickname"
        :error="nicknameError || undefined"
        required
      >
        <UInput
          v-model="nickname"
          placeholder="파티원에게 표시할 이름"
          :maxlength="PARTY_MAX_NICKNAME_LENGTH"
          required
          autocomplete="nickname"
          color="neutral"
          :disabled="submitting"
          class="w-full"
        />
      </UFormField>
      <UButton
        type="submit"
        label="입장"
        icon="i-tabler-login"
        color="info"
        variant="soft"
        :loading="submitting"
        :disabled="submitting || !PARTY_ROOM_ID_PATTERN.test(roomId) || Boolean(nicknameValidation.error)"
        block
        class="py-2"
      />
      <p v-if="entryError" role="alert" class="text-sm text-error">
        {{ entryError }}
      </p>
    </form>
  </div>
</template>
