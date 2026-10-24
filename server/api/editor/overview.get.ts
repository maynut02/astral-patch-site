import { getEditorOverview } from '../../utils/editor-overview'

// 공개 실시간 현황이므로 인증이나 응답 캐시를 추가하지 않는다.
export default defineEventHandler(() => getEditorOverview())
