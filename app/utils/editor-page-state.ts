import type { ComputedRef, Ref } from 'vue'
import type { EditorItemsResponse, EditorLanguage } from '#shared/types/editor'
import type { EditorOverviewResponse } from '#shared/types/editor-overview'
import type { useEditorQuery } from '~/composables/editor-query'
import type { useEditorLayout } from '~/composables/editor-layout'
import type { useEditorItems } from '~/composables/editor-items'
import type { useEditorActions } from '~/composables/editor-actions'
import type { useEditorDictionaryPanel } from '~/composables/editor-dictionary-panel'
import type { useEditorGlossaryContext } from '~/composables/editor-glossary-context'
import type { useEditorDraftStorage } from '~/composables/editor-drafts'
import type { useEditorPreferences } from '~/composables/editor-preferences'
import type { EditorLanguageOption } from '~/utils/editor-options'

export interface EditorPageData {
  itemsData: Ref<EditorItemsResponse>
  itemsError: Ref<unknown>
  itemsStatus: Ref<string>
  overviewData: Ref<EditorOverviewResponse>
  overviewStatus: Ref<string>
  overviewError: Ref<unknown>
  refreshItems: () => Promise<unknown>
  refreshOverview: () => Promise<unknown>
}

export type EditorPageState = EditorPageData
  & ReturnType<typeof useEditorQuery>
  & ReturnType<typeof useEditorLayout>
  & ReturnType<typeof useEditorItems>
  & ReturnType<typeof useEditorActions>
  & ReturnType<typeof useEditorDictionaryPanel>
  & ReturnType<typeof useEditorGlossaryContext>
  & ReturnType<typeof useEditorDraftStorage>
  & ReturnType<typeof useEditorPreferences>
  & {
    visibleSourceLanguageItems: ComputedRef<EditorLanguageOption[]>
    toggleDisplayLanguage: (language: EditorLanguage) => void
  }
