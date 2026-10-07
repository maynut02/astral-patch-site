<script setup lang="ts">
import type { ModEntry, ModSaveInput } from '#shared/types/mod'
import { MOD_PLATFORM_ITEMS } from '~/utils/mod'
import { getRequestErrorMessage } from '~/utils/request-error'

const platformItems = MOD_PLATFORM_ITEMS.map(({ label, value }) => ({ label, value }))
const props = defineProps<{ mod?: ModEntry | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [mod: ModEntry] }>()
const { loggedIn } = useUserSession()
const form = reactive<Pick<ModSaveInput, 'repository' | 'name' | 'platforms'>>({ name: '', repository: '', platforms: ['windows'] })
const submitting = ref(false)
const error = ref('')
const isEditing = computed(() => Boolean(props.mod))
const canSubmit = computed(() => loggedIn.value && Boolean(form.name.trim() && form.repository.trim() && form.platforms.length))

watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(form, props.mod
    ? { name: props.mod.name, repository: props.mod.repository, platforms: [...props.mod.platforms] }
    : { name: '', repository: '', platforms: ['windows'] })
  error.value = ''
})

async function save(): Promise<void> {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const mod = await $fetch<ModEntry>(props.mod ? `/api/mods/${props.mod.id}` : '/api/mods', {
      method: props.mod ? 'PATCH' : 'POST',
      body: { ...form }
    })
    open.value = false
    emit('saved', mod)
  } catch (cause) {
    error.value = getRequestErrorMessage(cause, '모드 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="isEditing ? '모드 정보 수정' : '모드 등록'"
    :dismissible="!submitting"
    :close="!submitting"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <form id="mod-editor-form" class="flex flex-col gap-5" @submit.prevent="save">
        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          :title="error"
        />

        <UFormField label="모드 이름" name="name" required>
          <UInput
            v-model="form.name"
            placeholder="모드 이름"
            class="w-full"
            color="neutral"
            variant="soft"
            :maxlength="120"
            :disabled="submitting"
            required
          />
        </UFormField>

        <UFormField
          label="GitHub 저장소 URL"
          name="repository"
          required
        >
          <UInput
            v-model="form.repository"
            placeholder="https://github.com/owner/repository"
            icon="i-tabler-brand-github"
            class="w-full"
            color="neutral"
            variant="soft"
            :maxlength="250"
            :disabled="submitting"
            required
          />
        </UFormField>

        <UFormField label="지원 플랫폼" name="platforms" required>
          <UCheckboxGroup
            v-model="form.platforms"
            :items="platformItems"
            orientation="horizontal"
            color="neutral"
            :disabled="submitting"
          />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="submitting"
          @click="open = false"
        >
          취소
        </UButton>
        <UButton
          type="submit"
          form="mod-editor-form"
          color="info"
          variant="soft"
          :loading="submitting"
          :disabled="!canSubmit"
        >
          {{ isEditing ? '저장' : '등록' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
