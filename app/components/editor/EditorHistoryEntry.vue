<script setup lang="ts">
import type {
  EditorDiffMode,
  EditorHistoryAction,
  EditorHistoryEntry,
  EditorLanguage,
  EditorSourceChangeType
} from '#shared/types/editor'
import {
  formatEditorDate as formatDate,
  normalizeEditorHandle,
  formatEditorVersion
} from '~/utils/editor-helpers'
import {
  getEditorDiffParts,
  getEditorSideDiffParts,
  type EditorDiffPart
} from '~/utils/editor-diff'
import { EDITOR_SOURCE_LANGUAGE_OPTIONS, type EditorLanguageOption } from '~/utils/editor-options'

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

const sourceFields: Record<EditorLanguage, {
  before: 'beforeCnS' | 'beforeEn' | 'beforeJp' | 'beforeCnT'
  after: 'afterCnS' | 'afterEn' | 'afterJp' | 'afterCnT'
}> = {
  cnS: { before: 'beforeCnS', after: 'afterCnS' },
  en: { before: 'beforeEn', after: 'afterEn' },
  jp: { before: 'beforeJp', after: 'afterJp' },
  cnT: { before: 'beforeCnT', after: 'afterCnT' }
}

const sourceLanguageMeta = Object.fromEntries(EDITOR_SOURCE_LANGUAGE_OPTIONS.map(language => [language.key, language])) as Record<EditorLanguage, EditorLanguageOption>
const allSourceLanguages = EDITOR_SOURCE_LANGUAGE_OPTIONS.map(language => language.key)

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
        before: entry[fields.before] ?? '',
        after: entry[fields.after] ?? ''
      }
    })
    .filter(value => value.before !== value.after)
}

const props = defineProps<{
  entry: EditorHistoryEntry
  isLast: boolean
  diffMode: EditorDiffMode
  canReview: boolean
  reviewingId: string | null
}>()
const emit = defineEmits<{ review: [entry: EditorHistoryEntry, action: 'approve' | 'reject'] }>()
const reviewResult = computed(() => getReviewResultMeta(props.entry))
const sourceRevision = computed(() => formatEditorVersion(props.entry.version, props.entry.revision, true))
const values = computed(() => getHistoryValues(props.entry).map((value) => {
  const unified = computed(() => getEditorDiffParts(value.before, value.after))
  const before = computed(() => getEditorSideDiffParts(unified.value, 'before'))
  const after = computed(() => getEditorSideDiffParts(unified.value, 'after'))
  return {
    ...value,
    get unifiedParts() { return unified.value },
    get beforeParts() { return before.value },
    get afterParts() { return after.value }
  }
}))
function getReviewId(entry: EditorHistoryEntry): string {
  return entry.id.replace(/:translation$/, '')
}
</script>

<template>
  <article class="flex flex-col pl-2 pr-4 pt-1 hover:bg-elevated/40 transition-colors">
    <div class="flex items-center gap-2">
      <div
        class="flex size-6 items-center justify-center rounded-full shrink-0"
        :class="actionMeta[entry.action].toneClass"
      >
        <UIcon
          :name="actionMeta[entry.action].icon"
          class="size-4"
        />
      </div>

      <span
        class="flex flex-1 shrink-0 text-sm font-medium bg-transparent!"
        :class="actionMeta[entry.action].toneClass"
      >
        {{ getActionLabel(entry) }}
      </span>

      <AppUserIdentity
        :handle="getActorHandle(entry)"
        :role="entry.actorRole"
        text-class="text-xs text-muted"
        icon-class="size-3.5"
        stop-propagation
      />
    </div>

    <div class="flex gap-2">
      <div class="w-6 flex justify-center shrink-0 pt-1">
        <div
          v-if="!isLast"
          class="w-0.5 bg-elevated"
        />
      </div>

      <div class="flex-1 pb-12 flex flex-col gap-4">
        <div class="flex items-center gap-2 text-xs text-muted">
          <time
            class="flex-1 shrink-0 text-xs text-muted"
            :datetime="entry.createdAt"
          >
            {{ formatDate(entry.createdAt) }}
          </time>

          <UBadge
            v-if="entry.changeKind === 'retain_confirmation'"
            color="warning"
            variant="soft"
            size="sm"
          >
            유지 확인
          </UBadge>

          <div
            v-if="entry.action === 'source_changed' && sourceRevision"
            class="flex items-center gap-1 text-xs"
          >
            <UIcon
              name="i-tabler-tag"
              class="size-3 mt-0.5"
            />
            <span class="">{{ sourceRevision }}</span>
          </div>
        </div>

        <div
          v-if="diffMode === 'unified'"
          class="flex flex-col gap-3"
        >
          <div
            v-for="value in values"
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
              <EditorDiffText :parts="value.unifiedParts" side="unified" />
            </p>
          </div>
        </div>

        <div
          v-else
          class="flex flex-col gap-4 py-2"
        >
          <div
            v-for="value in values"
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
                  <EditorDiffText :parts="value.beforeParts" side="before" />
                </p>
              </div>
              <div class="min-w-0 flex flex-col gap-0.5">
                <span class="block text-[10px] text-success">수정 후</span>
                <p
                  :lang="value.lang"
                  class="whitespace-pre-wrap wrap-break-word text-sm leading-6 min-h-5"
                >
                  <EditorDiffText :parts="value.afterParts" side="after" />
                </p>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="entry.action === 'translation_changed' && entry.reviewedAt"
          class="flex flex-wrap flex-col gap-1 text-xs p-2"
          :class="reviewResult.containerClass"
        >
          <div class="flex items-center gap-1">
            <UIcon
              :name="reviewResult.icon"
              :class="reviewResult.textClass"
              class="size-4"
            />
            <span
              :class="reviewResult.textClass"
              class="flex-1"
            >
              {{ reviewResult.label }}
            </span>

            <AppUserIdentity
              :handle="getReviewerHandle(entry)"
              :role="entry.reviewerRole"
              text-class="text-muted"
              icon-class="size-3.5"
              stop-propagation
            />
          </div>
          <time
            class="text-muted"
            :datetime="entry.reviewedAt"
          >{{ formatDate(entry.reviewedAt)
          }}</time>
        </div>

        <div
          v-if="canReview && entry.action === 'translation_changed' && entry.status === 'pending'"
          class="mt-3 flex justify-end gap-2 border-t border-default pt-3"
        >
          <UButton
            color="error"
            variant="soft"
            size="sm"
            :loading="reviewingId === getReviewId(entry)"
            :disabled="Boolean(reviewingId)"
            @click="emit('review', entry, 'reject')"
          >
            반려
          </UButton>
          <UButton
            color="success"
            variant="soft"
            size="sm"
            :loading="reviewingId === getReviewId(entry)"
            :disabled="Boolean(reviewingId)"
            @click="emit('review', entry, 'approve')"
          >
            승인
          </UButton>
        </div>
      </div>
    </div>
  </article>
</template>
