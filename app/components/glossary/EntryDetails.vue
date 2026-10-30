<script setup lang="ts">
import type { EditorDictionaryEntry } from '#shared/types/editor-dictionary'
import { getEditorKeyQuery } from '~/utils/editor-links'

defineProps<{ entry: Pick<EditorDictionaryEntry, 'translation' | 'revision' | 'metadata' | 'note'>, hideActions?: boolean, proposed?: boolean }>()
defineEmits<{ propose: [], usage: [], history: [] }>()
const { showToast } = useAppToast()
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast({ id: 'glossary-copy', title: '한국어 표기를 복사했습니다.' })
  } catch { showToast({ id: 'glossary-copy', title: '복사 권한을 사용할 수 없습니다. 표기를 직접 선택해 주세요.' }) }
}
</script>

<template>
  <section class="flex flex-col gap-4 p-4 text-sm">
    <header class="flex items-center justify-between gap-3">
      <h2 class="font-semibold">
        {{ entry.translation }}
      </h2><UBadge :color="proposed || entry.metadata.archived ? 'neutral' : 'success'" variant="soft">
        {{ proposed ? '변경 제안' : entry.metadata.archived ? '보관' : '확정' }} · v{{ entry.revision }}
      </UBadge>
    </header>
    <dl v-if="entry.metadata.kind === 'term'" class="grid grid-cols-[5rem_1fr] gap-2">
      <dt class="text-xs text-dimmed">
        일본어
      </dt><dd lang="ja" class="whitespace-pre-wrap wrap-break-word">
        {{ entry.metadata.japanese || '미등록' }}
      </dd>
      <dt class="text-xs text-dimmed">
        중국어 간체
      </dt><dd lang="zh-Hans" class="whitespace-pre-wrap wrap-break-word">
        {{ entry.metadata.chineseSimplified || '미등록' }}
      </dd>
      <dt class="text-xs text-dimmed">
        중국어 번체
      </dt><dd lang="zh-Hant" class="whitespace-pre-wrap wrap-break-word">
        {{ entry.metadata.chineseTraditional || '미등록' }}
      </dd>
    </dl>
    <template v-else>
      <p>{{ entry.metadata.speechStyle }}</p>
      <p v-if="entry.metadata.selfAddress || entry.metadata.otherAddress" class="text-muted">
        <span v-if="entry.metadata.selfAddress">자신: {{ entry.metadata.selfAddress }}</span><span v-if="entry.metadata.selfAddress && entry.metadata.otherAddress"> · </span><span v-if="entry.metadata.otherAddress">상대: {{ entry.metadata.otherAddress }}</span>
      </p>
      <p v-if="entry.metadata.endings" class="whitespace-pre-wrap">
        {{ entry.metadata.endings }}
      </p><p v-if="entry.metadata.exceptions" class="whitespace-pre-wrap text-muted">
        {{ entry.metadata.exceptions }}
      </p>
      <blockquote class="border-l-2 border-info pl-3">
        <p>{{ entry.metadata.exampleTranslation }}</p><p class="mt-1 text-xs text-dimmed">
          {{ entry.metadata.exampleSource }}
        </p>
      </blockquote>
    </template>
    <p class="whitespace-pre-wrap wrap-break-word">
      {{ entry.note }}
    </p>
    <div v-if="entry.metadata.allowed.length">
      <p class="mb-1 text-xs text-dimmed">
        허용 표기
      </p><p>{{ entry.metadata.allowed.join(', ') }}</p>
    </div>
    <div v-if="entry.metadata.historical.length">
      <p class="mb-1 text-xs text-dimmed">
        과거 표기
      </p><p>{{ entry.metadata.historical.join(', ') }}</p>
    </div>
    <div v-if="entry.metadata.discouraged.length">
      <p class="mb-1 text-xs text-dimmed">
        비권장 표기
      </p><p>{{ entry.metadata.discouraged.join(', ') }}</p>
    </div>
    <p v-if="entry.metadata.scope !== 'project'" class="break-all text-xs text-muted">
      범위: {{ entry.metadata.target }}
    </p>
    <p class="text-xs text-muted">
      {{ entry.metadata.semanticReview === 'recorded' ? '중국어 대조 기록' : entry.metadata.semanticReview === 'unresolved' ? '의미 차이 검토 중' : '중국어 대조 미기록' }}<span v-if="entry.metadata.semanticNote"> · {{ entry.metadata.semanticNote }}</span>
    </p>
    <UButton
      v-if="entry.metadata.evidenceKey"
      :to="{ path: '/translate/editor', query: getEditorKeyQuery(entry.metadata.evidenceKey) }"
      target="_blank"
      color="neutral"
      variant="link"
      icon="i-tabler-external-link"
      class="justify-start p-0"
    >
      {{ entry.metadata.evidenceKey }}
    </UButton>
    <div v-if="!hideActions" class="flex flex-wrap gap-2">
      <UButton
        size="xs"
        color="info"
        variant="soft"
        @click="$emit('propose')"
      >
        변경 제안
      </UButton><UButton
        size="xs"
        color="neutral"
        variant="soft"
        @click="$emit('usage')"
      >
        사용처
      </UButton><UButton
        size="xs"
        color="neutral"
        variant="soft"
        @click="$emit('history')"
      >
        결정 이력
      </UButton><UButton
        size="xs"
        color="neutral"
        variant="ghost"
        @click="copy(entry.translation)"
      >
        표기 복사
      </UButton>
    </div>
  </section>
</template>
