import { PARTY_MAX_NICKNAME_LENGTH, getPartyTextLength } from '#shared/types/party'

export function validatePartyNickname(value: string): { nickname: string, error: string } {
  const nickname = value.trim()
  const valid = Boolean(nickname) && getPartyTextLength(nickname) <= PARTY_MAX_NICKNAME_LENGTH
  return { nickname, error: valid ? '' : `${PARTY_MAX_NICKNAME_LENGTH}자 이내의 닉네임을 입력해 주세요.` }
}
