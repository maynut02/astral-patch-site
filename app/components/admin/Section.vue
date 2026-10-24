<script setup lang="ts">
defineProps<{
  icon: string
  title: string
  description: string
}>()
</script>

<template>
  <section class="border border-default">
    <div class="flex flex-col gap-3 border-b border-default bg-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-2">
        <UIcon
          :name="icon"
          class="size-5 text-muted"
        />
        <div>
          <h2 class="text-sm font-semibold text-default">
            {{ title }}
          </h2>
          <p class="text-xs text-muted">
            {{ description }}
          </p>
        </div>
      </div>

      <slot name="status" />
    </div>

    <slot />
  </section>
</template>
