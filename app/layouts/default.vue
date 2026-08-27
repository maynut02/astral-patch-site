<script setup lang="ts">
const navItems = [
  { link: '/', icon: 'i-tabler-home', label: '홈' },
  { link: '/download', icon: 'i-tabler-download', label: '다운로드' },
  { link: '/release', icon: 'i-tabler-clipboard-check', label: '패치 릴리즈' },
  { link: '/translate', icon: 'i-tabler-edit', label: '번역 에디터' },
  { link: '/translate/log', icon: 'i-tabler-history-toggle', label: '변경 기록' },
  { link: '/mod', icon: 'i-tabler-package', label: '모드 허브' },
  { link: '/notice', icon: 'i-tabler-speakerphone', label: '공지사항' },
  { link: '/contributor', icon: 'i-tabler-user-heart', label: '기여자' }
]

const isSidebarCollapsed = ref(false)
const isMobileNavigationOpen = ref(false)
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

const route = useRoute()

watch(() => route.fullPath, () => {
  isMobileNavigationOpen.value = false
})
</script>

<template>
  <div class="flex flex-col min-h-dvh">
    <div class="flex justify-between h-14 bg-default border-b border-default shrink-0 sticky top-0 z-100">
      <NuxtLink to="/" aria-label="Astral Patch 홈"
        class="flex items-center px-4 md:px-5 transition-opacity hover:opacity-80">
        <img src="/favicon.ico" alt="" class="size-5">
      </NuxtLink>

      <div class="flex items-center px-3 md:px-5">
        <AppUserMenu />

        <button aria-label="메뉴" :aria-expanded="isMobileNavigationOpen" type="button"
          class="size-9 shrink-0 flex items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:hidden"
          :class="isMobileNavigationOpen ? 'bg-elevated text-default' : ''" @click="isMobileNavigationOpen = true">
          <UIcon name="i-tabler-menu" class="size-5" />
        </button>
      </div>
    </div>

    <USlideover v-model:open="isMobileNavigationOpen" side="right"
      :ui="{ overlay: 'z-200', content: 'z-200 max-w-80', header: 'min-h-14 px-4 py-3', body: 'p-2 sm:p-2' }">
      <template #body>
        <nav aria-label="주요 메뉴" class="flex flex-col text-sm font-medium">
          <NuxtLink v-for="item in navItems" :key="item.label" :to="item.link"
            active-class="bg-elevated/80! text-default!"
            class="flex min-w-0 items-center gap-3 rounded-md px-3 py-2.5 text-muted transition-colors hover:bg-muted hover:text-toned"
            @click="isMobileNavigationOpen = false">
            <div class="flex size-6 shrink-0 items-center justify-center">
              <UIcon :name="item.icon" class="size-5" />
            </div>
            <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
          </NuxtLink>
        </nav>
      </template>
    </USlideover>

    <div class="flex min-h-0 flex-1">
      <aside
        class="hidden md:flex w-14 flex-col shrink-0 h-[calc(100dvh-3.5rem)] bg-default sticky top-14 z-100 overflow-hidden transition-[width] duration-200 ease-in-out"
        :class="isSidebarCollapsed ? 'lg:w-14' : 'lg:w-52'">
        <nav aria-label="주요 메뉴" class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 text-sm font-medium">
          <UTooltip v-for="item in navItems" :key="item.label" :text="item.label"
            :disabled="!isSidebarEffectivelyCollapsed" :delay-duration="0" :content="{ side: 'right', sideOffset: 8 }">
            <NuxtLink :to="item.link" active-class="bg-elevated/80! text-default!" :aria-label="item.label" :class="[
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
            :delay-duration="0" :content="{ side: 'right', sideOffset: 8 }">
            <button type="button" :aria-label="isSidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'"
              class="flex items-center gap-2 overflow-hidden rounded-md px-2 text-sm font-medium text-muted transition-colors hover:bg-muted hover:text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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

      <main class="min-h-0 min-w-0 flex-1 md:border-l border-default">
        <slot />
      </main>
    </div>
  </div>
</template>
