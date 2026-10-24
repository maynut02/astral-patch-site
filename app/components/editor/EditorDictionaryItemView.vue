<script setup lang="ts">
import type { EditorPageState } from '~/utils/editor-page-state'

const props = defineProps<{ state: EditorPageState }>()
const {
  dictionaryError, dictionaryItem, dictionaryKey, dictionarySelection, dictionaryStatus,
  editDictionaryItem, selectDictionaryReference, visibleSourceLanguageItems
} = props.state
</script>

<template>
  <div
    v-if="dictionaryStatus === 'pending'"
    class="flex flex-1 flex-col"
  >
    <div class="flex shrink-0 items-center gap-2 border-b border-default p-3">
      <UButton
        icon="i-tabler-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="사전 메뉴로 돌아가기"
        @click="dictionarySelection = null"
      />
      <div class="min-w-0">
        <p class="truncate text-sm font-medium">
          {{ dictionarySelection?.originalText }}
        </p>
        <p class="truncate text-xs text-dimmed">
          {{ dictionaryKey }}
        </p>
      </div>
    </div>
    <div class="flex min-h-0 flex-1 items-center justify-center">
      <AppLoadingSpinner />
    </div>
  </div>

  <div
    v-else-if="dictionaryStatus === 'error'"
    class="flex min-h-0 flex-1 flex-col"
  >
    <div class="flex shrink-0 items-center gap-2 border-b border-default p-3">
      <UButton
        icon="i-tabler-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="사전 메뉴로 돌아가기"
        @click="dictionarySelection = null"
      />
      <div class="min-w-0">
        <p class="truncate text-sm font-medium">
          {{ dictionarySelection?.originalText }}
        </p>
        <p class="truncate text-xs text-dimmed">
          {{ dictionaryKey }}
        </p>
      </div>
    </div>
    <UAlert
      color="error"
      variant="soft"
      title="사전 항목을 불러오지 못했습니다."
      :description="dictionaryError"
      class="m-4"
    />
  </div>

  <div
    v-else-if="dictionaryStatus === 'success' && !dictionaryItem"
    class="flex min-h-0 flex-1 flex-col"
  >
    <div class="flex shrink-0 items-center gap-2 border-b border-default p-3">
      <UButton
        icon="i-tabler-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="사전 메뉴로 돌아가기"
        @click="dictionarySelection = null"
      />
      <div class="min-w-0">
        <p class="truncate text-sm font-medium">
          {{ dictionarySelection?.originalText }}
        </p>
        <p class="truncate text-xs text-dimmed">
          {{ dictionaryKey }}
        </p>
      </div>
    </div>
    <div class="flex flex-1 items-center justify-center p-5 text-center text-sm text-muted">
      <div>
        <UIcon
          name="i-tabler-file-off"
          class="mx-auto size-6 text-dimmed"
        />
        <p class="mt-2">
          대상 사전 항목을 찾을 수 없습니다.
        </p>
      </div>
    </div>
  </div>

  <div
    v-else-if="dictionaryItem"
    class="min-h-0 flex flex-1 flex-col"
  >
    <div class="flex shrink-0 items-center gap-2 border-b border-default p-3">
      <UButton
        icon="i-tabler-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="사전 메뉴로 돌아가기"
        @click="dictionarySelection = null"
      />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium">
          {{ dictionarySelection?.originalText }}
        </p>
        <p class="truncate text-xs text-dimmed">
          {{ dictionaryKey }}
        </p>
      </div>
      <UButton
        color="neutral"
        variant="soft"
        size="xs"
        @click="editDictionaryItem"
      >
        수정
      </UButton>
    </div>

    <div class="editor-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
      <div class="mt-1 flex flex-col gap-3 text-sm">
        <div
          v-for="source in visibleSourceLanguageItems"
          :key="source.key"
          class="flex flex-col gap-0.5"
        >
          <span class="text-[10px] text-dimmed">{{ source.label }}</span>
          <div class="whitespace-pre-wrap wrap-break-word">
            <EditorSourceText
              :text="dictionaryItem[source.key] || null"
              :lang="source.lang"
              @select="selectDictionaryReference"
            >
              <template #empty>
                —
              </template>
            </EditorSourceText>
          </div>
        </div>

        <div class="flex flex-col gap-0.5 border-t border-default pt-3">
          <span class="text-[10px] text-dimmed">한국어 번역</span>
          <p
            lang="ko"
            class="whitespace-pre-wrap wrap-break-word"
          >
            {{ dictionaryItem.ko || '—' }}
          </p>
        </div>

        <div
          v-if="dictionaryItem.pendingStatus === 'pending'"
          class="flex flex-col gap-1 border-t border-default pt-3 text-info"
        >
          <span class="text-xs font-medium">승인 대기 번역</span>
          <p class="whitespace-pre-wrap wrap-break-word">
            {{ dictionaryItem.pendingKo || '—' }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
