<script setup lang="ts">
const navItem = [
  { link: '/', label: '메인' },
  { link: '/download', label: '다운로드' },
  { link: '/release', label: '릴리즈 노트' },
  { link: '/editor', label: '번역 에디터' },
  { link: '/editor/log', label: '번역 기록' }
]

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
  <div class="min-h-dvh flex flex-col">
    <header class="flex justify-between items-center sticky top-0 z-50 p-4">
      <NuxtLink to="/" class="flex size-11 items-center justify-center hover:opacity-80 transition-opacity">
        <img src="/favicon.ico" alt="icon" class="size-6">
      </NuxtLink>

      <div class="flex gap-2">
        <nav
          class="hidden md:flex h-11 px-2 rounded-2xl bg-elevated/60 backdrop-blur-lg text-sm font-medium border border-accented/30">
          <NuxtLink v-for="item in navItem" :key="item.label" :to="item.link" active-class="text-default!"
            class="flex items-center px-4 text-muted hover:text-default transition-colors">
            {{ item.label }}
          </NuxtLink>
        </nav>

        <UDropdownMenu v-if="ready && loggedIn" :items="userMenuItems" :content="{ align: 'end' }">
          <UButton icon="i-tabler-user" color="neutral" variant="ghost" aria-label="사용자 메뉴"
            class="size-11 shrink-0 justify-center rounded-2xl bg-elevated/60 backdrop-blur-lg text-muted hover:text-default border border-accented/30" />
        </UDropdownMenu>

        <UButton v-else-if="ready" icon="i-tabler-login-2" color="neutral" variant="ghost" aria-label="Google 로그인"
          class="size-11 shrink-0 justify-center rounded-2xl bg-elevated/60 backdrop-blur-lg text-muted hover:text-default border border-accented/30"
          @click="login" />

        <div v-else
          class="flex items-center justify-center size-11 shrink-0 rounded-2xl bg-elevated/60 backdrop-blur-lg text-muted border border-accented/30"
          aria-label="로그인 상태 확인 중">
          <UIcon name="i-tabler-loader-2" class="size-5 animate-spin" />
        </div>

        <button
          class="flex md:hidden items-center justify-center size-11 shrink-0 rounded-2xl bg-elevated/60 backdrop-blur-lg text-muted hover:text-default border border-accented/30 transition-colors">
          <UIcon name="i-tabler-menu" class="size-5" />
        </button>
      </div>
    </header>

    <main class="flex flex-1">
      <slot />
    </main>
  </div>
</template>
