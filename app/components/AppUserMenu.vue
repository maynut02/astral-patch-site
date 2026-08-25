<script setup lang="ts">
import {
  formatHandle,
  getHandleInitial,
  getPublicProfilePath
} from '~/utils/profile'

const props = withDefaults(defineProps<{
  context?: 'default' | 'editor'
}>(), {
  context: 'default'
})

const { ready, loggedIn, user, clear } = useUserSession()
const route = useRoute()

const displayHandle = computed(() => formatHandle(user.value?.handle))
const initial = computed(() => getHandleInitial(user.value?.handle))
const publicProfilePath = computed(() => getPublicProfilePath(user.value?.handle, '/setting'))

const triggerClass = computed(() => props.context === 'editor'
  ? 'size-9 hover:bg-elevated/75 lg:size-10'
  : 'size-9 hover:bg-elevated/75'
)

const menuItems = computed(() => [{
  label: '내 프로필',
  icon: 'i-tabler-user-circle',
  to: publicProfilePath.value
}, {
  label: '설정',
  icon: 'i-tabler-settings',
  to: '/setting'
}, {
  label: '로그아웃',
  icon: 'i-tabler-logout',
  color: 'error' as const,
  onSelect: async () => {
    await clear()
  }
}])

function login() {
  const returnTo = encodeURIComponent(route.fullPath)

  return navigateTo(`/auth/login?returnTo=${returnTo}`, { external: true })
}
</script>

<template>
  <UDropdownMenu v-if="ready && loggedIn" :items="menuItems" :content="{ align: 'end', sideOffset: 8 }"
    :ui="{ content: 'w-52' }">
    <template #default="{ open }">
      <button type="button" aria-label="사용자 메뉴" :aria-expanded="open" aria-haspopup="menu"
        class="flex shrink-0 items-center justify-center rounded-md text-sm font-semibold text-default transition-colors"
        :class="[triggerClass, open ? 'bg-accented/75' : '', 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary']">
        <span class="flex size-6 items-center justify-center rounded-full bg-inverted text-xs text-inverted">
          {{ initial }}
        </span>
      </button>
    </template>

    <template #content-top="{ sub }">
      <div v-if="!sub" class="flex items-center min-w-0 gap-3 px-3 py-3 border-b border-default">
        <div
          class="flex size-6 shrink-0 items-center justify-center rounded-full bg-inverted text-sm font-semibold text-inverted">
          {{ initial }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <NuxtLink :to="publicProfilePath" class="truncate text-sm font-semibold text-default hover:underline"
              :class="hasUserRoleIcon(user?.role) ? '-mt-0.5' : ''">
              {{ displayHandle }}
            </NuxtLink>
            <AppUserRoleIcon :role="user?.role" />
          </div>
        </div>
      </div>
    </template>
  </UDropdownMenu>

  <button v-else-if="ready" type="button" aria-label="Google 로그인" :class="triggerClass"
    class="flex shrink-0 items-center justify-center rounded-md bg-elevated/75 text-muted transition-colors hover:text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    @click="login">
    <UIcon name="i-tabler-user-key" class="size-5" />
  </button>

  <div v-else :class="triggerClass"
    class="flex shrink-0 items-center justify-center rounded-md border border-accented/30 bg-elevated/60 text-muted backdrop-blur-lg"
    aria-label="로그인 상태 확인 중" role="status" aria-live="polite">
    <UIcon name="i-tabler-loader-2" class="size-5 animate-spin" />
  </div>
</template>
