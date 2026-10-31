<script setup lang="ts">
import type { EditorDictionaryEntry } from '#shared/types/editor-dictionary'
import type { EditorItem, EditorItemsResponse } from '#shared/types/editor'
import { getEditorItemLocation, getEditorItemKey } from '~/utils/editor-links'
import { EDITOR_SOURCE_LANGUAGE_OPTIONS } from '~/utils/editor-options'
import { EDITOR_STATUS_META, getEditorItemStatus } from '~/utils/editor-progress'

const props = defineProps<{ entry: EditorDictionaryEntry }>()
const source = ref('ko')
const page = ref(1)
const choices = computed(() => [
  { label: '한국어 표기', value: 'ko', text: props.entry.translation }, { label: '일본어 표현', value: 'jp', text: props.entry.metadata.japanese },
  { label: '중국어 간체 표현', value: 'cnS', text: props.entry.metadata.chineseSimplified }, { label: '중국어 번체 표현', value: 'cnT', text: props.entry.metadata.chineseTraditional }
].filter(option => option.text))
const search = computed(() => choices.value.find(option => option.value === source.value)?.text ?? props.entry.translation)
function sourceTexts(item: EditorItem) {
  return EDITOR_SOURCE_LANGUAGE_OPTIONS.filter(language => item[language.key] && (source.value === 'ko' || item[language.key].toLocaleLowerCase().includes(search.value.toLocaleLowerCase())))
}
function itemStatus(item: EditorItem) {
  return EDITOR_STATUS_META[getEditorItemStatus(item)]
}
const { data, status, error } = await useFetch<EditorItemsResponse>('/api/editor/items', {
  server: false, query: computed(() => ({ page: page.value, search: search.value, searchType: source.value === 'ko' ? 'translation' : 'source' }))
})
watch(() => props.entry.id, () => {
  page.value = 1
  source.value = 'ko'
})
watch(source, () => {
  page.value = 1
})
</script>

<template>
  <section class="flex flex-col gap-3 p-4">
    <USelect v-model="source" :items="choices.map(({ label, value }) => ({ label, value }))" aria-label="사용처 검색 표현" />
    <p class="text-xs">
      {{ source === 'ko' ? '한국어' : '원문 전체' }} · {{ search }}<span v-if="status === 'success'"> · {{ data?.total ?? 0 }}개</span>
    </p>
    <AppLoadingSpinner v-if="status === 'pending'" />
    <UAlert v-else-if="error" color="error" title="사용처를 불러오지 못했습니다." />
    <article v-for="item in status === 'success' ? data?.items ?? [] : []" :key="item.id" class="border-b border-default pb-3 text-sm">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="font-mono text-xs text-dimmed">
          {{ getEditorItemKey(item) }}
        </p><span class="text-xs" :class="itemStatus(item).textColor">{{ itemStatus(item).label }}</span>
      </div>
      <div v-for="language in sourceTexts(item)" :key="language.key" class="mt-2">
        <p class="text-[10px] text-dimmed">
          {{ language.label }}
        </p>
        <EditorHighlightedText
          :text="item[language.key]"
          :query="source === 'ko' ? '' : search"
          :lang="language.lang"
          class="line-clamp-3 text-xs text-muted"
        />
      </div>
      <p v-if="item.ko.trim()" class="mt-2 whitespace-pre-wrap">
        {{ item.ko }}
      </p>
      <UButton
        :to="getEditorItemLocation(item)"
        target="_blank"
        color="info"
        variant="link"
        size="xs"
        class="mt-2 px-0"
      >
        에디터에서 열기 ↗
      </UButton>
    </article>
    <p v-if="status === 'success' && !data?.items.length" class="text-sm text-muted">
      일치하는 사용처가 없습니다.
    </p>
    <div v-if="data && data.totalPages > 1" class="flex items-center gap-3">
      <UButton
        :disabled="page <= 1 || status === 'pending'"
        size="xs"
        color="neutral"
        @click="page--"
      >
        이전
      </UButton><span class="text-xs">{{ page }} / {{ data.totalPages }}</span><UButton
        :disabled="page >= data.totalPages || status === 'pending'"
        size="xs"
        color="neutral"
        @click="page++"
      >
        다음
      </UButton>
    </div>
  </section>
</template>
