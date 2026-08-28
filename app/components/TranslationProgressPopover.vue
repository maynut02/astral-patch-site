<script setup lang="ts">
import type { EditorProgressCounts } from '#shared/types/editor-overview'
import {
  EDITOR_PROGRESS_STATUSES,
  EDITOR_STATUS_META,
  getProgressSegments
} from '~/utils/editor-progress'
import { formatEditorCount, formatEditorPercent } from '~/utils/editor-helpers'

type ProgressBarSize = 'overall' | 'row'

const props = withDefaults(defineProps<{
  label: string
  counts: EditorProgressCounts
  total: number
  size?: ProgressBarSize
  ariaLabel?: string
}>(), {
  size: 'row',
  ariaLabel: undefined
})

const segments = computed(() => getProgressSegments(props.counts, props.total))
const progressBarClass = computed(() => props.size === 'overall' ? 'w-20 sm:w-24' : 'w-20 sm:w-32 lg:w-52')
const progressAriaLabel = computed(() => props.ariaLabel || `${props.label} 번역 진행률`)
</script>

<template>
  <UPopover
    mode="hover"
    enable-touch
    :content="{ side: 'top', align: 'center', sideOffset: 8 }"
  >
    <div
      class="relative flex h-2.5 shrink-0 overflow-hidden bg-elevated"
      :class="progressBarClass"
      role="img"
      tabindex="0"
      :aria-label="progressAriaLabel"
    >
      <div
        class="absolute inset-0 flex"
        aria-hidden="true"
      >
        <div
          v-for="segment in segments"
          :key="segment.status"
          class="h-full shrink-0"
          :class="[
            EDITOR_STATUS_META[segment.status].color,
            segment.isLast ? '' : 'border-r-2 border-default'
          ]"
          :style="{ width: `${segment.percentage}%` }"
        />
      </div>
    </div>

    <template #content>
      <div class="w-64 max-w-[calc(100vw-2rem)] p-3 text-xs">
        <div class="flex items-center justify-between gap-4">
          <h3 class="min-w-0 truncate text-sm font-semibold">
            {{ label }}
          </h3>
          <span class="shrink-0 font-mono text-muted">
            {{ formatEditorPercent(counts.success, total) }}
          </span>
        </div>

        <div class="mt-3 flex items-center justify-between border-t border-default pt-3">
          <span class="text-muted">완료 항목</span>
          <span class="font-mono">
            {{ formatEditorCount(counts.success) }} / {{ formatEditorCount(total) }}
          </span>
        </div>

        <div class="mt-3 flex flex-col gap-2 border-t border-default pt-3">
          <div
            v-for="status in EDITOR_PROGRESS_STATUSES"
            :key="status"
            class="flex items-center justify-between gap-4"
          >
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="size-1.5 shrink-0 rounded-full"
                :class="EDITOR_STATUS_META[status].color"
                aria-hidden="true"
              />
              <span class="truncate text-muted">
                {{ EDITOR_STATUS_META[status].label }}
              </span>
            </div>
            <div class="flex shrink-0 text-right font-mono">
              <span>{{ formatEditorCount(counts[status]) }}</span>
              <span
                class="mx-1.5"
                aria-hidden="true"
              >·</span>
              <span class="w-10">
                {{ formatEditorPercent(counts[status], total) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UPopover>
</template>
