<script setup lang="ts">
import type {
  PatchWatcherHourlyStat,
  PatchWatcherHourState,
  PatchWatcherHistoryResponse,
  PatchWatcherOverallState,
  PatchWatcherRoute,
  PatchWatcherRouteStatus,
  PatchWatcherRunStatus,
  PatchWatcherStatusResponse
} from '#shared/types/status'

type StatusColor = 'success' | 'warning' | 'error' | 'info' | 'neutral'
type HistoryFilter = 'all' | 'failed'

interface StatusMeta {
  label: string
  color: StatusColor
  icon: string
}

useAstralPageSeo('상태')

const routeMeta: Record<PatchWatcherRoute, { label: string, icon: string }> = {
  INT_STEAM: { label: 'Steam 글로벌', icon: 'i-tabler-brand-steam' },
  CN_STEAM: { label: 'Steam 중국', icon: 'i-tabler-brand-steam' },
  INT_ANDROID: { label: 'Android 일본', icon: 'i-tabler-brand-android' }
}

const overallMeta: Record<PatchWatcherOverallState, StatusMeta> = {
  operational: { label: '정상 운영 중', color: 'success', icon: 'i-tabler-circle-check-filled' },
  checking: { label: '감지 중', color: 'info', icon: 'i-tabler-loader-2' },
  degraded: { label: '일부 문제', color: 'warning', icon: 'i-tabler-alert-triangle-filled' },
  outage: { label: '감지 시스템 문제', color: 'error', icon: 'i-tabler-circle-x-filled' },
  paused: { label: '감지 비활성화', color: 'neutral', icon: 'i-tabler-player-pause-filled' }
}

const runMeta: Record<PatchWatcherRunStatus, StatusMeta> = {
  running: { label: '감지 중', color: 'info', icon: 'i-tabler-loader-2' },
  success: { label: '정상', color: 'success', icon: 'i-tabler-check' },
  partial_failure: { label: '일부 실패', color: 'warning', icon: 'i-tabler-alert-triangle' },
  failed: { label: '실패', color: 'error', icon: 'i-tabler-x' },
  disabled: { label: '비활성화', color: 'neutral', icon: 'i-tabler-player-pause' },
  skipped_locked: { label: '건너뜀', color: 'neutral', icon: 'i-tabler-player-skip-forward' }
}

const routeStatusMeta: Record<PatchWatcherRouteStatus, StatusMeta> = {
  checking: { label: '확인 중', color: 'info', icon: 'i-tabler-loader-2' },
  unchanged: { label: '변경 없음', color: 'success', icon: 'i-tabler-check' },
  change_detected: { label: '업데이트 감지', color: 'info', icon: 'i-tabler-radar-2' },
  waiting_processing: { label: '처리 대기', color: 'info', icon: 'i-tabler-hourglass' },
  dispatched: { label: '생성 요청 완료', color: 'info', icon: 'i-tabler-send' },
  failed: { label: '감지 실패', color: 'error', icon: 'i-tabler-x' },
  unknown: { label: '기록 없음', color: 'neutral', icon: 'i-tabler-minus' }
}

const hourClass: Record<PatchWatcherHourState, string> = {
  operational: 'bg-success hover:bg-success/80',
  error: 'bg-error hover:bg-error/80',
  paused: 'bg-warning hover:bg-warning/80',
  no_data: 'bg-muted hover:bg-elevated'
}

const historyTabs: Array<{ label: string, value: HistoryFilter }> = [
  { label: '전체', value: 'all' },
  { label: '실패', value: 'failed' }
]

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

const relativeTimeNow = ref<number | null>(null)
let relativeTimeTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  relativeTimeNow.value = Date.now()
  relativeTimeTimer = setInterval(() => {
    relativeTimeNow.value = Date.now()
  }, 30_000)
})

onBeforeUnmount(() => {
  if (relativeTimeTimer) {
    clearInterval(relativeTimeTimer)
  }
})

