<script setup lang="ts">
import type { EditorItem } from '#shared/types/editor'
import type { EditorDictionaryEntry } from '#shared/types/editor-dictionary'
import type { useEditorGlossaryContext } from '~/composables/editor-glossary-context'
import { getEditorItemKey } from '~/utils/editor-links'

const props = defineProps<{ item: EditorItem | null, context: ReturnType<typeof useEditorGlossaryContext> }>()
const { glossaryEntries: entries, glossaryVoices: voices, glossaryLoading: loading, glossaryFailed: failed, refreshGlossary: load } = props.context
const { loggedIn } = useUserSession()
const { showLoginRequiredToast } = useAppToast()
const { dictionaries, loadDictionaries } = useEditorDictionaryList()
const teamDictionaries = computed(() => dictionaries.value.filter(dictionary => dictionary.isTeam))
const dictionaryId = ref('')
const voiceId = ref('general')
const formOpen = ref(false)
const selectedEntry = ref<EditorDictionaryEntry | null>(null)
const expanded = ref<string | null>(null)
const usageOpen = ref(false)
const usageEntry = ref<EditorDictionaryEntry | null>(null)
const voice = computed(() => voices.value.find(entry => entry.id === voiceId.value))
function propose(entry: EditorDictionaryEntry | null = null) {
  if (!loggedIn.value) {
    showLoginRequiredToast('glossary-editor-login')
    return
  }
  dictionaryId.value = entry?.dictionaryId ?? dictionaryId.value ?? ''
  if (!dictionaryId.value) dictionaryId.value = teamDictionaries.value[0]?.id ?? ''
  if (!dictionaryId.value) return
  selectedEntry.value = entry
  formOpen.value = true
}
function showUsage(entry: EditorDictionaryEntry) {
  usageEntry.value = entry
  usageOpen.value = true
}
watch(() => props.item?.id, () => {
  voiceId.value = 'general'
  expanded.value = null
}, { immediate: true })
watch([voices, loading], () => {
  if (!loading.value && !voices.value.some(entry => entry.id === voiceId.value)) voiceId.value = 'general'
})
onMounted(() => {
  void loadDictionaries()
})
</script>

<template>
  <div class="editor-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
    <div class="mb-4 flex items-center justify-between gap-2">
      <p class="text-sm font-medium">
        현재 항목의 공통 기준
      </p><UButton
        to="/translate/glossary"
        target="_blank"
        color="neutral"
        variant="link"
        size="xs"
      >
        전체 보기 ↗
      </UButton>
    </div>
    <p class="mb-3 font-mono text-[10px] text-dimmed">
      {{ item ? getEditorItemKey(item) : '항목을 선택해 주세요.' }}
    </p>
    <p class="mb-4 text-xs text-muted">
      관련 기준은 참고 안내입니다. 번역문·승인 상태를 자동 변경하지 않습니다.
    </p>
    <AppLoadingSpinner v-if="loading" />
    <UAlert
      v-else-if="failed"
      color="error"
      variant="soft"
      title="공통 기준을 불러오지 못했습니다."
    >
      <template #actions>
        <UButton size="xs" color="neutral" @click="load">
          재시도
        </UButton>
      </template>
    </UAlert>
    <template v-else>
      <article v-for="entry in entries" :key="entry.id" class="mb-3 border border-default">
        <div v-if="expanded !== entry.id" class="flex flex-col gap-2 p-3 text-sm">
          <h3 class="font-medium">
            {{ entry.translation }} <span class="text-[10px] text-dimmed">확정 v{{ entry.revision }}</span>
          </h3><p lang="ja" class="text-xs">
            일본어: {{ entry.metadata.japanese || '미등록' }}
          </p><p lang="zh-Hans" class="text-xs">
            중국어: {{ entry.metadata.chineseSimplified || entry.metadata.chineseTraditional || '미등록' }}
          </p><p class="text-xs text-muted">
            {{ entry.note }}
          </p><div class="flex gap-2">
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              @click="expanded = entry.id"
            >
              상세
            </UButton><UButton
              size="xs"
              color="neutral"
              variant="soft"
              @click="showUsage(entry)"
            >
              사용처
            </UButton>
          </div>
        </div>
        <template v-else>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            @click="expanded = null"
          >
            접기
          </UButton><GlossaryEntryDetails
            :entry="entry"
            @propose="propose(entry)"
            @usage="showUsage(entry)"
            @history="navigateTo({ path: '/translate/glossary', query: { dictionary: entry.dictionaryId, entry: entry.id, tab: entry.metadata.kind, detail: 'history' } }, { open: { target: '_blank' } })"
          />
        </template>
      </article>
      <p v-if="item && !entries.length" class="py-4 text-center text-sm text-muted">
        관련된 확정 용어가 없습니다.
      </p>
      <section class="mt-4 border-t border-default pt-4">
        <h3 class="text-sm font-medium">
          캐릭터 문체 · 수동 참고
        </h3><USelect
          v-model="voiceId"
          :items="[{ label: '일반 가이드', value: 'general' }, ...voices.map(entry => ({ label: entry.translation, value: entry.id }))]"
          aria-label="참고할 캐릭터 문체"
          class="my-3 w-full"
        /><GlossaryEntryDetails
          v-if="voice"
          :entry="voice"
          @propose="propose(voice)"
          @usage="showUsage(voice)"
          @history="navigateTo({ path: '/translate/glossary', query: { dictionary: voice.dictionaryId, entry: voice.id, tab: 'voice', detail: 'history' } }, { open: { target: '_blank' } })"
        /><p v-else class="text-xs text-muted">
          설명문은 일반 문체를, 실제 대사는 캐릭터의 성격과 관계를 참고합니다.
        </p><p class="mt-3 text-[10px] text-dimmed">
          선택은 참고용이며 화자 정보로 저장되지 않습니다. 항목이 바뀌면 초기화됩니다.
        </p>
      </section>
    </template>
    <div class="mt-5 flex flex-col gap-2 border-t border-default pt-3">
      <USelect
        v-if="teamDictionaries.length > 1"
        v-model="dictionaryId"
        :items="teamDictionaries.map(dictionary => ({ label: dictionary.name, value: dictionary.id }))"
        placeholder="제안할 공통 용어집"
      /><UButton
        v-if="teamDictionaries.length"
        color="info"
        variant="soft"
        :disabled="!item"
        @click="propose()"
      >
        현재 항목에서 용어 제안
      </UButton>
    </div>
    <GlossaryEntryForm
      v-model:open="formOpen"
      :dictionary-id="dictionaryId"
      :entry="selectedEntry"
      :kind="selectedEntry?.metadata.kind ?? 'term'"
      :source="item"
      @submitted="load"
    />
    <UModal v-model:open="usageOpen" title="용어 사용처" description="참고용 검색 결과입니다. 기존 번역은 변경되지 않습니다.">
      <template #body>
        <GlossaryUsages v-if="usageEntry" :entry="usageEntry" />
      </template>
    </UModal>
  </div>
</template>
