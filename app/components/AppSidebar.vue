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
  authButtonLabel: string
}>()

const isSidebarCollapsed = defineModel<boolean>('collapsed', { required: true })
const emit = defineEmits<{
  login: []
  logout: []
}>()

const sidebarLabelClass = computed(() => [
  'sidebar-nav-label min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] ease-in-out',
  isSidebarCollapsed.value
    ? 'max-w-0 opacity-0'
    : 'max-w-0 opacity-0 lg:max-w-40 lg:opacity-100'
])
const sidebarTooltipContentClass = computed(() => isSidebarCollapsed.value ? '' : 'lg:hidden')
</script>

<template>
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
          :aria-current="isPartyRoomNavItem(item, isPartyRoom) ? 'page' : undefined"
          :class="[
            'p-2 flex items-center gap-2 overflow-hidden transition-all shrink-0',
            item.emphasis === 'info'
              ? 'text-info hover:bg-info/10 hover:text-info'
              : 'text-muted hover:bg-muted hover:text-toned',
            isPartyRoomNavItem(item, isPartyRoom) && 'bg-elevated/80! text-default!'
          ]"
        >
          <div class="flex justify-center items-center size-6 shrink-0">
            <UIcon
              :name="item.icon"
              class="size-5"
            />
          </div>
          <span :class="sidebarLabelClass">{{ item.label }}</span>
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
          :to="EXTERNAL_LINKS.layoutDiscordInvite"
          aria-label="알림 서버 가입"
          class="flex h-10 w-full min-w-0 items-center gap-2 overflow-hidden bg-[#5460E9] p-2 text-left transition-colors hover:bg-[#5460E9]/75"
        >
          <span class="flex size-6 shrink-0 items-center justify-center">
            <UIcon
              name="i-tabler-brand-discord-filled"
              class="size-5"
            />
          </span>
          <span :class="sidebarLabelClass">알림 서버 가입</span>
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
          @click="emit('logout')"
        >
          <span class="flex size-6 shrink-0 items-center justify-center">
            <UIcon
              name="i-tabler-logout"
              class="size-5"
            />
          </span>
          <span :class="sidebarLabelClass">로그아웃</span>
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
              <span :class="sidebarLabelClass">{{ currentUserHandle }}</span>
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
          @click="emit('login')"
        >
          <span class="flex size-6 shrink-0 items-center justify-center">
            <UIcon
              name="i-tabler-user-key"
              class="size-5"
            />
          </span>
          <span :class="sidebarLabelClass">로그인</span>
        </button>
      </UTooltip>
    </div>
  </aside>
</template>
