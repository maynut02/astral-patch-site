<script setup lang="ts">
import type { EditorPageState } from '~/utils/editor-page-state'
import { formatEditorCount } from '~/utils/editor-helpers'

const props = defineProps<{ state: EditorPageState }>()
const {
  dictionaries, dictionariesError, dictionariesStatus, dictionaryEntries, dictionaryEntriesError,
  dictionaryEntriesSearch, dictionaryEntriesSearchInput, dictionaryEntriesStatus, dictionaryEntryItems,
  getDictionaryCreatorHandle, getDictionaryOwnerHandle, openCreateDictionary, openCreateDictionaryEntry,
  runDictionaryEntrySearch, selectDictionary, selectedDictionary, selectedDictionaryId
} = props.state
</script>

<template>
  <template v-if="selectedDictionary">
    <div class="flex shrink-0 items-start gap-2 border-b border-default p-3">
      <UButton
        icon="i-tabler-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="용어집 목록으로 돌아가기"
        @click="selectedDictionaryId = null"
      />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium">
          {{ selectedDictionary.name }}
        </p>
        <div class="flex min-w-0 items-center gap-1 text-xs text-dimmed">
          <span class="shrink-0">
            {{ selectedDictionary.visibility === 'public' ? '공개 용어집' : '비공개 용어집' }} ·
          </span>
          <AppUserIdentity
            :handle="getDictionaryOwnerHandle(selectedDictionary)"
            :role="selectedDictionary.ownerRole"
            text-class="text-xs text-dimmed"
            icon-class="size-3"
            stop-propagation
          />
        </div>
      </div>
      <UButton
        v-if="selectedDictionary.canEdit"
        icon="i-tabler-plus"
        color="neutral"
        variant="soft"
        size="sm"
        aria-label="용어 추가"
        @click="openCreateDictionaryEntry"
      />
    </div>

    <div class="flex shrink-0 gap-2 border-b border-default p-3">
      <UInput
        v-model="dictionaryEntriesSearchInput"
        icon="i-tabler-search"
        color="neutral"
        variant="soft"
        class="w-full"
        placeholder="용어 검색"
        :ui="{ base: 'h-8 leading-5', trailing: 'pe-1', leadingIcon: 'size-4' }"
        @keydown.enter.prevent="runDictionaryEntrySearch"
      >
        <template #trailing>
          <UButton
            v-if="dictionaryEntriesSearchInput.length"
            color="neutral"
            variant="link"
            size="sm"
            icon="i-tabler-x"
            aria-label="용어 검색어 지우기"
            @click="dictionaryEntriesSearchInput = ''; runDictionaryEntrySearch()"
          />
          <UButton
            icon="i-tabler-search"
            color="neutral"
            variant="link"
            size="sm"
            aria-label="용어 검색"
            :disabled="dictionaryEntriesSearchInput.trim() === dictionaryEntriesSearch"
            @click="runDictionaryEntrySearch"
          />
        </template>
      </UInput>
    </div>

    <div class="editor-scrollbar min-h-0 flex-1 overflow-y-auto">
      <div
        v-if="dictionaryEntriesStatus === 'pending'"
        class="flex items-center justify-center p-6 text-muted"
      >
        <AppLoadingSpinner />
      </div>
      <UAlert
        v-else-if="dictionaryEntriesStatus === 'error'"
        color="error"
        variant="soft"
        :title="dictionaryEntriesError"
        class="m-3"
      />
      <div
        v-else-if="!dictionaryEntryItems.length"
        class="flex flex-col items-center justify-center p-6 text-center text-sm text-muted"
      >
        <UIcon
          name="i-tabler-book-2"
          class="size-6 text-dimmed"
        />
        <p class="mt-2">
          아직 등록된 용어가 없습니다.
        </p>
        <UButton
          v-if="selectedDictionary.canEdit"
          color="neutral"
          variant="soft"
          size="sm"
          class="mt-3"
          @click="openCreateDictionaryEntry"
        >
          용어 추가
        </UButton>
      </div>
      <div
        v-else
        class="flex flex-col"
      >
        <div class="border-b border-default px-4 py-2 text-xs text-dimmed">
          {{ formatEditorCount(dictionaryEntries.total) }}개 용어
        </div>
        <article
          v-for="entry in dictionaryEntryItems"
          :key="entry.id"
          class="flex flex-col gap-1 border-b border-default px-4 py-3 text-sm"
        >
          <div class="flex items-start gap-2">
            <span class="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word font-medium">{{
              entry.sourceText }}</span>
            <UIcon
              name="i-tabler-arrow-narrow-right"
              class="mt-0.5 size-4 shrink-0 text-dimmed"
            />
            <span class="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word">{{ entry.translation
            }}</span>
          </div>
          <p
            v-if="entry.note"
            class="whitespace-pre-wrap wrap-break-word text-xs text-muted"
          >
            {{
              entry.note }}
          </p>
          <div class="flex items-center gap-1 text-[10px] text-dimmed">
            <AppUserIdentity
              :handle="getDictionaryCreatorHandle(entry)"
              :role="entry.creatorRole"
              text-class="text-[10px] text-dimmed"
              icon-class="size-3"
              stop-propagation
            />
          </div>
        </article>
      </div>
    </div>
  </template>

  <template v-else>
    <div class="flex shrink-0 items-center justify-between gap-3 border-b border-default p-3">
      <p class="text-sm font-medium h-8 flex items-center">
        용어집
      </p>
      <UButton
        icon="i-tabler-plus"
        color="neutral"
        variant="soft"
        size="sm"
        @click="openCreateDictionary"
      >
        새 용어집
      </UButton>
    </div>

    <div class="editor-scrollbar min-h-0 flex-1 overflow-y-auto">
      <div
        v-if="dictionariesStatus === 'pending'"
        class="flex items-center justify-center p-6 text-muted"
      >
        <AppLoadingSpinner />
      </div>
      <div
        v-else-if="dictionariesStatus === 'error'"
        class="flex p-3"
      >
        <UAlert
          color="error"
          variant="soft"
          :title="dictionariesError"
        />
      </div>
      <div
        v-else-if="!dictionaries.length"
        class="flex flex-col items-center justify-center p-6 text-center text-sm text-muted"
      >
        <UIcon
          name="i-tabler-books"
          class="size-6 text-dimmed"
        />
        <p class="mt-2">
          등록된 용어집이 없습니다.
        </p>
      </div>
      <nav
        v-else
        class="flex flex-col"
      >
        <div
          v-for="dictionary in dictionaries"
          :key="dictionary.id"
          role="button"
          tabindex="0"
          class="flex min-w-0 items-start gap-3 border-b border-default px-4 py-3 text-left transition-colors hover:bg-elevated/70"
          @click="selectDictionary(dictionary.id)"
          @keydown.enter.prevent="selectDictionary(dictionary.id)"
          @keydown.space.prevent="selectDictionary(dictionary.id)"
        >
          <UIcon
            :name="dictionary.visibility === 'public' ? 'i-tabler-book-2' : 'i-tabler-lock'"
            class="mt-0.5 size-4 shrink-0 text-dimmed"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">{{ dictionary.name }}</span>
            <span
              v-if="dictionary.description"
              class="mt-0.5 block truncate text-xs text-muted"
            >
              {{ dictionary.description }}
            </span>
            <span class="mt-1 flex items-center gap-1 text-[10px] text-dimmed">
              <AppUserIdentity
                :handle="getDictionaryOwnerHandle(dictionary)"
                :role="dictionary.ownerRole"
                text-class="text-[10px] text-dimmed"
                icon-class="size-3"
                stop-propagation
              />
              <span>· {{ formatEditorCount(dictionary.entryCount) }}개 용어</span>
            </span>
          </span>
        </div>
      </nav>
    </div>
  </template>
</template>
