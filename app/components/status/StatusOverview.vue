<script setup lang="ts">
import type { PatchWatcherStatusResponse } from '#shared/types/status'
import { overallMeta } from '~/utils/status-meta'

const props = defineProps<{
  data: PatchWatcherStatusResponse
  formatDateTime: (value: string | null) => string
  formatRelative: (value: string | null) => string
}>()

const currentOverallMeta = computed(() => overallMeta[props.data.overall.state ?? 'degraded'])
const latestRunStandaloneError = computed(() => {
  const errorMessage = props.data.latestRun?.errorMessage
  if (!errorMessage || props.data.routes.some(route => Boolean(route.errorMessage))) {
    return null
  }

  return errorMessage
})
</script>

<template>
  <article class="">
    <div class="flex flex-wrap items-start justify-between gap-5">
      <div class="flex min-w-0 items-start gap-3">
        <div class="flex shrink-0 items-center justify-center mt-1">
          <UIcon
            :name="currentOverallMeta.icon"
            class="size-6"
            :class="{
              'text-success': currentOverallMeta.color === 'success',
              'text-warning': currentOverallMeta.color === 'warning',
              'text-error': currentOverallMeta.color === 'error',
              'text-info': currentOverallMeta.color === 'info',
              'text-muted': currentOverallMeta.color === 'neutral'
            }"
          />
        </div>

        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-lg font-semibold text-default">
              {{ currentOverallMeta.label }}
            </h2>
            <UBadge
              :color="currentOverallMeta.color"
              variant="soft"
              size="sm"
            >
              {{ data.watcher.enabled ? `${data.schedule.intervalMinutes}분 주기` : '중지됨' }}
            </UBadge>
          </div>
          <p class="mt-1 text-sm text-muted">
            {{ data.overall.message }}
          </p>
          <div
            v-if="latestRunStandaloneError"
            class="mt-3 border border-error/30 bg-error/5 p-3"
          >
            <p class="text-xs font-medium text-error">
              최근 실행 오류
            </p>
            <p class="mt-1 whitespace-pre-wrap wrap-break-word font-mono text-xs leading-5 text-toned">
              {{ latestRunStandaloneError }}
            </p>
          </div>
        </div>
      </div>

      <dl class="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div>
          <dt class="text-xs text-muted">
            게임 버전
          </dt>
          <dd class="mt-0.5 font-medium tabular-nums text-default">
            {{ data.watcher.gameVersion }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted">
            마지막 활동
          </dt>
          <dd class="mt-0.5 font-medium text-default">
            <UTooltip
              :text="formatDateTime(data.overall.lastActivityAt)"
              :delay-duration="0"
            >
              <span class="cursor-help">{{ formatRelative(data.overall.lastActivityAt) }}</span>
            </UTooltip>
          </dd>
        </div>
      </dl>
    </div>
  </article>
</template>
