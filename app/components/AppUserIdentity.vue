<script setup lang="ts">
import { isDeletedUserId } from '#shared/types/user'
import { getUserRoleMeta, type UserRole } from '~/utils/user-role'
import {
  formatHandle,
  getPublicProfilePath,
  normalizeHandle
} from '~/utils/profile'

const props = withDefaults(defineProps<{
  userId?: unknown
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

const isDeleted = computed(() => isDeletedUserId(props.userId))
const normalizedHandle = computed(() => isDeleted.value ? '' : normalizeHandle(props.handle).replace(/^@+/, ''))
const displayHandle = computed(() => isDeleted.value ? '탈퇴한 사용자' : formatHandle(normalizedHandle.value, props.fallback))
const profilePath = computed(() => props.to || getPublicProfilePath(normalizedHandle.value))
const roleMeta = computed(() => isDeleted.value ? null : getUserRoleMeta(props.role))
const hasRoleIcon = computed(() => roleMeta.value !== null)

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
    <UTooltip
      v-if="roleMeta"
      :text="roleMeta.label"
      :delay-duration="0"
    >
      <UIcon
        :name="roleMeta.icon"
        role="img"
        :aria-label="roleMeta.label"
        class="shrink-0 text-muted"
        :class="iconClass"
      />
    </UTooltip>
  </span>
</template>
