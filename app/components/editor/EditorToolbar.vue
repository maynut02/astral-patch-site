<script setup lang="ts">
import type { EditorPageState } from '~/utils/editor-page-state'

const props = defineProps<{ state: EditorPageState }>()
const {
  aiTranslationTooltip, applySearch, copySelectedItemLink, currentPageDraftCount, editorToolbar,
  isAiTranslating, isSaving, isSearchFilterActive, isViewFilterActive, optionsPopoverOpen,
  revertCurrentPageDrafts, revertSelectedItem, saveCurrentPage, search, searchFilterOpen, searchInput,
  searchMatch, searchMatchOptions, searchType, searchTypeOptions, selectSearchMatch, selectSearchType,
  selectViewFilter, selectedItem, selectedItemHasDraft, selectedItemHasSource, selectedItemId,
  translateSelectedItemWithAi, viewFilter, viewFilterOpen, viewFilterOptions
} = props.state
</script>

<template>
  <div
    ref="editorToolbar"
    class="sticky top-16 z-40 flex shrink-0 flex-wrap gap-1.5 border-b border-default bg-muted p-1.5 sm:gap-2 sm:p-2 md:flex-nowrap lg:static lg:z-auto"
  >
    <div class="flex w-full min-w-0 flex-1 gap-1 md:w-auto">
      <UInput
        v-model="searchInput"
        size="lg"
        color="neutral"
        variant="ghost"
        placeholder="검색"
        class="min-w-0 max-md:flex-1"
        :ui="{ base: 'h-9 leading-5 px-2', trailing: 'pe-1.5' }"
        @keydown.enter.prevent="applySearch"
      >
        <template #trailing>
          <UButton
            icon="i-tabler-search"
            color="neutral"
            variant="link"
            size="md"
            aria-label="검색"
            :disabled="searchInput.trim() === search"
            @click="applySearch"
          />
        </template>
      </UInput>
      <div class="my-1 border-x border-default mx-1" />
      <UPopover
        v-model:open="searchFilterOpen"
        :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
      >
        <UTooltip
          text="검색 설정"
          :delay-duration="0"
        >
          <div class="relative">
            <UButton
              icon="i-tabler-adjustments-horizontal"
              color="neutral"
              variant="ghost"
              size="lg"
              :class="searchFilterOpen
                ? 'bg-elevated text-default'
                : isSearchFilterActive ? 'text-default' : 'text-dimmed hover:text-default'"
              aria-label="검색 설정"
            />
            <span
              v-if="isSearchFilterActive"
              class="pointer-events-none absolute right-1.5 top-1.5 size-1.5 rounded-full bg-info ring-1 ring-muted"
            />
          </div>
        </UTooltip>
        <template #content>
          <div class="flex min-w-40 flex-col p-1.5">
            <span class="px-2 py-1 text-xs font-medium text-dimmed">검색 범위</span>
            <button
              v-for="option in searchTypeOptions"
              :key="option.key"
              type="button"
              class="flex items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
              @click="void selectSearchType(option.key)"
            >
              <UIcon
                v-if="searchType === option.key"
                name="i-tabler-check"
                class="size-4"
              />
              <span
                v-else
                class="size-4"
              />
              <span>{{ option.label }}</span>
            </button>

            <div class="mt-2 border-t border-default pt-2">
              <span class="px-2 py-1 text-xs font-medium text-dimmed">검색 옵션</span>
              <button
                v-for="option in searchMatchOptions"
                :key="option.key"
                type="button"
                class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                @click="void selectSearchMatch(option.key)"
              >
                <UIcon
                  v-if="searchMatch === option.key"
                  name="i-tabler-check"
                  class="size-4"
                />
                <span
                  v-else
                  class="size-4"
                />
                <span>{{ option.label }}</span>
              </button>
            </div>
          </div>
        </template>
      </UPopover>

      <UPopover
        v-model:open="viewFilterOpen"
        :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
      >
        <UTooltip
          text="보기 설정"
          :delay-duration="0"
        >
          <div class="relative">
            <UButton
              icon="i-tabler-eye-search"
              color="neutral"
              variant="ghost"
              size="lg"
              :class="viewFilterOpen
                ? 'bg-elevated text-default'
                : isViewFilterActive ? 'text-default' : 'text-dimmed hover:text-default'"
              aria-label="보기 설정"
            />
            <span
              v-if="isViewFilterActive"
              class="pointer-events-none absolute right-1.5 top-1.5 size-1.5 rounded-full bg-info ring-1 ring-muted"
            />
          </div>
        </UTooltip>
        <template #content>
          <div class="flex min-w-40 flex-col p-1.5">
            <span class="px-2 py-1 text-xs font-medium text-dimmed">보기 설정</span>
            <button
              v-for="option in viewFilterOptions"
              :key="option.key"
              type="button"
              :disabled="option.disabled"
              class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed! disabled:opacity-50"
              @click="selectViewFilter(option.key)"
            >
              <UIcon
                v-if="viewFilter === option.key"
                name="i-tabler-check"
                class="size-4"
              />
              <span
                v-else
                class="size-4"
              />
              <span>{{ option.label }}</span>
            </button>
          </div>
        </template>
      </UPopover>
    </div>

    <div class="flex w-full shrink-0 justify-end gap-1 sm:gap-2 md:w-auto">
      <UTooltip
        :text="currentPageDraftCount ? `현재 페이지 저장 (${currentPageDraftCount}건)` : '저장'"
        :delay-duration="0"
      >
        <UButton
          icon="i-tabler-device-floppy-filled"
          color="info"
          variant="soft"
          size="lg"
          :loading="isSaving"
          :disabled="!currentPageDraftCount || isSaving"
          @click="saveCurrentPage"
        />
      </UTooltip>
      <UTooltip
        text="변경사항 되돌리기"
        :delay-duration="0"
      >
        <UButton
          icon="i-tabler-arrow-back-up"
          color="neutral"
          variant="ghost"
          size="lg"
          :disabled="!selectedItemHasDraft"
          @click="revertSelectedItem"
        />
      </UTooltip>
      <UTooltip
        :text="aiTranslationTooltip"
        :delay-duration="0"
      >
        <UButton
          icon="i-tabler-sparkles-2"
          color="neutral"
          variant="ghost"
          size="lg"
          aria-label="AI 번역"
          :loading="isAiTranslating"
          :disabled="!selectedItem || !selectedItemHasSource || isAiTranslating || isSaving"
          @click="translateSelectedItemWithAi"
        />
      </UTooltip>
      <UPopover
        v-model:open="optionsPopoverOpen"
        :content="{ align: 'end', side: 'bottom', sideOffset: 8 }"
      >
        <UTooltip
          text="옵션"
          :delay-duration="0"
        >
          <UButton
            icon="i-tabler-dots-vertical"
            color="neutral"
            variant="ghost"
            size="lg"
            :class="optionsPopoverOpen ? 'bg-elevated text-default' : ''"
            aria-label="옵션"
          />
        </UTooltip>
        <template #content>
          <div class="flex min-w-56 flex-col p-1.5">
            <button
              type="button"
              class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed! disabled:opacity-50"
              :disabled="!selectedItemId"
              @click="void copySelectedItemLink()"
            >
              <UIcon
                name="i-tabler-link"
                class="size-4 shrink-0"
              />
              <span>선택 항목 링크 복사</span>
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed! disabled:opacity-50"
              :disabled="!currentPageDraftCount"
              @click="revertCurrentPageDrafts"
            >
              <UIcon
                name="i-tabler-arrow-back-up"
                class="size-4 shrink-0"
              />
              <span>현재 페이지 변경사항 되돌리기</span>
            </button>
          </div>
        </template>
      </UPopover>
    </div>
  </div>
</template>
