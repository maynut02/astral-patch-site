<script setup lang="ts">
import type { PatchWatcherHourlyStat, PatchWatcherRouteSummary } from '#shared/types/status'
import { hourClass, routeMeta } from '~/utils/status-meta'

defineProps<{
  routes: PatchWatcherRouteSummary[]
  getHourTooltip: (hour: PatchWatcherHourlyStat) => string
}>()
</script>

<template>
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
        v-for="route in routes"
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
</template>
