import { PARTY_CHARACTER_IDS, getPartyCharacterImage, type PartyCharacter } from '#shared/types/party'
import { withDatabaseRetry } from '../../utils/database'

interface CharacterText {
  unit_key: string
  text: string
}

export default defineCachedEventHandler(async (): Promise<PartyCharacter[]> => {
  const keys = PARTY_CHARACTER_IDS.flatMap(id => [`${id}0`, `${id}1`])
  const rows = await withDatabaseRetry(database => database<CharacterText[]>`
    SELECT src.unit_key,
      COALESCE(NULLIF(btrim(tr.text), ''), NULLIF(btrim(src.en), ''),
        NULLIF(btrim(src.cn_s), ''), '') AS text
    FROM current_source_texts src
    LEFT JOIN translations tr ON tr.unit_id = src.unit_id AND tr.locale = 'ko'
    WHERE src.kind = 'str' AND src.namespace = 'STRCharacter'
      AND src.unit_key IN ${database(keys)}
  `)
  const texts = new Map(rows.map(row => [row.unit_key, row.text]))
  return PARTY_CHARACTER_IDS.map(id => ({
    id,
    name: texts.get(`${id}0`) || `캐릭터 ${id}`,
    nickname: texts.get(`${id}1`) || '',
    image: getPartyCharacterImage(id)
  }))
}, { maxAge: 300, swr: false })
