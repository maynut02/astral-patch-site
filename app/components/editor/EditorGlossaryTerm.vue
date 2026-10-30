<script setup lang="ts">
import type { EditorDictionaryEntry } from '#shared/types/editor-dictionary'

defineProps<{ text: string, entries: EditorDictionaryEntry[] }>()
const open = ref(false)
const usageOpen = ref(false)
const usageEntry = ref<EditorDictionaryEntry | null>(null)
const { showToast } = useAppToast()
async function copy(entry: EditorDictionaryEntry) {
  try {
    await navigator.clipboard.writeText(entry.translation)
    showToast({ id: 'glossary-inline-copy', title: '한국어 표기를 복사했습니다.' })
  } catch {
    showToast({ id: 'glossary-inline-copy', title: '복사 권한을 사용할 수 없습니다. 표기를 직접 선택해 주세요.' })
  }
}
function showUsages(entry: EditorDictionaryEntry) {
  usageEntry.value = entry
  open.value = false
  usageOpen.value = true
}
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'start', side: 'bottom', sideOffset: 6 }">
    <button
      type="button"
      class="inline cursor-pointer whitespace-pre-wrap p-0 font-inherit text-inherit underline decoration-info/70 decoration-dotted decoration-2 underline-offset-4 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-info"
      :aria-label="`${text}의 용어집 기준 보기`"
      @click.stop
      v-text="text"
    />
    <template #content>
      <section class="max-h-96 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-4 text-sm" @click.stop>
        <h2 class="font-medium">
          {{ text }} · 공통 용어
        </h2>
        <p v-if="entries.length > 1" class="mt-2 text-xs text-muted">
          같은 표현의 기준이 여러 개입니다. 문맥과 적용 범위를 확인해 주세요.
        </p>
        <article v-for="entry in entries" :key="entry.id" class="mt-3 border-t border-default pt-3">
          <div class="flex items-center justify-between gap-3">
            <p class="font-semibold text-info">
              {{ entry.translation }}
            </p>
            <UBadge color="success" variant="soft" size="xs">
              확정 · v{{ entry.revision }}
            </UBadge>
          </div>
          <p class="mt-2 whitespace-pre-wrap wrap-break-word">
            {{ entry.note }}
          </p>
          <p class="mt-2 text-xs text-muted">
            적용 범위: {{ entry.metadata.scope === 'project' ? '전체' : entry.metadata.target }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <UButton
              size="xs"
              color="info"
              variant="soft"
              @click="copy(entry)"
            >
              표기 복사
            </UButton>
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              @click="showUsages(entry)"
            >
              사용처
            </UButton>
            <UButton
              :to="{ path: '/translate/glossary', query: { dictionary: entry.dictionaryId, entry: entry.id, tab: 'term' } }"
              target="_blank"
              size="xs"
              color="neutral"
              variant="link"
            >
              기준 상세 ↗
            </UButton>
          </div>
        </article>
        <p class="mt-3 text-xs text-dimmed">
          참고용 기준입니다. 번역문은 자동 변경되지 않습니다.
        </p>
      </section>
    </template>
  </UPopover>
  <UModal v-model:open="usageOpen" title="용어 사용처" description="참고용 검색 결과입니다. 기존 번역은 변경되지 않습니다.">
    <template #body>
      <GlossaryUsages v-if="usageEntry" :entry="usageEntry" />
    </template>
  </UModal>
</template>
