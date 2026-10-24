import type { GameServerPayload, GameServerResponse } from '#shared/types/game-server'

const GAME_SERVER_API_URL = 'http://senotice1.feimogames.com:7878/api/data/get'

const getCachedGameServerData = defineCachedFunction(async (): Promise<GameServerResponse> => {
  const payload = await $fetch<GameServerPayload>(GAME_SERVER_API_URL, {
    timeout: 8_000
  })

  return {
    fetchedAt: new Date().toISOString(),
    payload
  }
}, {
  maxAge: 30,
  swr: true,
  name: 'astral-game-server-data',
  getKey: () => 'server-data'
})

export default defineEventHandler(async () => {
  try {
    return await getCachedGameServerData()
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: '게임 서버 정보를 불러오지 못했습니다.'
    })
  }
})
