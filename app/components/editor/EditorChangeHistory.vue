<script setup lang="ts">
import type { EditorChangeStatus, EditorHistoryEntry, EditorHistoryResponse } from '#shared/types/editor'

const props = defineProps<{
  itemId: string | null
  reloadKey: number
}>()

const emit = defineEmits<{
  changed: []
}>()

const entries = ref<EditorHistoryEntry[]>([])
const status = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const reviewingId = ref<string | null>(null)
const reviewError = ref('')
const { user } = useUserSession()
const canReview = computed(() => user.value?.role === 'admin')

const statusLabels: Record<EditorChangeStatus, string> = {
  pending: '승인 대기',
  approved: '승인됨',
  rejected: '반려됨',
  superseded: '대체됨'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

async function loadHistory() {
  if (!props.itemId) {
    entries.value = []
    status.value = 'idle'
    reviewError.value = ''
    return
  }

  status.value = 'pending'
  reviewError.value = ''

  try {
    const response = await $fetch<EditorHistoryResponse>(`/api/editor/items/${props.itemId}/history`)
    entries.value = response.entries
    status.value = 'success'
  } catch {
    entries.value = []
    status.value = 'error'
  }
}

async function reviewEntry(entry: EditorHistoryEntry, action: 'approve' | 'reject') {
  if (!canReview.value || entry.status !== 'pending' || reviewingId.value) {
    return
  }

  reviewingId.value = entry.id
  reviewError.value = ''

  try {
    await $fetch(`/api/editor/changes/${entry.id}`, {
      method: 'PATCH',
      body: { action }
    })
    await loadHistory()
    emit('changed')
  } catch {
    reviewError.value = '변경 사항을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  } finally {
    reviewingId.value = null
  }
}

watch([() => props.itemId, () => props.reloadKey], loadHistory, { immediate: true })
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex-1 overflow-y-auto p-4">
      <div v-if="status === 'pending'" class="flex flex-col gap-3">
        <USkeleton v-for="index in 3" :key="index" class="h-32 w-full rounded-xl" />
      </div>

      <UAlert v-else-if="status === 'error'" color="error" variant="soft" title="변경 기록을 불러오지 못했습니다."
        description="잠시 후 다시 시도해 주세요." />

      <UAlert v-else-if="!entries.length" color="neutral" variant="soft" icon="i-tabler-history-off"
        title="변경 기록이 없습니다." description="아직 저장된 번역 수정 내역이 없습니다." />

      <div v-else class="flex flex-col gap-4">
        <UAlert v-if="reviewError" color="error" variant="soft" title="검토에 실패했습니다." :description="reviewError" />

        <article v-for="entry in entries" :key="entry.id" class="">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-sm">
              <span class="font-semibold">{{ entry.nickname }}</span>
              <span class="text-muted">{{ formatDate(entry.createdAt) }}</span>
            </div>
            <UBadge color="neutral" variant="soft">
              {{ statusLabels[entry.status] }}
            </UBadge>
          </div>

          <div class="mt-4 grid gap-3 text-sm">
            <div>
              <p class="mb-1 text-xs font-medium text-muted">수정 전</p>
              <p class="whitespace-pre-wrap wrap-break-word rounded-lg bg-muted p-3">
                {{ entry.previousText || '미번역' }}
              </p>
            </div>
            <div>
              <p class="mb-1 text-xs font-medium text-muted">수정 후</p>
              <p class="whitespace-pre-wrap wrap-break-word rounded-lg bg-muted p-3">
                {{ entry.proposedText }}
              </p>
            </div>
          </div>

          <div v-if="canReview && entry.status === 'pending'" class="mt-4 flex justify-end gap-2">
            <UButton color="error" variant="soft" size="sm" :loading="reviewingId === entry.id"
              :disabled="Boolean(reviewingId)" @click="reviewEntry(entry, 'reject')">
              반려
            </UButton>
            <UButton color="success" variant="soft" size="sm" :loading="reviewingId === entry.id"
              :disabled="Boolean(reviewingId)" @click="reviewEntry(entry, 'approve')">
              승인
            </UButton>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>
