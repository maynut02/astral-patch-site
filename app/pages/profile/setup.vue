<script setup lang="ts">
const { user, fetch: fetchSession } = useUserSession()

const state = reactive({
  handle: user.value?.handle ?? '',
  nickname: user.value?.nickname ?? ''
})

const errors = reactive({
  handle: '',
  nickname: ''
})

const submitting = ref(false)
const serverError = ref('')

function textLength(value: string): number {
  return Array.from(value).length
}

function validate() {
  errors.handle = ''
  errors.nickname = ''

  const handle = state.handle.trim()
  const nickname = state.nickname.trim()

  if (!handle) {
    errors.handle = '핸들을 입력해 주세요.'
  } else if (!/^[A-Za-z0-9]+$/.test(handle)) {
    errors.handle = '핸들은 영문과 숫자만 사용할 수 있어요.'
  } else if (textLength(handle) > 20) {
    errors.handle = '핸들은 20자 이내로 입력해 주세요.'
  }

  if (!nickname) {
    errors.nickname = '닉네임을 입력해 주세요.'
  } else if (textLength(nickname) > 20) {
    errors.nickname = '닉네임은 20자 이내로 입력해 주세요.'
  }

  return !errors.handle && !errors.nickname
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

async function submit() {
  serverError.value = ''

  if (!validate()) {
    return
  }

  submitting.value = true

  try {
    await $fetch('/api/profile', {
      method: 'PATCH',
      body: {
        handle: state.handle.trim(),
        nickname: state.nickname.trim()
      }
    })

    await fetchSession()
    await navigateTo('/')
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
  <div class="flex flex-1 items-center justify-center px-4 py-12">
    <UPageCard class="w-full max-w-md" title="프로필 설정" :ui="{ root: 'rounded-xl' }">
      <UForm :state="state" class="space-y-5" @submit="submit">
        <UFormField name="handle" label="핸들" description="영문과 숫자만 사용할 수 있습니다." required
          :error="errors.handle || undefined">
          <UInput v-model="state.handle" maxlength="20" placeholder="이곳에 핸들을 입력" autocomplete="username" color="neutral"
            class="w-full" :ui="{ base: 'rounded-xl px-3 pl-7' }">
            <template #leading>
              <p class="mb-0.5">
                @
              </p>
            </template>
          </UInput>
        </UFormField>

        <UFormField name="nickname" label="닉네임" description="최대 20자까지 입력할 수 있습니다." required
          :error="errors.nickname || undefined">
          <UInput v-model="state.nickname" maxlength="20" placeholder="이곳에 닉네임을 입력" autocomplete="nickname"
            color="neutral" class="w-full" :ui="{ base: 'rounded-xl px-3' }" />
        </UFormField>

        <UAlert v-if="serverError" color="error" variant="soft" :description="serverError" />

        <UButton type="submit" block :loading="submitting" color="neutral" variant="soft" class="rounded-xl">
          저장하고 시작하기
        </UButton>
      </UForm>
    </UPageCard>
  </div>
</template>
