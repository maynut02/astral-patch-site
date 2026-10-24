<script setup lang="ts">
import type {
  PatchWatcherHourlyStat,
  PatchWatcherHistoryResponse,
  PatchWatcherStatusResponse
} from '#shared/types/status'
import { formatFetchedAgo } from '~/utils/format'
import type { HistoryFilter } from '~/utils/status-meta'

useAstralPageSeo('서비스 상태')

const {
  data,
  status,
  error,
  refresh
} = await useFetch<PatchWatcherStatusResponse>('/api/status')

const historyPage = ref(1)
const historyFilter = ref<HistoryFilter>('all')
const {
  data: history,
  status: historyStatus,
  error: historyError,
  refresh: refreshHistory
} = await useFetch<PatchWatcherHistoryResponse>('/api/status/history', {
  query: {
    page: historyPage,
    filter: historyFilter
  }
})

const relativeTimeNow = useRelativeNow(30_000)

const isLoading = computed(() => status.value === 'idle' || status.value === 'pending')
const isHistoryLoading = computed(() => historyStatus.value === 'idle' || historyStatus.value === 'pending')

const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Seoul'
})

const hourFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Seoul'
})

function formatDateTime(value: string | null): string {
  if (!value) {
    return '기록 없음'
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '기록 없음' : dateTimeFormatter.format(date)
}

function formatRelative(value: string | null): string {
  return formatFetchedAgo(value ?? '', relativeTimeNow.value, '기록 없음')
}

function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }

  if (value < 1000) {
    return `${Math.round(value)}ms`
  }

  const seconds = value / 1000
  return seconds < 60 ? `${seconds.toFixed(seconds >= 10 ? 1 : 2)}초` : `${(seconds / 60).toFixed(1)}분`
}

function formatSuccessRate(value: number | null): string {
  return value === null ? '-' : `${value.toFixed(value === 100 ? 0 : 2)}%`
}

function getHourTooltip(hour: PatchWatcherHourlyStat): string {
  const label = hourFormatter.format(new Date(hour.hour))

  if (hour.state === 'paused') {
    return `${label} · 감지 비활성화`
  }

  if (hour.state === 'no_data') {
    return `${label} · 기록 없음`
  }

  return `${label} · ${hour.success}/${hour.total}회 성공 · ${formatSuccessRate(hour.successRate)}`
}

async function refreshAll(): Promise<void> {
  await Promise.all([refresh(), refreshHistory()])
}

function previousHistoryPage(): void {
  if (historyPage.value > 1) {
    historyPage.value -= 1
  }
}

function nextHistoryPage(): void {
  if (history.value?.hasMore) {
    historyPage.value += 1
  }
}

function updateHistoryFilter(value: string | number): void {
  if (value !== 'all' && value !== 'failed') {
    return
  }

  historyFilter.value = value
  historyPage.value = 1
}
</script>

<template>
  <section class="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-tabler-activity-heartbeat"
            class="size-5"
          />
          <h1 class="-mt-0.75 text-xl font-semibold">
            서비스 상태
          </h1>
        </div>
      </div>

      <UButton
        icon="i-tabler-refresh"
        color="neutral"
        variant="soft"
        size="sm"
        :loading="isLoading || isHistoryLoading"
        @click="refreshAll"
      >
        새로고침
      </UButton>
    </header>

    <div
      v-if="isLoading"
      class="flex flex-col gap-4"
    >
      <USkeleton class="h-32 w-full" />
      <div class="grid gap-4 lg:grid-cols-3">
        <USkeleton
          v-for="index in 3"
          :key="index"
          class="h-56 w-full"
        />
      </div>
    </div>

    <UAlert
      v-else-if="error || !data"
      icon="i-tabler-alert-triangle"
      color="error"
      variant="subtle"
      title="상태 정보를 불러오지 못했습니다."
      description="잠시 후 다시 시도해 주세요."
      :actions="[{ label: '다시 시도', color: 'error', variant: 'soft', onClick: () => refresh() }]"
    />

    <template v-else>
      <StatusOverview
        :data="data"
        :format-date-time="formatDateTime"
        :format-relative="formatRelative"
      />

      <StatusRouteCards
        :routes="data.routes"
        :format-date-time="formatDateTime"
        :format-relative="formatRelative"
        :format-success-rate="formatSuccessRate"
        :format-duration="formatDuration"
      />

      <StatusTimeline
        :routes="data.routes"
        :get-hour-tooltip="getHourTooltip"
      />

      <StatusHistory
        :history="history"
        :history-page="historyPage"
        :history-filter="historyFilter"
        :is-history-loading="isHistoryLoading"
        :history-error="Boolean(historyError)"
        :refresh-history="refreshHistory"
        :format-date-time="formatDateTime"
        :format-relative="formatRelative"
        :format-duration="formatDuration"
        @previous-page="previousHistoryPage"
        @next-page="nextHistoryPage"
        @update-filter="updateHistoryFilter"
      />

      <p class="text-xs leading-5 text-dimmed">
        감지 작업은 {{ data.schedule.intervalMinutes }}분마다 실행됩니다. 새 기록이 {{ data.schedule.delayedAfterMinutes }}분 이상 없으면
        감지 지연, {{ data.schedule.outageAfterMinutes }}분 이상 없으면 감지 중단으로 표시합니다. 표시되는 성공률은 서버 가동률이 아니라
        저장된 패치 감지 실행 결과를 기준으로 계산합니다.
      </p>
    </template>
  </section>
</template>
