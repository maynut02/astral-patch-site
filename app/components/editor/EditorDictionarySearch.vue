<script setup lang="ts">
import type { EditorPageState } from '~/utils/editor-page-state'
import { formatEditorCount } from '~/utils/editor-helpers'
import { getEditorItemKey } from '~/utils/editor-links'

const props = defineProps<{ state: EditorPageState }>()
const {
  dictionarySearch, dictionarySearchData, dictionarySearchError, dictionarySearchInput,
  dictionarySearchItems, dictionarySearchRows, dictionarySearchStatus, expandedDictionarySearchItemId,
  openDictionarySearchItem, runDictionarySearch, toggleDictionarySearchItem
} = props.state
</script>

<template>
  <div class="flex shrink-0 gap-2 border-b border-default p-3">
    <UInput
      v-model="dictionarySearchInput"
      color="neutral"
      variant="soft"
      class="w-full"
      placeholder="전체 검색"
      :ui="{ base: 'h-8 leading-5', trailing: 'pe-1' }"
      @keydown.enter.prevent="runDictionarySearch"
    >
      <template #trailing>
        <UButton
          v-if="dictionarySearchInput.length"
          color="neutral"
          variant="link"
          size="sm"
          icon="i-tabler-x"
          aria-label="검색어 지우기"
          @click="dictionarySearchInput = ''"
        />
        <UButton
          icon="i-tabler-search"
          color="neutral"
          variant="link"
          size="sm"
          aria-label="파일 검색"
          :disabled="dictionarySearchInput.trim() === dictionarySearch"
          @click="runDictionarySearch"
        />
      </template>
    </UInput>
  </div>

  <div class="editor-scrollbar min-h-0 flex-1 overflow-y-auto">
    <div
      v-if="dictionarySearchStatus === 'pending'"
      class="flex items-center justify-center p-6 text-muted"
    >
      <AppLoadingSpinner />
    </div>
    <UAlert
      v-else-if="dictionarySearchStatus === 'error'"
      color="error"
      variant="soft"
      :title="dictionarySearchError"
      class="m-3"
    />
    <div
      v-else-if="!dictionarySearch"
      class="flex flex-col items-center justify-center p-6 text-center text-sm text-muted"
    >
      <UIcon
        name="i-tabler-search"
        class="size-6 text-dimmed"
      />
      <p class="mt-2">
        검색어를 입력해 주세요.
      </p>
    </div>
    <div
      v-else-if="!dictionarySearchItems.length"
      class="flex flex-col items-center justify-center p-6 text-center text-sm text-muted"
    >
      <UIcon
        name="i-tabler-file-search"
        class="size-6 text-dimmed"
      />
      <p class="mt-2">
        검색 결과가 없습니다.
      </p>
    </div>
    <div
      v-else
      class="flex flex-col"
    >
      <div class="border-b border-default px-4 py-2 text-xs text-dimmed">
        {{ formatEditorCount(dictionarySearchData.total) }}개 결과
      </div>
      <article
        v-for="row in dictionarySearchRows"
        :key="row.item.id"
        class="border-b border-default hover:bg-elevated/70 transition-colors"
      >
        <div class="flex min-w-0 items-start">
          <button
            type="button"
            class="flex min-w-0 flex-1 flex-col gap-2 px-4 py-3 text-left transition-colors"
            :aria-expanded="expandedDictionarySearchItemId === row.item.id"
            @click="toggleDictionarySearchItem(row.item.id)"
          >
            <div class="flex min-w-0 items-center gap-2">
              <UIcon
                name="i-tabler-file-filled"
                class="size-4 shrink-0 text-dimmed"
              />
              <span class="min-w-0 flex-1 truncate text-xs font-medium">
                <EditorHighlightedText
                  :text="getEditorItemKey(row.item)"
                  :query="dictionarySearch"
                />
              </span>
              <UIcon
                :name="expandedDictionarySearchItemId === row.item.id ? 'i-tabler-chevron-up' : 'i-tabler-chevron-down'"
                class="size-4 shrink-0 text-dimmed"
              />
            </div>
            <div class="flex flex-col gap-1 pl-6 text-xs text-muted">
              <div
                v-for="field in row.fields"
                :key="`${row.item.id}-${field.label}`"
                class="flex min-w-0 gap-2"
              >
                <span class="w-16 shrink-0 text-[10px] text-dimmed">{{ field.label }}</span>
                <span class="min-w-0 flex-1 wrap-break-word">
                  <EditorHighlightedText
                    :text="field.text"
                    :query="dictionarySearch"
                    :lang="field.lang"
                  />
                </span>
              </div>
            </div>
          </button>
        </div>
        <div
          v-if="expandedDictionarySearchItemId === row.item.id"
          class="flex flex-col gap-2 border-t border-default bg-elevated/40 px-4 py-3 relative"
        >
          <div
            v-for="field in row.expandedFields"
            :key="`${row.item.id}-expanded-${field.label}`"
            class="flex min-w-0 gap-3 text-xs"
          >
            <span class="w-14 shrink-0 text-[10px] text-dimmed text-right">{{ field.label }}</span>
            <span
              v-if="field.text"
              class="min-w-0 flex-1 wrap-break-word whitespace-pre-wrap"
            >
              <EditorHighlightedText
                :text="field.text"
                :query="dictionarySearch"
                :lang="field.lang"
              />
            </span>
            <span
              v-else
              class="text-dimmed"
            >—</span>
          </div>

          <UButton
            icon="i-tabler-arrow-up-right"
            color="info"
            variant="ghost"
            size="xs"
            class="absolute top-2 right-2 p-1"
            aria-label="항목으로 이동"
            @click.stop="void openDictionarySearchItem(row.item)"
          />
        </div>
      </article>
    </div>
  </div>
</template>
