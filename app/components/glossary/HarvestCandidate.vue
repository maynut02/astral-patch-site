<script setup lang="ts">
import type { HarvestDraft } from '~/composables/glossary-harvest'
import { getEditorItemLocation } from '~/utils/editor-links'

const candidate = defineModel<HarvestDraft>({ required: true })
defineProps<{ busy: boolean, dictionaryId: string }>()
const emit = defineEmits<{ remove: [] }>()
const locked = computed(() => candidate.value.result?.status === 'submitted' || candidate.value.result?.status === 'duplicate')
const fields = [{ key: 'japanese', label: '일본어' }, { key: 'chineseSimplified', label: '중국어 간체' }, { key: 'chineseTraditional', label: '중국어 번체' }] as const
</script>

<template>
  <article class="flex min-w-0 flex-col gap-4 border border-default p-4">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold">
        후보 대조
      </h2>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        :disabled="busy"
        @click="emit('remove')"
      >
        목록에서 제외
      </UButton>
    </header>
    <section class="flex flex-col gap-2 bg-muted p-3 text-sm">
      <NuxtLink
        :to="getEditorItemLocation(candidate.source)"
        target="_blank"
        rel="noopener"
        class="font-mono text-xs text-info hover:underline"
      >
        {{ candidate.source.category }}_{{ candidate.source.unitKey }} ↗
      </NuxtLink>
      <p v-if="candidate.source.jp" lang="ja" class="whitespace-pre-wrap break-words">
        일본어: {{ candidate.source.jp }}
      </p>
      <p v-if="candidate.source.cnS" lang="zh-Hans" class="whitespace-pre-wrap break-words">
        간체: {{ candidate.source.cnS }}
      </p>
      <p v-if="candidate.source.cnT" lang="zh-Hant" class="whitespace-pre-wrap break-words">
        번체: {{ candidate.source.cnT }}
      </p>
      <p class="whitespace-pre-wrap break-words">
        확정 번역: {{ candidate.source.ko }}
      </p>
    </section>
    <UAlert v-if="candidate.result" :color="candidate.result.status === 'error' ? 'error' : 'neutral'" :title="candidate.result.message" />
    <UButton
      v-if="candidate.result?.status === 'duplicate'"
      :to="{ path: '/translate/glossary', query: { dictionary: dictionaryId, q: candidate.japanese || candidate.chineseSimplified || candidate.chineseTraditional } }"
      target="_blank"
      color="neutral"
      variant="soft"
      class="self-start"
    >
      용어집에서 대조 ↗
    </UButton>
    <fieldset :disabled="busy || locked" class="flex min-w-0 flex-col gap-4">
      <UFormField label="한국어 권장 표기" required>
        <UInput
          v-model="candidate.translation"
          aria-label="후보 한국어 표기"
          :maxlength="200"
          class="w-full"
        />
      </UFormField>
      <div class="grid gap-3 sm:grid-cols-3">
        <UFormField v-for="field in fields" :key="field.key" :label="field.label">
          <UInput
            v-model="candidate[field.key]"
            :aria-label="'후보 ' + field.label"
            :maxlength="200"
            class="w-full"
          />
        </UFormField>
      </div>
      <UFormField label="의미·대조 메모" required>
        <UTextarea
          v-model="candidate.note"
          aria-label="후보 의미와 대조 메모"
          :maxlength="1000"
          :rows="3"
          class="w-full"
        />
      </UFormField>
      <UFormField label="적용 범위">
        <USelect
          v-model="candidate.scope"
          aria-label="후보 적용 범위"
          :items="[{ value: 'file', label: candidate.source.category }, { value: 'project', label: '전체' }]"
          class="w-full"
        />
      </UFormField>
      <UFormField label="중국어 의미 대조">
        <USelect
          v-model="candidate.semanticReview"
          aria-label="후보 중국어 대조 상태"
          :items="[{ value: 'unrecorded', label: '미기록' }, { value: 'recorded', label: '대조 기록 있음' }, { value: 'unresolved', label: '언어 간 차이 검토 중' }]"
          class="w-full"
        />
      </UFormField>
      <UFormField v-if="candidate.semanticReview !== 'unrecorded'" label="대조 근거·미해결 차이">
        <UTextarea
          v-model="candidate.semanticNote"
          aria-label="후보 중국어 대조 근거"
          :maxlength="1000"
          class="w-full"
        />
      </UFormField>
      <UCheckbox v-if="!locked" v-model="candidate.selected" label="대조 완료 · 등록 대상으로 선택" />
    </fieldset>
  </article>
</template>
