<script setup lang="ts">
import type { UserProfileDetails, UserSocialLink } from '#shared/types/profile'
import {
  GAME_PROFILE_VALUE_MAX_LENGTH,
  HANDLE_MAX_LENGTH,
  SOCIAL_LINK_LABEL_MAX_LENGTH,
  SOCIAL_LINK_MAX_COUNT,
  SOCIAL_LINK_URL_MAX_LENGTH,
  getErrorStatus,
  getHandleInitial,
  getPublicProfilePath,
  sanitizeGameInviteCode,
  sanitizeGameUid,
  validateGameInviteCode,
  validateGameUid,
  validateHandle,
  validateSocialLink
} from '~/utils/profile'

definePageMeta({ middleware: 'authenticated' })

useHead({ title: '설정' })

interface SocialLinkFormRow {
  key: string
  id: string
  label: string
  url: string
}

interface SocialLinkError {
  label: string
  url: string
}

const { user, fetch: fetchSession } = useUserSession()
const { showToast } = useAppToast()

let socialLinkKey = 0

const state = reactive({
  handle: '',
  gameUid: '',
  gameInviteCode: '',
  socialLinks: [] as SocialLinkFormRow[]
})

const errors = reactive({
  handle: '',
  gameUid: '',
  gameInviteCode: '',
  socialLinks: [] as SocialLinkError[]
})

const savedProfileSnapshot = ref('')
const profileLoading = ref(true)
const profileLoadError = ref('')
const submitting = ref(false)
const serverError = ref('')
const deleteModalOpen = ref(false)
const deleteConfirmation = ref('')
const deleting = ref(false)
const deleteError = ref('')

const publicProfilePath = computed(() => getPublicProfilePath(state.handle))
const initial = computed(() => getHandleInitial(state.handle))
const isBot = computed(() => String(user.value?.role || 'user') === 'bot')
const canDeleteAccount = computed(() =>
  deleteConfirmation.value.trim() === '탈퇴' && !deleting.value && !isBot.value
)

function createSocialLinkRow(link?: Partial<UserSocialLink>): SocialLinkFormRow {
  socialLinkKey += 1
  return {
    key: `social-link-${socialLinkKey}`,
    id: link?.id ?? '',
    label: link?.label ?? '',
    url: link?.url ?? ''
  }
}

function normalizedProfileState() {
  return {
    handle: state.handle.trim(),
    gameUid: state.gameUid.trim(),
    gameInviteCode: state.gameInviteCode.trim(),
    socialLinks: state.socialLinks.map(link => ({
      label: link.label.trim(),
      url: link.url.trim()
    }))
  }
}

const isDirty = computed(() => Boolean(savedProfileSnapshot.value)
  && JSON.stringify(normalizedProfileState()) !== savedProfileSnapshot.value)

function applyProfile(profile: Pick<UserProfileDetails, 'handle' | 'gameUid' | 'gameInviteCode' | 'socialLinks'>): void {
  state.handle = profile.handle
  state.gameUid = profile.gameUid ?? ''
  state.gameInviteCode = profile.gameInviteCode ?? ''
  state.socialLinks = profile.socialLinks.map(link => createSocialLinkRow(link))
  savedProfileSnapshot.value = JSON.stringify(normalizedProfileState())
  clearValidationErrors()
}

function clearValidationErrors(): void {
  errors.handle = ''
  errors.gameUid = ''
  errors.gameInviteCode = ''
  errors.socialLinks = state.socialLinks.map(() => ({ label: '', url: '' }))
  serverError.value = ''
}

async function loadProfile(): Promise<void> {
  profileLoading.value = true
  profileLoadError.value = ''

  try {
    const profile = await $fetch<UserProfileDetails>('/api/profile')
    applyProfile(profile)
  } catch {
    profileLoadError.value = '프로필 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
  } finally {
    profileLoading.value = false
  }
}

onMounted(() => {
  if (user.value?.handle && !state.handle) {
    state.handle = user.value.handle
  }
  void loadProfile()
})

watch(deleteModalOpen, (open) => {
  if (!open) {
    deleteConfirmation.value = ''
    deleteError.value = ''
  }
})

function validate(): boolean {
  errors.handle = validateHandle(state.handle)
  errors.gameUid = validateGameUid(state.gameUid)
  errors.gameInviteCode = validateGameInviteCode(state.gameInviteCode)
  errors.socialLinks = state.socialLinks.map(link => validateSocialLink(link.label, link.url))

  return !errors.handle
    && !errors.gameUid
    && !errors.gameInviteCode
    && errors.socialLinks.every(error => !error.label && !error.url)
}

function addSocialLink(): void {
  if (state.socialLinks.length >= SOCIAL_LINK_MAX_COUNT) {
    return
  }

  state.socialLinks.push(createSocialLinkRow())
  errors.socialLinks.push({ label: '', url: '' })
}

function removeSocialLink(index: number): void {
  state.socialLinks.splice(index, 1)
  errors.socialLinks.splice(index, 1)
}

