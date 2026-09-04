<script setup lang="ts">
import type {
  EditorDiffMode,
  EditorHistoryAction,
  EditorHistoryEntry,
  EditorHistoryResponse,
  EditorLanguage,
  EditorSourceChangeType
} from '#shared/types/editor'
import {
  formatEditorDate as formatDate,
  normalizeEditorHandle
} from '~/utils/editor-helpers'
import {
  getEditorDiffParts,
  getEditorSideDiffParts,
  type EditorDiffPart
} from '~/utils/editor-diff'

type HistoryColor = 'neutral' | 'success' | 'info' | 'warning' | 'error'

interface HistoryValue {
  key: string
  label: string
  lang: string
  before: string
  after: string
  unifiedParts: EditorDiffPart[]
  beforeParts: EditorDiffPart[]
  afterParts: EditorDiffPart[]
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
const historyRequestId = ref(0)
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

const sourceLanguageMeta: Record<EditorLanguage, { label: string, lang: string }> = {
  cnS: { label: '중국어 간체', lang: 'zh-CN' },
  en: { label: '영어', lang: 'en' },
  jp: { label: '일본어', lang: 'ja' },
  cnT: { label: '중국어 번체', lang: 'zh-TW' }
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

function getActorHandle(entry: EditorHistoryEntry): string {
  const handle = normalizeEditorHandle(entry.handle)

  return handle || (entry.actorType === 'automation' ? 'Bot' : '')
}

function getReviewerHandle(entry: EditorHistoryEntry): string {
  return normalizeEditorHandle(entry.reviewerHandle)
}

function getActionLabel(entry: EditorHistoryEntry): string {
  if (entry.action === 'source_changed' && entry.changeType) {
    return sourceChangeLabels[entry.changeType]
  }

  return actionMeta[entry.action].label
}

function getReviewResultMeta(entry: EditorHistoryEntry) {
  if (entry.status === 'approved') {
    return {
      label: '승인',
      icon: 'i-tabler-check',
      containerClass: 'bg-success/5',
      textClass: 'text-success'
    }
  }

  if (entry.status === 'superseded') {
    return {
      label: '다른 제안 승인으로 자동 종료',
      icon: 'i-tabler-replace',
      containerClass: 'bg-warning/5',
      textClass: 'text-warning'
    }
  }

  return {
    label: '반려',
    icon: 'i-tabler-x',
    containerClass: 'bg-error/5',
    textClass: 'text-error'
  }
}

function formatSourceRevision(entry: EditorHistoryEntry): string {
  const version = entry.version?.trim().replace(/^v/i, '')
  const revision = entry.revision?.trim().replace(/^r/i, '')

  if (version && revision) {
    return `v${version} · r${revision}`
  }

  return version ? `v${version}` : revision ? `r${revision}` : ''
}

function getHistoryValues(entry: EditorHistoryEntry): Omit<HistoryValue, 'unifiedParts' | 'beforeParts' | 'afterParts'>[] {
  if (entry.action !== 'source_changed') {
    return [{
      key: 'ko',
      label: '한국어 번역',
      lang: 'ko',
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
        lang: sourceLanguageMeta[language].lang,
        before: String(entry[fields.before] ?? ''),
        after: String(entry[fields.after] ?? '')
      }
    })
    .filter(value => value.before !== value.after)
}

const historyViews = computed(() => entries.value.map(entry => ({
  entry,
  values: getHistoryValues(entry).map((value) => {
    const unifiedParts = getEditorDiffParts(value.before, value.after)

    return {
      ...value,
      unifiedParts,
      beforeParts: getEditorSideDiffParts(unifiedParts, 'before'),
      afterParts: getEditorSideDiffParts(unifiedParts, 'after')
    }
  })
})))

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

        <article
          v-for="(history, index) in historyViews"
          :key="history.entry.id"
          class="flex flex-col pl-2 pr-4 pt-1 hover:bg-elevated/40 transition-colors"
        >
          <div class="flex items-center gap-2">
            <div
              class="flex size-6 items-center justify-center rounded-full shrink-0"
              :class="actionMeta[history.entry.action].toneClass"
            >
              <UIcon
                :name="actionMeta[history.entry.action].icon"
                class="size-4"
              />
            </div>

            <span
              class="flex flex-1 shrink-0 text-sm font-medium bg-transparent!"
              :class="actionMeta[history.entry.action].toneClass"
            >
              {{ getActionLabel(history.entry) }}
            </span>

            <AppUserIdentity
              :handle="getActorHandle(history.entry)"
              :role="history.entry.actorRole"
              text-class="text-xs text-muted"
              icon-class="size-3.5"
              stop-propagation
            />
          </div>

          <div class="flex gap-2">
            <div class="w-6 flex justify-center shrink-0 pt-1">
              <div
                v-if="index < historyViews.length - 1"
                class="w-0.5 bg-elevated"
              />
            </div>

            <div class="flex-1 pb-12 flex flex-col gap-4">
              <div class="flex items-center gap-2 text-xs text-muted">
                <time
                  class="flex-1 shrink-0 text-xs text-muted"
                  :datetime="history.entry.createdAt"
                >
                  {{ formatDate(history.entry.createdAt) }}
                </time>

                <UBadge
                  v-if="history.entry.changeKind === 'retain_confirmation'"
                  color="warning"
                  variant="soft"
                  size="sm"
                >
                  유지 확인
                </UBadge>

                <div
                  v-if="history.entry.action === 'source_changed' && formatSourceRevision(history.entry)"
                  class="flex items-center gap-1 text-xs"
                >
                  <UIcon
                    name="i-tabler-tag"
                    class="size-3 mt-0.5"
                  />
                  <span class="">{{ formatSourceRevision(history.entry) }}</span>
                </div>
              </div>

              <div
                v-if="diffMode === 'unified'"
                class="flex flex-col gap-3"
              >
                <div
                  v-for="value in history.values"
                  :key="value.key"
                  class="min-w-0 flex flex-col gap-0.5"
                >
                  <span class="block text-[10px] text-dimmed">
                    {{ value.label }}
                  </span>
                  <p
                    :lang="value.lang"
                    class="whitespace-pre-wrap text-sm leading-6 min-h-5"
                  >
                    <template
                      v-for="(part, partIndex) in value.unifiedParts"
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
                  </p>
                </div>
              </div>

              <div
                v-else
                class="flex flex-col gap-4 py-2"
              >
                <div
                  v-for="value in history.values"
                  :key="value.key"
                  class="min-w-0 flex flex-col gap-0.5"
                >
                  <span class="block text-[10px] text-dimmed">
                    {{ value.label }}
                  </span>
                  <div class="flex flex-col gap-2">
                    <div class="min-w-0 flex flex-col gap-0.5">
                      <span class="block text-[10px] text-error">수정 전</span>
                      <p
                        :lang="value.lang"
                        class="whitespace-pre-wrap text-sm leading-6 min-h-5"
                      >
                        <template
                          v-for="(part, partIndex) in value.beforeParts"
                          :key="`before-${part.type}-${partIndex}`"
                        >
                          <span :class="part.type === 'removed' ? 'bg-error/10 text-error' : 'text-toned'">
                            {{ part.text }}
                          </span>
                        </template>
                      </p>
                    </div>
                    <div class="min-w-0 flex flex-col gap-0.5">
                      <span class="block text-[10px] text-success">수정 후</span>
                      <p
                        :lang="value.lang"
                        class="whitespace-pre-wrap wrap-break-word text-sm leading-6 min-h-5"
                      >
                        <template
                          v-for="(part, partIndex) in value.afterParts"
                          :key="`after-${part.type}-${partIndex}`"
                        >
                          <span :class="part.type === 'added' ? 'bg-success/10 text-success' : 'text-toned'">
                            {{ part.text }}
                          </span>
                        </template>
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-if="history.entry.action === 'translation_changed' && history.entry.reviewedAt"
                class="flex flex-wrap flex-col gap-1 text-xs p-2"
                :class="getReviewResultMeta(history.entry).containerClass"
              >
                <div class="flex items-center gap-1">
                  <UIcon
                    :name="getReviewResultMeta(history.entry).icon"
                    :class="getReviewResultMeta(history.entry).textClass"
                    class="size-4"
                  />
                  <span
                    :class="getReviewResultMeta(history.entry).textClass"
                    class="flex-1"
                  >
                    {{ getReviewResultMeta(history.entry).label }}
                  </span>

                  <AppUserIdentity
                    :handle="getReviewerHandle(history.entry)"
                    :role="history.entry.reviewerRole"
                    text-class="text-muted"
                    icon-class="size-3.5"
                    stop-propagation
                  />
                </div>
                <time
                  class="text-muted"
                  :datetime="history.entry.reviewedAt"
                >{{ formatDate(history.entry.reviewedAt)
                }}</time>
              </div>

              <div
                v-if="canReview && history.entry.action === 'translation_changed' && history.entry.status === 'pending'"
                class="mt-3 flex justify-end gap-2 border-t border-default pt-3"
              >
                <UButton
                  color="error"
                  variant="soft"
                  size="sm"
                  :loading="reviewingId === getReviewId(history.entry)"
                  :disabled="Boolean(reviewingId)"
                  @click="reviewEntry(history.entry, 'reject')"
                >
                  반려
                </UButton>
                <UButton
                  color="success"
                  variant="soft"
                  size="sm"
                  :loading="reviewingId === getReviewId(history.entry)"
                  :disabled="Boolean(reviewingId)"
                  @click="reviewEntry(history.entry, 'approve')"
                >
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
