<script setup lang="ts">
import type { EditorDictionaryEntry } from '#shared/types/editor-dictionary'
import type { EditorItemsResponse } from '#shared/types/editor'
import { getEditorItemLocation, getEditorItemKey } from '~/utils/editor-links'

const props = defineProps<{ entry: EditorDictionaryEntry }>()
const source = ref('ko')
const page = ref(1)
const choices = computed(() => [
  { label: '한국어', value: 'ko', text: props.entry.translation }, { label: '일본어', value: 'jp', text: props.entry.metadata.japanese },
  { label: '중국어 간체', value: 'cnS', text: props.entry.metadata.chineseSimplified }, { label: '중국어 번체', value: 'cnT', text: props.entry.metadata.chineseTraditional }
].filter(option => option.text))
const search = computed(() => choices.value.find(option => option.value === source.value)?.text ?? props.entry.translation)
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
    <p class="text-xs text-muted">
      선택한 표현을 현재 번역 자료에서 검색합니다. 참고용 결과이며 수정 작업으로 집계하지 않습니다. 원문 검색은 기존 검색과 같이 모든 원문 언어를 대상으로 합니다.
    </p>
    <USelect v-model="source" :items="choices.map(({ label, value }) => ({ label, value }))" aria-label="사용처 검색 표현" />
    <p class="text-xs">
      검색: {{ search }} · {{ data?.total ?? 0 }}개
    </p>
    <AppLoadingSpinner v-if="status === 'pending'" />
    <UAlert v-else-if="error" color="error" title="사용처를 불러오지 못했습니다." />
    <article v-for="item in data?.items ?? []" :key="item.id" class="border-b border-default pb-3 text-sm">
      <p class="font-mono text-xs text-dimmed">
        {{ getEditorItemKey(item) }}
      </p><p class="mt-2 whitespace-pre-wrap">
        {{ item.ko || '미번역' }}
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
        :disabled="page <= 1"
        size="xs"
        color="neutral"
        @click="page--"
      >
        이전
      </UButton><span class="text-xs">{{ page }} / {{ data.totalPages }}</span><UButton
        :disabled="page >= data.totalPages"
        size="xs"
        color="neutral"
        @click="page++"
      >
        다음
      </UButton>
    </div>
  </section>
</template>
