<script setup lang="ts">
import {
  EDITOR_PROGRESS_STATUSES,
  type EditorProgressStatus,
  type EditorProgressSummary
} from '#shared/types/editor-overview'
import { formatEditorCount, formatEditorPercent } from '~/utils/editor-helpers'

interface EditorStatusMeta {
  label: string
  color: string
}

const props = defineProps<{
  title: string
  progress: EditorProgressSummary
  statusMeta: Record<EditorProgressStatus, EditorStatusMeta>
}>()

const visibleStatuses = computed(() => EDITOR_PROGRESS_STATUSES.filter(status => props.progress[status] > 0))
const lastVisibleStatus = computed(() => visibleStatuses.value.at(-1))
</script>

<template>
  <UPopover
    mode="hover"
    enable-touch
    :content="{ side: 'bottom', align: 'center', sideOffset: 8 }"
  >
    <div class="hidden items-center sm:flex">
      <div
        class="relative flex h-1.5 w-20 shrink-0 overflow-hidden bg-elevated sm:w-28"
        aria-label="현재 번역 진행률"
        role="img"
      >
        <div class="absolute inset-0 flex">
          <div
            v-for="status in visibleStatuses"
            :key="status"
            class="h-full shrink-0"
            :class="[statusMeta[status].color, status === lastVisibleStatus ? '' : 'border-r-2 border-default']"
            :style="{ width: `${progress.total > 0 ? (progress[status] / progress.total) * 100 : 0}%` }"
          />
        </div>
      </div>
    </div>

    <template #content>
      <div class="w-64 max-w-[calc(100vw-2rem)] p-3 text-xs">
        <div class="flex items-center justify-between gap-4">
          <h3 class="min-w-0 truncate text-sm font-semibold">
            {{ title }} 진행도
          </h3>
          <span class="shrink-0 font-mono text-muted">
            {{ formatEditorPercent(progress.success, progress.total) }}
          </span>
        </div>

        <div class="mt-3 flex items-center justify-between border-t border-default pt-3">
          <span class="text-muted">완료 항목</span>
          <span class="font-mono">
            {{ formatEditorCount(progress.success) }} / {{ formatEditorCount(progress.total) }}
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
                :class="statusMeta[status].color"
              />
              <span class="truncate text-muted">{{ statusMeta[status].label }}</span>
            </div>
            <div class="flex shrink-0 text-right font-mono">
              <span>{{ formatEditorCount(progress[status]) }}</span>
              <span class="mx-1.5">·</span>
              <span class="w-10">{{ formatEditorPercent(progress[status], progress.total) }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UPopover>
</template>
