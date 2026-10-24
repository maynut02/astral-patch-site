<script setup lang="ts">
import type { ModDetailResponse, ModEntry } from '#shared/types/mod'
import { getRequestErrorMessage } from '~/utils/request-error'

const route = useRoute()
const { loggedIn } = useUserSession()
const { showToast } = useAppToast()
const editorOpen = ref(false)
const deleteOpen = ref(false)
const editorTarget = ref<{ id: string, session: string } | null>(null)
const deletedId = ref('')
const sessionKey = useSessionKey()
const permissionSession = ref<string | null>(sessionKey.value)
const modId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const { data, status, error, refresh } = await useFetch<ModDetailResponse>(() => `/api/mods/${encodeURIComponent(modId.value)}`)
const detail = computed(() => data.value?.mod.id === modId.value ? data.value : null)
const managementEnabled = computed(() => permissionSession.value === sessionKey.value && deletedId.value !== modId.value)

useAstralPageSeo(
  () => detail.value?.mod.name ?? '모드 상세',
  () => detail.value?.github?.description || '모드의 소개, GitHub README, 최근 커밋과 버전별 다운로드를 확인하세요.'
)

function canManage(action: 'edit' | 'delete', id = modId.value): boolean {
  return managementEnabled.value
    && loggedIn.value
    && Boolean(action === 'edit' ? detail.value?.mod.canEdit : detail.value?.mod.canDelete)
    && modId.value === id
}

function openEditor(): void {
  if (!canManage('edit')) return
  deleteOpen.value = false
  editorTarget.value = { id: modId.value, session: sessionKey.value }
  editorOpen.value = true
}

function openDelete(): void {
  if (!canManage('delete')) return
  editorOpen.value = false
  editorTarget.value = null
  deleteOpen.value = true
}

async function refreshDetail(): Promise<void> {
  const session = sessionKey.value
  await refresh()
  if (sessionKey.value === session && !error.value) permissionSession.value = session
}

async function handleSaved(mod: ModEntry): Promise<void> {
  const target = editorTarget.value
  if (!target || target.id !== mod.id || target.session !== sessionKey.value
    || !canManage('edit', mod.id)) return
  editorTarget.value = null
  if (data.value?.mod.id === mod.id) data.value = { ...data.value, mod }
  await Promise.allSettled([
    refreshDetail(),
    refreshNuxtData('mod-hub-list')
  ])
  if (modId.value === target.id && sessionKey.value === target.session) {
    showToast({ id: `mod-saved-${mod.id}`, title: '모드 정보를 수정했습니다.' })
  }
}

async function handleDeleted(id: string): Promise<void> {
  if (!canManage('delete', id)) return
  deletedId.value = id
  deleteOpen.value = false
  editorOpen.value = false
  clearNuxtData('mod-hub-list')
  showToast({ id: `mod-deleted-${id}`, title: '모드를 삭제했습니다.' })
  await navigateTo('/mod')
}

watch([
  modId,
  sessionKey,
  () => detail.value?.mod.canEdit,
  () => detail.value?.mod.canDelete
], () => {
  editorOpen.value = false
  deleteOpen.value = false
  editorTarget.value = null
}, { flush: 'sync' })

watch(modId, () => {
  deletedId.value = ''
}, { flush: 'sync' })

watch(sessionKey, async (session) => {
  if (permissionSession.value === session) return
  permissionSession.value = null
  await refreshDetail()
}, { immediate: true, flush: 'sync' })
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
          @click="refreshDetail()"
        >
          다시 시도
        </UButton>
      </template>
    </UAlert>
    <ModDetail
      v-else-if="detail"
      :detail="detail"
      :refreshing="status === 'pending'"
      :management-enabled="managementEnabled"
      @edit="openEditor"
      @delete="openDelete"
      @refresh="refreshDetail()"
    />

    <ModEditor
      v-if="managementEnabled && loggedIn && detail?.mod.canEdit"
      :key="`${modId}:${sessionKey}`"
      v-model:open="editorOpen"
      :mod="detail.mod"
      @saved="handleSaved"
    />
    <ModDeleteConfirm
      v-if="managementEnabled && loggedIn && detail?.mod.canDelete"
      v-model:open="deleteOpen"
      :mod="detail.mod"
      @deleted="handleDeleted"
    />
  </div>
</template>
