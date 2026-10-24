import type { DatabaseClient } from '../database'

// 표시용 빈 문자열과 집계용 공백 제거는 의미가 달라 구분해서 유지한다.
export function effectiveWorkbenchText(sql: DatabaseClient, blankAsNull = false) {
  if (blankAsNull) {
    return sql`CASE
      WHEN wb.latest_change_status = 'pending' THEN COALESCE(
        NULLIF(BTRIM(wb.latest_proposed_text), ''), NULLIF(BTRIM(wb.approved_text), '')
      )
      ELSE NULLIF(BTRIM(wb.approved_text), '')
    END`
  }

  return sql`CASE
    WHEN wb.latest_change_status = 'pending' THEN COALESCE(wb.latest_proposed_text, wb.approved_text, '')
    ELSE COALESCE(wb.approved_text, '')
  END`
}

export function workbenchStatusCounts(sql: DatabaseClient) {
  return sql`
    count(*)::int AS total,
    count(*) FILTER (
      WHERE effective_text IS NOT NULL
        AND latest_change_status IS DISTINCT FROM 'pending'
        AND approved_for_current_source IS TRUE
    )::int AS success,
    count(*) FILTER (
      WHERE effective_text IS NOT NULL AND latest_change_status = 'pending'
    )::int AS info,
    count(*) FILTER (
      WHERE effective_text IS NOT NULL
        AND latest_change_status IS DISTINCT FROM 'pending'
        AND approved_for_current_source IS NOT TRUE
    )::int AS warning,
    count(*) FILTER (WHERE effective_text IS NULL)::int AS untranslated
  `
}

export function sourceVersionJoins(sql: DatabaseClient) {
  return sql`
    LEFT JOIN source_versions old_sv ON old_sv.id = sc.old_source_version_id
    LEFT JOIN source_versions new_sv ON new_sv.id = sc.new_source_version_id
  `
}

export function contributorCounts(sql: DatabaseClient) {
  // 공개 프로필은 LEFT JOIN으로 0건도 포함하고 기여자 목록은 JOIN으로 제외한다.
  return sql`
    count(changes.id)::int AS "translationCount",
    count(changes.id) FILTER (WHERE changes.status = 'approved')::int AS "approvedTranslationCount"
  `
}

const SOURCE_VERSION_FIELDS = [
  ['beforeCnS', 'old_sv.cn_s'],
  ['beforeEn', 'old_sv.en'],
  ['beforeJp', 'old_sv.jp'],
  ['beforeCnT', 'old_sv.cn_t'],
  ['afterCnS', 'new_sv.cn_s'],
  ['afterEn', 'new_sv.en'],
  ['afterJp', 'new_sv.jp'],
  ['afterCnT', 'new_sv.cn_t']
] as const

export function sourceVersionFields(sql: DatabaseClient, json = false) {
  let fields = sql``
  for (const [index, [name, column]] of SOURCE_VERSION_FIELDS.entries()) {
    const field = json ? sql`${name}::text, ${sql(column)}` : sql`${sql(column)} AS ${sql(name)}`
    fields = sql`${fields}${index > 0 ? sql`,` : sql``}${field}`
  }
  return fields
}
