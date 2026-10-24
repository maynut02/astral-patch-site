<script setup lang="ts">
import type { EditorSourceRevision, EditorSourceChangeEntry } from '#shared/types/editor'
import { formatEditorDate } from '~/utils/editor-helpers'
import { getEditorItemLocation } from '~/utils/editor-links'
import { BOT_HANDLE, getSourceBorderClass, getSourceDiffValues, getSourceActionIcon, getSourceTextClass, sourceChangeLabels } from '~/composables/change-log-display'

defineProps<{
  selectedRevision: EditorSourceRevision | null
  revisionLabel: string
  sourceLoading: boolean
  sourceEntries: EditorSourceChangeEntry[]
  sourceRevisionError: unknown
  sourceChangesError: unknown
  sourceRevisions: EditorSourceRevision[]
  sourceRevisionId: string
  sourceTotal: number
  sourceTotalPages: number
  diffMode: string
}>()
const sourcePage = defineModel<number>('page', { required: true })
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <section class="flex flex-col pt-5">
    <div
      v-if="selectedRevision"
      class="flex flex-wrap items-center gap-x-3 gap-y-2 bg-muted px-4 py-3 text-xs text-muted border border-default"
    >
      <span class="font-medium text-toned">{{ revisionLabel }}</span>
      <span>{{ formatEditorDate(selectedRevision.detectedAt) }}</span>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span class="text-success">추가 {{ selectedRevision.addedCount }}</span>
        <span class="text-warning">수정 {{ selectedRevision.modifiedCount }}</span>
        <span class="text-error">삭제 {{ selectedRevision.removedCount }}</span>
      </div>
    </div>

    <ChangeLoadingIndicator v-if="sourceLoading && sourceEntries.length" />

    <ChangeLogError
      v-if="sourceRevisionError || sourceChangesError"
      title="원문 변경 기록을 불러오지 못했습니다."
      @retry="emit('retry')"
    />

    <div
      v-if="sourceLoading && !sourceEntries.length"
      class="flex items-center justify-center p-12 text-muted"
    >
      <AppLoadingSpinner />
    </div>

    <UAlert
      v-else-if="!sourceRevisionError && !sourceChangesError && !sourceRevisions.length"
      class="my-4"
      color="neutral"
      variant="soft"
      icon="i-tabler-file-off"
      title="원문 변경 기록이 없습니다."
      description="Bot이 감지한 원문 변경이 아직 등록되지 않았습니다."
    />

    <UAlert
      v-else-if="!sourceChangesError && sourceRevisionId && !sourceEntries.length"
      class="my-4"
      color="neutral"
      variant="soft"
      icon="i-tabler-file-search"
      title="선택한 버전에 변경 항목이 없습니다."
      description="다른 버전·리비전을 선택해 보세요."
    />

    <div
      v-else-if="sourceEntries.length"
      class="relative flex flex-col gap-5 pt-5"
    >
      <span class="shrink-0 text-xs text-muted">
        총 {{ sourceTotal.toLocaleString() }}건
      </span>

      <article
        v-for="entry in sourceEntries"
        :key="entry.id"
        class="flex flex-col border-l-2 border-r border-r-default max-md:-ml-0.5"
        :class="getSourceBorderClass(entry.changeType)"
      >
        <div class="flex flex-col gap-3 p-3 md:px-5 md:py-4 bg-muted border-y border-default">
          <div
            v-for="value in getSourceDiffValues(entry)"
            :key="value.key"
            class="flex min-w-0 flex-col gap-0.5"
          >
            <span class="block text-[10px] text-dimmed">{{ value.label }}</span>
            <p
              v-if="diffMode === 'unified'"
              :lang="value.lang"
              class="min-h-5 whitespace-pre-wrap wrap-break-word text-sm leading-6"
            >
              <EditorDiffText :parts="value.parts" side="unified" />
            </p>
            <div
              v-else
              class="grid gap-2 md:grid-cols-2 md:gap-5"
            >
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="block text-[10px] text-error">수정 전</span>
                <p
                  :lang="value.lang"
                  class="min-h-5 whitespace-pre-wrap wrap-break-word text-sm leading-6"
                >
                  <EditorDiffText :parts="value.beforeParts" side="before" />
                </p>
              </div>
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="block text-[10px] text-success">수정 후</span>
                <p
                  :lang="value.lang"
                  class="min-h-5 whitespace-pre-wrap wrap-break-word text-sm leading-6"
                >
                  <EditorDiffText :parts="value.afterParts" side="after" />
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-2 p-3 md:px-5 md:py-4 border-b border-default text-xs">
          <div class="flex items-center gap-1.5">
            <UIcon
              name="i-tabler-file-filled"
              class="size-3.5 text-muted"
            />
            <NuxtLink
              :to="getEditorItemLocation(entry)"
              class="min-w-0 truncate hover:underline underline-offset-2"
              :title="`${entry.category}_${entry.unitKey}`"
            >
              {{ entry.category }}_{{ entry.unitKey }}
            </NuxtLink>
          </div>

          <div class="flex min-w-0 items-center gap-1.5">
            <UIcon
              name="i-tabler-git-pull-request"
              class="size-3.5 text-muted"
            />
            <AppUserIdentity
              :handle="BOT_HANDLE"
              role="bot"
              text-class="text-xs"
              icon-class="size-3.5"
              stop-propagation
            />
            <time
              class="text-muted"
              :datetime="entry.createdAt"
            >{{ formatEditorDate(entry.createdAt) }}</time>
          </div>

          <div class="flex items-center gap-1.5">
            <UIcon
              :name="getSourceActionIcon(entry.changeType)"
              class="size-3.5"
              :class="getSourceTextClass(entry.changeType)"
            />
            <span :class="getSourceTextClass(entry.changeType)">
              {{ sourceChangeLabels[entry.changeType] }}
            </span>
          </div>

          <div class="flex items-center gap-1.5 text-muted">
            <UIcon
              name="i-tabler-tag"
              class="size-3.5"
            />
            <span>{{ revisionLabel }}</span>
          </div>
        </div>
      </article>
    </div>

    <ChangeLogPagination
      v-if="sourceTotal"
      v-model:page="sourcePage"
      :total-pages="sourceTotalPages"
      :loading="sourceLoading"
    />
  </section>
</template>
