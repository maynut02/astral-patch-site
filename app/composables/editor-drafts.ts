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
  const serializedDrafts = new Map<string, string>()
  const dirtyKeys = new Set<string>()

  function persistDrafts(): void {
    if (!import.meta.client || !draftsReady.value) {
      return
    }

    const keys = Object.keys(drafts.value)
    if (!keys.length) {
      removeBrowserStorage(storageKey)
      serializedDrafts.clear()
      dirtyKeys.clear()
      return
    }

    for (const key of dirtyKeys) {
      const draft = drafts.value[key]
      if (draft) serializedDrafts.set(key, JSON.stringify(draft))
      else serializedDrafts.delete(key)
    }
    dirtyKeys.clear()

    // 기존 단일 JSON 객체의 키 순서와 직렬화 형식을 유지한다.
    const payload = keys.map(key => `${JSON.stringify(key)}:${serializedDrafts.get(key)}`).join(',')
    writeBrowserStorage(storageKey, `{${payload}}`)
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

  function setDraft(key: string, draft: EditorDraft): void {
    drafts.value[key] = draft
    dirtyKeys.add(key)
    schedulePersist()
  }

  function loadDrafts(): void {
    if (!import.meta.client) {
      draftsReady.value = true
      return
    }

    const storedDrafts = readBrowserStorage(storageKey)
    // 저장된 값을 정규화해 교체한 경우에만 다시 저장한다. 빈 키를 읽은 탭이 다른 탭의 임시저장을 지우지 않게 한다.
    let replaced = false

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
          replaced = true
        }
      } catch {
        drafts.value = {}
        replaced = true
      }
    }

    draftsReady.value = true
    serializedDrafts.clear()
    for (const [key, draft] of Object.entries(drafts.value)) {
      serializedDrafts.set(key, JSON.stringify(draft))
    }
    dirtyKeys.clear()
    if (replaced) schedulePersist()
  }

  function applyDraftsToItems(itemsToApply: EditorItem[]): void {
    if (!draftsReady.value) {
      return
    }

    for (const item of itemsToApply) {
      const key = getEditorDraftKey(item.id)
      const legacyKey = getLegacyEditorDraftKey(item.category, item.unitKey)
      const currentDraft = drafts.value[key]
      const legacyDraft = drafts.value[legacyKey]
      const draft = currentDraft ?? legacyDraft

      if (!draft) {
        continue
      }

      if (!currentDraft || draft.itemId !== item.id) {
        removeDraftsByKeys([legacyKey])
        setDraft(key, {
          ...draft,
          category: item.category,
          unitKey: item.unitKey,
          itemId: item.id
        })
      }

      item.ko = draft.text
    }
  }

  function hasItemDraft(item: Pick<EditorItem, 'id'>): boolean {
    return Boolean(drafts.value[getEditorDraftKey(item.id)])
  }

  function removeDraftsByKeys(keys: string[]): void {
    let removed = false
    for (const key of keys) {
      if (!Object.hasOwn(drafts.value, key)) continue
      Reflect.deleteProperty(drafts.value, key)
      dirtyKeys.add(key)
      removed = true
    }
    if (removed) schedulePersist()
  }

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
    setDraft,
    applyDraftsToItems,
    hasItemDraft,
    removeDraftsByKeys,
    getDraftKey: getEditorDraftKey
  }
}
