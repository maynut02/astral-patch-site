<script setup lang="ts">
import type {
  EditorBatchReviewResponse,
  EditorChangeKind,
  EditorReviewAction,
  EditorReviewCandidateGroup,
  EditorReviewCandidatesResponse,
  EditorTranslationLogEntry,
  EditorTranslationLogResponse
} from '#shared/types/editor'
import { createEditorDiffCache } from '~/utils/editor-diff-cache'
import { getEditorItemLocation } from '~/utils/editor-links'
import { getRequestErrorMessage } from '~/utils/request-error'
import { formatEditorDate } from '~/utils/editor-helpers'

definePageMeta({ middleware: 'reviewer' })
useAstralPageSeo('번역 승인')

function createEmptyReviewData(): EditorTranslationLogResponse {
  return { entries: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }
}

const getDiffParts = createEditorDiffCache()
const page = ref(1)
const reviewKind = ref<EditorChangeKind>('translation_edit')
const reviewingId = ref<string | null>(null)
const batchReviewAction = ref<EditorReviewAction | null>(null)
const isPreparingApproval = ref(false)
const preparingApprovalId = ref<string | null>(null)
const selectedIds = ref<Set<string>>(new Set())
const approvalModalOpen = ref(false)
const approvalGroups = ref<EditorReviewCandidateGroup[]>([])
const approvalSelections = ref<Record<string, string>>({})
const { showToast } = useAppToast()

const {
  data,
  status,
  error,
  refresh
} = await useFetch<EditorTranslationLogResponse>('/api/editor/review', {
  query: computed(() => ({ page: page.value, changeKind: reviewKind.value })),
  default: createEmptyReviewData
})

const entries = computed(() => data.value?.entries ?? [])
const reviewTabs = [
  { label: '번역 수정', value: 'translation_edit' },
  { label: '유지 확인', value: 'retain_confirmation' }
]
const currentReviewLabel = computed(() => reviewKind.value === 'retain_confirmation' ? '유지 확인' : '번역 수정')
const isReviewing = computed(() => Boolean(reviewingId.value || batchReviewAction.value || isPreparingApproval.value))
const selectedEntries = computed(() => entries.value.filter(entry => selectedIds.value.has(entry.id)))
const selectedCount = computed(() => selectedEntries.value.length)
const allPageSelected = computed(() => entries.value.length > 0 && selectedCount.value === entries.value.length)
const somePageSelected = computed(() => selectedCount.value > 0 && !allPageSelected.value)
const pageSelectionValue = computed<boolean | 'indeterminate'>(() => {
  if (allPageSelected.value) {
    return true
  }

  return somePageSelected.value ? 'indeterminate' : false
})
const approvalConflictGroups = computed(() => approvalGroups.value.filter(group => group.candidates.length > 1))
const approvalSelectionComplete = computed(() => approvalGroups.value.every((group) => {
  const selectedId = approvalSelections.value[group.unitId]
  return Boolean(selectedId && group.candidates.some(candidate => candidate.id === selectedId))
}))

watch(page, () => {
  selectedIds.value = new Set()
  resetApprovalDialog()
})

watch(entries, (currentEntries) => {
  const currentIds = new Set(currentEntries.map(entry => entry.id))
  selectedIds.value = new Set([...selectedIds.value].filter(id => currentIds.has(id)))
})

function updateEntrySelection(entryId: string, value: boolean | 'indeterminate'): void {
  const next = new Set(selectedIds.value)

  if (value === true) {
    next.add(entryId)
  } else {
    next.delete(entryId)
  }

  selectedIds.value = next
}

function updatePageSelection(value: boolean | 'indeterminate'): void {
  selectedIds.value = value === true
    ? new Set(entries.value.map(entry => entry.id))
    : new Set()
}

function updateReviewKind(value: string | number): void {
  if ((value !== 'translation_edit' && value !== 'retain_confirmation') || value === reviewKind.value) {
    return
  }

  page.value = 1
  selectedIds.value = new Set()
  resetApprovalDialog()
  reviewKind.value = value
}

function setApprovalSelection(unitId: string, value: unknown): void {
  if (typeof value !== 'string') {
    return
  }

  approvalSelections.value = {
    ...approvalSelections.value,
    [unitId]: value
  }
}

function resetApprovalDialog(): void {
  approvalModalOpen.value = false
  approvalGroups.value = []
  approvalSelections.value = {}
}

async function refreshAfterReview(): Promise<void> {
  await refresh()

  if (!entries.value.length && page.value > 1) {
    page.value -= 1
  }
}

