<script setup lang="ts">
import type { AdminPatchWatcherConfig, AdminUserEntry, AdminUsersResponse } from '#shared/types/admin'
import { isUserRole, type UserRole } from '#shared/types/user'
import { formatEditorDate } from '~/utils/editor-helpers'
import { getUserRoleMeta } from '~/utils/user-role'

definePageMeta({ middleware: 'admin' })
useAstralPageSeo('관리자')

const roleItems = [
  { label: '관리자', value: 'admin' },
  { label: '인증된 사용자', value: 'verified' },
  { label: '일반 사용자', value: 'user' }
]

const defaultData: AdminUsersResponse = {
  users: [],
  total: 0
}

const search = ref('')
const updatingUserId = ref<string | null>(null)
const gameVersionInput = ref('')
const isPatchWatcherConfirmOpen = ref(false)
const isUpdatingPatchWatcher = ref(false)
const { user: currentUser } = useUserSession()
const { showToast } = useAppToast()

const gameVersionPattern = /^\d+\.\d+\.\d+$/

const {
  data: patchWatcherConfig,
  status: patchWatcherStatus,
  error: patchWatcherError,
  refresh: refreshPatchWatcher
} = await useFetch<AdminPatchWatcherConfig>('/api/admin/patch-watcher')

const {
  data,
  status,
  error,
  refresh
} = await useFetch<AdminUsersResponse>('/api/admin/users', {
  default: () => defaultData
})

watch(patchWatcherConfig, (config) => {
  gameVersionInput.value = config?.gameVersion ?? ''
}, { immediate: true })

const normalizedGameVersion = computed(() => gameVersionInput.value.trim())
const isGameVersionValid = computed(() => gameVersionPattern.test(normalizedGameVersion.value))
const hasGameVersionChange = computed(() => (
  Boolean(patchWatcherConfig.value)
  && normalizedGameVersion.value !== patchWatcherConfig.value?.gameVersion
))
const gameVersionError = computed(() => {
  if (!gameVersionInput.value || isGameVersionValid.value) {
    return undefined
  }

  return '버전은 3.2.0처럼 x.y.z 형식으로 입력해 주세요.'
})

const filteredUsers = computed(() => {
  const query = search.value.trim().toLowerCase()
  const users = data.value?.users ?? []

  if (!query) {
    return users
  }

  return users.filter(user => [user.handle, user.email, getRoleLabel(user.role)]
    .some(value => value?.toLowerCase().includes(query)))
})

function getRoleLabel(role: UserRole): string {
  return getUserRoleMeta(role)?.label ?? '일반 사용자'
}

function isRoleEditable(user: AdminUserEntry): boolean {
  return user.role !== 'bot' && user.id !== currentUser.value?.id
}

function openPatchWatcherConfirm(): void {
  if (!isGameVersionValid.value || !hasGameVersionChange.value || isUpdatingPatchWatcher.value) {
    return
  }

  isPatchWatcherConfirmOpen.value = true
}

async function updatePatchWatcherGameVersion(): Promise<void> {
  if (!isGameVersionValid.value || !hasGameVersionChange.value || isUpdatingPatchWatcher.value) {
    return
  }

  isUpdatingPatchWatcher.value = true

  try {
    patchWatcherConfig.value = await $fetch<AdminPatchWatcherConfig>('/api/admin/patch-watcher', {
      method: 'PATCH',
      body: { gameVersion: normalizedGameVersion.value }
    })
    gameVersionInput.value = patchWatcherConfig.value.gameVersion
    isPatchWatcherConfirmOpen.value = false
    showToast({
      id: 'admin-patch-watcher-version-updated',
      title: '게임 버전을 변경했습니다.'
    })
  } catch (patchWatcherUpdateError) {
    showToast({
      id: 'admin-patch-watcher-version-update-failed',
      title: '게임 버전을 변경하지 못했습니다.',
      description: patchWatcherUpdateError instanceof Error ? patchWatcherUpdateError.message : undefined
    })
    await refreshPatchWatcher()
  } finally {
    isUpdatingPatchWatcher.value = false
  }
}

