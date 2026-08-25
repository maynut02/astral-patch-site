<script setup lang="ts">
definePageMeta({
  middleware: async () => {
    const { ready, loggedIn, fetch } = useUserSession()

    if (!ready.value) {
      await fetch()
    }

    if (!loggedIn.value) {
      return navigateTo('/')
    }
  }
})

useHead({ title: '설정' })

const { user, fetch: fetchSession } = useUserSession()
const toast = useToast()

const state = reactive({
  handle: ''
})

const savedHandle = ref('')
const errors = reactive({
  handle: ''
})

const submitting = ref(false)
const serverError = ref('')
const deleteModalOpen = ref(false)
const deleteConfirmation = ref('')
const deleting = ref(false)
const deleteError = ref('')

const displayHandle = computed(() =>
  state.handle.trim() ? `@${state.handle.trim()}` : '@handle'
)

const publicProfilePath = computed(() =>
  state.handle.trim() ? `/@${encodeURIComponent(state.handle.trim())}` : '/'
)

const initial = computed(() =>
  Array.from(state.handle.trim() || 'U')[0]?.toLocaleUpperCase() ?? 'U'
)

const isDirty = computed(() => state.handle.trim() !== savedHandle.value)
const isBot = computed(() => String(user.value?.role || 'user') === 'bot')
const canDeleteAccount = computed(() =>
  deleteConfirmation.value.trim() === '탈퇴' && !deleting.value && !isBot.value
)

watch(user, (value) => {
  if (!value) {
    return
  }

  const handle = value.handle ?? ''
  state.handle = handle
  savedHandle.value = handle
}, { immediate: true })

watch(deleteModalOpen, (open) => {
  if (!open) {
    deleteConfirmation.value = ''
    deleteError.value = ''
  }
})

function textLength(value: string): number {
  return Array.from(value).length
}

function validate(): boolean {
  errors.handle = ''

  const handle = state.handle.trim()

  if (!handle) {
    errors.handle = '핸들을 입력해 주세요.'
  } else if (!/^[A-Za-z0-9]+$/.test(handle)) {
    errors.handle = '핸들은 영문과 숫자만 사용할 수 있어요.'
  } else if (textLength(handle) > 20) {
    errors.handle = '핸들은 20자 이내로 입력해 주세요.'
  }

  return !errors.handle
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  if ('status' in error && typeof error.status === 'number') {
    return error.status
  }

  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode
  }

  return undefined
}

function resetProfile(): void {
  state.handle = savedHandle.value
  errors.handle = ''
  serverError.value = ''
}

async function submit(): Promise<void> {
  serverError.value = ''

  if (!validate() || !isDirty.value) {
    return
  }

  submitting.value = true

  try {
    const profile = await $fetch<{ handle: string }>('/api/profile', {
      method: 'PATCH',
      body: {
        handle: state.handle.trim()
      }
    })

    savedHandle.value = profile.handle
    state.handle = profile.handle
    await fetchSession()

    toast.add({
      id: 'setting-handle-saved',
      title: '핸들을 저장했습니다.',
      icon: 'i-tabler-check',
      color: 'success',
      progress: false
    })
  } catch (error: unknown) {
    if (getErrorStatus(error) === 409) {
      errors.handle = '이미 사용 중인 핸들이에요.'
    } else {
      serverError.value = '핸들을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'
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

    toast.add({
      id: 'setting-account-deleted',
      title: '계정 탈퇴가 완료되었습니다.',
      icon: 'i-tabler-user-minus',
      color: 'neutral',
      progress: false
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
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-3 md:px-5 py-5">
    <div>
      <h1 class="text-2xl font-semibold text-default">
        설정
      </h1>
    </div>

    <UCard
      variant="soft"
      :ui="{ root: 'rounded-xl', body: 'p-5 sm:p-6' }"
    >
      <div class="flex min-w-0 items-center gap-4">
        <div
          class="flex size-14 shrink-0 items-center justify-center rounded-full bg-inverted text-lg font-semibold text-inverted"
        >
          {{ initial }}
        </div>
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <NuxtLink
            v-if="state.handle"
            :to="publicProfilePath"
            class="truncate text-lg font-semibold text-default hover:underline underline-offset-2"
            :class="hasUserRoleIcon(user?.role) ? '-mt-0.5' : ''"
          >
            {{ displayHandle }}
          </NuxtLink>
          <span
            v-else
            class="truncate text-lg font-semibold text-default"
            :class="hasUserRoleIcon(user?.role) ? '-mt-0.5' : ''"
          >{{ displayHandle }}</span>
          <AppUserRoleIcon
            :role="user?.role"
            icon-class="size-5"
          />
        </div>
      </div>
    </UCard>

    <UCard
      :ui="{ root: 'rounded-xl', header: 'px-5 py-4 sm:px-6', body: 'px-5 py-5 sm:px-6', footer: 'px-5 py-4 sm:px-6' }"
    >
      <template #header>
        <div>
          <h2 class="font-semibold text-default">
            사용자 설정
          </h2>
          <p class="mt-0.5 text-sm text-muted">
            공개 페이지와 서비스에서 표시되는 핸들입니다.
          </p>
        </div>
      </template>

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
            maxlength="20"
            autocomplete="username"
            color="neutral"
            class="w-full"
            placeholder="handle"
            :ui="{ base: 'pl-7' }"
          >
            <template #leading>
              <span class="text-muted">@</span>
            </template>
          </UInput>
        </UFormField>

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
            :disabled="!isDirty || submitting"
            @click="resetProfile"
          >
            되돌리기
          </UButton>
          <UButton
            type="submit"
            color="neutral"
            variant="soft"
            :loading="submitting"
            :disabled="!isDirty"
          >
            변경사항 저장
          </UButton>
        </div>
      </UForm>
    </UCard>

    <UCard :ui="{ root: 'rounded-xl', header: 'px-5 py-4 sm:px-6', body: 'px-5 py-5 sm:px-6' }">
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