async function executeSingleReview(entry: EditorTranslationLogEntry, action: EditorReviewAction): Promise<void> {
  reviewingId.value = entry.id

  try {
    await $fetch(`/api/editor/changes/${encodeURIComponent(entry.id)}`, {
      method: 'PATCH',
      body: { action }
    })

    showToast({
      id: `translation-review-${entry.id}`,
      title: action === 'approve' ? '번역을 승인했습니다.' : '번역을 반려했습니다.'
    })

    await refreshAfterReview()
  } catch (reviewError) {
    showToast({
      id: `translation-review-failed-${entry.id}`,
      title: '번역 검토를 처리하지 못했습니다.',
      description: getRequestErrorMessage(reviewError, undefined)
    })
  } finally {
    reviewingId.value = null
  }
}

async function review(entry: EditorTranslationLogEntry, action: EditorReviewAction): Promise<void> {
  if (isReviewing.value) {
    return
  }

  if (action === 'approve') {
    await prepareApproval([entry], new Set([entry.id]), entry.id)
    return
  }

  await executeSingleReview(entry, 'reject')
}

async function executeBatchReview(ids: string[], action: EditorReviewAction): Promise<void> {
  if (!ids.length) {
    return
  }

  batchReviewAction.value = action

  try {
    const response = await $fetch<EditorBatchReviewResponse>('/api/editor/changes/batch', {
      method: 'PATCH',
      body: { ids, action }
    })
    const successCount = response.results.filter(result => result.ok).length
    const failedCount = response.results.length - successCount

    showToast({
      id: `translation-batch-review-${action}`,
      title: action === 'approve'
        ? `${successCount.toLocaleString()}건의 번역을 승인했습니다.`
        : `${successCount.toLocaleString()}건의 번역을 반려했습니다.`,
      description: failedCount > 0
        ? `${failedCount.toLocaleString()}건은 처리하지 못했습니다.`
        : undefined
    })

    await refreshAfterReview()
  } catch (reviewError) {
    showToast({
      id: `translation-batch-review-failed-${action}`,
      title: '선택한 번역을 처리하지 못했습니다.',
      description: getRequestErrorMessage(reviewError, undefined)
    })
  } finally {
    batchReviewAction.value = null
  }
}

async function prepareApproval(
  requestedEntries: EditorTranslationLogEntry[],
  preselectedIds: Set<string>,
  singleEntryId: string | null = null
): Promise<void> {
  if (!requestedEntries.length) {
    return
  }

  isPreparingApproval.value = true
  preparingApprovalId.value = singleEntryId

  try {
    const unitIds = [...new Set(requestedEntries.map(entry => entry.unitId))]
    const response = await $fetch<EditorReviewCandidatesResponse>('/api/editor/review/candidates', {
      method: 'POST',
      body: { unitIds }
    })
    const groupsByUnitId = new Map(response.groups.map(group => [group.unitId, group]))
    const groups = unitIds
      .map(unitId => groupsByUnitId.get(unitId))
      .filter((group): group is EditorReviewCandidateGroup => Boolean(group))

    if (groups.length !== unitIds.length) {
      showToast({
        id: 'translation-batch-review-stale',
        title: '승인 대기 목록이 변경되었습니다.',
        description: '목록을 새로 불러온 뒤 다시 선택해 주세요.'
      })
      await refreshAfterReview()
      return
    }

    const selections: Record<string, string> = {}

    for (const group of groups) {
      const selectedCandidates = group.candidates.filter(candidate => preselectedIds.has(candidate.id))
      if (!selectedCandidates.length) {
        showToast({
          id: 'translation-batch-review-stale',
          title: '승인 대기 목록이 변경되었습니다.',
          description: '목록을 새로 불러온 뒤 다시 선택해 주세요.'
        })
        await refreshAfterReview()
        return
      }

      if (group.candidates.length === 1) {
        const first = group.candidates[0]
        if (first) selections[group.unitId] = first.id
      } else if (selectedCandidates.length === 1) {
        const first = selectedCandidates[0]
        if (first) selections[group.unitId] = first.id
      }
    }

    if (groups.every(group => group.candidates.length === 1)) {
      if (requestedEntries.length === 1) {
        const first = requestedEntries[0]
        if (first) await executeSingleReview(first, 'approve')
      } else {
        await executeBatchReview(groups.flatMap((group) => {
          const first = group.candidates[0]
          return first ? [first.id] : []
        }), 'approve')
      }
      return
    }

    approvalGroups.value = groups
    approvalSelections.value = selections
    approvalModalOpen.value = true
  } catch (reviewError) {
    showToast({
      id: 'translation-batch-review-candidates-failed',
      title: '승인 후보를 불러오지 못했습니다.',
      description: getRequestErrorMessage(reviewError, undefined)
    })
  } finally {
    isPreparingApproval.value = false
    preparingApprovalId.value = null
  }
}

