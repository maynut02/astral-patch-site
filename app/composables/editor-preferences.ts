import type { EditorDiffMode, EditorLanguage } from '#shared/types/editor'
import { readBrowserStorage, writeBrowserStorage } from '~/utils/browser-storage'
import {
  EDITOR_SOURCE_LANGUAGE_OPTIONS,
  isEditorDiffMode,
  isEditorLanguage
} from '~/utils/editor-options'

const LANGUAGE_STORAGE_KEY = 'astral-editor-languages'
const DIFF_MODE_STORAGE_KEY = 'astral-editor-diff-mode'

// 에디터 표시 언어와 비교 방식을 브라우저에 저장하고 복원한다.
export function useEditorPreferences() {
  const displayLanguages = ref<EditorLanguage[]>(EDITOR_SOURCE_LANGUAGE_OPTIONS.map(option => option.key))
  const diffMode = ref<EditorDiffMode>('unified')
  const ready = ref(false)

  onMounted(() => {
    const storedLanguages = readBrowserStorage(LANGUAGE_STORAGE_KEY)
    const storedDiffMode = readBrowserStorage(DIFF_MODE_STORAGE_KEY)

    if (storedLanguages) {
      try {
        const parsedLanguages: unknown = JSON.parse(storedLanguages)

        if (Array.isArray(parsedLanguages) && parsedLanguages.every(isEditorLanguage)) {
          displayLanguages.value = parsedLanguages
        }
      } catch {
        displayLanguages.value = EDITOR_SOURCE_LANGUAGE_OPTIONS.map(option => option.key)
      }
    }

    if (storedDiffMode && isEditorDiffMode(storedDiffMode)) {
      diffMode.value = storedDiffMode
    }

    ready.value = true
  })

  watch(displayLanguages, (languages) => {
    if (ready.value) {
      writeBrowserStorage(LANGUAGE_STORAGE_KEY, JSON.stringify(languages))
    }
  }, { deep: true })

  watch(diffMode, (mode) => {
    if (ready.value) {
      writeBrowserStorage(DIFF_MODE_STORAGE_KEY, mode)
    }
  })

  return {
    displayLanguages,
    diffMode
  }
}
