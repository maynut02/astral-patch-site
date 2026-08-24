<script setup lang="ts">
const navItem = [
  { link: '/', icon: 'i-tabler-home', label: '홈' },
  { link: '/download', icon: 'i-tabler-download', label: '다운로드' },
  { link: '/release', icon: 'i-tabler-clipboard-check', label: '패치 릴리즈' },
  { link: '/translate', icon: 'i-tabler-edit', label: '번역 에디터' },
  { link: '/translate/log', icon: 'i-tabler-history-toggle', label: '변경 기록' },
  { link: '/translate/log', icon: 'i-tabler-package', label: '모드 허브' },
  { link: '/', icon: 'i-tabler-speakerphone', label: '공지사항' },
  { link: '/', icon: 'i-tabler-user-heart', label: '기여자' },
]

const isSidebarCollapsed = ref(false)
const isMediumSidebarViewport = ref(false)
let mediumSidebarMediaQuery: MediaQueryList | undefined

const isSidebarEffectivelyCollapsed = computed(() =>
  isSidebarCollapsed.value || isMediumSidebarViewport.value
)

function syncSidebarViewport() {
  isMediumSidebarViewport.value = mediumSidebarMediaQuery?.matches ?? false
}

onMounted(() => {
  mediumSidebarMediaQuery = window.matchMedia('(min-width: 768px) and (max-width: 1023.98px)')
  syncSidebarViewport()
  mediumSidebarMediaQuery.addEventListener('change', syncSidebarViewport)
})

onBeforeUnmount(() => {
  mediumSidebarMediaQuery?.removeEventListener('change', syncSidebarViewport)
})

const { ready, loggedIn, user, clear } = useUserSession()

const userMenuItems = computed(() => [[{
  label: user.value?.email ?? '로그인한 사용자',
  icon: 'i-tabler-user',
  disabled: true
}], [{
  label: user.value?.role === 'admin' ? '관리자' : '사용자',
  disabled: true
}], [{
  label: '로그아웃',
  icon: 'i-tabler-logout',
  onSelect: () => clear()
}]])

function login() {
  return navigateTo('/auth/google', { external: true })
}
</script>

<template>
  <div class="flex flex-col min-h-dvh">
    <div class="flex justify-between h-14 bg-default border-b border-default shrink-0 sticky top-0 z-100">
      <NuxtLink to="/" class="flex px-5 items-center hover:opacity-80 transition-opacity">
        <img src="/favicon.ico" alt="icon" class="size-5">
      </NuxtLink>

      <div class="flex items-center gap-2 px-5">
        <UDropdownMenu v-if="ready && loggedIn" :items="userMenuItems" :content="{ align: 'end' }">
          <button aria-label="사용자 메뉴"
            class="size-9 shrink-0 flex justify-center items-center rounded-md bg-muted hover:bg-elevated text-muted hover:text-default transition-colors">
            <UIcon name="i-tabler-user" class="size-5" />
          </button>
        </UDropdownMenu>

        <button v-else-if="ready" aria-label="Google 로그인" @click="login"
          class="size-9 shrink-0 flex justify-center items-center rounded-md bg-muted hover:bg-elevated text-muted hover:text-default transition-colors">
          <UIcon name="i-tabler-login-2" class="size-5" />
        </button>

        <div v-else
          class="flex items-center justify-center size-9 shrink-0 rounded-md bg-elevated/60 backdrop-blur-lg text-muted border border-accented/30"
          aria-label="로그인 상태 확인 중">
          <UIcon name="i-tabler-loader-2" class="size-5 animate-spin" />
        </div>

        <button aria-label="메뉴"
          class="size-9 shrink-0 flex md:hidden justify-center items-center rounded-md hover:bg-elevated text-muted hover:text-default transition-colors">
          <UIcon name="i-tabler-menu" class="size-5" />
        </button>
      </div>
    </div>

    <div class="flex flex-1">
      <aside
        class="hidden md:flex w-14 flex-col shrink-0 h-[calc(100dvh-3.5rem)] bg-default sticky top-14 z-100 overflow-hidden transition-[width] duration-200 ease-in-out"
        :class="isSidebarCollapsed ? 'lg:w-14' : 'lg:w-52'">
        <nav class="flex flex-1 flex-col gap-1 text-sm font-medium p-2 overflow-y-auto">
          <UTooltip v-for="item in navItem" :key="item.label" :text="item.label"
            :disabled="!isSidebarEffectivelyCollapsed" :content="{ side: 'right', sideOffset: 8 }">
            <NuxtLink :to="item.link" active-class="bg-elevated! text-default!" :aria-label="item.label" :class="[
              isSidebarEffectivelyCollapsed ? 'py-2' : 'py-1.5',
              'md:max-lg:py-2',
              'px-2 flex items-center gap-2 overflow-hidden hover:bg-muted rounded-md text-muted hover:text-toned transition-all shrink-0'
            ]">
              <div class="flex justify-center items-center size-6 shrink-0">
                <UIcon :name="item.icon" class="size-5" />
              </div>
              <span :class="[
                'min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-in-out',
                isSidebarEffectivelyCollapsed ? 'max-w-0 opacity-0' : 'max-w-40 opacity-100',
                'md:max-lg:max-w-0 md:max-lg:opacity-0'
              ]">{{ item.label }}</span>
            </NuxtLink>
          </UTooltip>
        </nav>

        <div class="flex flex-col p-2 shrink-0 md:max-lg:hidden">
          <UTooltip :text="isSidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'" :disabled="!isSidebarEffectivelyCollapsed"
            :content="{ side: 'right', sideOffset: 8 }">
            <button :aria-label="isSidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'"
              class="px-2 flex items-center gap-2 overflow-hidden hover:bg-muted rounded-md transition-colors text-sm font-medium text-muted hover:text-default"
              :class="isSidebarCollapsed ? 'py-2' : 'py-1.5'" @click="isSidebarCollapsed = !isSidebarCollapsed">
              <div class="flex justify-center items-center size-6 shrink-0">
                <UIcon
                  :name="isSidebarCollapsed ? 'i-tabler-layout-sidebar-left-expand' : 'i-tabler-layout-sidebar-left-collapse'"
                  class="size-5" />
              </div>
              <span :class="[
                'min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-in-out',
                isSidebarCollapsed ? 'max-w-0 opacity-0' : 'max-w-40 opacity-100'
              ]">사이드바 접기</span>
            </button>
          </UTooltip>
        </div>
      </aside>

      <main class="min-w-0 flex-1 md:border-l border-default">
        <slot />
      </main>
    </div>
  </div>
</template>