async function resetProfile(): Promise<void> {
  serverError.value = ''
  await loadProfile()
}

async function submit(): Promise<void> {
  serverError.value = ''

  if (profileLoading.value || profileLoadError.value || !validate() || !isDirty.value) {
    return
  }

  submitting.value = true

  try {
    const profile = await $fetch<UserProfileDetails>('/api/profile', {
      method: 'PATCH',
      body: {
        handle: state.handle.trim(),
        gameUid: state.gameUid.trim(),
        gameInviteCode: state.gameInviteCode.trim(),
        socialLinks: state.socialLinks.map(link => ({
          label: link.label.trim(),
          url: link.url.trim()
        }))
      }
    })

    applyProfile(profile)
    await fetchSession()

    showToast({
      id: 'setting-profile-saved',
      title: '프로필 정보를 저장했습니다.'
    })
  } catch (error: unknown) {
    if (getErrorStatus(error) === 409) {
      errors.handle = '이미 사용 중인 핸들이에요.'
    } else {
      serverError.value = '프로필 정보를 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.'
    }
  } finally {
    submitting.value = false
  }
}

async function deleteAccount(): Promise<void> {
  if (!canDeleteAccount.value) {
    return
  }

  deleting.value = true
  deleteError.value = ''

  try {
    await $fetch('/api/profile', { method: 'DELETE' })
    await fetchSession()
    deleteModalOpen.value = false

    showToast({
      id: 'setting-account-deleted',
      title: '계정 탈퇴가 완료되었습니다.'
    })

    await navigateTo('/')
  } catch {
    deleteError.value = '계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-3 md:px-5 py-5 pb-15">
    <div>
      <h1 class="text-2xl font-semibold text-default">
        설정
      </h1>
    </div>

    <div class="flex min-w-0 items-center gap-3">
      <div
        class="flex size-8 shrink-0 items-center justify-center rounded-full bg-inverted text-base font-semibold text-inverted"
      >
        {{ initial }}
      </div>
      <AppUserIdentity
        :handle="state.handle"
        :role="user?.role"
        :to="publicProfilePath"
        fallback="@handle"
        text-class="text-lg font-semibold text-default"
        icon-class="size-5"
        class="max-w-full flex-1 gap-2"
      />
    </div>

    <UCard
      :ui="{ header: 'px-5 py-4 sm:px-6', body: 'px-5 py-5 sm:px-6', footer: 'px-5 py-4 sm:px-6' }"
    >
      <template #header>
        <div>
          <h2 class="font-semibold text-default">
            사용자 설정
          </h2>
          <p class="mt-0.5 text-sm text-muted">
            공개 프로필에 표시할 사용자 정보를 관리합니다.
          </p>
        </div>
      </template>

      <UAlert
        v-if="profileLoadError"
        class="mb-5"
        color="error"
        variant="soft"
        :description="profileLoadError"
      >
        <template #actions>
          <UButton
            size="sm"
            color="error"
            variant="outline"
            @click="loadProfile"
          >
            다시 시도
          </UButton>
        </template>
      </UAlert>

      <UForm
        :state="state"
        class="space-y-5"
        @submit="submit"
      >
        <UFormField
          name="handle"
          label="핸들"
          description="영문과 숫자만 사용할 수 있는 고유 ID입니다."
          required
          :error="errors.handle || undefined"
        >
          <UInput
            v-model="state.handle"
            :maxlength="HANDLE_MAX_LENGTH"
            autocomplete="username"
            color="neutral"
            class="w-full"
            placeholder="handle"
            :disabled="profileLoading"
            :ui="{ base: 'h-8 leading-5 pl-7' }"
          >
            <template #leading>
              <span class="text-muted">@</span>
            </template>
          </UInput>
        </UFormField>

        <div class="grid gap-5 sm:grid-cols-2">
          <UFormField
            name="gameUid"
            label="게임 UID"
            description="프로필 - UID"
            :error="errors.gameUid || undefined"
          >
            <UInput
              :model-value="state.gameUid"
              :maxlength="GAME_PROFILE_VALUE_MAX_LENGTH"
              inputmode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              color="neutral"
              class="w-full"
              placeholder="UID"
              :disabled="profileLoading"
              :ui="{ base: 'h-8 leading-5' }"
              @update:model-value="state.gameUid = sanitizeGameUid($event)"
            />
          </UFormField>

          <UFormField
            name="gameInviteCode"
            label="게임 초대 코드"
            description="임무 - 초대 보상 - 나의 초대 코드"
            :error="errors.gameInviteCode || undefined"
          >
            <UInput
              :model-value="state.gameInviteCode"
              :maxlength="GAME_PROFILE_VALUE_MAX_LENGTH"
              pattern="[A-Za-z0-9]*"
              autocomplete="off"
              color="neutral"
              class="w-full"
              placeholder="초대 코드"
              :disabled="profileLoading"
              :ui="{ base: 'h-8 leading-5' }"
              @update:model-value="state.gameInviteCode = sanitizeGameInviteCode($event)"
            />
          </UFormField>
        </div>

        <div class="flex flex-col gap-3 border-t border-default pt-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-medium text-default">
                소셜미디어 링크
              </h3>
              <p class="mt-0.5 text-xs text-muted">
                최대 {{ SOCIAL_LINK_MAX_COUNT }}개까지 등록할 수 있습니다.
              </p>
            </div>
            <UButton
              type="button"
              icon="i-tabler-plus"
              color="neutral"
              variant="soft"
              size="sm"
              :disabled="profileLoading || state.socialLinks.length >= SOCIAL_LINK_MAX_COUNT"
              @click="addSocialLink"
            >
              링크 추가
            </UButton>
          </div>

          <div
            v-if="state.socialLinks.length"
            class="flex flex-col gap-3"
          >
            <div
              v-for="(link, index) in state.socialLinks"
              :key="link.key"
              class="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.6fr)_auto]"
            >
              <UFormField :error="errors.socialLinks[index]?.label || undefined">
                <UInput
                  v-model="link.label"
                  :maxlength="SOCIAL_LINK_LABEL_MAX_LENGTH"
                  color="neutral"
                  class="w-full"
                  placeholder="예: X, YouTube, GitHub"
                  :disabled="profileLoading"
                  :ui="{ base: 'h-8 leading-5' }"
                />
              </UFormField>

              <UFormField :error="errors.socialLinks[index]?.url || undefined">
                <UInput
                  v-model="link.url"
                  :maxlength="SOCIAL_LINK_URL_MAX_LENGTH"
                  type="url"
                  color="neutral"
                  class="w-full"
                  placeholder="https://..."
                  :disabled="profileLoading"
                  :ui="{ base: 'h-8 leading-5' }"
                />
              </UFormField>

              <UButton
                type="button"
                icon="i-tabler-trash"
                color="error"
                variant="ghost"
                class="self-start"
                aria-label="소셜 링크 삭제"
                :disabled="profileLoading"
                @click="removeSocialLink(index)"
              />
            </div>
          </div>

          <p
            v-else
            class="text-sm text-muted"
          >
            등록된 소셜미디어 링크가 없습니다.
          </p>
        </div>

        <UAlert
          v-if="serverError"
          color="error"
          variant="soft"
          :description="serverError"
        />

        <div class="flex justify-end gap-2 border-t border-default pt-5">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :disabled="profileLoading || Boolean(profileLoadError) || !isDirty || submitting"
            @click="resetProfile"
          >
            되돌리기
          </UButton>
          <UButton
            type="submit"
            color="neutral"
            variant="soft"
            :loading="submitting"
            :disabled="profileLoading || Boolean(profileLoadError) || !isDirty"
          >
            변경사항 저장
          </UButton>
        </div>
      </UForm>
    </UCard>

    <UCard :ui="{ header: 'px-5 py-4 sm:px-6', body: 'px-5 py-5 sm:px-6' }">
      <template #header>
        <div>
          <h2 class="font-semibold text-error">
            계정 탈퇴
          </h2>
          <p class="mt-0.5 text-sm text-muted">
            계정과 개인 정보를 영구적으로 삭제합니다.
          </p>
        </div>
      </template>

      <UButton
        color="error"
        variant="soft"
        icon="i-tabler-user-minus"
        class="shrink-0"
        :disabled="isBot"
        @click="deleteModalOpen = true"
      >
        계정 탈퇴
      </UButton>
    </UCard>

    <UModal
      v-model:open="deleteModalOpen"
      title="계정을 탈퇴하시겠습니까?"
      description="이 작업은 취소하거나 되돌릴 수 없습니다."
      :dismissible="!deleting"
      :close="!deleting"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <div class="space-y-4">
          <UAlert
            color="error"
            variant="soft"
            icon="i-tabler-alert-triangle"
            description="프로필과 소유한 용어집이 영구적으로 삭제됩니다. 번역 기록에서는 개인 정보가 제거됩니다."
          />

          <UFormField label="확인을 위해 ‘탈퇴’를 입력해 주세요.">
            <UInput
              v-model="deleteConfirmation"
              color="neutral"
              class="w-full"
              autocomplete="off"
              placeholder="탈퇴"
              :disabled="deleting"
              :ui="{ base: 'h-8 leading-5' }"
              @keydown.enter.prevent="deleteAccount"
            />
          </UFormField>

          <p
            v-if="deleteError"
            class="text-sm text-error"
          >
            {{ deleteError }}
          </p>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="deleting"
          @click="deleteModalOpen = false"
        >
          취소
        </UButton>
        <UButton
          color="error"
          variant="soft"
          :loading="deleting"
          :disabled="!canDeleteAccount"
          @click="deleteAccount"
        >
          계정 영구 삭제
        </UButton>
      </template>
    </UModal>
  </div>
</template>
