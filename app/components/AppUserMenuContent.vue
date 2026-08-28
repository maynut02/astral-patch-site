<script setup lang="ts">
import { getPublicProfilePath } from '~/utils/profile'

const props = withDefaults(defineProps<{
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}>(), {
  side: 'bottom',
  align: 'end'
})

const { user, clear } = useUserSession()

const publicProfilePath = computed(() => getPublicProfilePath(user.value?.handle, '/setting'))

const menuItems = computed(() => [{
  label: '내 프로필',
  icon: 'i-tabler-user-circle',
  to: publicProfilePath.value
}, {
  label: '계정 설정',
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
</script>

<template>
  <UDropdownMenu
    :items="menuItems"
    :content="{ side: props.side, align: props.align, sideOffset: 8 }"
    :ui="{ content: 'w-52' }"
  >
    <template #default="{ open }">
      <slot
        name="trigger"
        :open="open"
      />
    </template>

    <template #content-top="{ sub }">
      <div
        v-if="!sub"
        class="flex min-w-0 items-center border-b border-default px-3 py-3"
      >
        <AppUserIdentity
          :handle="user?.handle"
          :role="user?.role"
          :to="publicProfilePath"
          text-class="text-sm font-semibold text-default"
          class="max-w-full gap-2"
        />
      </div>
    </template>
  </UDropdownMenu>
</template>
