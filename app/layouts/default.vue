<script setup lang="ts">
import { getHandleInitial, getPublicProfilePath } from '~/utils/profile'

type NavItem = {
  link: string
  icon: string
  label: string
  emphasis?: 'info'
}

const publicNavItems: NavItem[] = [
  { link: '/', icon: 'i-tabler-home', label: '홈' },
  { link: '/download', icon: 'i-tabler-download', label: '다운로드' },
  { link: '/release', icon: 'i-tabler-clipboard-check', label: '릴리즈 노트' },
  { link: '/translate', icon: 'i-tabler-language', label: '번역 대시보드' },
  { link: '/change', icon: 'i-tabler-history-toggle', label: '변경 기록' },
  { link: '/status', icon: 'i-tabler-activity-heartbeat', label: '서비스 상태' },
  { link: '/mod', icon: 'i-tabler-package', label: '모드 허브' },
  { link: '/notice', icon: 'i-tabler-speakerphone', label: '공지사항' },
  { link: '/contributor', icon: 'i-tabler-user-heart', label: '기여자' }
]

const SIDEBAR_COOKIE_KEY = 'astral-patch-sidebar-collapsed'
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10
const isSidebarCollapsed = useCookie<boolean>(SIDEBAR_COOKIE_KEY, {
  default: () => false,
  maxAge: SIDEBAR_COOKIE_MAX_AGE,
  sameSite: 'lax'
})
const isMobileNavigationOpen = ref(false)
const isMobileUserMenuOpen = ref(false)

const {
  ready: authReady,
  loggedIn: isLoggedIn,
  user: currentUser,
  clear: clearSession
} = useUserSession()

const navItems = computed<NavItem[]>(() => [
  ...publicNavItems,
  ...(currentUser.value?.role === 'admin' || currentUser.value?.role === 'verified'
    ? [{ link: '/translate/review', icon: 'i-tabler-checkup-list', label: '번역 승인', emphasis: 'info' as const }]
    : []),
  ...(currentUser.value?.role === 'admin'
    ? [{ link: '/admin', icon: 'i-tabler-shield-lock', label: '관리자', emphasis: 'info' as const }]
    : [])
])

const sidebarLabelVisibilityClass = computed(() => isSidebarCollapsed.value
  ? 'max-w-0 opacity-0'
  : 'max-w-0 opacity-0 lg:max-w-40 lg:opacity-100'
)
const sidebarTooltipContentClass = computed(() => isSidebarCollapsed.value ? '' : 'lg:hidden')

const currentUserHandle = computed(() =>
  currentUser.value?.handle ? `@${currentUser.value.handle}` : '사용자'
)
const currentUserInitial = computed(() => getHandleInitial(currentUser.value?.handle))
const currentUserProfilePath = computed(() => getPublicProfilePath(currentUser.value?.handle, '/setting'))

const isProfileSetupRequired = computed(() =>
  authReady.value && isLoggedIn.value && !currentUser.value?.handle
)

const authButtonLabel = computed(() => {
  if (!isLoggedIn.value) {
    return '로그인'
  }

  return `${currentUserHandle.value} 메뉴`
})

const route = useRoute()

function login() {
  if (isLoggedIn.value) {
    return
  }

  const returnTo = encodeURIComponent(route.fullPath)

  return navigateTo(`/auth/login?returnTo=${returnTo}`, { external: true })
}

function closeMobileNavigation() {
  isMobileNavigationOpen.value = false
  isMobileUserMenuOpen.value = false
}

async function logout(): Promise<void> {
  closeMobileNavigation()
  await clearSession()
  await navigateTo('/')
}

function loginFromMobileNavigation() {
  closeMobileNavigation()

  return login()
}

watch(() => route.fullPath, () => {
  isMobileNavigationOpen.value = false
})
</script>

