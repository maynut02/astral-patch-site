<script setup lang="ts">
import type { EditorPageState } from '~/utils/editor-page-state'

const props = defineProps<{ state: EditorPageState }>()
const { activeFilterTags, isLoading, items, itemsError, listContainer, removeFilterTag, viewFilter } = props.state
</script>

<template>
  <div
    ref="listContainer"
    class="flex min-w-0 flex-1 flex-col pb-24 lg:min-h-0 editor-scrollbar lg:overflow-y-auto lg:pb-20"
  >
    <div class="flex flex-col bg-muted/60">
      <div
        v-if="activeFilterTags.length"
        class="flex flex-wrap items-center gap-2 px-4 pt-3 pb-3 md:pb-1"
      >
        <div
          v-for="tag in activeFilterTags"
          :key="tag.key"
          class="flex min-w-0 max-w-full items-center gap-1 bg-elevated px-2 py-1"
        >
          <span class="truncate text-xs">{{ tag.label }}: {{ tag.value }}</span>
          <UButton
            icon="i-tabler-x"
            color="neutral"
            variant="link"
            size="xs"
            class="size-5 justify-center shrink-0 p-0"
            :aria-label="`${tag.label} 제거`"
            @click="removeFilterTag(tag.key)"
          />
        </div>
      </div>
      <div class="hidden text-xs font-medium text-muted lg:flex">
        <span class="flex flex-1 shrink-0 px-5 py-2">원문</span>
        <span class="flex flex-1 shrink-0 px-5 py-2">한국어 번역</span>
      </div>
    </div>
    <div
      v-if="itemsError && !items.length"
      class="p-5 text-sm text-error"
    >
      항목을 불러오지 못했습니다.
    </div>
    <div
      v-else-if="!isLoading && !items.length"
      class="p-5 text-sm text-muted"
    >
      {{ viewFilter === 'changed' ? '변경된 항목이 없습니다.' : '검색 결과가 없습니다.' }}
    </div>
    <template v-else-if="items.length">
      <EditorItemRow
        v-for="item in items"
        :key="item.id"
        :item="item"
        :state="state"
      />
    </template>
  </div>
</template>
