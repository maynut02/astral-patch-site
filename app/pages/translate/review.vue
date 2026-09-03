<script setup lang="ts">
import type {
  EditorBatchReviewResponse,
  EditorReviewAction,
  EditorReviewCandidateGroup,
  EditorReviewCandidatesResponse,
  EditorTranslationLogEntry,
  EditorTranslationLogResponse
} from '#shared/types/editor'
import { getEditorDiffParts } from '~/utils/editor-diff'
import { formatEditorDate } from '~/utils/editor-helpers'

definePageMeta({ middleware: 'reviewer' })
useAstralPageSeo('번역 승인')

const defaultData: EditorTranslationLogResponse = {
  entries: [],
  total: 0,
  page: 1,
  pageSize: 50,
  totalPages: 1
}

const page = ref(1)
const reviewingId = ref<string | null>(null)
const batchReviewAction = ref<EditorReviewAction | null>(null)
const isPreparingApproval = ref(false)
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
  query: computed(() => ({ page: page.value })),
  default: () => defaultData
})

const entries = computed(() => data.value?.entries ?? [])
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

async function review(entry: EditorTranslationLogEntry, action: EditorReviewAction): Promise<void> {
  if (isReviewing.value) {
    return
  }

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
      description: reviewError instanceof Error ? reviewError.message : undefined
    })
  } finally {
    reviewingId.value = null
  }
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
      description: reviewError instanceof Error ? reviewError.message : undefined
    })
  } finally {
    batchReviewAction.value = null
  }
}

async function prepareSelectedApproval(): Promise<void> {
  const currentSelection = selectedEntries.value
  if (!currentSelection.length) {
    return
  }

  isPreparingApproval.value = true

  try {
    const unitIds = [...new Set(currentSelection.map(entry => entry.unitId))]
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
      const selectedCandidates = group.candidates.filter(candidate => selectedIds.value.has(candidate.id))
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
        selections[group.unitId] = group.candidates[0]!.id
      } else if (selectedCandidates.length === 1) {
        selections[group.unitId] = selectedCandidates[0]!.id
      }
    }

    if (groups.every(group => group.candidates.length === 1)) {
      await executeBatchReview(groups.map(group => group.candidates[0]!.id), 'approve')
      return
    }

    approvalGroups.value = groups
    approvalSelections.value = selections
    approvalModalOpen.value = true
  } catch (reviewError) {
    showToast({
      id: 'translation-batch-review-candidates-failed',
      title: '승인 후보를 불러오지 못했습니다.',
      description: reviewError instanceof Error ? reviewError.message : undefined
    })
  } finally {
    isPreparingApproval.value = false
  }
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

  const ids = approvalGroups.value.map(group => approvalSelections.value[group.unitId]!)
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
        승인 대기 {{ (data?.total ?? 0).toLocaleString() }}건
      </UBadge>
    </header>

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
      title="승인 대기 중인 번역이 없습니다."
      description="현재 검토가 필요한 번역 제안이 모두 처리되었습니다."
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
          <div class="flex flex-1">
            <NuxtLink
              :to="{
                path: '/translate/editor',
                query: {
                  file: entry.category,
                  search: `${entry.category}_${entry.unitKey}`,
                  searchType: 'key',
                  match: 'exact',
                  page: '1'
                }
              }"
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
          <p class="whitespace-pre-wrap wrap-break-word bg-default/75 p-4 text-sm leading-6 text-toned">
            <template
              v-for="(part, partIndex) in getEditorDiffParts(entry.previousText ?? '', entry.proposedText)"
              :key="`${part.type}-${partIndex}`"
            >
              <span
                :class="part.type === 'removed'
                  ? 'bg-error/10 text-error'
                  : part.type === 'added'
                    ? 'bg-success/10 text-success'
                    : 'text-toned'"
              >{{ part.text }}</span>
            </template>
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
                :to="{
                  path: '/translate/editor',
                  query: {
                    file: entry.category,
                    search: `${entry.category}_${entry.unitKey}`,
                    searchType: 'key',
                    match: 'exact',
                    page: '1'
                  }
                }"
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
                :loading="reviewingId === entry.id"
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

    <UModal
      v-model:open="approvalModalOpen"
      title="승인할 번역 선택"
      description="같은 번역 항목에 여러 승인 대기 요청이 있습니다. 항목마다 최종 승인할 요청을 하나씩 선택해 주세요."
      :ui="{
        content: 'sm:max-w-240',
        footer: 'justify-end'
      }"
    >
      <template #body>
        <div class="flex max-h-[65vh] flex-col gap-5 overflow-y-auto pr-1">
          <UAlert
            color="warning"
            variant="soft"
            icon="i-tabler-git-merge"
            title="현재 페이지 밖의 요청도 함께 표시됩니다."
            description="승인한 요청을 제외한 같은 항목의 다른 승인 대기 요청은 자동 종료됩니다."
          />

          <section
            v-for="group in approvalConflictGroups"
            :key="group.unitId"
            class="flex flex-col gap-3"
          >
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-default pb-2">
              <span class="min-w-0 truncate text-sm font-semibold text-default">
                {{ group.category }}_{{ group.unitKey }}
              </span>
              <UBadge
                color="neutral"
                variant="soft"
                size="sm"
              >
                {{ group.candidates.length }}개 요청
              </UBadge>
            </div>

            <URadioGroup
              :model-value="approvalSelections[group.unitId]"
              :items="group.candidates"
              value-key="id"
              color="neutral"
              variant="card"
              :ui="{
                fieldset: 'gap-y-2',
                item: 'rounded-none p-3',
                wrapper: 'min-w-0',
                description: 'mt-2 whitespace-pre-wrap wrap-break-word leading-6'
              }"
              @update:model-value="setApprovalSelection(group.unitId, $event)"
            >
              <template #label="{ item }">
                <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span class="font-medium text-default">{{ item.handle ? `@${item.handle}` : '익명' }}</span>
                  <time
                    class="text-xs font-normal text-muted"
                    :datetime="item.createdAt"
                  >
                    {{ formatEditorDate(item.createdAt) }}
                  </time>
                </span>
              </template>

              <template #description="{ item }">
                <template
                  v-for="(part, partIndex) in getEditorDiffParts(item.previousText ?? '', item.proposedText)"
                  :key="`${item.id}-${part.type}-${partIndex}`"
                >
                  <span
                    :class="part.type === 'removed'
                      ? 'bg-error/10 text-error'
                      : part.type === 'added'
                        ? 'bg-success/10 text-success'
                        : 'text-toned'"
                  >{{ part.text }}</span>
                </template>
                <span v-if="!item.previousText && !item.proposedText">빈 문자열</span>
              </template>
            </URadioGroup>
          </section>
        </div>
      </template>

      <template #footer="{ close }">
        <UButton
          color="neutral"
          variant="outline"
          :disabled="isReviewing"
          @click="close"
        >
          취소
        </UButton>
        <UButton
          color="success"
          icon="i-tabler-check"
          :loading="batchReviewAction === 'approve'"
          :disabled="!approvalSelectionComplete || isReviewing"
          @click="confirmApprovalSelection"
        >
          선택한 번역 승인
        </UButton>
      </template>
    </UModal>
  </section>
</template>
