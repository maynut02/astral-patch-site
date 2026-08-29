<script setup lang="ts">
import {
  EDITOR_ALL_CATEGORY_VALUE,
  EDITOR_ALL_REVISION_VALUE,
  type EditorLanguage,
  type EditorSelectOption
} from '#shared/types/editor'

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
}>()

const languageItems: { value: EditorLanguage, label: string }[] = [
  { value: 'cnS', label: '중국어 간체' },
  { value: 'en', label: '영어' },
  { value: 'jp', label: '일본어' },
  { value: 'cnT', label: '중국어 번체' }
]

const pageInput = ref(String(props.page))

watch(() => props.page, (value) => {
  pageInput.value = String(value)
})

function updateSearch(value: string) {
  emit('update:search', value)
}

function updateCategory(value: string | undefined) {
  emit('update:category', value || EDITOR_ALL_CATEGORY_VALUE)
}

function updateRevision(value: string | undefined) {
  emit('update:revisionId', value || EDITOR_ALL_REVISION_VALUE)
}

function toggleLanguage(language: EditorLanguage) {
  const selected = props.selectedLanguages.includes(language)
  const nextLanguages = selected
    ? props.selectedLanguages.filter(value => value !== language)
    : [...props.selectedLanguages, language]

  emit('update:selectedLanguages', nextLanguages)
}

function updateUntranslated(value: string | number | undefined) {
  emit('update:untranslatedOnly', String(value) === 'on')
}

function goToPage(value: number) {
  const maxPage = Math.max(props.totalPages, 1)
  const nextPage = Math.min(Math.max(Math.trunc(value), 1), maxPage)

  if (nextPage !== props.page) {
    emit('update:page', nextPage)
  }
}

function commitPage() {
  const nextPage = Number(pageInput.value)

  if (Number.isInteger(nextPage) && nextPage > 0) {
    goToPage(nextPage)
  }

  pageInput.value = String(props.page)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <UInput
      :model-value="props.search"
      icon="i-tabler-search"
      size="lg"
      color="neutral"
      variant="soft"
      placeholder="검색..."
      :ui="{ base: 'h-9 leading-5' }"
      @update:model-value="updateSearch"
    />

    <div class="flex flex-col gap-2">
      <p class="text-xs text-muted font-medium">
        카테고리
      </p>
      <USelect
        :model-value="props.category"
        :items="props.categoryItems"
        placeholder="전체 카테고리"
        color="neutral"
        variant="soft"
        class="w-full"
        :ui="{ base: 'h-8 leading-5' }"
        @update:model-value="updateCategory"
      />
    </div>

    <USeparator />

    <div class="flex flex-col gap-2">
      <p class="text-xs text-muted font-medium">
        버전
      </p>
      <USelect
        :model-value="props.revisionId"
        :items="props.revisionItems"
        placeholder="전체 버전"
        color="neutral"
        variant="soft"
        class="w-full"
        :ui="{ base: 'h-8 leading-5' }"
        @update:model-value="updateRevision"
      />
    </div>

    <USeparator />

    <div class="flex flex-col gap-2">
      <p class="text-xs text-muted font-medium">
        표시 언어
      </p>

      <div class="flex flex-col text-sm">
        <button
          v-for="language in languageItems"
          :key="language.value"
          type="button"
          class="flex items-center gap-2 py-1 hover:bg-muted transition-colors pl-1"
          :class="props.selectedLanguages.includes(language.value) ? 'text-default' : 'text-dimmed'"
          @click="toggleLanguage(language.value)"
        >
          <UIcon
            v-if="props.selectedLanguages.includes(language.value)"
            name="i-tabler-check"
            class="size-4"
          />
          <div
            v-else
            class="size-4"
          />
          <span>{{ language.label }}</span>
        </button>
      </div>
    </div>

    <USeparator />

    <div class="flex flex-col gap-2">
      <p class="text-xs text-muted font-medium">
        미번역 항목만 표시
      </p>

      <UTabs
        :model-value="props.untranslatedOnly ? 'on' : 'off'"
        :items="[{ label: 'OFF', value: 'off' }, { label: 'ON', value: 'on' }]"
        color="neutral"
        size="xs"
        :ui="{ list: 'bg-muted', trigger: 'h-6 px-3 leading-4' }"
        @update:model-value="updateUntranslated"
      />
    </div>

    <USeparator />

    <div class="flex flex-col gap-2">
      <p class="text-xs text-muted font-medium">
        페이지
      </p>

      <div class="flex flex-wrap gap-2 text-sm">
        <UButton
          icon="i-tabler-chevron-left"
          color="neutral"
          variant="soft"
          class="rounded-full bg-muted hover:bg-elevated px-3"
          :disabled="props.loading || props.page <= 1"
          @click="goToPage(props.page - 1)"
        />
        <UInput
          v-model="pageInput"
          color="neutral"
          variant="soft"
          :ui="{ base: 'h-8 leading-5 px-4 text-center' }"
          class="flex-1"
          :disabled="props.loading"
          @blur="commitPage"
          @keydown.enter="commitPage"
        >
          <template #trailing>
            <div
              class="text-xs text-muted tabular-nums"
              aria-live="polite"
              role="status"
            >
              / {{ props.totalPages }}
            </div>
          </template>
        </UInput>
        <UButton
          icon="i-tabler-chevron-right"
          color="neutral"
          variant="soft"
          class="rounded-full bg-muted hover:bg-elevated px-3"
          :disabled="props.loading || props.page >= props.totalPages"
          @click="goToPage(props.page + 1)"
        />
      </div>
    </div>
  </div>
</template>
