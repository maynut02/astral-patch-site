<script setup lang="ts">
import type { PatchWatcherHistoryEntry, PatchWatcherHistoryResponse } from '#shared/types/status'
import type { HistoryFilter } from '~/utils/status-meta'
import { historyTabs, routeMeta, routeStatusMeta, runMeta } from '~/utils/status-meta'

defineProps<{
  history: PatchWatcherHistoryResponse | null | undefined
  historyPage: number
  historyFilter: HistoryFilter
  isHistoryLoading: boolean
  historyError: boolean
  refreshHistory: () => Promise<void>
  formatDateTime: (value: string | null) => string
  formatRelative: (value: string | null) => string
  formatDuration: (value: number | null) => string
}>()

const emit = defineEmits<{
  previousPage: []
  nextPage: []
  updateFilter: [value: string | number]
}>()

function getHistoryRouteErrors(entry: PatchWatcherHistoryEntry) {
  return entry.routes.filter(route => Boolean(route.errorMessage))
}

function getStandaloneRunError(entry: PatchWatcherHistoryEntry): string | null {
  return getHistoryRouteErrors(entry).length > 0 ? null : entry.errorMessage
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-semibold text-default">
          최근 감지 기록
        </h2>
      </div>
      <span class="text-xs text-dimmed">페이지 {{ historyPage }}</span>
    </div>

    <UTabs
      :model-value="historyFilter"
      :items="historyTabs"
      :content="false"
      color="neutral"
      size="sm"
      :ui="{ trigger: 'h-7 leading-4 px-3', list: 'h-9 bg-elevated/50 p-1' }"
      class="w-fit"
      @update:model-value="emit('updateFilter', $event)"
    />

    <div
      v-if="isHistoryLoading"
      class="flex flex-col gap-2"
    >
      <USkeleton
        v-for="index in 5"
        :key="index"
        class="h-20 w-full"
      />
    </div>

    <UAlert
      v-else-if="historyError || !history"
      icon="i-tabler-alert-triangle"
      color="error"
      variant="subtle"
      title="최근 감지 기록을 불러오지 못했습니다."
      :actions="[{ label: '다시 시도', color: 'error', variant: 'soft', onClick: () => refreshHistory() }]"
    />

    <div
      v-else-if="!history.entries.length"
      class="flex min-h-32 items-center justify-center border border-default bg-elevated/30 p-6 text-sm text-muted"
    >
      {{ historyFilter === 'failed' ? '저장된 실패 감지 기록이 없습니다.' : '아직 저장된 감지 기록이 없습니다.' }}
    </div>

    <div
      v-else
      class="flex flex-col"
    >
      <article
        v-for="entry in history.entries"
        :key="entry.id"
        class="grid gap-3 md:grid-cols-[12rem_8rem_1fr_auto] md:items-center py-2 border-b border-default hover:bg-muted"
      >
        <div class="min-w-0">
          <UTooltip
            :text="formatDateTime(entry.startedAt)"
            :delay-duration="0"
          >
            <span class="cursor-help text-sm font-medium text-default">
              {{ formatRelative(entry.startedAt) }}
            </span>
          </UTooltip>
          <p class="mt-0.5 text-xs text-muted">
            {{ formatDuration(entry.durationMs) }}
          </p>
        </div>

        <div>
          <UBadge
            :color="runMeta[entry.status].color"
            variant="soft"
            size="md"
          >
            <UIcon :name="runMeta[entry.status].icon" class="size-3.5" />
            {{ runMeta[entry.status].label }}
          </UBadge>
        </div>

        <div class="flex min-w-0 flex-wrap gap-1.5">
          <UBadge
            v-for="route in entry.routes"
            :key="route.route"
            :color="routeStatusMeta[route.status].color"
            variant="soft"
            size="md"
          >
            {{ routeMeta[route.route].label }} · {{ routeStatusMeta[route.status].label }}
          </UBadge>
          <span
            v-if="!entry.routes.length"
            class="text-xs text-muted"
          >
            경로별 기록 없음
          </span>
        </div>

        <span class="text-xs tabular-nums text-dimmed">#{{ entry.id }}</span>

        <p
          v-if="entry.message"
          class="text-xs text-muted md:col-span-4"
        >
          {{ entry.message }}
        </p>

        <div
          v-if="getHistoryRouteErrors(entry).length"
          class="flex flex-col gap-2 md:col-span-4"
        >
          <div
            v-for="route in getHistoryRouteErrors(entry)"
            :key="`${entry.id}-${route.route}-error`"
            class="bg-error/5 p-3"
          >
            <p class="text-xs font-medium text-error">
              {{ routeMeta[route.route].label }} 실패
            </p>
            <p class="mt-1 whitespace-pre-wrap wrap-break-word font-mono text-xs leading-5 text-toned">
              {{ route.errorMessage }}
            </p>
          </div>
        </div>

        <div
          v-else-if="getStandaloneRunError(entry)"
          class="bg-error/5 p-3 md:col-span-4"
        >
          <p class="text-xs font-medium text-error">
            실행 실패
          </p>
          <p class="mt-1 whitespace-pre-wrap wrap-break-word font-mono text-xs leading-5 text-toned">
            {{ getStandaloneRunError(entry) }}
          </p>
        </div>
      </article>
    </div>

    <div
      v-if="history && (historyPage > 1 || history.hasMore)"
      class="flex justify-end gap-2 pt-2"
    >
      <UButton
        icon="i-tabler-chevron-left"
        color="neutral"
        variant="soft"
        size="sm"
        :disabled="historyPage <= 1 || isHistoryLoading"
        @click="emit('previousPage')"
      >
        이전
      </UButton>
      <UButton
        trailing-icon="i-tabler-chevron-right"
        color="neutral"
        variant="soft"
        size="sm"
        :disabled="!history.hasMore || isHistoryLoading"
        @click="emit('nextPage')"
      >
        다음
      </UButton>
    </div>
  </section>
</template>
