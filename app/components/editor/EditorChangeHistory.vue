<script setup lang="ts">
import type {
  EditorDiffMode,
  EditorHistoryEntry,
  EditorHistoryResponse
} from '#shared/types/editor'
import { isReviewerRole } from '#shared/types/user'

const props = defineProps<{
  itemId: string | null
  itemKey: string
  itemStatusLabel: string
  itemStatusColor: string
  reloadKey: number
  diffMode: EditorDiffMode
}>()

const emit = defineEmits<{
  changed: []
}>()

const entries = ref<EditorHistoryEntry[]>([])
const status = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const reviewingId = ref<string | null>(null)
const reviewError = ref('')
const historyRequestId = ref(0)
const { user } = useUserSession()
const canReview = computed(() => isReviewerRole(user.value?.role))

async function loadHistory(): Promise<void> {
  const requestId = ++historyRequestId.value

  if (!props.itemId) {
    entries.value = []
    status.value = 'idle'
    reviewError.value = ''
    return
  }

  status.value = 'pending'
  reviewError.value = ''

  try {
    const response = await $fetch<EditorHistoryResponse>(
      `/api/editor/items/${encodeURIComponent(props.itemId)}/history`
    )

    if (requestId !== historyRequestId.value) {
      return
    }

    entries.value = response.entries
    status.value = 'success'
  } catch {
    if (requestId !== historyRequestId.value) {
      return
    }

    entries.value = []
    status.value = 'error'
  }
}

function getReviewId(entry: EditorHistoryEntry): string {
  return entry.id.replace(/:translation$/, '')
}

async function reviewEntry(entry: EditorHistoryEntry, action: 'approve' | 'reject'): Promise<void> {
  if (!canReview.value || entry.action !== 'translation_changed' || entry.status !== 'pending' || reviewingId.value) {
    return
  }

  reviewingId.value = getReviewId(entry)
  reviewError.value = ''

  try {
    await $fetch(`/api/editor/changes/${encodeURIComponent(reviewingId.value)}`, {
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
  <div class="flex h-full min-h-0 flex-col">
    <div class="shrink-0 p-4">
      <div class="flex min-w-0 items-center gap-2">
        <h2
          class="min-w-0 flex-1 truncate text-sm font-medium text-toned"
          :title="itemKey"
        >
          {{ itemKey || '' }}
        </h2>
        <span
          v-if="itemStatusLabel"
          class="shrink-0 text-xs font-medium"
          :class="itemStatusColor"
        >
          {{ itemStatusLabel }}
        </span>
      </div>
    </div>

    <div class="editor-scrollbar min-h-0 flex-1 overflow-y-auto pb-4">
      <div
        v-if="!itemId"
        class="flex h-full items-center justify-center text-center text-sm text-muted"
      >
        <div>
          <UIcon
            name="i-tabler-click"
            class="mx-auto size-6 text-dimmed"
          />
          <p class="mt-2">
            변경 기록을 확인할 항목을 선택하세요.
          </p>
        </div>
      </div>

      <div
        v-else-if="status === 'pending'"
        class="flex items-center justify-center p-5 text-muted"
      >
        <AppLoadingSpinner />
      </div>

      <UAlert
        v-else-if="status === 'error'"
        color="error"
        variant="soft"
        title="변경 기록을 불러오지 못했습니다."
        description="잠시 후 다시 시도해 주세요."
      />

      <UAlert
        v-else-if="!entries.length"
        color="neutral"
        variant="soft"
        icon="i-tabler-history-off"
        title="변경 기록이 없습니다."
        description="아직 저장된 변경 내역이 없습니다."
      />

      <div
        v-else
        class="flex flex-col"
      >
        <UAlert
          v-if="reviewError"
          color="error"
          variant="soft"
          title="검토에 실패했습니다."
          :description="reviewError"
          class="mb-4"
        />

        <EditorHistoryEntry
          v-for="(entry, index) in entries"
          :key="entry.id"
          :entry="entry"
          :is-last="index === entries.length - 1"
          :diff-mode="diffMode"
          :can-review="canReview"
          :reviewing-id="reviewingId"
          @review="reviewEntry"
        />
      </div>
    </div>
  </div>
</template>