async function prepareSelectedApproval(): Promise<void> {
  await prepareApproval(selectedEntries.value, new Set(selectedEntries.value.map(entry => entry.id)))
}

async function reviewSelected(action: EditorReviewAction): Promise<void> {
  if (isReviewing.value || !selectedCount.value) {
    return
  }

  if (action === 'approve') {
    await prepareSelectedApproval()
    return
  }

  await executeBatchReview(selectedEntries.value.map(entry => entry.id), 'reject')
}

async function confirmApprovalSelection(): Promise<void> {
  if (!approvalSelectionComplete.value || isReviewing.value) {
    return
  }

  const ids = approvalGroups.value.flatMap((group) => {
    const id = approvalSelections.value[group.unitId]
    return id ? [id] : []
  })
  approvalModalOpen.value = false
  await executeBatchReview(ids, 'approve')
  resetApprovalDialog()
}
</script>

<template>
  <section class="mx-auto flex w-full max-w-400 flex-col gap-5">
    <header class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-tabler-checkup-list"
            class="size-5 text-muted"
          />
          <h1 class="text-xl font-semibold text-default">
            번역 승인
          </h1>
        </div>
      </div>

      <UBadge
        color="warning"
        variant="soft"
        size="md"
        class="w-fit shrink-0"
      >
        {{ currentReviewLabel }} 승인 대기 {{ (data?.total ?? 0).toLocaleString() }}건
      </UBadge>
    </header>

    <UTabs
      :model-value="reviewKind"
      :items="reviewTabs"
      :content="false"
      color="neutral"
      size="sm"
      :ui="{ trigger: 'h-7 leading-4 px-3', list: 'h-9 bg-elevated/50 p-1' }"
      class="w-fit"
      @update:model-value="updateReviewKind"
    />

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="승인 대기 목록을 불러오지 못했습니다."
      description="잠시 후 다시 시도해 주세요."
    >
      <template #actions>
        <UButton
          color="error"
          variant="outline"
          size="sm"
          @click="refresh()"
        >
          다시 시도
        </UButton>
      </template>
    </UAlert>

    <div
      v-if="status === 'pending' && !entries.length"
      class="flex flex-col gap-4"
    >
      <div
        v-for="index in 5"
        :key="index"
        class="flex flex-col gap-3 border border-default p-4"
      >
        <USkeleton class="h-5 w-1/3" />
        <USkeleton class="h-16 w-full" />
        <USkeleton class="h-4 w-1/4" />
      </div>
    </div>

    <UAlert
      v-else-if="!error && !entries.length"
      color="neutral"
      variant="soft"
      icon="i-tabler-circle-check"
      :title="reviewKind === 'retain_confirmation' ? '승인 대기 중인 유지 확인 요청이 없습니다.' : '승인 대기 중인 번역 수정이 없습니다.'"
      :description="reviewKind === 'retain_confirmation' ? '현재 번역을 그대로 유지할지 검토할 항목이 없습니다.' : '현재 검토가 필요한 실제 번역 수정 제안이 없습니다.'"
    />

    <div
      v-else-if="!error"
      class="flex flex-col gap-4"
    >
      <div class="flex flex-col gap-3 border border-default bg-elevated/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2">
          <UCheckbox
            :model-value="pageSelectionValue"
            color="neutral"
            :disabled="isReviewing"
            aria-label="현재 페이지의 모든 번역 선택"
            @update:model-value="updatePageSelection"
          />
          <span class="text-sm text-toned">현재 페이지 전체 선택</span>
          <span class="text-xs text-muted">
            {{ selectedCount.toLocaleString() }} / {{ entries.length.toLocaleString() }}
          </span>
        </div>

        <div class="flex flex-wrap gap-2">
          <UButton
            icon="i-tabler-x"
            color="error"
            variant="soft"
            size="md"
            :loading="batchReviewAction === 'reject'"
            :disabled="!selectedCount || isReviewing"
            @click="reviewSelected('reject')"
          >
            선택 반려
          </UButton>
          <UButton
            icon="i-tabler-check"
            color="success"
            variant="soft"
            size="md"
            :loading="batchReviewAction === 'approve' || isPreparingApproval"
            :disabled="!selectedCount || isReviewing"
            @click="reviewSelected('approve')"
          >
            선택 승인
          </UButton>
        </div>
      </div>

      <article
        v-for="entry in entries"
        :key="entry.id"
        class="flex flex-col border border-default"
        :class="selectedIds.has(entry.id) ? 'bg-elevated' : 'bg-muted'"
      >
        <header class="flex flex-wrap items-center gap-2 border-b border-default px-4 py-3">
          <UCheckbox
            :model-value="selectedIds.has(entry.id)"
            color="neutral"
            :disabled="isReviewing"
            :aria-label="`${entry.category}_${entry.unitKey} 선택`"
            class="mr-1 shrink-0"
            @update:model-value="updateEntrySelection(entry.id, $event)"
          />
          <UBadge
            color="warning"
            variant="soft"
            size="sm"
          >
            승인 대기
          </UBadge>
          <UBadge
            :color="entry.changeKind === 'retain_confirmation' ? 'neutral' : 'info'"
            variant="soft"
            size="sm"
          >
            {{ entry.changeKind === 'retain_confirmation' ? '유지 확인' : '번역 수정' }}
          </UBadge>
          <UBadge
            v-if="(entry.pendingCandidateCount ?? 0) > 1"
            color="warning"
            variant="outline"
            size="sm"
          >
            다른 승인 대기 요청 {{ (entry.pendingCandidateCount ?? 1) - 1 }}건
          </UBadge>
          <div class="flex flex-1">
            <NuxtLink
              :to="getEditorItemLocation(entry)"
              class="min-w-0 truncate text-sm font-medium text-default hover:underline underline-offset-2"
            >
              {{ entry.category }}_{{ entry.unitKey }}
            </NuxtLink>
          </div>
          <time
            class="shrink-0 text-xs text-muted"
            :datetime="entry.createdAt"
          >
            {{ formatEditorDate(entry.createdAt) }}
          </time>
        </header>

        <div class="flex flex-col gap-1.5">
          <div
            v-if="entry.changeKind === 'retain_confirmation'"
            class="flex flex-col gap-2 bg-default/75 p-4"
          >
            <p class="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-toned">
              {{ entry.proposedText }}
            </p>
          </div>
          <p
            v-else
            class="whitespace-pre-wrap wrap-break-word bg-default/75 p-4 text-sm leading-6 text-toned"
          >
            <EditorDiffText :parts="getDiffParts(entry)" side="unified" />
            <span v-if="!entry.previousText && !entry.proposedText">빈 문자열</span>
          </p>
        </div>

        <div class="flex flex-col gap-4 px-4 py-3">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-center gap-2 text-xs text-muted">
              <UIcon
                name="i-tabler-git-pull-request"
                class="size-3.5 shrink-0"
              />
              <AppUserIdentity
                :handle="entry.handle"
                :role="entry.actorRole"
                fallback="익명"
                text-class="text-xs"
                icon-class="size-3.5"
              />
            </div>

            <div class="flex flex-wrap justify-end gap-2">
              <UButton
                :to="getEditorItemLocation(entry)"
                icon="i-tabler-external-link"
                color="neutral"
                variant="soft"
                size="md"
              >
                에디터에서 확인
              </UButton>
              <UButton
                icon="i-tabler-x"
                color="error"
                variant="soft"
                size="md"
                :loading="reviewingId === entry.id"
                :disabled="isReviewing"
                @click="review(entry, 'reject')"
              >
                반려
              </UButton>
              <UButton
                icon="i-tabler-check"
                color="success"
                variant="soft"
                size="md"
                :loading="reviewingId === entry.id || preparingApprovalId === entry.id"
                :disabled="isReviewing"
                @click="review(entry, 'approve')"
              >
                승인
              </UButton>
            </div>
          </div>
        </div>
      </article>
    </div>

    <div
      v-if="!error && (data?.totalPages ?? 1) > 1"
      class="flex justify-center border-t border-default pt-5"
    >
      <UPagination
        v-model:page="page"
        :total="data?.total ?? 0"
        :items-per-page="data?.pageSize ?? 50"
        color="neutral"
      />
    </div>

    <EditorReviewApprovalModal
      v-model:open="approvalModalOpen"
      :groups="approvalConflictGroups"
      :selections="approvalSelections"
      :selection-complete="approvalSelectionComplete"
      :busy="isReviewing"
      :loading="batchReviewAction === 'approve'"
      @select="setApprovalSelection"
      @confirm="confirmApprovalSelection"
    />
  </section>
</template>
