import type { EditorAiTranslationResponse, EditorBatchSaveResponse, EditorItem, EditorSaveResponse } from '#shared/types/editor'
import type { useEditorDraftStorage } from '~/composables/editor-drafts'
import { getRequestErrorMessage } from '~/utils/request-error'
import type { EditorPageData } from '~/utils/editor-page-state'
import type { useEditorQuery } from '~/composables/editor-query'
import type { useEditorLayout } from '~/composables/editor-layout'
import type { useEditorItems } from '~/composables/editor-items'
import { getEditorKeyQuery, getEditorItemKey } from '~/utils/editor-links'

export function useEditorActions(data: EditorPageData, query: ReturnType<typeof useEditorQuery>, layout: ReturnType<typeof useEditorLayout>, itemState: ReturnType<typeof useEditorItems>, draftStorage: ReturnType<typeof useEditorDraftStorage>) {
  const { refreshItems, refreshOverview } = data
  const { router, isFileMode, isTagMode, version, revision, optionsPopoverOpen, jumpToEditorKey } = query
  const { isMobileSidebarOpen, activeSidebarMenu } = layout
  const { items, selectedItem, selectedItemId, selectedItemHasSource, currentPageDrafts, persistedItemStates, canRetainItem, historyReloadKey, selectItem, setPersistedItemState, getItemDraftKey } = itemState
  const { drafts, draftsReady, removeDraftsByKeys, setDraft } = draftStorage

  const isSaving = ref(false)
  const isAiTranslating = ref(false)
  const retainingItemId = ref<string | null>(null)

  const { loggedIn } = useUserSession()
  const { showToast, showLoginRequiredToast } = useAppToast()

  const aiTranslationTooltip = computed(() => {
    if (isAiTranslating.value) {
      return 'AI 번역 중'
    }

    if (!selectedItem.value) {
      return '번역할 항목을 선택해 주세요.'
    }

    return selectedItemHasSource.value ? 'AI 번역' : '번역할 원문이 없습니다.'
  })

  async function retainItemTranslation(item: EditorItem): Promise<void> {
    if (!canRetainItem(item) || retainingItemId.value) {
      return
    }

    if (!loggedIn.value) {
      showLoginRequiredToast('editor-retain-login-required')
      return
    }

    retainingItemId.value = item.id

    try {
      const response = await $fetch<EditorSaveResponse>(
        `/api/editor/items/${encodeURIComponent(item.id)}/retain`,
        { method: 'POST' }
      )

      item.ko = response.ko
      item.pendingStatus = response.status
      setPersistedItemState(item.id, item)

      await Promise.allSettled([refreshItems(), refreshOverview()])

      if (selectedItemId.value === item.id && activeSidebarMenu.value === 'history') {
        historyReloadKey.value += 1
      }

      showToast({
        id: `editor-retain-${item.id}`,
        title: response.changed ? '현재 번역을 승인 대기로 등록했습니다.' : '이미 같은 내용이 승인 대기 중입니다.'
      })
    } catch (error: unknown) {
      showToast({
        id: `editor-retain-failed-${item.id}`,
        title: '현재 번역을 유지하지 못했습니다.',
        description: getRequestErrorMessage(error, '잠시 후 다시 시도해 주세요.')
      })
    } finally {
      retainingItemId.value = null
    }
  }

  async function openCommentItem(comment: { unitId: string, itemKey: string }): Promise<void> {
    const visibleItem = items.value.find(item => item.id === comment.unitId)

    if (visibleItem) {
      selectItem(visibleItem)
      isMobileSidebarOpen.value = false
      return
    }

    await jumpToEditorKey(comment.itemKey)
  }

  function removeDraftByKey(key: string): void {
    removeDraftsByKeys([key])
  }

  function updateItemDraft(item: EditorItem): void {
    if (!draftsReady.value) {
      return
    }

    const key = getItemDraftKey(item)
    const persistedState = persistedItemStates.value[item.id]

    if (persistedState && item.ko === persistedState.ko) {
      removeDraftByKey(key)
      return
    }

    setDraft(key, {
      category: item.category,
      unitKey: item.unitKey,
      text: item.ko,
      updatedAt: Date.now(),
      itemId: item.id
    })
  }

  function handleItemTranslationInput(item: EditorItem, value: string): void {
    item.ko = value
    selectItem(item)
    updateItemDraft(item)
  }

  function getAiTranslationErrorMessage(error: unknown): string {
    return getRequestErrorMessage(error, 'AI 번역에 실패했습니다.')
  }

  async function translateSelectedItemWithAi(): Promise<void> {
    const item = selectedItem.value

    if (!item || isAiTranslating.value || !selectedItemHasSource.value) {
      return
    }

    if (!loggedIn.value) {
      showLoginRequiredToast('editor-ai-translation-login-required')
      return
    }

    isAiTranslating.value = true

    try {
      const response = await $fetch<EditorAiTranslationResponse>(
        `/api/editor/items/${encodeURIComponent(item.id)}/ai-translation`,
        {
          method: 'POST',
          body: {
            sourceVersionId: item.sourceVersionId
          }
        }
      )
      const translatedText = response.text.trim()

      if (response.itemId !== item.id
        || response.sourceVersionId !== item.sourceVersionId
        || !translatedText) {
        throw new Error('AI 번역 결과가 현재 항목과 일치하지 않습니다.')
      }

      handleItemTranslationInput(item, translatedText)
    } catch (error: unknown) {
      showToast({
        id: 'editor-ai-translation-failed',
        title: 'AI 번역에 실패했습니다.',
        description: getAiTranslationErrorMessage(error)
      })
    } finally {
      isAiTranslating.value = false
    }
  }

  async function saveCurrentPage(): Promise<void> {
    const entries = currentPageDrafts.value

    if (isSaving.value || !entries.length) {
      return
    }

    if (!loggedIn.value) {
      showLoginRequiredToast('editor-save-login-required')
      return
    }

    if (entries.some(({ draft }) => !draft.text.trim())) {
      showToast({
        id: 'editor-save-empty-translation',
        title: '번역을 저장할 수 없습니다.',
        description: '번역 내용이 비어 있는 항목을 먼저 입력해 주세요.'
      })
      return
    }

    isSaving.value = true

    try {
      const batch = await $fetch<EditorBatchSaveResponse>('/api/editor/items/batch', {
        method: 'PATCH',
        body: {
          items: entries.map(({ item, draft }) => ({
            id: item.id,
            text: draft.text
          }))
        }
      })
      const entriesById = new Map(entries.map(entry => [entry.item.id, entry]))
      const handledItemIds = new Set<string>()
      let savedCount = 0
      let failedCount = 0
      const savedDraftKeys: string[] = []
      const changedItemIds = new Set<string>()

      for (const result of batch.results) {
        const entry = entriesById.get(result.itemId)

        if (!entry || handledItemIds.has(result.itemId)) {
          continue
        }

        handledItemIds.add(result.itemId)

        if (!result.ok || !result.response) {
          failedCount += 1
          continue
        }

        const { item, draft } = entry
        const response = result.response
        const key = getItemDraftKey(item)
        const currentDraft = drafts.value[key]

        if (currentDraft?.text === draft.text) {
          savedDraftKeys.push(key)
        }

        item.ko = response.ko
        item.pendingStatus = response.status

        if (response.changed) {
          changedItemIds.add(item.id)
        }

        const previousState = persistedItemStates.value[item.id]
        setPersistedItemState(item.id, {
          ko: response.ko,
          pendingStatus: response.status ?? previousState?.pendingStatus ?? null,
          approvedForCurrentSource: previousState?.approvedForCurrentSource ?? item.approvedForCurrentSource
        })
        savedCount += 1
      }

      failedCount += entries.length - handledItemIds.size
      removeDraftsByKeys(savedDraftKeys)

      await Promise.allSettled([refreshItems(), refreshOverview()])

      if (activeSidebarMenu.value === 'history'
        && selectedItemId.value
        && changedItemIds.has(selectedItemId.value)) {
        historyReloadKey.value += 1
      }

      if (failedCount) {
        showToast({
          id: 'editor-save-partial',
          title: `${savedCount}개 항목을 저장했습니다.`,
          description: `${failedCount}개 항목은 저장하지 못했습니다. 임시저장 상태로 남아 있습니다.`
        })
      } else {
        showToast({
          id: 'editor-save-success',
          title: `${savedCount}개 항목을 저장했습니다.`
        })
      }
    } catch (error: unknown) {
      showToast({
        id: 'editor-save-failed',
        title: '번역을 저장하지 못했습니다.',
        description: getRequestErrorMessage(error, '잠시 후 다시 시도해 주세요.')
      })
    } finally {
      isSaving.value = false
    }
  }

  function revertSelectedItem(): void {
    const item = items.value.find(item => item.id === selectedItemId.value)

    if (!item) {
      return
    }

    const key = getItemDraftKey(item)
    const draft = drafts.value[key]

    if (!draft) {
      return
    }

    const persistedState = persistedItemStates.value[item.id]
    removeDraftByKey(key)
    item.ko = persistedState?.ko ?? ''
  }

  async function copySelectedItemLink(): Promise<void> {
    const item = items.value.find(item => item.id === selectedItemId.value)

    if (!item || !import.meta.client) {
      return
    }

    const query: Record<string, string> = { ...getEditorKeyQuery(getEditorItemKey(item)) }

    if (isFileMode.value) {
      query.file = item.category
    } else if (isTagMode.value) {
      query.version = version.value
      query.revision = revision.value
    }

    const resolved = router.resolve({ path: '/translate/editor', query })
    const url = new URL(resolved.href, window.location.origin).toString()

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API is unavailable')
      }

      await navigator.clipboard.writeText(url)
      showToast({
        id: 'editor-share-link-copied',
        title: '항목 링크를 복사했습니다.'
      })
    } catch {
      showToast({
        id: 'editor-share-link-copy-failed',
        title: '항목 링크를 복사하지 못했습니다.',
        description: '브라우저의 클립보드 권한을 확인해 주세요.'
      })
    } finally {
      optionsPopoverOpen.value = false
    }
  }

  function revertCurrentPageDrafts(): void {
    const entries = currentPageDrafts.value

    if (!entries.length) {
      return
    }

    removeDraftsByKeys(entries.map(({ item }) => getItemDraftKey(item)))

    for (const { item } of entries) {
      item.ko = persistedItemStates.value[item.id]?.ko ?? ''
    }

    optionsPopoverOpen.value = false
    showToast({
      id: 'editor-page-drafts-reset',
      title: `${entries.length}개 항목의 임시저장을 되돌렸습니다.`
    })
  }

  function handleHistoryChanged(): void {
    historyReloadKey.value += 1
    void refreshItems()
    void refreshOverview()
  }

  return {
    isSaving,
    isAiTranslating,
    retainingItemId,
    aiTranslationTooltip,
    retainItemTranslation,
    openCommentItem,
    removeDraftByKey,
    updateItemDraft,
    handleItemTranslationInput,
    getAiTranslationErrorMessage,
    translateSelectedItemWithAi,
    saveCurrentPage,
    revertSelectedItem,
    copySelectedItemLink,
    revertCurrentPageDrafts,
    handleHistoryChanged,
    loggedIn,
    showLoginRequiredToast
  }
}