const isLoading = computed(() => status.value === 'idle' || status.value === 'pending')
const isHistoryLoading = computed(() => historyStatus.value === 'idle' || historyStatus.value === 'pending')
const currentOverallMeta = computed(() => overallMeta[data.value?.overall.state ?? 'degraded'])

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
  if (!value) {
    return '기록 없음'
  }

  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) {
    return '기록 없음'
  }

  const now = relativeTimeNow.value ?? timestamp
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000))

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}초 전`
  }

  const minutes = Math.floor(elapsedSeconds / 60)
  if (minutes < 60) {
    return `${minutes}분 전`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}시간 전`
  }

  return `${Math.floor(hours / 24)}일 전`
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
            패치 감지 상태
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

      <div class="grid gap-4 lg:grid-cols-3">
        <article
          v-for="route in data.routes"
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
            class="mt-3 text-xs text-muted"
          >
            {{ route.message }}
          </p>

          <dl class="grid grid-cols-2 gap-4 text-sm p-5 bg-default/75">
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

      <section class="">
        <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="font-semibold text-default">
              최근 7일 상태
            </h2>
          </div>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dimmed">
            <span class="flex items-center gap-1"><span class="size-1.5 bg-success mt-px" /> 정상</span>
            <span class="flex items-center gap-1"><span class="size-1.5 bg-error mt-px" /> 실패</span>
            <span class="flex items-center gap-1"><span class="size-1.5 bg-warning mt-px" /> 일시중지</span>
            <span class="flex items-center gap-1"><span class="size-1.5 bg-accented mt-px" /> 기록 없음</span>
          </div>
        </div>

        <div class="flex flex-col gap-4">
          <div
            v-for="route in data.routes"
            :key="`timeline-${route.route}`"
            class="flex flex-col gap-2"
          >
            <div class="flex min-w-0 items-center gap-2">
              <UIcon
                :name="routeMeta[route.route].icon"
                class="size-4 shrink-0 text-muted"
              />
              <span class="truncate text-xs font-medium text-default">
                {{ routeMeta[route.route].label }}
              </span>
            </div>

            <div class="grid h-6 w-full min-w-0 items-stretch gap-px md:gap-0.5" style="grid-template-columns: repeat(168, minmax(0, 1fr));">
              <UTooltip
                v-for="hour in route.hourly"
                :key="hour.hour"
                :text="getHourTooltip(hour)"
                :delay-duration="0"
              >
                <span
                  class="block h-full min-w-0 cursor-help transition-colors"
                  :class="hourClass[hour.state]"
                />
              </UTooltip>
            </div>
          </div>
        </div>

        <div class="mt-2">
          <span class="hidden lg:block" />
          <div class="flex justify-between text-[10px] text-dimmed">
            <span>7일 전</span>
            <span>현재</span>
          </div>
        </div>
      </section>

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
          class="self-start"
          :ui="{
            list: 'w-full bg-elevated/50 p-1 sm:w-fit',
            trigger: 'h-8 justify-center px-3 leading-4 sm:flex-none'
          }"
          @update:model-value="updateHistoryFilter"
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
            @click="previousHistoryPage"
          >
            이전
          </UButton>
          <UButton
            trailing-icon="i-tabler-chevron-right"
            color="neutral"
            variant="soft"
            size="sm"
            :disabled="!history.hasMore || isHistoryLoading"
            @click="nextHistoryPage"
          >
            다음
          </UButton>
        </div>
      </section>

      <p class="text-xs leading-5 text-dimmed">
        감지 작업은 {{ data.schedule.intervalMinutes }}분마다 실행됩니다. 새 기록이 {{ data.schedule.delayedAfterMinutes }}분 이상 없으면
        감지 지연, {{ data.schedule.outageAfterMinutes }}분 이상 없으면 감지 중단으로 표시합니다. 표시되는 성공률은 서버 가동률이 아니라
        저장된 패치 감지 실행 결과를 기준으로 계산합니다.
      </p>
    </template>
  </section>
</template>
