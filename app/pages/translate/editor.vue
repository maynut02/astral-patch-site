<script setup lang="ts">
import type { EditorItemsResponse } from '#shared/types/editor'
import type { EditorOverviewResponse } from '#shared/types/editor-overview'
import { useEditorLayout } from '~/composables/editor-layout'
import { useEditorQuery } from '~/composables/editor-query'
import { useEditorDraftStorage } from '~/composables/editor-drafts'
import { useEditorPreferences } from '~/composables/editor-preferences'
import { useEditorItems } from '~/composables/editor-items'
import { useEditorActions } from '~/composables/editor-actions'
import { useEditorRealtime } from '~/composables/editor-realtime'
import { useEditorDictionaryPanel } from '~/composables/editor-dictionary-panel'
import { useEditorGlossaryContext } from '~/composables/editor-glossary-context'
import { createEmptyEditorItems, createEmptyEditorOverview } from '~/utils/editor-progress'
import { formatEditorCount, formatEditorPercent } from '~/utils/editor-helpers'
import type { EditorPageState } from '~/utils/editor-page-state'

definePageMeta({ layout: false })

const layout = useEditorLayout()
const query = useEditorQuery(layout)
const draftStorage = useEditorDraftStorage('astral-editor-translation-drafts-v1')
const preferences = useEditorPreferences()
const dictionary = useEditorDictionaryPanel(query, layout)
const { page, search, searchType, searchMatch, viewFilter, category, version, revision, isFileMode, isTagMode } = query
const changedItemIds = computed(() => {
  const ids = new Set<string>()
  for (const draft of Object.values(draftStorage.drafts.value)) {
    if (!draft.itemId || (isFileMode.value && draft.category !== category.value)) continue
    ids.add(draft.itemId)
  }
  return [...ids]
})

const requestQuery = computed(() => ({
  page: page.value,
  search: search.value || undefined,
  searchType: searchType.value,
  match: searchMatch.value === 'exact' ? 'exact' : undefined,
  status: viewFilter.value !== 'all' && viewFilter.value !== 'changed' ? viewFilter.value : undefined,
  itemIds: viewFilter.value === 'changed'
    ? changedItemIds.value.join(',') || '__none__'
    : undefined,
  category: isFileMode.value ? category.value : undefined,
  version: isTagMode.value ? version.value : undefined,
  revision: isTagMode.value ? revision.value : undefined
}))

const {
  data: itemsData,
  error: itemsError,
  status: itemsStatus,
  refresh: refreshItems
} = await useFetch<EditorItemsResponse>('/api/editor/items', {
  query: requestQuery,
  default: createEmptyEditorItems,
  server: false
})

const {
  data: overviewData,
  status: overviewStatus,
  error: overviewError,
  refresh: refreshOverview
} = await useFetch<EditorOverviewResponse>('/api/editor/overview', {
  server: false,
  lazy: true,
  default: createEmptyEditorOverview
})

const data = { itemsData, itemsError, itemsStatus, refreshItems, overviewData, overviewStatus, overviewError, refreshOverview }
const itemState = useEditorItems(data, query, layout, draftStorage)
const glossary = useEditorGlossaryContext(itemState.selectedItem)
const actions = useEditorActions(data, query, layout, itemState, draftStorage)
useEditorRealtime(data, { ...query, requestQuery }, itemState, draftStorage)
useAstralPageSeo(query.editorPageTitle)

const { displayLanguages, diffMode } = preferences
const visibleSourceLanguageItems = computed(() => query.sourceLanguageItems.filter(language => displayLanguages.value.includes(language.key)))
function toggleDisplayLanguage(language: typeof displayLanguages.value[number]): void {
  displayLanguages.value = displayLanguages.value.includes(language)
    ? displayLanguages.value.filter(value => value !== language)
    : [...displayLanguages.value, language]
}

const state: EditorPageState = { ...data, ...query, ...layout, ...draftStorage, ...preferences, ...itemState, ...actions, ...dictionary, ...glossary, visibleSourceLanguageItems, toggleDisplayLanguage }
const { backPath, headerTitle } = query
const { isSidebarOpen, isMobileSidebarOpen, activeSidebarMenu, activeSidebarMenuItem, sidebarMenuItems, editorToolbarHeight, selectSidebarMenu } = layout
const { total, currentProgress, isLoading, selectedItemId, selectedItemKey, selectedItemStatusMeta, historyReloadKey, totalPages } = itemState
const { handleHistoryChanged, openCommentItem } = actions
</script>

