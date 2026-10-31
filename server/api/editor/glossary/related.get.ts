import { getQuery } from 'h3'
import { parseUuid } from '../../../utils/validation'
import { getGlossaryContext } from '../../../utils/editor-dictionary/glossary'

export default defineEventHandler(async event => getGlossaryContext(parseUuid(getQuery(event).itemId, 'Invalid translation item id')))
