import { createError } from 'h3'
import {
  EDITOR_ALL_CATEGORY_VALUE,
  EDITOR_ALL_REVISION_VALUE,
  type EditorSearchMatch,
  type EditorSearchType,
  type EditorItemStatusFilter
} from '#shared/types/editor'
import { getFirstQueryValue, parsePage as parseValidatedPage, parseUuid, UUID_PATTERN } from '../validation'

export interface EditorQueryFilters {
  page: number
  search: string
  searchType: EditorSearchType
  searchMatch: EditorSearchMatch
  statusFilter: EditorItemStatusFilter | 'all'
  category: string
  revisionId: string
  version: string
  revision: string
  itemId: string
  itemIds: string[] | null
  untranslatedOnly: boolean
}

function parseCategory(value: unknown): string {
  const category = getFirstQueryValue(value).trim()

  return category === EDITOR_ALL_CATEGORY_VALUE ? '' : category
}

function parseRevisionId(value: unknown): string {
  const revisionId = getFirstQueryValue(value)

  if (revisionId === EDITOR_ALL_REVISION_VALUE) {
    return ''
  }

  return revisionId ? parseUuid(revisionId, 'Invalid revision id') : ''
}

function parseVersion(value: unknown): string {
  return getFirstQueryValue(value).trim().replace(/^v/i, '')
}

function parseRevision(value: unknown): string {
  return getFirstQueryValue(value).trim().replace(/^r/i, '')
}

function parseItemId(value: unknown): string {
  const itemId = getFirstQueryValue(value)

  if (itemId && !UUID_PATTERN.test(itemId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid item id'
    })
  }

  return itemId
}

function parseItemIds(value: unknown): string[] | null {
  if (value === undefined || value === null) {
    return null
  }

  const rawItemIds = getFirstQueryValue(value).trim()

  if (!rawItemIds || rawItemIds === '__none__') {
    return []
  }

  const itemIds = [...new Set(rawItemIds.split(',').map(itemId => itemId.trim()).filter(Boolean))]

  if (itemIds.length > 500 || itemIds.some(itemId => !UUID_PATTERN.test(itemId))) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid item ids'
    })
  }

  return itemIds
}

function parseSearchType(value: unknown): EditorSearchType {
  const searchType = getFirstQueryValue(value).trim().toLowerCase()

  if (!searchType) {
    return 'all'
  }

  if (searchType !== 'all' && searchType !== 'content' && searchType !== 'key' && searchType !== 'source' && searchType !== 'translation') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid search type'
    })
  }

  return searchType
}

function parseSearchMatch(value: unknown): EditorSearchMatch {
  const searchMatch = getFirstQueryValue(value).trim().toLowerCase()

  if (!searchMatch) {
    return 'contains'
  }

  if (searchMatch !== 'contains' && searchMatch !== 'exact') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid search match'
    })
  }

  return searchMatch
}

function parseStatusFilter(value: unknown): EditorItemStatusFilter | 'all' {
  const status = getFirstQueryValue(value).trim().toLowerCase()

  if (!status || status === 'all') {
    return 'all'
  }

  if (status !== 'untranslated' && status !== 'pending' && status !== 'warning') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid status filter'
    })
  }

  return status
}

export function parseEditorQuery(query: Record<string, unknown>): EditorQueryFilters {
  const search = getFirstQueryValue(query.search).trim()
  const searchType = parseSearchType(query.searchType)
  const searchMatch = parseSearchMatch(query.match)
  const category = parseCategory(query.category)
  const revisionId = parseRevisionId(query.revisionId)
  const version = parseVersion(query.version)
  const revision = parseRevision(query.revision)
  const statusFilter = parseStatusFilter(query.status)
  const itemIds = parseItemIds(query.itemIds)
  const untranslated = getFirstQueryValue(query.untranslated).toLowerCase()
  const untranslatedOnly = untranslated === 'true' || untranslated === '1' || untranslated === 'on'

  if (search.length > 200 || category.length > 200 || version.length > 100 || revision.length > 100) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Filter value is too long'
    })
  }

  if (Boolean(version) !== Boolean(revision)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Version and revision must be provided together'
    })
  }

  return {
    page: parseValidatedPage(query.page, 'Invalid page'),
    search,
    searchType,
    searchMatch,
    statusFilter: statusFilter === 'all' && untranslatedOnly ? 'untranslated' : statusFilter,
    category,
    revisionId,
    version,
    revision,
    itemId: parseItemId(query.itemId),
    itemIds,
    untranslatedOnly
  }
}
