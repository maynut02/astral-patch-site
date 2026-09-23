<script setup lang="ts">
const props = withDefaults(defineProps<{ src?: string, alt?: string, icon?: string }>(), { alt: '' })
const failed = ref(false)
watch(() => props.src, () => {
  failed.value = false
})
</script>

<template>
  <span class="inline-flex shrink-0 items-center justify-center overflow-hidden bg-muted">
    <img
      v-if="src && !failed"
      :src="src"
      :alt="alt"
      loading="lazy"
      class="size-full object-contain"
      @error="failed = true"
    >
    <UIcon
      v-else
      :name="icon || 'i-tabler-user'"
      class="size-2/3 text-dimmed"
      :aria-label="alt || undefined"
      :aria-hidden="alt ? undefined : true"
    />
  </span>
</template>