<template>
  <div class="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
    <header class="sticky top-0 z-50 flex h-16 shrink-0 items-center border-b border-default bg-muted px-2 sm:px-3 lg:relative lg:top-auto">
      <UButton
        :to="backPath"
        icon="i-tabler-chevron-left"
        color="neutral"
        variant="soft"
        size="lg"
        class="mr-2 sm:mr-4"
        :ui="{ leadingIcon: 'size-5 lg:size-6' }"
      />

      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex min-w-0 items-center gap-2 sm:gap-3">
          <h1
            class="truncate font-medium"
            :title="headerTitle"
          >
            {{ headerTitle }}
          </h1>
          <EditorProgressPopover
            :title="headerTitle"
            :progress="currentProgress"
          />
        </div>

        <span class="flex items-center gap-1.5 text-xs text-muted">
          <span>{{ formatEditorCount(total) }}개 항목</span>
          <span class="font-mono text-[#81C995] sm:hidden">
            {{ formatEditorPercent(currentProgress.success, currentProgress.total) }}
          </span>
        </span>
      </div>

      <div class="ml-2 flex shrink-0 items-center">
        <UButton
          icon="i-tabler-bell"
          color="neutral"
          variant="ghost"
          size="lg"
          :ui="{ leadingIcon: 'size-5', base: 'p-2 lg:p-2.5' }"
          class="hidden sm:inline-flex text-muted hover:text-default"
        />
        <AppUserMenu context="editor" />
        <UButton
          :icon="isMobileSidebarOpen ? 'i-tabler-layout-sidebar-right-filled' : 'i-tabler-layout-sidebar-right'"
          color="neutral"
          variant="ghost"
          size="lg"
          class="lg:hidden"
          :class="isMobileSidebarOpen ? 'bg-elevated text-default' : 'text-dimmed hover:text-default'"
          :aria-label="isMobileSidebarOpen ? '사이드바 닫기' : '사이드바 열기'"
          :aria-pressed="isMobileSidebarOpen"
          @click="isMobileSidebarOpen = !isMobileSidebarOpen"
        />
      </div>
    </header>

    <div class="flex flex-1 lg:min-h-0 lg:overflow-hidden">
      <main class="flex min-w-0 flex-1 flex-col lg:min-h-0 lg:border-r lg:border-default">
        <EditorToolbar :state="state" />

        <div class="relative flex flex-1 lg:min-h-0">
          <div
            v-if="isLoading"
            class="editor-loading-indicator pointer-events-none fixed inset-x-0 z-30 flex justify-center lg:absolute lg:z-10"
            :style="{ '--editor-toolbar-height': `${editorToolbarHeight}px` }"
          >
            <div class="flex items-center gap-3 bg-elevated/50 backdrop-blur-lg px-3 py-2 text-sm text-muted">
              <UIcon
                name="i-tabler-loader-2"
                class="size-4 animate-spin"
              />
              <span>불러오는 중...</span>
            </div>
          </div>

          <EditorItemList :state="state" />

          <EditorPageController
            v-model:page="page"
            :total-pages="totalPages"
            class="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 lg:absolute lg:left-auto lg:right-4 lg:translate-x-0"
          />
        </div>
      </main>

      <aside
        class="editor-sidebar shrink-0 overflow-hidden bg-muted"
        :class="{ 'editor-sidebar--desktop-open': isSidebarOpen, 'editor-sidebar--mobile-open': isMobileSidebarOpen }"
      >
        <section
          class="editor-sidebar-content absolute inset-x-0 bottom-0 top-14 flex shrink-0 flex-col border-t border-default transition-opacity lg:inset-y-0 lg:left-0 lg:right-auto lg:border-r lg:border-t-0"
          :class="isSidebarOpen || isMobileSidebarOpen
            ? 'opacity-100 duration-500 ease-out'
            : 'pointer-events-none opacity-0 duration-150 ease-in'"
        >
          <div class="flex items-center gap-2 px-4 pt-4 text-sm font-medium text-muted">
            <UIcon
              :name="activeSidebarMenuItem.icon"
              class="size-4"
            />
            <span>{{ activeSidebarMenuItem.label }}</span>
          </div>

          <template v-if="activeSidebarMenu === 'list'">
            <EditorSidebarListPanel :state="state" />
          </template>

          <template v-else-if="activeSidebarMenu === 'history'">
            <EditorChangeHistory
              :item-id="selectedItemId"
              :item-key="selectedItemKey"
              :reload-key="historyReloadKey"
              :item-status-label="selectedItemStatusMeta?.label ?? ''"
              :item-status-color="selectedItemStatusMeta?.textColor ?? 'text-muted'"
              :diff-mode="diffMode"
              @changed="handleHistoryChanged"
            />
          </template>

          <template v-else-if="activeSidebarMenu === 'comments'">
            <EditorComments
              :item-id="selectedItemId"
              :item-key="selectedItemKey"
              @navigate-item="openCommentItem"
            />
          </template>

          <template v-else-if="activeSidebarMenu === 'dictionary'">
            <EditorDictionaryPanel :state="state" />
          </template>

          <template v-else-if="activeSidebarMenu === 'settings'">
            <EditorSettingsPanel :state="state" />
          </template>
        </section>

        <nav class="absolute inset-x-0 top-0 z-20 flex h-14 min-h-0 shrink-0 gap-2 overflow-hidden bg-muted p-2.5 lg:inset-y-0 lg:left-auto lg:right-0 lg:h-auto lg:w-16 lg:flex-col lg:p-3">
          <div class="scrollbar-hidden flex min-h-0 min-w-0 flex-1 gap-2 overflow-x-auto overscroll-contain lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto">
            <UTooltip
              v-for="menu in sidebarMenuItems"
              :key="menu.key"
              :text="menu.label"
              :delay-duration="0"
              :content="{ side: 'left' }"
            >
              <UButton
                :icon="menu.icon"
                color="neutral"
                variant="ghost"
                size="lg"
                :ui="{ leadingIcon: 'size-5 lg:size-6' }"
                :class="activeSidebarMenu === menu.key ? 'bg-elevated text-default' : 'text-dimmed hover:text-default'"
                :aria-label="menu.label"
                :aria-current="activeSidebarMenu === menu.key ? 'page' : undefined"
                @click="selectSidebarMenu(menu.key)"
              />
            </UTooltip>
          </div>

          <UButton
            icon="i-tabler-x"
            color="neutral"
            variant="ghost"
            size="lg"
            class="text-dimmed lg:hidden"
            aria-label="사이드바 닫기"
            @click="isMobileSidebarOpen = false"
          />

          <div class="hidden lg:block">
            <UTooltip
              :text="isSidebarOpen ? '사이드바 닫기' : '사이드바 열기'"
              :delay-duration="0"
              :content="{ side: 'left' }"
            >
              <UButton
                :icon="isSidebarOpen ? 'i-tabler-layout-sidebar-right-filled' : 'i-tabler-layout-sidebar-right'"
                color="neutral"
                variant="ghost"
                size="xl"
                :class="isSidebarOpen ? 'text-default' : 'text-dimmed hover:text-default'"
                :aria-label="isSidebarOpen ? '사이드바 닫기' : '사이드바 열기'"
                :aria-pressed="isSidebarOpen"
                @click="isSidebarOpen = !isSidebarOpen"
              />
            </UTooltip>
          </div>
        </nav>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.editor-loading-indicator {
  top: calc(4rem + var(--editor-toolbar-height) + 1rem);
}

.editor-sidebar {
  position: fixed;
  inset: 0;
  z-index: 60;
  width: 100%;
  transform: translateX(100%);
  transition: transform 300ms ease-in-out;
}

.editor-sidebar--mobile-open {
  transform: translateX(0);
}

.editor-sidebar :deep(.editor-scrollbar) {
  overscroll-behavior: contain;
}

.editor-sidebar-content {
  width: 100%;
}

@media (min-width: 64rem) {
  .editor-loading-indicator {
    top: 1rem;
  }

  .editor-sidebar {
    position: relative;
    inset: auto;
    z-index: auto;
    width: 4rem;
    transform: none;
    transition: width 300ms ease-in-out;
  }

  .editor-sidebar--desktop-open {
    width: max(25%, 28rem);
  }

  .editor-sidebar-content {
    width: calc(max(25vw, 28rem) - 4rem);
  }
}
</style>
