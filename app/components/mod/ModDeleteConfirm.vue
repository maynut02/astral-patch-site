<script setup lang="ts">
import type { ModDeleteResponse, ModEntry } from '#shared/types/mod'

const props = defineProps<{ mod?: ModEntry | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ deleted: [id: string] }>()
const { loggedIn, user } = useUserSession()
const target = ref<{ id: string, name: string, userId: string } | null>(null)
const submitting = ref(false)
const error = ref('')
const canDelete = computed(() => loggedIn.value && Boolean(user.value?.id && props.mod?.canDelete))
let requestVersion = 0
let controller: AbortController | null = null

function reset(): void {
  requestVersion++
  controller?.abort()
  controller = null
  submitting.value = false
  error.value = ''
  target.value = null
}

watch(open, (isOpen) => {
  reset()
  if (!isOpen) return
  if (!canDelete.value || !props.mod || !user.value?.id) {
    open.value = false
    return
  }
  target.value = { id: props.mod.id, name: props.mod.name, userId: user.value.id }
}, { immediate: true, flush: 'sync' })

watch([
  () => props.mod?.id,
  () => props.mod?.canDelete,
  () => user.value?.id,
  () => user.value?.role,
  loggedIn
], () => {
  reset()
  open.value = false
}, { flush: 'sync' })

onScopeDispose(reset)

async function confirmDelete(): Promise<void> {
  const requestedTarget = target.value
  if (!open.value || !requestedTarget || !canDelete.value || submitting.value) return
  const version = ++requestVersion
  const requestController = new AbortController()
  controller = requestController
  submitting.value = true
  error.value = ''
  const isCurrent = () => version === requestVersion
    && open.value
    && canDelete.value
    && props.mod?.id === requestedTarget.id
    && user.value?.id === requestedTarget.userId

  try {
    const response = await $fetch<ModDeleteResponse>(`/api/mods/${encodeURIComponent(requestedTarget.id)}`, {
      method: 'DELETE',
      signal: requestController.signal
    })
    if (!isCurrent()) return
    if (response.id !== requestedTarget.id || response.deleted !== true) throw new Error('Invalid delete response')
    open.value = false
    emit('deleted', requestedTarget.id)
  } catch {
    if (isCurrent()) error.value = '모드를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  } finally {
    if (version === requestVersion) {
      submitting.value = false
      controller = null
    }
  }
}

function cancel(): void {
  if (!submitting.value) open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="모드 삭제"
    :dismissible="!submitting"
    :close="!submitting"
    :ui="{ footer: 'justify-end' }"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="wrap-break-word text-sm">
          <strong>{{ target?.name }}</strong> 모드를 삭제할까요? 삭제한 등록 정보는 복구할 수 없습니다.
        </p>
        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          :title="error"
        />
      </div>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="submitting"
        @click="cancel"
      >
        취소
      </UButton>
      <UButton
        color="error"
        variant="soft"
        :loading="submitting"
        :disabled="submitting || !canDelete || !target"
        @click="confirmDelete"
      >
        {{ error ? '다시 시도' : '삭제' }}
      </UButton>
    </template>
  </UModal>
</template>
