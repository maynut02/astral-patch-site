<script setup lang="ts">
import type {
  EditorDiffMode,
  EditorHistoryAction,
  EditorHistoryEntry,
  EditorHistoryResponse,
  EditorLanguage,
  EditorSourceChangeType
} from '#shared/types/editor'

type HistoryDiffPartType = 'same' | 'removed' | 'added'
type HistoryColor = 'neutral' | 'success' | 'info' | 'warning' | 'error'

interface HistoryDiffPart {
  text: string
  type: HistoryDiffPartType
}

interface HistoryValue {
  key: string
  label: string
  before: string
  after: string
}

interface HistoryActionMeta {
  label: string
  icon: string
  color: HistoryColor
  toneClass: string
}

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
const { user } = useUserSession()
const canReview = computed(() => ['admin', 'verified'].includes(String(user.value?.role ?? '')))

const actionMeta: Record<EditorHistoryAction, HistoryActionMeta> = {
  source_changed: {
    label: '원문 변경',
    icon: 'i-tabler-database-import',
    color: 'warning',
    toneClass: 'bg-warning/15 text-warning'
  },
  translation_changed: {
    label: '번역 수정',
    icon: 'i-tabler-language',
    color: 'info',
    toneClass: 'bg-info/15 text-info'
  }
}

const sourceChangeLabels: Record<EditorSourceChangeType, string> = {
  added: '원문 추가',
  modified: '원문 변경',
  removed: '원문 삭제'
}

const sourceLanguageMeta: Record<EditorLanguage, { label: string }> = {
  cnS: { label: '중국어 간체' },
  en: { label: '영어' },
  jp: { label: '일본어' },
  cnT: { label: '중국어 번체' }
}

const sourceFields: Record<EditorLanguage, {
  before: keyof EditorHistoryEntry
  after: keyof EditorHistoryEntry
}> = {
  cnS: { before: 'beforeCnS', after: 'afterCnS' },
  en: { before: 'beforeEn', after: 'afterEn' },
  jp: { before: 'beforeJp', after: 'afterJp' },
  cnT: { before: 'beforeCnT', after: 'afterCnT' }
}

const allSourceLanguages: EditorLanguage[] = ['cnS', 'en', 'jp', 'cnT']

function normalizeHandle(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^@+/, '') : ''
}

function getUserPath(handle: string): string {
  return `/@${encodeURIComponent(handle)}`
}

function formatHandle(handle: string): string {
  return `@${handle}`
}

function getActorHandle(entry: EditorHistoryEntry): string {
  const handle = normalizeHandle(entry.handle)

  return handle || (entry.actorType === 'automation' ? 'Bot' : '')
}

