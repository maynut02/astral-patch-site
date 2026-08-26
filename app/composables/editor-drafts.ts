import type { EditorItem } from '#shared/types/editor'

export interface EditorDraft {
  category: string
  unitKey: string
  text: string
  updatedAt: number
  itemId?: string
}

const DEFAULT_DRAFT_STORAGE_KEY = 'astral-editor-translation-drafts-v1'
const DRAFT_PERSIST_DELAY = 250

export function readEditorStorageValue(key: string): string | null {
  if (!import.meta.client) {
    return null
  }

  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeEditorStorageValue(key: string, value: string): boolean {
  if (!import.meta.client) {
    return false
  }

  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function removeEditorStorageValue(key: string): boolean {
  if (!import.meta.client) {
    return false
  }

  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

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

/**
 * Draft persistence uses the database item UUID as the internal identity so lang/str
 * rows with the same category and unit key cannot collide. Human-readable category
 * and unitKey values remain stored in each draft for display and recovery.
 */
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
      removeEditorStorageValue(storageKey)
      return
    }

    writeEditorStorageValue(storageKey, JSON.stringify(drafts.value))
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

    const storedDrafts = readEditorStorageValue(storageKey)

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
