<script setup lang="ts">
import type { EditorDictionaryEntry, GlossaryProposalsResponse } from '#shared/types/editor-dictionary'

const props = defineProps<{ entry: EditorDictionaryEntry }>()
const { data, status, error } = await useFetch<GlossaryProposalsResponse>(() => `/api/editor/dictionaries/${props.entry.dictionaryId}/proposals`, {
  server: false, query: computed(() => ({ entryId: props.entry.id }))
})
</script>

<template>
  <div v-if="status === 'idle' || status === 'pending'" class="p-4">
    <AppLoadingSpinner />
  </div>
  <div v-else-if="error" class="p-4">
    <UAlert color="error" title="이력을 불러오지 못했습니다." />
  </div>
  <GlossaryHistory v-else :proposals="data?.proposals ?? []" />
</template>
