import type { ComputedRef } from 'vue'
import type { EditorItem } from '#shared/types/editor'
import type { EditorDictionaryEntry, GlossaryContextResponse } from '#shared/types/editor-dictionary'

export function useEditorGlossaryContext(item: ComputedRef<EditorItem | null>) {
  const glossaryEntries = ref<EditorDictionaryEntry[]>([])
  const glossaryVoices = ref<EditorDictionaryEntry[]>([])
  const glossaryLoading = ref(false)
  const glossaryFailed = ref(false)
  let request = 0
  async function refreshGlossary() {
    const id = ++request
    const itemId = item.value?.id
    glossaryEntries.value = []
    glossaryVoices.value = []
    glossaryFailed.value = false
    glossaryLoading.value = false
    if (!itemId) return
    glossaryLoading.value = true
    try {
      const result = await $fetch<GlossaryContextResponse>('/api/editor/glossary/related', { query: { itemId } })
      if (id !== request) return
      glossaryEntries.value = result.entries
      glossaryVoices.value = result.voices
    } catch {
      if (id === request) glossaryFailed.value = true
    } finally {
      if (id === request) glossaryLoading.value = false
    }
  }
  watch([() => item.value?.id, () => item.value?.sourceVersionId], refreshGlossary, { immediate: true })
  onMounted(() => window.addEventListener('focus', refreshGlossary))
  onUnmounted(() => {
    request++
    window.removeEventListener('focus', refreshGlossary)
  })
  return { glossaryEntries, glossaryVoices, glossaryLoading, glossaryFailed, refreshGlossary }
}
