<script setup lang="ts">
defineProps<{ totalPages: number, loading: boolean }>()
const page = defineModel<number>('page', { required: true })
</script>

<template>
  <div class="sticky bottom-4 z-20 flex justify-center pt-5 pointer-events-none">
    <EditorPageController
      v-model:page="page"
      :total-pages="totalPages"
      :disabled="loading"
      class="relative pointer-events-auto"
    />
  </div>
</template>
