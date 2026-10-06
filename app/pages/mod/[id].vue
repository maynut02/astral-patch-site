<script setup lang="ts">
import type { ModDetailResponse, ModEntry } from '#shared/types/mod'
import { getRequestErrorMessage } from '~/utils/request-error'

const route = useRoute()
const { loggedIn, user } = useUserSession()
const { showToast } = useAppToast()
const editorOpen = ref(false)
const modId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const { data, status, error, refresh } = await useFetch<ModDetailResponse>(() => `/api/mods/${encodeURIComponent(modId.value)}`)
const detail = computed(() => data.value?.mod.id === modId.value ? data.value : null)

useAstralPageSeo(
  () => detail.value?.mod.name ?? '모드 상세',
  () => detail.value?.mod.summary || '모드의 소개, GitHub README, 최근 커밋과 버전별 다운로드를 확인하세요.'
)

function openEditor(): void {
  if (!loggedIn.value || !detail.value?.mod.canEdit) return
  editorOpen.value = true
}

async function handleSaved(mod: ModEntry): Promise<void> {
  if (data.value?.mod.id === mod.id) data.value = { ...data.value, mod }
  await Promise.allSettled([
    refresh(),
    refreshNuxtData('mod-hub-list')
  ])
  showToast({ id: `mod-saved-${mod.id}`, title: '모드 정보를 수정했습니다.' })
}

watch(() => user.value?.id, async () => {
  editorOpen.value = false
  await refresh()
})

watch(modId, () => {
  editorOpen.value = false
})
</script>

<template>
  <div class="mx-auto flex h-full w-full max-w-7xl flex-col gap-5 pb-5">
    <UButton
      to="/mod"
      color="neutral"
      variant="ghost"
      icon="i-tabler-arrow-left"
      class="self-start -ml-2"
    >
      모드 목록
    </UButton>

    <div v-if="status === 'pending' && !detail" class="flex min-h-60 items-center justify-center">
      <AppLoadingSpinner />
    </div>
    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      title="모드 정보를 불러오지 못했습니다."
      :description="getRequestErrorMessage(error, '등록되지 않은 모드이거나 연결에 문제가 있습니다.')"
    >
      <template #actions>
        <UButton
          color="error"
          variant="outline"
          size="xs"
          @click="refresh()"
        >
          다시 시도
        </UButton>
      </template>
    </UAlert>
    <ModDetail
      v-else-if="detail"
      :detail="detail"
      :refreshing="status === 'pending'"
      @edit="openEditor"
      @refresh="refresh()"
    />

    <ModEditor v-model:open="editorOpen" :mod="detail?.mod" @saved="handleSaved" />
  </div>
</template>
