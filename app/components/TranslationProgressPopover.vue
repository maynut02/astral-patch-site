<script setup lang="ts">
import type { EditorProgressCounts } from '#shared/types/editor-overview'
import {
  EDITOR_STATUS_META,
  getProgressSegments
} from '~/utils/editor-progress'

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
      <EditorProgressDetail
        :title="label"
        :counts="counts"
        :total="total"
        decorative
      />
    </template>
  </UPopover>
</template>
