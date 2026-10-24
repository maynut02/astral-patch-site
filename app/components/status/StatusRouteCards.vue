<script setup lang="ts">
import type { PatchWatcherRouteSummary } from '#shared/types/status'
import { routeMeta, routeStatusMeta } from '~/utils/status-meta'

defineProps<{
  routes: PatchWatcherRouteSummary[]
  formatDateTime: (value: string | null) => string
  formatRelative: (value: string | null) => string
  formatSuccessRate: (value: number | null) => string
  formatDuration: (value: number | null) => string
}>()
</script>

<template>
  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
    <article
      v-for="route in routes"
      :key="route.route"
      class="flex min-w-0 flex-col border border-default bg-muted"
    >
      <div class="flex items-start justify-between gap-3 p-3">
        <div class="flex min-w-0 items-center gap-2">
          <UIcon
            :name="routeMeta[route.route].icon"
            class="size-5 shrink-0 text-muted"
          />
          <div class="min-w-0">
            <h2 class="truncate font-semibold text-default">
              {{ routeMeta[route.route].label }}
            </h2>
            <p class="text-xs text-muted">
              {{ route.route }}
            </p>
          </div>
        </div>

        <UBadge
          :color="routeStatusMeta[route.status].color"
          variant="soft"
          size="sm"
        >
          {{ routeStatusMeta[route.status].label }}
        </UBadge>
      </div>

      <p
        v-if="route.message"
        class="mx-3 mt-3 text-xs text-muted"
      >
        {{ route.message }}
      </p>

      <div
        v-if="route.errorMessage"
        class="mx-3 mt-3 border border-error/30 bg-error/5 p-3"
      >
        <p class="text-xs font-medium text-error">
          실패 원인
        </p>
        <p class="mt-1 whitespace-pre-wrap wrap-break-word font-mono text-xs leading-5 text-toned">
          {{ route.errorMessage }}
        </p>
      </div>

      <dl class="grid grid-cols-2 gap-4 bg-default/75 p-5 text-sm">
        <div>
          <dt class="text-xs text-muted">
            리비전
          </dt>
          <dd class="mt-1 truncate font-mono text-xs text-default" :title="route.revision ?? undefined">
            {{ route.revision ?? '-' }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted">
            최근 7일 감지 성공률
          </dt>
          <dd class="mt-1 font-semibold tabular-nums text-default">
            {{ formatSuccessRate(route.successRate7d) }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted">
            마지막 감지
          </dt>
          <dd class="mt-1 text-default">
            <UTooltip
              :text="formatDateTime(route.checkedAt)"
              :delay-duration="0"
            >
              <span class="cursor-help">{{ formatRelative(route.checkedAt) }}</span>
            </UTooltip>
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted">
            감지 소요 시간
          </dt>
          <dd class="mt-1 tabular-nums text-default">
            {{ formatDuration(route.durationMs) }}
          </dd>
        </div>
      </dl>
    </article>
  </div>
</template>
