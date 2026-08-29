import type { EditorItem } from '#shared/types/editor'
import { readBrowserStorage, removeBrowserStorage, writeBrowserStorage } from '~/utils/browser-storage'

export interface EditorDraft {
  category: string
  unitKey: string
  text: string
  updatedAt: number
  itemId?: string
}

const DEFAULT_DRAFT_STORAGE_KEY = 'astral-editor-translation-drafts-v1'
const DRAFT_PERSIST_DELAY = 250

function isEditorDraft(value: unknown): value is EditorDraft {
  if (!value || typeof value !== 'object') {
    return false
  }

  const draft = value as Record<string, unknown>

  return typeof draft.category === 'string'
    && typeof draft.unitKey === 'string'
    && typeof draft.text === 'string'
    && typeof draft.updatedAt === 'number'
    && (draft.itemId === undefined || typeof draft.itemId === 'string')
}

// DB 항목 UUID를 임시저장 키로 사용해 같은 category/unitKey 간 충돌을 막는다.
export function getEditorDraftKey(itemId: string): string {
  return itemId
}

function getLegacyEditorDraftKey(category: string, unitKey: string): string {
  return `${category}::${unitKey}`
}

export function useEditorDraftStorage(storageKey = DEFAULT_DRAFT_STORAGE_KEY) {
  const drafts = ref<Record<string, EditorDraft>>({})
  const draftsReady = ref(false)
  let persistTimer: ReturnType<typeof setTimeout> | undefined

  function persistDrafts(): void {
    if (!import.meta.client || !draftsReady.value) {
      return
    }

    if (Object.keys(drafts.value).length === 0) {
      removeBrowserStorage(storageKey)
      return
    }

    writeBrowserStorage(storageKey, JSON.stringify(drafts.value))
  }

  function schedulePersist(): void {
    if (!import.meta.client || !draftsReady.value) {
      return
    }

    if (persistTimer) {
      clearTimeout(persistTimer)
    }

    persistTimer = setTimeout(() => {
      persistTimer = undefined
      persistDrafts()
    }, DRAFT_PERSIST_DELAY)
  }

  function loadDrafts(): void {
    if (!import.meta.client) {
      draftsReady.value = true
      return
    }

    const storedDrafts = readBrowserStorage(storageKey)

    if (storedDrafts) {
      try {
        const parsed: unknown = JSON.parse(storedDrafts)

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const nextDrafts: Record<string, EditorDraft> = {}

          for (const [key, value] of Object.entries(parsed)) {
            if (isEditorDraft(value)) {
              nextDrafts[key] = {
                category: value.category,
                unitKey: value.unitKey,
                text: value.text,
                updatedAt: value.updatedAt,
                ...(value.itemId ? { itemId: value.itemId } : {})
              }
            }
          }

          drafts.value = nextDrafts
        }
      } catch {
        drafts.value = {}
      }
    }

    draftsReady.value = true
  }

  function applyDraftsToItems(itemsToApply: EditorItem[]): void {
    if (!draftsReady.value) {
      return
    }

    let nextDrafts = drafts.value
    let draftsChanged = false

    for (const item of itemsToApply) {
      const key = getEditorDraftKey(item.id)
      const legacyKey = getLegacyEditorDraftKey(item.category, item.unitKey)
      const currentDraft = nextDrafts[key]
      const legacyDraft = nextDrafts[legacyKey]
      const draft = currentDraft ?? legacyDraft

      if (!draft) {
        continue
      }

      if (!currentDraft || draft.itemId !== item.id) {
        const { [legacyKey]: _legacy, ...withoutLegacy } = nextDrafts
        nextDrafts = {
          ...withoutLegacy,
          [key]: {
            ...draft,
            category: item.category,
            unitKey: item.unitKey,
            itemId: item.id
          }
        }
        draftsChanged = true
      }

      item.ko = draft.text
    }

    if (draftsChanged) {
      drafts.value = nextDrafts
    }
  }

  function hasItemDraft(item: Pick<EditorItem, 'id'>): boolean {
    return Boolean(drafts.value[getEditorDraftKey(item.id)])
  }

  function removeDraftsByKeys(keys: string[]): void {
    const keysToRemove = new Set(keys)
    const nextDrafts = Object.fromEntries(
      Object.entries(drafts.value).filter(([key]) => !keysToRemove.has(key))
    )
    const removed = Object.keys(nextDrafts).length !== Object.keys(drafts.value).length

    if (removed) {
      drafts.value = nextDrafts
    }
  }

  watch(drafts, schedulePersist, { deep: true })

  onBeforeUnmount(() => {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = undefined
    }

    persistDrafts()
  })

  return {
    drafts,
    draftsReady,
    loadDrafts,
    schedulePersist,
    applyDraftsToItems,
    hasItemDraft,
    removeDraftsByKeys,
    getDraftKey: getEditorDraftKey
  }
}
