<script setup lang="ts">
import type { EditorPageState } from '~/utils/editor-page-state'

const props = defineProps<{ state: EditorPageState }>()
const { dictionaryPanelTabs, dictionaryPanelView, dictionarySelection } = props.state
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      v-if="!dictionarySelection"
      class="flex min-h-0 flex-1 flex-col"
    >
      <div class="shrink-0 p-3 pb-0">
        <UTabs
          v-model="dictionaryPanelView"
          :content="false"
          :items="dictionaryPanelTabs"
          color="neutral"
          size="sm"
          :ui="{ trigger: 'h-7 leading-4 px-3', list: 'h-9 bg-elevated/50 p-1' }"
          class="w-fit"
        />
      </div>

      <template v-if="dictionaryPanelView === 'search'">
        <EditorDictionarySearch :state="state" />
      </template>

      <template v-else>
        <EditorDictionaryCollections :state="state" />
      </template>

      <EditorDictionaryForms :state="state" />
    </div>

    <EditorDictionaryItemView v-else :state="state" />
  </div>
</template>
