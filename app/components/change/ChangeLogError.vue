<script setup lang="ts">
defineProps<{ title: string }>()
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <UAlert
    class="my-4"
    color="error"
    variant="soft"
    :title="title"
    description="잠시 후 다시 시도해 주세요."
  >
    <template #actions>
      <UButton
        size="sm"
        color="error"
        variant="outline"
        @click="emit('retry')"
      >
        다시 시도
      </UButton>
    </template>
  </UAlert>
</template>
