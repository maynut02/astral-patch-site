<script setup lang="ts">
import { formatEditorCount, formatEditorDate, formatEditorVersion } from '~/utils/editor-helpers'
import { tabItems, statusItems, translationStatuses, translationStatusTextColors } from '~/composables/change-log-display'
import { useChangeLogPage } from '~/composables/change-log-page'
import { EDITOR_CHANGE_STATUS_META } from '~/utils/editor-progress'

useAstralPageSeo('변경 기록')

const {
  diffMode,
  diffModeItems,
  updateDiffMode,
  activeTab,
  translationSearchInput,
  translationStatusFilter,
  sourceRevisionId,
  sourceRevisionItems,
  updateActiveTab,
  selectSourceRevision,
  isLoading,
  latestVersion,
  translationSummaryLoading,
  translationSummaryError,
  translationSummary,
  translationLoading,
  translationError,
  translationEntries,
  translationTotal,
  translationTotalPages,
  translationPage,
  retryActiveLog,
  selectedRevision,
  getSourceRevisionLabel,
  sourceLoading,
  sourceEntries,
  sourceRevisionError,
  sourceChangesError,
  sourceRevisions,
  sourceTotal,
  sourceTotalPages,
  sourcePage
} = useChangeLogPage()
</script>

<template>
  <div class="flex flex-col h-full max-w-400 mx-auto">
    <header class="flex flex-col gap-5">
      <div class="flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-tabler-history-toggle"
            class="size-5"
          />
          <h1 class="text-xl font-semibold -mt-0.75">
            변경 기록
          </h1>
        </div>

        <div class="flex items-center gap-2">
          <UButton
            to="/translate/editor"
            icon="i-tabler-arrow-right"
            color="info"
            variant="soft"
            size="md"
            class="px-3 shrink-0 flex-row-reverse self-start"
          >
            번역하러 가기
          </UButton>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <div class="flex flex-1 flex-col gap-2 p-4 bg-elevated/50 border border-default max-md:col-span-2">
          <span class="text-xs text-muted">최신 버전</span>
          <ClientOnly>
            <div
              v-if="isLoading"
              class="flex flex-col gap-1"
            >
              <USkeleton class="h-7 w-20" />
              <USkeleton class="h-4 w-28" />
            </div>
            <div
              v-else
              class="flex flex-col gap-1"
            >
              <span
                class="truncate text-xl font-semibold"
                :title="latestVersion ? formatEditorVersion(latestVersion.version, latestVersion.revision) : undefined"
              >
                {{ latestVersion ? formatEditorVersion(latestVersion.version, latestVersion.revision) : '—' }}
              </span>
              <time
                v-if="latestVersion"
                class="text-xs text-muted"
                :datetime="latestVersion.detectedAt"
              >
                {{ formatEditorDate(latestVersion.detectedAt) }}
              </time>
              <span
                v-else
                class="text-xs text-muted"
              >—</span>
            </div>
            <template #fallback>
              <div class="flex flex-col gap-1">
                <USkeleton class="h-7 w-20" />
                <USkeleton class="h-4 w-28" />
              </div>
            </template>
          </ClientOnly>
        </div>

        <div
          v-for="status in translationStatuses"
          :key="status"
          class="flex flex-col gap-2 p-4 bg-elevated/50 border border-default"
        >
          <span
            class="text-xs"
            :class="translationStatusTextColors[status]"
          >
            {{ EDITOR_CHANGE_STATUS_META[status].label }}
          </span>
          <ClientOnly>
            <USkeleton
              v-if="translationSummaryLoading"
              class="h-7 w-20"
            />
            <span
              v-else-if="translationSummaryError"
              class="text-xl font-semibold text-muted"
            >—</span>
            <span
              v-else
              class="text-xl font-semibold"
            >
              {{ formatEditorCount(translationSummary[status]) }}개
            </span>
            <template #fallback>
              <USkeleton class="h-7 w-20" />
            </template>
          </ClientOnly>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <UTabs
          :model-value="activeTab"
          :items="tabItems"
          :content="false"
          size="sm"
          color="neutral"
          class="w-fit"
          :ui="{ trigger: 'h-7 leading-4 px-3', list: 'h-9 bg-elevated/50 p-1' }"
          @update:model-value="updateActiveTab"
        />

        <div
          v-if="activeTab === 'translations'"
          class="flex gap-3 items-center"
        >
          <UInput
            v-model="translationSearchInput"
            icon="i-tabler-search"
            color="neutral"
            variant="soft"
            size="lg"
            placeholder="검색"
            class="h-9 w-full sm:flex-1"
            :ui="{ base: 'h-9 leading-5' }"
          />
          <USelect
            v-model="translationStatusFilter"
            :items="statusItems"
            color="neutral"
            variant="soft"
            class="h-9 w-32"
            :ui="{ base: 'h-9 leading-5' }"
          />
        </div>

        <div
          v-else
          class="flex gap-3 items-center"
        >
          <USelect
            :model-value="sourceRevisionId"
            :items="sourceRevisionItems"
            color="neutral"
            variant="soft"
            size="lg"
            class="h-9 w-48"
            :ui="{ base: 'h-9 leading-5' }"
            :disabled="!sourceRevisionItems.length"
            @update:model-value="selectSourceRevision"
          />
        </div>

        <UTabs
          :model-value="diffMode"
          :items="diffModeItems"
          :content="false"
          size="sm"
          color="neutral"
          class="w-fit md:ml-auto"
          :ui="{ trigger: 'h-7 leading-4 px-2', list: 'h-9 bg-elevated/50 p-1', label: 'sr-only' }"
          @update:model-value="updateDiffMode"
        >
          <template #leading="{ item }">
            <UTooltip :text="item.label">
              <UIcon
                :name="item.icon ?? ''"
                class="size-4"
              />
            </UTooltip>
          </template>
        </UTabs>
      </div>
    </header>

    <ClientOnly>
      <ChangeTranslationLog
        v-if="activeTab === 'translations'"
        v-model:page="translationPage"
        :translation-loading="translationLoading"
        :translation-error="translationError"
        :translation-entries="translationEntries"
        :translation-total="translationTotal"
        :translation-total-pages="translationTotalPages"
        :diff-mode="diffMode"
        @retry="retryActiveLog"
      />

      <ChangeSourceLog
        v-else
        v-model:page="sourcePage"
        :selected-revision="selectedRevision"
        :revision-label="getSourceRevisionLabel()"
        :source-loading="sourceLoading"
        :source-entries="sourceEntries"
        :source-revision-error="sourceRevisionError"
        :source-changes-error="sourceChangesError"
        :source-revisions="sourceRevisions"
        :source-revision-id="sourceRevisionId"
        :source-total="sourceTotal"
        :source-total-pages="sourceTotalPages"
        :diff-mode="diffMode"
        @retry="retryActiveLog"
      />

      <template #fallback>
        <div class="flex items-center justify-center p-12 text-muted">
          <AppLoadingSpinner />
        </div>
      </template>
    </ClientOnly>
  </div>
</template>
