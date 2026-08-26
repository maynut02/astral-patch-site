<script setup lang="ts">
import type { UserRole } from '~/utils/user-role'
import {
  formatHandle,
  getPublicProfilePath,
  normalizeHandle
} from '~/utils/profile'

const props = withDefaults(defineProps<{
  handle?: unknown
  role?: UserRole | null
  fallback?: string
  link?: boolean
  to?: string
  textClass?: string
  iconClass?: string
  stopPropagation?: boolean
}>(), {
  role: null,
  fallback: '알 수 없는 사용자',
  link: true,
  to: undefined,
  textClass: 'text-sm',
  iconClass: 'size-4',
  stopPropagation: false
})

const normalizedHandle = computed(() => normalizeHandle(props.handle).replace(/^@+/, ''))
const displayHandle = computed(() => formatHandle(normalizedHandle.value, props.fallback))
const profilePath = computed(() => props.to || getPublicProfilePath(normalizedHandle.value))
const hasRoleIcon = computed(() => hasUserRoleIcon(props.role))

function handleClick(event: MouseEvent) {
  if (props.stopPropagation) {
    event.stopPropagation()
  }
}
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-1">
    <NuxtLink
      v-if="link && normalizedHandle"
      :to="profilePath"
      class="min-w-0 truncate hover:underline underline-offset-2"
      :class="[textClass, hasRoleIcon ? '-mt-0.5' : '']"
      @click="handleClick"
    >
      {{ displayHandle }}
    </NuxtLink>
    <span
      v-else
      class="min-w-0 truncate"
      :class="[textClass, hasRoleIcon ? '-mt-0.5' : '']"
    >{{ displayHandle }}</span>
    <AppUserRoleIcon
      :role="role"
      :icon-class="iconClass"
    />
  </span>
</template>
