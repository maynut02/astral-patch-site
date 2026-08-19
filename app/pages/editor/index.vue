<script setup lang="ts">
const languageItems = ['중국어 간체', '영어', '일본어', '중국어 번체']
const cardItems = Array.from({ length: 30 }, (_, index) => index + 1)
</script>

<template>
  <div class="flex flex-1 flex-col lg:flex-row gap-6 px-2 pb-6 md:px-6 max-w-400 mx-auto">
    <section class="hidden lg:flex flex-col shrink-0 w-60">
      <div class="sticky top-19 -m-1 p-1 pb-8 max-h-[calc(100dvh-4.8rem)] overflow-y-auto">
        <EditorFilterDesktop />
      </div>
    </section>

    <section class="flex flex-1 flex-col gap-4">
      <div v-for="cardId in cardItems" :key="cardId">
        <div class="flex flex-col bg-muted rounded-xl px-2">
          <div class="flex items-center gap-4 p-4">
            <span class="text-base font-semibold">STRCategory</span>
            <span class="text-sm font-medium text-muted">unit_key_{{ cardId }}</span>
          </div>

          <div class="flex flex-col gap-3 text-sm rounded-lg bg-default/50 p-4">
            <div v-for="language in languageItems" :key="language" class="flex gap-4">
              <span class="w-20 text-right text-muted font-medium shrink-0">{{ language }}</span>
              <span>내용내용</span>
            </div>
            <div class="flex gap-4">
              <span class="w-20 text-right text-muted font-medium shrink-0">한국어</span>
              <!-- <span>내용내용</span> -->
              <UTextarea v-model="value" color="neutral" variant="outline" autoresize :ui="{ base: 'bg-transparent' }"
                class="w-full" />
            </div>
          </div>

          <div class="flex justify-end gap-2 p-3">
            <USlideover side="right" inset>
              <UButton icon="i-tabler-history" color="neutral" variant="soft" size="md" class="px-4 rounded-xl">
                변경 기록
              </UButton>

              <template #content>
                <Placeholder class="h-full m-4" />
              </template>
            </USlideover>

            <UButton icon="i-tabler-edit" color="info" variant="soft" size="md" class="px-4 rounded-xl">
              번역 수정
            </UButton>
            <UButton icon="i-tabler-x" color="neutral" variant="ghost" size="md" class="px-4 rounded-xl">
              취소
            </UButton>
            <UButton icon="i-tabler-device-floppy" color="info" variant="soft" size="md" class="px-4 rounded-xl">
              저장
            </UButton>
          </div>
        </div>
      </div>

    </section>

    <section class="w-fit mx-auto lg:hidden sticky bottom-2">
      <EditorFilterMobile />
    </section>
  </div>
</template>
