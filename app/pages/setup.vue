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

useHead({ title: '초기 설정' })

const { user, fetch: fetchSession } = useUserSession()

const state = reactive({
  handle: ''
})

const errors = reactive({
  handle: ''
})

const submitting = ref(false)
const serverError = ref('')

watch(user, (value) => {
  if (value) {
    state.handle = value.handle ?? ''
  }
}, { immediate: true })

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

async function submit(): Promise<void> {
  serverError.value = ''

  if (!validate()) {
    return
  }

  submitting.value = true

  try {
    await $fetch('/api/profile', {
      method: 'PATCH',
      body: {
        handle: state.handle.trim()
      }
    })

    await fetchSession()
    await navigateTo('/auth/continue', { external: true })
  } catch (error: unknown) {
    if (getErrorStatus(error) === 409) {
      errors.handle = '이미 사용 중인 핸들이에요.'
    } else {
      serverError.value = '프로필을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex flex-1 items-center justify-center p-3 md:p-5">
    <UPageCard variant="naked" class="w-full max-w-md" title="프로필 설정">
      <UForm :state="state" class="space-y-5" @submit="submit">
        <UFormField name="handle" label="핸들" description="영문과 숫자만 사용할 수 있습니다." required
          :error="errors.handle || undefined">
          <UInput v-model="state.handle" maxlength="20" placeholder="이곳에 핸들을 입력" autocomplete="username" color="neutral"
            class="w-full" :ui="{ base: 'px-3 pl-7' }">
            <template #leading>
              <span class="text-muted">@</span>
            </template>
          </UInput>
        </UFormField>

        <UAlert v-if="serverError" color="error" variant="soft" :description="serverError" />

        <UButton type="submit" block :loading="submitting" color="neutral" variant="soft" class="py-2">
          저장하고 시작하기
        </UButton>
      </UForm>
    </UPageCard>
  </div>
</template>
