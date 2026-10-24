<script setup lang="ts">
withDefaults(defineProps<{
  icon: string
  fileName: string
  title: string
  version: string
  releaseDate: string
  fileSize: string
  downloadCount: string
  kind?: 'tool' | 'patch'
}>(), {
  kind: 'tool'
})
</script>

<template>
  <article class="flex flex-col gap-1 border border-default bg-muted">
    <div class="flex flex-col gap-5 p-5">
      <div class="flex flex-col">
        <UIcon :name="icon" class="size-7 md:size-8" />
        <span :class="kind === 'tool' ? 'text-xs text-muted mt-3' : 'mt-3 text-xs text-muted'">{{ fileName }}</span>
        <span :class="kind === 'tool' ? 'text-xl font-medium mt-1' : 'mt-1 text-xl font-medium'">{{ title }}</span>
      </div>

      <div class="grid grid-cols-2 gap-x-2 gap-y-4">
        <div class="flex min-w-0 flex-col">
          <span class="text-xs text-dimmed">버전</span>
          <span class="truncate text-sm">{{ version }}</span>
        </div>
        <div class="flex min-w-0 flex-col">
          <span class="text-xs text-dimmed">릴리즈 시각</span>
          <span class="truncate text-sm">{{ releaseDate }}</span>
        </div>
        <div class="flex min-w-0 flex-col">
          <span class="text-xs text-dimmed">크기</span>
          <span class="text-sm">{{ fileSize }}</span>
        </div>
        <div class="flex min-w-0 flex-col">
          <span class="text-xs text-dimmed">다운로드</span>
          <span class="text-sm">{{ downloadCount }}</span>
        </div>
      </div>
    </div>

    <div :class="kind === 'tool' ? 'flex flex-col p-2 bg-default/75 h-full' : 'flex h-full flex-col bg-default/75 p-2'">
      <slot />
    </div>
  </article>
</template>
