<script setup lang="ts">
import { getHandleInitial, getPublicProfilePath } from '~/utils/profile'
import { getNavigationItems } from '~/utils/navigation'

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

const navItems = computed(() => getNavigationItems(currentUser.value?.role))

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
  <div
    class="flex flex-col md:flex-row"
    :class="route.meta.partyChat ? 'h-dvh overflow-hidden' : 'min-h-dvh'"
  >
    <AppSidebar
      v-model:collapsed="isSidebarCollapsed"
      :nav-items="navItems"
      :is-party-room="route.meta.partyChat === true"
      :auth-ready="authReady"
      :is-logged-in="isLoggedIn"
      :is-profile-setup-required="isProfileSetupRequired"
      :current-user-handle="currentUserHandle"
      :current-user-initial="currentUserInitial"
      :auth-button-label="authButtonLabel"
      @login="login"
      @logout="logout"
    />

    <AppMobileNavigation
      v-model:open="isMobileNavigationOpen"
      v-model:user-menu-open="isMobileUserMenuOpen"
      :nav-items="navItems"
      :is-party-room="route.meta.partyChat === true"
      :auth-ready="authReady"
      :is-logged-in="isLoggedIn"
      :is-profile-setup-required="isProfileSetupRequired"
      :current-user-handle="currentUserHandle"
      :current-user-initial="currentUserInitial"
      :current-user-profile-path="currentUserProfilePath"
      :auth-button-label="authButtonLabel"
      @close="closeMobileNavigation"
      @login="loginFromMobileNavigation"
      @logout="logout"
    >
      <main
        class="relative min-w-0 flex-1"
        :class="route.meta.partyChat ? 'min-h-0 overflow-hidden' : 'px-3 py-5 md:px-5 pb-20'"
      >
        <slot />
      </main>
    </AppMobileNavigation>
  </div>
</template>
