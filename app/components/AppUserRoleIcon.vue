<script setup lang="ts">
import type { UserRole } from '~/utils/user-role'

const props = withDefaults(defineProps<{
  role?: UserRole | null
  iconClass?: string
}>(), {
  role: null,
  iconClass: 'size-4'
})

const meta = computed(() => getUserRoleMeta(props.role))
</script>

<template>
  <UTooltip
    v-if="meta"
    :text="meta.label"
    :delay-duration="0"
  >
    <UIcon
      :name="meta.icon"
      class="shrink-0 text-muted"
      :class="iconClass"
    />
  </UTooltip>
</template>
