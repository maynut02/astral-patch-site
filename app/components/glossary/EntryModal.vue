<script setup lang="ts">
import type { EditorDictionaryEntry } from '#shared/types/editor-dictionary'

// Editor entry points open usage and decision history here; the glossary workspace shows both inline.
defineProps<{ entry: EditorDictionaryEntry | null, view: 'usage' | 'history' }>()
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <UModal v-model:open="open" :title="view === 'usage' ? '용어 사용처' : '결정 이력'" :ui="{ body: 'p-0 sm:p-0' }">
    <template #body>
      <template v-if="entry">
        <GlossaryUsages v-if="view === 'usage'" :entry="entry" />
        <GlossaryEntryHistory v-else :entry="entry" />
      </template>
    </template>
  </UModal>
</template>
