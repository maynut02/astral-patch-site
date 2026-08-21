<script setup lang="ts">
import type { EditorLanguage, EditorSelectOption } from '#shared/types/editor'

const props = withDefaults(defineProps<{
  search: string
  category: string
  categoryItems: EditorSelectOption[]
  revisionId: string
  revisionItems: EditorSelectOption[]
  selectedLanguages: EditorLanguage[]
  untranslatedOnly: boolean
  page: number
  totalPages: number
  loading?: boolean
}>(), {
  loading: false
})

const emit = defineEmits<{
  'update:search': [value: string]
  'update:category': [value: string]
  'update:revisionId': [value: string]
  'update:selectedLanguages': [value: EditorLanguage[]]
  'update:untranslatedOnly': [value: boolean]
  'update:page': [value: number]
  'reset': []
}>()

const filterOpen = ref(false)

function goToPage(value: number) {
  const maxPage = Math.max(props.totalPages, 1)
  const nextPage = Math.min(Math.max(Math.trunc(value), 1), maxPage)

  if (nextPage !== props.page) {
    emit('update:page', nextPage)
  }
}

function resetFilters() {
  emit('reset')
  filterOpen.value = false
}
</script>

<template>
  <UButton icon="i-tabler-filter" color="neutral" variant="ghost" size="md" class="rounded-full hover:bg-accented"
    aria-label="필터 열기" @click="filterOpen = true" />

  <UDrawer v-model:open="filterOpen">
    <template #body>
      <div class="overflow-y-auto p-1">
        <EditorFilterDesktop :search="props.search" :category="props.category" :category-items="props.categoryItems"
          :revision-id="props.revisionId" :revision-items="props.revisionItems"
          :selected-languages="props.selectedLanguages" :untranslated-only="props.untranslatedOnly" :page="props.page"
          :total-pages="props.totalPages" :loading="props.loading" @update:search="emit('update:search', $event)"
          @update:category="emit('update:category', $event)" @update:revision-id="emit('update:revisionId', $event)"
          @update:selected-languages="emit('update:selectedLanguages', $event)"
          @update:untranslated-only="emit('update:untranslatedOnly', $event)"
          @update:page="emit('update:page', $event)" />
      </div>
    </template>
  </UDrawer>

  <UButton icon="i-tabler-chevron-left" color="neutral" variant="ghost" size="md" class="rounded-full hover:bg-accented"
    aria-label="이전 페이지" :disabled="props.loading || props.page <= 1" @click="goToPage(props.page - 1)" />
  <UButton icon="i-tabler-x" color="neutral" variant="ghost" size="md" class="rounded-full hover:bg-accented"
    aria-label="필터 초기화" :disabled="props.loading" @click="resetFilters" />
  <UButton icon="i-tabler-chevron-right" color="neutral" variant="ghost" size="md"
    class="rounded-full hover:bg-accented" aria-label="다음 페이지"
    :disabled="props.loading || props.page >= props.totalPages" @click="goToPage(props.page + 1)" />
</template>