<template>
  <div class="flex flex-col md:flex-row min-h-dvh">
    <aside
      class="hidden md:flex flex-col gap-3 w-14 h-dvh p-2 shrink-0 sticky top-0 transition-[width] duration-200 ease-in-out border-r border-default"
      :class="isSidebarCollapsed ? 'lg:w-14' : 'lg:w-52'"
    >
      <div class="relative flex shrink-0 items-center justify-between">
        <div class="group/logo relative size-10 shrink-0">
          <NuxtLink
            to="/"
            aria-label="Astral Patch 홈"
            class="flex size-10 items-center justify-center transition-opacity hover:opacity-75"
          >
            <img
              src="/favicon.ico"
              alt=""
              class="size-5"
            >
          </NuxtLink>

          <div
            v-if="isSidebarCollapsed"
            class="hidden lg:block"
          >
            <UTooltip
              text="사이드바 펼치기"
              :delay-duration="0"
              :content="{ side: 'right', sideOffset: 8 }"
            >
              <button
                type="button"
                aria-label="사이드바 펼치기"
                class="pointer-events-none absolute inset-0 z-10 flex size-10 items-center justify-center text-muted opacity-0 transition-opacity hover:bg-muted hover:text-default group-hover/logo:pointer-events-auto group-hover/logo:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                @click="isSidebarCollapsed = !isSidebarCollapsed"
              >
                <UIcon
                  name="i-tabler-layout-sidebar-left-expand"
                  class="size-5"
                />
              </button>
            </UTooltip>
          </div>
        </div>

        <UTooltip
          v-if="!isSidebarCollapsed"
          text="사이드바 접기"
          :delay-duration="0"
          :content="{ side: 'right', sideOffset: 8 }"
        >
          <button
            type="button"
            aria-label="사이드바 접기"
            class="hidden size-10 shrink-0 items-center justify-center text-muted transition-colors hover:bg-muted hover:text-default lg:flex"
            @click="isSidebarCollapsed = !isSidebarCollapsed"
          >
            <UIcon
              name="i-tabler-layout-sidebar-left-collapse"
              class="size-5"
            />
          </button>
        </UTooltip>
      </div>

      <nav
        aria-label="주요 메뉴"
        class="scrollbar-hidden flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto text-sm font-medium"
      >
        <UTooltip
          v-for="item in navItems"
          :key="item.label"
          :text="item.label"
          :delay-duration="0"
          :content="{ side: 'right', sideOffset: 8 }"
          :ui="{ content: sidebarTooltipContentClass }"
        >
          <NuxtLink
            :to="item.link"
            :active-class="item.emphasis === 'info' ? 'bg-info/20! text-info!' : 'bg-elevated/80! text-default!'"
            :aria-label="item.label"
            :class="[
              'p-2 flex items-center gap-2 overflow-hidden transition-all shrink-0',
              item.emphasis === 'info'
                ? 'text-info hover:bg-info/10 hover:text-info'
                : 'text-muted hover:bg-muted hover:text-toned'
            ]"
          >
            <div class="flex justify-center items-center size-6 shrink-0">
              <UIcon
                :name="item.icon"
                class="size-5"
              />
            </div>
            <span
              :class="[
                'sidebar-nav-label min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] ease-in-out',
                sidebarLabelVisibilityClass
              ]"
            >{{ item.label }}</span>
          </NuxtLink>
        </UTooltip>
      </nav>

      <div class="flex flex-col gap-2 text-sm font-medium">
        <UTooltip
          text="알림 서버 가입"
          :delay-duration="0"
          :content="{ side: 'right', sideOffset: 8 }"
          :ui="{ content: sidebarTooltipContentClass }"
        >
          <NuxtLink
            to="https://discord.gg/khYThH3gPD"
            aria-label="알림 서버 가입"
            class="flex h-10 w-full min-w-0 items-center gap-2 overflow-hidden bg-[#5460E9] p-2 text-left transition-colors hover:bg-[#5460E9]/75"
          >
            <span class="flex size-6 shrink-0 items-center justify-center">
              <UIcon
                name="i-tabler-brand-discord-filled"
                class="size-5"
              />
            </span>
            <span
              :class="[
                'sidebar-nav-label min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] ease-in-out',
                sidebarLabelVisibilityClass
              ]"
            >알림 서버 가입</span>
          </NuxtLink>
        </UTooltip>

        <UTooltip
          v-if="isProfileSetupRequired"
          text="로그아웃"
          :delay-duration="0"
          :content="{ side: 'right', sideOffset: 8 }"
          :ui="{ content: sidebarTooltipContentClass }"
        >
          <button
            type="button"
            aria-label="로그아웃"
            class="flex h-10 w-full min-w-0 items-center gap-2 overflow-hidden bg-error/10 p-2 text-left text-error transition-colors hover:bg-error/20"
            @click="logout"
          >
            <span class="flex size-6 shrink-0 items-center justify-center">
              <UIcon
                name="i-tabler-logout"
                class="size-5"
              />
            </span>
            <span
              :class="[
                'sidebar-nav-label min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] ease-in-out',
                sidebarLabelVisibilityClass
              ]"
            >로그아웃</span>
          </button>
        </UTooltip>

        <AppUserMenuContent
          v-else-if="authReady && isLoggedIn"
          side="top"
        >
          <template #trigger="{ open }">
            <UTooltip
              :text="currentUserHandle"
              :delay-duration="0"
              :content="{ side: 'right', sideOffset: 8 }"
              :ui="{ content: sidebarTooltipContentClass }"
            >
              <button
                type="button"
                :aria-label="authButtonLabel"
                :aria-expanded="open"
                aria-haspopup="menu"
                class="flex h-10 w-full min-w-0 items-center gap-2 overflow-hidden p-2 text-left text-default transition-colors hover:bg-elevated/75"
                :class="open ? 'bg-elevated/75' : 'bg-muted'"
              >
                <span
                  class="flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-black"
                  aria-hidden="true"
                >
                  {{ currentUserInitial }}
                </span>
                <span
                  :class="[
                    'sidebar-nav-label min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] ease-in-out',
                    sidebarLabelVisibilityClass
                  ]"
                >{{ currentUserHandle }}</span>
              </button>
            </UTooltip>
          </template>
        </AppUserMenuContent>

        <UTooltip
          v-else
          text="로그인"
          :delay-duration="0"
          :content="{ side: 'right', sideOffset: 8 }"
          :ui="{ content: sidebarTooltipContentClass }"
        >
          <button
            type="button"
            :aria-label="authButtonLabel"
            :aria-busy="!authReady"
            class="flex h-10 w-full min-w-0 items-center gap-2 overflow-hidden bg-muted p-2 text-left text-default transition-colors hover:bg-elevated/75"
            @click="login"
          >
            <span class="flex size-6 shrink-0 items-center justify-center">
              <UIcon
                name="i-tabler-user-key"
                class="size-5"
              />
            </span>
            <span
              :class="[
                'sidebar-nav-label min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] ease-in-out',
                sidebarLabelVisibilityClass
              ]"
            >로그인</span>
          </button>
        </UTooltip>
      </div>
    </aside>

    <header class="flex items-center justify-between gap-3 px-3 py-2 sticky top-0 z-10 md:hidden bg-default border-b border-default">
      <NuxtLink
        to="/"
        aria-label="Astral Patch 홈"
        class="flex size-10 items-center justify-center transition-opacity hover:opacity-75"
      >
        <img
          src="/favicon.ico"
          alt=""
          class="size-5"
        >
      </NuxtLink>

      <button
        type="button"
        aria-label="메뉴 열기"
        :aria-expanded="isMobileNavigationOpen"
        class="flex size-10 items-center justify-center transition-colors hover:bg-elevated/75"
        @click="isMobileNavigationOpen = true"
      >
        <UIcon
          name="i-tabler-menu"
          class="size-5"
        />
      </button>
    </header>

    <main class="relative min-w-0 flex-1 px-3 py-5 md:px-5 pb-20">
      <slot />
    </main>

    <UModal
      v-model:open="isMobileNavigationOpen"
      fullscreen
      :ui="{ overlay: 'opacity-0', content: 'bg-default/75 backdrop-blur-lg divide-y-0', body: 'flex min-h-0 flex-1 flex-col p-3 sm:p-5', close: 'p-2' }"
    >
      <template #body>
        <div class="flex min-h-0 flex-1 flex-col gap-3">
          <nav
            aria-label="주요 메뉴"
            class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto text-base font-medium"
          >
            <div class="flex flex-col gap-1">
              <NuxtLink
                v-for="item in navItems"
                :key="item.label"
                :to="item.link"
                :active-class="item.emphasis === 'info' ? 'bg-info/20! text-info!' : 'bg-elevated/80! text-default!'"
                :aria-label="item.label"
                :class="[
                  'flex min-h-12 items-center gap-3 px-3 py-2 transition-colors',
                  item.emphasis === 'info'
                    ? 'text-info hover:bg-info/10 hover:text-info'
                    : 'text-muted hover:bg-muted hover:text-toned'
                ]"
                @click="closeMobileNavigation"
              >
                <span class="flex size-6 shrink-0 items-center justify-center">
                  <UIcon
                    :name="item.icon"
                    class="size-5"
                  />
                </span>
                <span class="min-w-0 truncate">{{ item.label }}</span>
              </NuxtLink>
            </div>
          </nav>

          <div class="shrink-0">
            <NuxtLink
              to="https://discord.gg/khYThH3gPD"
              aria-label="알림 서버 가입"
              class="flex h-12 w-full items-center gap-3 px-3 bg-[#5460E9] font-medium transition-colors hover:bg-[#5460E9]/75"
            >
              <span class="flex size-6 shrink-0 items-center justify-center">
                <UIcon
                  name="i-tabler-brand-discord-filled"
                  class="size-5"
                />
              </span>
              <span>알림 서버 가입</span>
            </NuxtLink>
          </div>

          <section
            aria-label="사용자 정보"
            class="shrink-0"
          >
            <button
              v-if="isProfileSetupRequired"
              type="button"
              aria-label="로그아웃"
              class="flex min-h-12 w-full items-center justify-center gap-2 bg-error/10 px-3 font-medium text-error transition-colors hover:bg-error/20"
              @click="logout"
            >
              <span class="flex size-6 shrink-0 items-center justify-center">
                <UIcon
                  name="i-tabler-logout"
                  class="size-5"
                />
              </span>
              <span>로그아웃</span>
            </button>

            <div
              v-else-if="authReady && isLoggedIn"
              class="overflow-hidden bg-elevated/75 transition-colors"
            >
              <div
                v-if="isMobileUserMenuOpen"
                class="flex flex-col border-b border-muted"
              >
                <NuxtLink
                  :to="currentUserProfilePath"
                  class="flex min-h-11 items-center gap-3 px-3 text-sm text-default transition-colors hover:bg-accented/50 hover:text-default"
                  @click="closeMobileNavigation"
                >
                  <span class="flex size-6 shrink-0 items-center justify-center">
                    <UIcon
                      name="i-tabler-user-circle"
                      class="size-5"
                    />
                  </span>
                  <span>내 프로필</span>
                </NuxtLink>
                <NuxtLink
                  to="/setting"
                  class="flex min-h-11 items-center gap-3 px-3 text-sm text-default transition-colors hover:bg-accented/50 hover:text-default"
                  @click="closeMobileNavigation"
                >
                  <span class="flex size-6 shrink-0 items-center justify-center">
                    <UIcon
                      name="i-tabler-settings"
                      class="size-5"
                    />
                  </span>
                  <span>계정 설정</span>
                </NuxtLink>
                <button
                  type="button"
                  class="flex min-h-11 items-center gap-3 px-3 text-left text-sm text-error transition-colors hover:bg-error/10"
                  @click="logout"
                >
                  <span class="flex size-6 shrink-0 items-center justify-center">
                    <UIcon
                      name="i-tabler-logout"
                      class="size-5"
                    />
                  </span>
                  <span>로그아웃</span>
                </button>
              </div>

              <button
                type="button"
                :aria-label="authButtonLabel"
                :aria-expanded="isMobileUserMenuOpen"
                class="flex min-h-12 w-full min-w-0 items-center justify-between gap-3 px-3 text-left text-default transition-colors hover:bg-accented/50"
                @click="isMobileUserMenuOpen = !isMobileUserMenuOpen"
              >
                <span class="flex min-w-0 items-center gap-3">
                  <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-black">{{ currentUserInitial }}</span>
                  <span class="truncate text-sm font-medium">{{ currentUserHandle }}</span>
                </span>
                <UIcon
                  name="i-tabler-chevron-up"
                  class="size-5 shrink-0 text-muted transition-transform duration-200"
                  :class="isMobileUserMenuOpen ? 'rotate-180' : ''"
                />
              </button>
            </div>

            <button
              v-else-if="authReady"
              type="button"
              aria-label="로그인"
              class="flex h-12 w-full items-center justify-center gap-2 text-sm font-medium text-default transition-colors bg-elevated/75 hover:bg-accented/75"
              @click="loginFromMobileNavigation"
            >
              <span class="flex size-6 shrink-0 items-center justify-center">
                <UIcon
                  name="i-tabler-user-key"
                  class="size-5"
                />
              </span>
              <span>로그인</span>
            </button>

            <div
              v-else
              class="flex h-10 items-center justify-center text-sm text-muted"
              role="status"
              aria-live="polite"
            >
              로그인 상태 확인 중
            </div>
          </section>
        </div>
      </template>
    </UModal>
  </div>
</template>
