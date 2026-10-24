<script setup lang="ts">
import type { NavItem } from '~/utils/navigation'
import { isPartyRoomNavItem } from '~/utils/navigation'
import { EXTERNAL_LINKS } from '~/utils/links'

defineProps<{
  navItems: NavItem[]
  isPartyRoom: boolean
  authReady: boolean
  isLoggedIn: boolean
  isProfileSetupRequired: boolean
  currentUserHandle: string
  currentUserInitial: string
  currentUserProfilePath: string
  authButtonLabel: string
}>()

const isMobileNavigationOpen = defineModel<boolean>('open', { required: true })
const isMobileUserMenuOpen = defineModel<boolean>('userMenuOpen', { required: true })
const emit = defineEmits<{
  close: []
  login: []
  logout: []
}>()
</script>

<template>
  <header class="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-default bg-default px-3 py-2 md:hidden">
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

  <slot />

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
              :aria-current="isPartyRoomNavItem(item, isPartyRoom) ? 'page' : undefined"
              :class="[
                'flex min-h-12 items-center gap-3 px-3 py-2 transition-colors',
                item.emphasis === 'info'
                  ? 'text-info hover:bg-info/10 hover:text-info'
                  : 'text-muted hover:bg-muted hover:text-toned',
                isPartyRoomNavItem(item, isPartyRoom) && 'bg-elevated/80! text-default!'
              ]"
              @click="emit('close')"
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
            :to="EXTERNAL_LINKS.layoutDiscordInvite"
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
            @click="emit('logout')"
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
                @click="emit('close')"
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
                @click="emit('close')"
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
                @click="emit('logout')"
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
            @click="emit('login')"
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
</template>
