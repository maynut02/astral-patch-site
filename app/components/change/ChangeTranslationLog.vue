<script setup lang="ts">
import type { EditorTranslationLogEntry } from '#shared/types/editor'
import { formatEditorDate } from '~/utils/editor-helpers'
import { getEditorItemLocation } from '~/utils/editor-links'
import { getTranslationStatusMeta, getTranslationDiffParts, getTranslationSideDiffParts, getTranslationHandle, getReviewerHandle, getReviewActionLabel } from '~/composables/change-log-display'

defineProps<{
  translationLoading: boolean
  translationError: unknown
  translationEntries: EditorTranslationLogEntry[]
  translationTotal: number
  translationTotalPages: number
  diffMode: string
}>()
const translationPage = defineModel<number>('page', { required: true })
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <section class="flex flex-col">
    <ChangeLoadingIndicator v-if="translationLoading && translationEntries.length" />

    <ChangeLogError
      v-if="translationError"
      title="번역 변경 기록을 불러오지 못했습니다."
      @retry="emit('retry')"
    />

    <div
      v-if="translationLoading && !translationEntries.length"
      class="flex items-center justify-center p-12 text-muted"
    >
      <AppLoadingSpinner />
    </div>

    <UAlert
      v-else-if="!translationError && !translationEntries.length"
      class="my-4"
      color="neutral"
      variant="soft"
      icon="i-tabler-history-off"
      title="번역 수정 기록이 없습니다."
      description="검색어나 상태 조건을 바꿔 보거나, 아직 저장된 번역 수정이 없는지 확인해 주세요."
    />

    <div
      v-else-if="translationEntries.length"
      class="relative flex flex-col gap-5 pt-5"
    >
      <span class="shrink-0 text-xs text-muted">
        총 {{ translationTotal.toLocaleString() }}건
      </span>

      <article
        v-for="entry in translationEntries"
        :key="entry.id"
        class="flex flex-col border-l-2 border-r border-r-default max-md:-ml-0.5"
        :class="getTranslationStatusMeta(entry.status).borderClass"
      >
        <p
          v-if="diffMode === 'unified'"
          class="min-h-5 whitespace-pre-wrap wrap-break-word p-3 md:px-5 md:py-4 text-sm leading-6 bg-muted border-y border-default"
        >
          <EditorDiffText :parts="getTranslationDiffParts(entry)" side="unified" />
        </p>

        <div
          v-else
          class="grid gap-3 p-3 md:grid-cols-2 md:gap-5 md:px-5 md:py-4 bg-muted border-y border-default"
        >
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="block text-[10px] text-error">수정 전</span>
            <p class="min-h-5 whitespace-pre-wrap wrap-break-word text-sm leading-6">
              <EditorDiffText :parts="getTranslationSideDiffParts(entry, 'before')" side="before" />
            </p>
          </div>
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="block text-[10px] text-success">수정 후</span>
            <p class="min-h-5 whitespace-pre-wrap wrap-break-word text-sm leading-6">
              <EditorDiffText :parts="getTranslationSideDiffParts(entry, 'after')" side="after" />
            </p>
          </div>
        </div>

        <div class="flex flex-col gap-2 p-3 md:px-5 md:py-4 border-b border-default text-xs">
          <div
            v-if="entry.changeKind === 'retain_confirmation'"
            class="flex"
          >
            <UBadge
              color="warning"
              variant="soft"
              size="sm"
            >
              유지 확인
            </UBadge>
          </div>

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
              :handle="getTranslationHandle(entry)"
              :role="entry.actorRole"
              text-class="text-xs"
              icon-class="size-3.5"
              stop-propagation
            />
            <time
              class="text-muted"
              :datetime="entry.createdAt"
            >{{ formatEditorDate(entry.createdAt) }}</time>
          </div>

          <div
            v-if="entry.reviewedAt"
            class="flex min-w-0 items-center gap-1.5"
          >
            <UIcon
              :name="getTranslationStatusMeta(entry.status).resultIcon"
              class="size-3.5"
              :class="getTranslationStatusMeta(entry.status).resultIconClass"
            />
            <span :class="getTranslationStatusMeta(entry.status).resultLabelClass">
              {{ getReviewActionLabel(entry.status) }}
            </span>
            <AppUserIdentity
              :handle="getReviewerHandle(entry)"
              :role="entry.reviewerRole"
              fallback="시스템"
              text-class="text-xs"
              icon-class="size-3.5"
              stop-propagation
            />
            <time
              class="text-muted"
              :datetime="entry.reviewedAt"
            >{{ formatEditorDate(entry.reviewedAt) }}</time>
          </div>

          <div
            v-if="entry.status === 'approved'"
            class="flex min-w-0 items-center gap-1.5 text-muted"
          >
            <UIcon name="i-tabler-package" class="size-3.5 shrink-0" />
            <span class="wrap-break-word">
              <template v-if="entry.publication">
                반영 배포 #{{ entry.publication.number }} · {{ entry.publication.gameVersion }} · {{ entry.publication.revision }}
              </template>
              <template v-else>미배포</template>
            </span>
          </div>
        </div>
      </article>
    </div>

    <ChangeLogPagination
      v-if="translationTotal"
      v-model:page="translationPage"
      :total-pages="translationTotalPages"
      :loading="translationLoading"
    />
  </section>
</template>
