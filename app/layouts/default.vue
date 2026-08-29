<script setup lang="ts">
import { getHandleInitial } from '~/utils/profile'

const navItems = [
  { link: '/', icon: 'i-tabler-home', label: '홈' },
  { link: '/download', icon: 'i-tabler-download', label: '다운로드' },
  { link: '/release', icon: 'i-tabler-clipboard-check', label: '패치 릴리즈' },
  { link: '/translate', icon: 'i-tabler-language', label: '번역 대시보드' },
  { link: '/change', icon: 'i-tabler-history-toggle', label: '변경 기록' },
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
const isMediumSidebarViewport = ref(false)
let mediumSidebarMediaQuery: MediaQueryList | undefined

const {
  ready: authReady,
  loggedIn: isLoggedIn,
  user: currentUser
} = useUserSession()

const isSidebarEffectivelyCollapsed = computed(() =>
  isSidebarCollapsed.value || isMediumSidebarViewport.value
)

const currentUserHandle = computed(() =>
  currentUser.value?.handle ? `@${currentUser.value.handle}` : '사용자'
)

const currentUserInitial = computed(() => getHandleInitial(currentUser.value?.handle))

const authButtonLabel = computed(() => {
  if (!isLoggedIn.value) {
    return '로그인'
  }

  return `${currentUserHandle.value} 메뉴`
})

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
      class="hidden md:flex flex-col gap-3 w-14 h-dvh px-2 py-3 shrink-0 sticky top-0 transition-[width] duration-200 ease-in-out border-r border-default"
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

          <UTooltip
            v-if="isSidebarEffectivelyCollapsed"
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

        <UTooltip
          v-if="!isSidebarEffectivelyCollapsed"
          text="사이드바 접기"
          :delay-duration="0"
          :content="{ side: 'right', sideOffset: 8 }"
        >
          <button
            type="button"
            aria-label="사이드바 접기"
            class="flex size-10 shrink-0 items-center justify-center text-muted transition-colors hover:bg-muted hover:text-default"
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
          :disabled="!isSidebarEffectivelyCollapsed"
          :delay-duration="0"
          :content="{ side: 'right', sideOffset: 8 }"
        >
          <NuxtLink
            :to="item.link"
            active-class="bg-elevated/80! text-default!"
            :aria-label="item.label"
            :class="[
              'p-2 flex items-center gap-2 overflow-hidden hover:bg-muted text-muted hover:text-toned transition-all shrink-0'
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
                isSidebarEffectivelyCollapsed ? 'max-w-0 opacity-0' : 'max-w-40 opacity-100',
                'md:max-lg:max-w-0 md:max-lg:opacity-0'
              ]"
            >{{ item.label }}</span>
          </NuxtLink>
        </UTooltip>
      </nav>

      <div class="flex flex-col gap-2">
        <UTooltip
          text="디스코드 가입"
          :disabled="!isSidebarEffectivelyCollapsed"
          :delay-duration="0"
          :content="{ side: 'right', sideOffset: 8 }"
        >
          <button
            type="button"
            aria-label="디스코드 가입"
            class="flex h-10 w-full min-w-0 items-center justify-center overflow-hidden bg-[#5460E9] text-sm font-medium transition-[gap,background-color] duration-200 ease-out hover:bg-[#5460E9]/75 motion-reduce:transition-none"
            :class="isSidebarEffectivelyCollapsed ? 'gap-0' : 'gap-2'"
          >
            <span
              class="flex size-6 shrink-0 items-center justify-center"
              aria-hidden="true"
            >
              <UIcon
                name="i-tabler-brand-discord-filled"
                class="size-5"
              />
            </span>
            <span
              aria-hidden="true"
              :class="[
                'min-w-0 overflow-hidden whitespace-nowrap text-nowrap transition-[max-width,opacity,transform] duration-200 ease-out motion-reduce:transition-none',
                isSidebarEffectivelyCollapsed ? 'max-w-0 -translate-x-1 opacity-0' : 'max-w-40 translate-x-0 opacity-100'
              ]"
            >Join Discord</span>
          </button>
        </UTooltip>

        <AppUserMenuContent
          v-if="authReady && isLoggedIn"
          side="top"
        >
          <template #trigger="{ open }">
            <button
              type="button"
              :aria-label="authButtonLabel"
              :aria-expanded="open"
              aria-haspopup="menu"
              class="relative flex h-10 w-full min-w-0 items-center justify-center overflow-hidden text-sm font-medium border-default/40 transition-colors duration-200 ease-out hover:bg-elevated/75 motion-reduce:transition-none"
              :class="[open ? 'bg-elevated/75' : '', isSidebarEffectivelyCollapsed ? '' : 'border-2 bg-muted']"
            >
              <span
                aria-hidden="true"
                :class="[
                  'pointer-events-none absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
                  isSidebarEffectivelyCollapsed ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
                ]"
              >
                <span
                  class="flex size-6 items-center justify-center rounded-full bg-inverted text-xs font-semibold text-inverted"
                >
                  {{ currentUserInitial }}
                </span>
              </span>
              <span
                aria-hidden="true"
                :class="[
                  'min-w-0 max-w-full truncate px-2 text-center text-sm font-medium transition-[max-width,opacity,transform] duration-150 ease-out motion-reduce:transition-none',
                  isSidebarEffectivelyCollapsed ? 'max-w-0 -translate-y-1 opacity-0 pointer-events-none' : 'max-w-full translate-y-0 opacity-100'
                ]"
              >
                <AppUserIdentity
                  :handle="currentUser?.handle"
                  :role="currentUser?.role"
                  :link="false"
                  :fallback="currentUserHandle"
                  text-class="text-sm font-medium text-default"
                  class="max-w-full justify-center"
                />
              </span>
            </button>
          </template>
        </AppUserMenuContent>

        <UTooltip
          v-else
          text="로그인"
          :disabled="!isSidebarEffectivelyCollapsed"
          :delay-duration="0"
          :content="{ side: 'right', sideOffset: 8 }"
        >
          <button
            type="button"
            :aria-label="authButtonLabel"
            :aria-busy="!authReady"
            class="relative flex h-10 w-full min-w-0 items-center justify-center overflow-hidden border-2 border-default/40 bg-muted text-sm font-medium transition-colors duration-200 ease-out hover:bg-elevated/75 motion-reduce:transition-none"
            @click="login"
          >
            <span
              aria-hidden="true"
              :class="[
                'pointer-events-none absolute inset-0 flex items-center justify-center whitespace-nowrap transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
                isSidebarEffectivelyCollapsed ? 'translate-y-1 opacity-0' : 'translate-y-0 opacity-100'
              ]"
            >로그인</span>
            <span
              aria-hidden="true"
              :class="[
                'pointer-events-none absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
                isSidebarEffectivelyCollapsed ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
              ]"
            >
              <UIcon
                name="i-tabler-user"
                class="size-5"
              />
            </span>
          </button>
        </UTooltip>
      </div>
    </aside>

    <header
      class="flex items-center justify-between gap-3 p-3 sticky top-0 z-10 md:hidden bg-default/75 backdrop-blur-lg"
    >
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

    <main class="relative min-w-0 flex-1 p-3 pb-5 md:p-5">
      <slot />
    </main>

    <UModal
      v-model:open="isMobileNavigationOpen"
      fullscreen
      :ui="{ overlay: 'opacity-0', content: 'bg-default/75 backdrop-blur-lg', body: 'flex min-h-0 flex-1 flex-col p-3 sm:p-5' }"
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
                active-class="bg-elevated/80! text-default!"
                :aria-label="item.label"
                class="flex min-h-11 items-center gap-3 px-3 py-2 text-muted transition-colors hover:bg-muted hover:text-toned"
                @click="closeMobileNavigation"
              >
                <UIcon
                  :name="item.icon"
                  class="size-5 shrink-0"
                />
                <span class="min-w-0 truncate">{{ item.label }}</span>
              </NuxtLink>
            </div>
          </nav>

          <div class="shrink-0">
            <button
              type="button"
              aria-label="디스코드 가입"
              class="flex h-10 w-full items-center justify-center gap-2 bg-[#5460E9] text-sm font-medium transition-colors hover:bg-[#5460E9]/75"
            >
              <UIcon
                name="i-tabler-brand-discord-filled"
                class="size-5"
              />
              <span>Join Discord</span>
            </button>
          </div>

          <section
            aria-label="사용자 정보"
            class="shrink-0"
          >
            <AppUserMenuContent
              v-if="authReady && isLoggedIn"
              side="bottom"
            >
              <template #trigger="{ open }">
                <button
                  type="button"
                  :aria-label="authButtonLabel"
                  :aria-expanded="open"
                  aria-haspopup="menu"
                  class="flex min-h-10 w-full min-w-0 items-center justify-between px-3 text-left text-default transition-colors bg-elevated/75 hover:bg-elevated"
                  :class="open ? 'bg-elevated/75' : ''"
                >
                  <AppUserIdentity
                    :handle="currentUser?.handle"
                    :role="currentUser?.role"
                    :link="false"
                    :fallback="currentUserHandle"
                    text-class="text-sm font-medium text-default"
                    class="min-w-0 max-w-full"
                  />
                </button>
              </template>
            </AppUserMenuContent>

            <button
              v-else-if="authReady"
              type="button"
              aria-label="로그인"
              class="flex h-10 w-full items-center justify-center gap-2 text-sm font-medium text-default transition-colors bg-elevated/75 hover:bg-elevated"
              @click="loginFromMobileNavigation"
            >
              <UIcon
                name="i-tabler-user-key"
                class="size-5"
              />
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