async function updateRole(user: AdminUserEntry, value: unknown): Promise<void> {
  if (!isRoleEditable(user) || !isUserRole(value) || value === 'bot' || value === user.role || updatingUserId.value) {
    return
  }

  updatingUserId.value = user.id

  try {
    const response = await $fetch<{ id: string, role: UserRole }>(
      `/api/admin/users/${encodeURIComponent(user.id)}`,
      {
        method: 'PATCH',
        body: { role: value }
      }
    )

    user.role = response.role
    showToast({
      id: `admin-role-updated-${user.id}`,
      title: '사용자 역할을 변경했습니다.'
    })
  } catch (roleError) {
    showToast({
      id: `admin-role-update-failed-${user.id}`,
      title: '사용자 역할을 변경하지 못했습니다.',
      description: roleError instanceof Error ? roleError.message : undefined
    })
    await refresh()
  } finally {
    updatingUserId.value = null
  }
}
</script>

<template>
  <section class="mx-auto flex w-full max-w-7xl flex-col gap-5">
    <header class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <UIcon
          name="i-tabler-shield-lock"
          class="size-5 text-muted"
        />
        <h1 class="text-xl font-semibold text-default">
          관리자
        </h1>
      </div>
    </header>

    <section class="border border-default">
      <div class="flex flex-col gap-3 border-b border-default bg-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-tabler-radar"
            class="size-5 text-muted"
          />
          <div>
            <h2 class="text-sm font-semibold text-default">
              패치 감시 설정
            </h2>
            <p class="text-xs text-muted">
              서버의 5분 주기 패치 감시 작업이 확인할 게임 버전을 관리합니다.
            </p>
          </div>
        </div>

        <UBadge
          v-if="patchWatcherConfig"
          :color="patchWatcherConfig.enabled ? 'success' : 'neutral'"
          variant="soft"
        >
          {{ patchWatcherConfig.enabled ? '감시 활성화' : '감시 비활성화' }}
        </UBadge>
      </div>

      <div v-if="patchWatcherStatus === 'pending'" class="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div class="space-y-2">
          <USkeleton class="h-4 w-24" />
          <USkeleton class="h-9 w-full max-w-md" />
          <USkeleton class="h-3 w-72 max-w-full" />
        </div>
        <USkeleton class="h-16 w-full" />
      </div>

      <div v-else-if="patchWatcherError" class="p-4">
        <UAlert
          color="error"
          variant="soft"
          title="패치 감시 설정을 불러오지 못했습니다."
          description="데이터베이스 연결과 patch_watch_config 설정을 확인해 주세요."
        >
          <template #actions>
            <UButton
              color="error"
              variant="outline"
              size="sm"
              @click="refreshPatchWatcher()"
            >
              다시 시도
            </UButton>
          </template>
        </UAlert>
      </div>

      <div v-else-if="patchWatcherConfig" class="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
        <div class="flex flex-col gap-4">
          <UFormField
            name="gameVersion"
            label="게임 버전"
            description="x.y.z 형식의 정식 게임 버전을 입력합니다."
            :error="gameVersionError"
          >
            <div class="flex flex-col gap-2 sm:flex-row">
              <UInput
                v-model="gameVersionInput"
                color="neutral"
                placeholder="3.2.0"
                class="w-full sm:max-w-xs"
                :disabled="isUpdatingPatchWatcher"
                @keyup.enter="openPatchWatcherConfirm"
              />
              <UButton
                icon="i-tabler-device-floppy"
                color="neutral"
                variant="soft"
                :loading="isUpdatingPatchWatcher"
                :disabled="!isGameVersionValid || !hasGameVersionChange || isUpdatingPatchWatcher"
                @click="openPatchWatcherConfirm"
              >
                버전 변경
              </UButton>
            </div>
          </UFormField>

          <UAlert
            color="warning"
            variant="soft"
            icon="i-tabler-alert-triangle"
            title="변경한 버전은 다음 패치 감시 주기부터 적용됩니다."
            description="새 버전에서 패치 변경이 감지되면 릴리스 빌드가 자동으로 시작될 수 있습니다."
          />
        </div>

        <dl class="grid gap-3 border border-default p-3 text-sm">
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted">
              현재 버전
            </dt>
            <dd class="font-medium text-default">
              {{ patchWatcherConfig.gameVersion }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="text-muted">
              마지막 변경
            </dt>
            <dd class="text-right text-toned">
              {{ formatEditorDate(patchWatcherConfig.updatedAt) }}
            </dd>
          </div>
        </dl>
      </div>
    </section>

    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <UInput
        v-model="search"
        icon="i-tabler-search"
        color="neutral"
        placeholder="사용자, 이메일, 역할 검색"
        class="w-full sm:max-w-sm"
      />
      <span class="shrink-0 text-sm text-muted">
        {{ filteredUsers.length.toLocaleString() }} / {{ (data?.total ?? 0).toLocaleString() }}명
      </span>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="사용자 목록을 불러오지 못했습니다."
      description="잠시 후 다시 시도해 주세요."
    >
      <template #actions>
        <UButton
          color="error"
          variant="outline"
          size="sm"
          @click="refresh()"
        >
          다시 시도
        </UButton>
      </template>
    </UAlert>

    <div
      v-if="status === 'pending'"
      class="flex flex-col border border-default"
    >
      <div
        v-for="index in 6"
        :key="index"
        class="grid gap-3 border-b border-default p-4 last:border-b-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_12rem_11rem] md:items-center"
      >
        <USkeleton class="h-4 w-1/2" />
        <USkeleton class="h-4 w-2/3" />
        <USkeleton class="h-8 w-full" />
        <USkeleton class="h-4 w-3/4" />
      </div>
    </div>

    <UAlert
      v-else-if="!error && !filteredUsers.length"
      color="neutral"
      variant="soft"
      icon="i-tabler-users-off"
      title="표시할 사용자가 없습니다."
      description="검색 조건을 바꿔 보세요."
    />

    <div
      v-else-if="!error"
      class="overflow-hidden border border-default"
    >
      <div class="hidden grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_9rem_13rem] gap-3 border-b border-default bg-muted px-4 py-2 text-xs font-medium text-muted md:grid">
        <span>사용자</span>
        <span>이메일</span>
        <span>역할</span>
        <span>계정 정보</span>
      </div>

      <article
        v-for="entry in filteredUsers"
        :key="entry.id"
        class="grid gap-3 border-b border-default p-4 last:border-b-0 hover:bg-elevated/40 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_9rem_13rem] md:items-center"
      >
        <div class="min-w-0">
          <AppUserIdentity
            :handle="entry.handle"
            :role="entry.role"
            fallback=""
            text-class="text-sm font-medium text-default"
          />
        </div>

        <span class="min-w-0 truncate text-sm text-toned" :title="entry.email">
          {{ entry.email }}
        </span>

        <div class="flex min-w-0 items-center gap-2">
          <USelect
            v-if="isRoleEditable(entry)"
            :model-value="entry.role"
            :items="roleItems"
            color="neutral"
            variant="outline"
            class="w-full"
            :loading="updatingUserId === entry.id"
            :disabled="Boolean(updatingUserId)"
            @update:model-value="updateRole(entry, $event)"
          />
          <UBadge
            v-else
            color="neutral"
            variant="soft"
            size="lg"
          >
            {{ getRoleLabel(entry.role) }}
          </UBadge>
        </div>

        <div class="flex min-w-0 flex-col gap-0.5 text-xs text-muted">
          <span>가입: {{ formatEditorDate(entry.createdAt) }}</span>
          <span v-if="entry.lastLoginAt">최근 로그인: {{ formatEditorDate(entry.lastLoginAt) }}</span>
          <span v-else>로그인 기록 없음</span>
        </div>
      </article>
    </div>

    <UModal
      v-model:open="isPatchWatcherConfirmOpen"
      title="게임 버전을 변경할까요?"
      :description="`${patchWatcherConfig?.gameVersion ?? '-'}에서 ${normalizedGameVersion}로 변경합니다.`"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <UAlert
          color="warning"
          variant="soft"
          icon="i-tabler-alert-triangle"
          title="다음 5분 주기의 패치 감시 작업부터 새 버전을 사용합니다."
          description="새 버전에서 변경 사항이 발견되면 GitHub Actions의 릴리스 패치 작업이 자동으로 실행될 수 있습니다."
        />
      </template>

      <template #footer="{ close }">
        <UButton
          color="neutral"
          variant="outline"
          :disabled="isUpdatingPatchWatcher"
          @click="close"
        >
          취소
        </UButton>
        <UButton
          color="warning"
          icon="i-tabler-check"
          :loading="isUpdatingPatchWatcher"
          :disabled="!isGameVersionValid || !hasGameVersionChange"
          @click="updatePatchWatcherGameVersion"
        >
          변경
        </UButton>
      </template>
    </UModal>
  </section>
</template>
