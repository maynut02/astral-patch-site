<script setup lang="ts">
import type { AdminUserEntry, AdminUsersResponse } from '#shared/types/admin'
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
const { user: currentUser } = useUserSession()
const { showToast } = useAppToast()

const {
  data,
  status,
  error,
  refresh
} = await useFetch<AdminUsersResponse>('/api/admin/users', {
  default: () => defaultData
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
  </section>
</template>
