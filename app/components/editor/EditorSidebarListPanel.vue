<script setup lang="ts">
import type { EditorPageState } from '~/utils/editor-page-state'
import { formatEditorPercent } from '~/utils/editor-helpers'

const props = defineProps<{ state: EditorPageState }>()
const {
  isActiveSidebarRow, isAllMode, isMobileSidebarOpen, isSidebarListLoading, overview,
  sidebarListHasError, sidebarListHasRows, sidebarListMode, sidebarListRows, sidebarListSearch
} = props.state
</script>

<template>
  <div class="flex shrink-0 flex-col gap-3 border-b border-default p-3 sm:flex-row">
    <UTabs
      v-model="sidebarListMode"
      :content="false"
      :items="[{ label: '파일', value: 'category' }, { label: '버전', value: 'version' }]"
      color="neutral"
      size="sm"
      :ui="{ trigger: 'h-7 leading-4 px-3', list: 'h-9 bg-elevated/50 p-1' }"
      class="w-fit"
    />

    <UInput
      v-model="sidebarListSearch"
      icon="i-tabler-search"
      color="neutral"
      variant="soft"
      size="lg"
      class="h-9 w-full min-w-0"
      :placeholder="sidebarListMode === 'category' ? '파일 검색' : '버전 검색'"
      :ui="{ base: 'h-9 leading-5', trailing: 'pe-1', leadingIcon: 'size-4' }"
    >
      <template
        v-if="sidebarListSearch.length"
        #trailing
      >
        <UButton
          color="neutral"
          variant="link"
          size="sm"
          icon="i-tabler-x"
          aria-label="검색어 지우기"
          @click="sidebarListSearch = ''"
        />
      </template>
    </UInput>
  </div>

  <div class="editor-scrollbar relative min-h-0 flex-1 overflow-y-auto">
    <div
      v-if="isSidebarListLoading && !sidebarListRows.length"
      class="flex items-center justify-center p-5 text-muted"
    >
      <AppLoadingSpinner />
    </div>

    <div
      v-else-if="sidebarListHasError && !sidebarListRows.length"
      class="p-4 text-sm text-error"
    >
      목록을 불러오지 못했습니다.
    </div>

    <nav
      v-else
      class="flex flex-col"
    >
      <NuxtLink
        to="/translate/editor"
        class="flex min-w-0 items-center gap-2 border-b border-default px-4 py-2.5 text-sm transition-colors"
        :class="isAllMode ? 'bg-elevated text-default' : 'text-muted hover:bg-elevated hover:text-default'"
        title="전체 번역"
        @click="isMobileSidebarOpen = false"
      >
        <UIcon
          name="i-tabler-language"
          class="size-4 shrink-0"
        />
        <span class="min-w-0 flex-1 truncate">전체 번역</span>
        <span class="shrink-0 font-mono text-xs text-[#81C995]">
          {{ formatEditorPercent(overview.overall.success, overview.overall.total) }}
        </span>
      </NuxtLink>

      <div
        v-if="!sidebarListRows.length"
        class="p-4 text-sm text-muted"
      >
        {{ sidebarListHasRows ? '검색 결과가 없습니다.' : sidebarListMode === 'category'
          ? '등록된 파일이 없습니다.' : '등록된 버전이 없습니다.' }}
      </div>

      <NuxtLink
        v-for="row in sidebarListRows"
        :key="row.key"
        :to="row.path"
        class="flex min-w-0 items-center gap-2 border-b border-default px-4 py-2.5 text-sm transition-colors"
        :class="isActiveSidebarRow(row) ? 'bg-elevated text-default' : 'text-muted hover:bg-elevated hover:text-default'"
        :title="row.label"
        @click="isMobileSidebarOpen = false"
      >
        <UIcon
          :name="row.mode === 'category' ? 'i-tabler-file-filled' : 'i-tabler-tag-filled'"
          class="size-4 shrink-0"
        />
        <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
        <span class="shrink-0 font-mono text-xs text-[#81C995]">
          {{ formatEditorPercent(row.counts.success, row.total) }}
        </span>
      </NuxtLink>
    </nav>
  </div>
</template>
