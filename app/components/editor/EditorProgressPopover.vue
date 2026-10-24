<script setup lang="ts">
import {
  EDITOR_PROGRESS_STATUSES,
  type EditorProgressSummary
} from '#shared/types/editor-overview'
import { EDITOR_STATUS_META } from '~/utils/editor-progress'

const props = defineProps<{
  title: string
  progress: EditorProgressSummary
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
            :class="[EDITOR_STATUS_META[status].color, status === lastVisibleStatus ? '' : 'border-r-2 border-default']"
            :style="{ width: `${progress.total > 0 ? (progress[status] / progress.total) * 100 : 0}%` }"
          />
        </div>
      </div>
    </div>

    <template #content>
      <EditorProgressDetail :title="`${title} 진행도`" :counts="progress" :total="progress.total" />
    </template>
  </UPopover>
</template>
