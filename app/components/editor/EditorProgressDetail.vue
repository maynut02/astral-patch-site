<script setup lang="ts">
import type { EditorProgressCounts } from '#shared/types/editor-overview'
import { EDITOR_PROGRESS_STATUSES, EDITOR_STATUS_META } from '~/utils/editor-progress'
import { formatEditorCount, formatEditorPercent } from '~/utils/editor-helpers'

defineProps<{
  title: string
  counts: EditorProgressCounts
  total: number
  decorative?: boolean
}>()
</script>

<template>
  <div class="w-64 max-w-[calc(100vw-2rem)] p-3 text-xs">
    <div class="flex items-center justify-between gap-4">
      <h3 class="min-w-0 truncate text-sm font-semibold">
        {{ title }}
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
            :aria-hidden="decorative ? true : undefined"
          />
          <span class="truncate text-muted">{{ EDITOR_STATUS_META[status].label }}</span>
        </div>
        <div class="flex shrink-0 text-right font-mono">
          <span>{{ formatEditorCount(counts[status]) }}</span>
          <span class="mx-1.5" :aria-hidden="decorative ? true : undefined">·</span>
          <span class="w-10">{{ formatEditorPercent(counts[status], total) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
