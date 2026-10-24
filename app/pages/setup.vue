<script setup lang="ts">
import { GAME_PROFILE_VALUE_MAX_LENGTH, HANDLE_MAX_LENGTH } from '#shared/types/profile'
import { sanitizeGameInviteCode, sanitizeGameUid } from '~/utils/profile'
import { useProfileForm } from '~/composables/use-profile-form'

definePageMeta({ middleware: 'setup-required' })

useAstralPageSeo('초기 설정')

const { user, fetch: fetchSession } = useUserSession()

const profileForm = useProfileForm()
const { state, errors, submitting, serverError } = profileForm

watch(user, (value) => {
  if (value) {
    state.handle = value.handle ?? ''
  }
}, { immediate: true })

async function submit(): Promise<void> {
  await profileForm.submit({
    validate: profileForm.validate,
    body: profileForm.normalizedState,
    onSaved: async () => {
      await fetchSession()
      await navigateTo('/auth/continue', { external: true })
    },
    failureMessage: '프로필을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
  })
}
</script>

<template>
  <div class="flex flex-1 items-center justify-center">
    <UPageCard
      variant="naked"
      class="w-full max-w-lg"
      title="프로필 설정"
    >
      <UForm
        :state="state"
        class="space-y-5"
        @submit="submit"
      >
        <UFormField
          name="handle"
          label="핸들"
          description="영문과 숫자만 사용할 수 있습니다."
          required
          :error="errors.handle || undefined"
        >
          <UInput
            v-model="state.handle"
            :maxlength="HANDLE_MAX_LENGTH"
            placeholder="이곳에 핸들을 입력"
            autocomplete="username"
            color="neutral"
            class="w-full"
            :ui="{ base: 'h-8 leading-5 px-3 pl-7' }"
          >
            <template #leading>
              <span class="text-muted">@</span>
            </template>
          </UInput>
        </UFormField>

        <div class="grid gap-5 sm:grid-cols-2">
          <UFormField
            name="gameUid"
            label="게임 UID(선택)"
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
              :ui="{ base: 'h-8 leading-5' }"
              @update:model-value="state.gameUid = sanitizeGameUid($event)"
            />
          </UFormField>

          <UFormField
            name="gameInviteCode"
            label="게임 초대 코드(선택)"
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
              :ui="{ base: 'h-8 leading-5' }"
              @update:model-value="state.gameInviteCode = sanitizeGameInviteCode($event)"
            />
          </UFormField>
        </div>

        <UAlert
          v-if="serverError"
          color="error"
          variant="soft"
          :description="serverError"
        />

        <UButton
          type="submit"
          block
          :loading="submitting"
          color="neutral"
          variant="soft"
          class="py-2.5 md:py-2"
        >
          저장하고 시작하기
        </UButton>
      </UForm>
    </UPageCard>
  </div>
</template>
