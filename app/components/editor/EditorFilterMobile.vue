<script setup lang="ts">
const languageItems = ['중국어 간체', '영어', '일본어', '중국어 번체']
</script>

<template>
  <div class="flex gap-1 p-1 rounded-2xl bg-elevated/60 backdrop-blur-lg text-sm font-medium border border-accented/30">
    <UButton icon="i-tabler-filter" color="neutral" variant="ghost" size="md" class="rounded-full hover:bg-accented" />
    <UButton icon="i-tabler-chevron-left" color="neutral" variant="ghost" size="md"
      class="rounded-full hover:bg-accented" />
    <UButton icon="i-tabler-x" color="neutral" variant="ghost" size="md" class="rounded-full hover:bg-accented" />
    <UButton icon="i-tabler-chevron-right" color="neutral" variant="ghost" size="md"
      class="rounded-full hover:bg-accented" />
  </div>
</template>