function getReviewerHandle(entry: EditorHistoryEntry): string {
  return normalizeHandle(entry.reviewerHandle)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function getActionLabel(entry: EditorHistoryEntry): string {
  if (entry.action === 'source_changed' && entry.changeType) {
    return sourceChangeLabels[entry.changeType]
  }

  return actionMeta[entry.action].label
}

function formatSourceRevision(entry: EditorHistoryEntry): string {
  const version = entry.version?.trim().replace(/^v/i, '')
  const revision = entry.revision?.trim().replace(/^r/i, '')

  if (version && revision) {
    return `v${version} · r${revision}`
  }

  return version ? `v${version}` : revision ? `r${revision}` : ''
}

function tokenize(value: string): string[] {
  return value.match(/\s+|[\p{Script=Han}]|[\p{L}\p{N}]+|[^\p{L}\p{N}\s]/gu) ?? []
}

function getDiffParts(beforeValue: string, afterValue: string): HistoryDiffPart[] {
  const before = beforeValue || ''
  const after = afterValue || ''

  if (!before && !after) {
    return [{ text: '', type: 'same' }]
  }

  const beforeTokens = tokenize(before)
  const afterTokens = tokenize(after)
  const matrix = Array.from(
    { length: beforeTokens.length + 1 },
    () => Array<number>(afterTokens.length + 1).fill(0)
  )

  for (let beforeIndex = beforeTokens.length - 1; beforeIndex >= 0; beforeIndex--) {
    for (let afterIndex = afterTokens.length - 1; afterIndex >= 0; afterIndex--) {
      matrix[beforeIndex]![afterIndex] = beforeTokens[beforeIndex] === afterTokens[afterIndex]
        ? matrix[beforeIndex + 1]![afterIndex + 1]! + 1
        : Math.max(matrix[beforeIndex + 1]![afterIndex]!, matrix[beforeIndex]![afterIndex + 1]!)
    }
  }

  const parts: HistoryDiffPart[] = []

  function append(text: string, type: HistoryDiffPartType): void {
    if (!text) {
      return
    }

    const previous = parts.at(-1)
    if (previous?.type === type) {
      previous.text += text
      return
    }

    parts.push({ text, type })
  }

  let beforeIndex = 0
  let afterIndex = 0

  while (beforeIndex < beforeTokens.length && afterIndex < afterTokens.length) {
    if (beforeTokens[beforeIndex] === afterTokens[afterIndex]) {
      append(beforeTokens[beforeIndex]!, 'same')
      beforeIndex++
      afterIndex++
    } else if (matrix[beforeIndex + 1]![afterIndex]! >= matrix[beforeIndex]![afterIndex + 1]!) {
      append(beforeTokens[beforeIndex]!, 'removed')
      beforeIndex++
    } else {
      append(afterTokens[afterIndex]!, 'added')
      afterIndex++
    }
  }

  while (beforeIndex < beforeTokens.length) {
    append(beforeTokens[beforeIndex]!, 'removed')
    beforeIndex++
  }

  while (afterIndex < afterTokens.length) {
    append(afterTokens[afterIndex]!, 'added')
    afterIndex++
  }

  return parts
}

function getSideDiffParts(before: string, after: string, side: 'before' | 'after'): HistoryDiffPart[] {
  const parts = getDiffParts(before, after)
    .filter(part => side === 'before' ? part.type !== 'added' : part.type !== 'removed')

  return parts.length ? parts : [{ text: '', type: 'same' }]
}

function getHistoryValues(entry: EditorHistoryEntry): HistoryValue[] {
  if (entry.action !== 'source_changed') {
    return [{
      key: 'ko',
      label: '한국어 번역',
      before: entry.previousText ?? '',
      after: entry.proposedText ?? ''
    }]
  }

  return allSourceLanguages
    .map((language) => {
      const fields = sourceFields[language]

      return {
        key: language,
        label: sourceLanguageMeta[language].label,
        before: String(entry[fields.before] ?? ''),
        after: String(entry[fields.after] ?? '')
      }
    })
    .filter(value => value.before !== value.after)
}

async function loadHistory(): Promise<void> {
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
    await $fetch(`/api/editor/changes/${reviewingId.value}`, {
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
        <h2 class="min-w-0 flex-1 truncate text-sm font-medium text-toned" :title="itemKey">
          {{ itemKey || '' }}
        </h2>
        <span v-if="itemStatusLabel" class="shrink-0 text-xs font-medium" :class="itemStatusColor">
          {{ itemStatusLabel }}
        </span>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-4">
      <div v-if="!itemId" class="flex h-full items-center justify-center text-center text-sm text-muted">
        <div>
          <UIcon name="i-tabler-click" class="mx-auto size-6 text-dimmed" />
          <p class="mt-2">변경 기록을 확인할 항목을 선택하세요.</p>
        </div>
      </div>

      <div v-else-if="status === 'pending'" class="flex items-center justify-center p-5 text-muted">
        <UIcon name="i-tabler-loader-2" class="size-5 animate-spin" />
      </div>

      <UAlert v-else-if="status === 'error'" color="error" variant="soft" title="변경 기록을 불러오지 못했습니다."
        description="잠시 후 다시 시도해 주세요." />

      <UAlert v-else-if="!entries.length" color="neutral" variant="soft" icon="i-tabler-history-off"
        title="변경 기록이 없습니다." description="아직 저장된 변경 내역이 없습니다." />

      <div v-else class="flex flex-col">
        <UAlert v-if="reviewError" color="error" variant="soft" title="검토에 실패했습니다." :description="reviewError"
          class="mb-4" />

        <article v-for="(entry, index) in entries" :key="entry.id"
          class="flex flex-col pl-2 pr-4 pt-1 hover:bg-elevated/40 transition-colors">
          <div class="flex items-center gap-2">
            <div class="flex size-6 items-center justify-center rounded-full shrink-0"
              :class="actionMeta[entry.action].toneClass">
              <UIcon :name="actionMeta[entry.action].icon" class="size-4" />
            </div>

            <span class="flex flex-1 shrink-0 text-sm font-medium bg-transparent!"
              :class="actionMeta[entry.action].toneClass">
              {{ getActionLabel(entry) }}
            </span>

            <div class="flex items-center gap-1 text-xs text-muted">
              <NuxtLink v-if="getActorHandle(entry)" :to="getUserPath(getActorHandle(entry))"
                class="hover:underline underline-offset-2"
                :class="hasUserRoleIcon(entry.actorRole) ? '-mt-0.5' : ''" @click.stop>
                {{ formatHandle(getActorHandle(entry)) }}
              </NuxtLink>
              <span v-else>알 수 없는 사용자</span>
              <AppUserRoleIcon :role="entry.actorRole" icon-class="size-3.5" />
            </div>
          </div>

          <div class="flex gap-2">
            <div class="w-6 flex justify-center shrink-0 pt-1">
              <div v-if="index < entries.length - 1" class="w-0.5 rounded-lg bg-elevated" />
            </div>

            <div class="flex-1 pb-12 flex flex-col gap-4">
              <!-- 작성자 -->
              <div class="flex items-center gap-2 text-xs text-muted">
                <time class="flex-1 shrink-0 text-xs text-muted" :datetime="entry.createdAt">
                  {{ formatDate(entry.createdAt) }}
                </time>

                <!-- 버전 -->
                <div v-if="entry.action === 'source_changed' && formatSourceRevision(entry)"
                  class="flex items-center gap-1 text-xs">
                  <UIcon name="i-tabler-tag" class="size-3 mt-0.5" />
                  <span class="">{{ formatSourceRevision(entry) }}</span>
                </div>
              </div>

              <!-- 통합 비교 -->
              <div v-if="diffMode === 'unified'" class="flex flex-col gap-3">
                <div v-for="value in getHistoryValues(entry)" :key="value.key" class="min-w-0 flex flex-col gap-0.5">
                  <span class="block text-[10px] text-dimmed">
                    {{ value.label }}
                  </span>
                  <p class="whitespace-pre-wrap wrap-break-word text-sm leading-6 min-h-5">
                    <template v-for="(part, partIndex) in getDiffParts(value.before, value.after)"
                      :key="`${part.type}-${partIndex}`">
                      <span :class="part.type === 'removed'
                        ? 'bg-error/10 text-error'
                        : part.type === 'added'
                          ? 'bg-success/10 text-success'
                          : 'text-toned'">{{ part.text }}</span>
                    </template>
                  </p>
                </div>
              </div>

              <!-- 분할 비교 -->
              <div v-else class="flex flex-col gap-4 py-2">
                <div v-for="value in getHistoryValues(entry)" :key="value.key" class="min-w-0 flex flex-col gap-0.5">
                  <span class="block text-[10px] text-dimmed">
                    {{ value.label }}
                  </span>
                  <div class="flex flex-col gap-2">
                    <div class="min-w-0 flex flex-col gap-0.5">
                      <span class="block text-[10px] text-error">수정 전</span>
                      <p class="whitespace-pre-wrap wrap-break-word text-sm leading-6 min-h-5">
                        <template v-for="(part, partIndex) in getSideDiffParts(value.before, value.after, 'before')"
                          :key="`before-${part.type}-${partIndex}`">
                          <span :class="part.type === 'removed' ? 'bg-error/10 text-error' : 'text-toned'">
                            {{ part.text }}
                          </span>
                        </template>
                      </p>
                    </div>
                    <div class="min-w-0 flex flex-col gap-0.5">
                      <span class="block text-[10px] text-success">수정 후</span>
                      <p class="whitespace-pre-wrap wrap-break-word text-sm leading-6 min-h-5">
                        <template v-for="(part, partIndex) in getSideDiffParts(value.before, value.after, 'after')"
                          :key="`after-${part.type}-${partIndex}`">
                          <span :class="part.type === 'added' ? 'bg-success/10 text-success' : 'text-toned'">
                            {{ part.text }}
                          </span>
                        </template>
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="entry.action === 'translation_changed' && entry.reviewedAt"
                class="flex flex-wrap flex-col gap-1 text-xs p-2 rounded-md"
                :class="entry.status === 'approved' ? 'bg-success/5' : 'bg-error/5'">
                <div class="flex items-center gap-1">
                  <UIcon :name="entry.status === 'approved' ? 'i-tabler-check' : 'i-tabler-x'"
                    :class="entry.status === 'approved' ? 'text-success' : 'text-error'" class="size-4" />
                  <span :class="entry.status === 'approved' ? 'text-success' : 'text-error'" class="flex-1">
                    {{ entry.status === 'approved' ? '승인' : '반려' }}
                  </span>

                  <div class="flex items-center gap-1 text-muted">
                    <NuxtLink v-if="getReviewerHandle(entry)" :to="getUserPath(getReviewerHandle(entry))"
                      class="hover:underline underline-offset-2"
                      :class="hasUserRoleIcon(entry.reviewerRole) ? '-mt-0.5' : ''" @click.stop>
                      {{ formatHandle(getReviewerHandle(entry)) }}
                    </NuxtLink>
                    <span v-else>알 수 없는 사용자</span>
                    <AppUserRoleIcon :role="entry.reviewerRole" icon-class="size-3.5" />
                  </div>
                </div>
                <time class="text-muted" :datetime="entry.reviewedAt">{{ formatDate(entry.reviewedAt) }}</time>
              </div>

              <div v-if="canReview && entry.action === 'translation_changed' && entry.status === 'pending'"
                class="mt-3 flex justify-end gap-2 border-t border-default pt-3">
                <UButton color="error" variant="soft" size="sm" :loading="reviewingId === getReviewId(entry)"
                  :disabled="Boolean(reviewingId)" @click="reviewEntry(entry, 'reject')">
                  반려
                </UButton>
                <UButton color="success" variant="soft" size="sm" :loading="reviewingId === getReviewId(entry)"
                  :disabled="Boolean(reviewingId)" @click="reviewEntry(entry, 'approve')">
                  승인
                </UButton>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>
