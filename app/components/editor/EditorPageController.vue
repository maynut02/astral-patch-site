<script setup lang="ts">
const props = withDefaults(defineProps<{
  totalPages: number
  disabled?: boolean
}>(), {
  disabled: false
})

const page = defineModel<number>('page', { required: true })
const pageInput = ref(String(page.value))
const pagePopoverOpen = ref(false)

const normalizedTotalPages = computed(() => Math.max(1, Math.trunc(props.totalPages) || 1))

function setPage(nextPage: number): void {
  if (props.disabled) {
    return
  }

  const targetPage = Math.min(Math.max(Math.trunc(nextPage), 1), normalizedTotalPages.value)
  pageInput.value = String(targetPage)
  pagePopoverOpen.value = false

  if (targetPage !== page.value) {
    page.value = targetPage
  }
}

function goToInputPage(): void {
  const requestedPage = Number(pageInput.value)

  if (!Number.isFinite(requestedPage)) {
    pageInput.value = String(page.value)
    pagePopoverOpen.value = false
    return
  }

  setPage(requestedPage)
}

watch(page, (value) => {
  pageInput.value = String(value)
})

watch(normalizedTotalPages, (totalPages) => {
  if (page.value > totalPages) {
    page.value = totalPages
  }
})
</script>

<template>
  <div class="flex rounded-lg bg-elevated/70 p-1 shadow-sm backdrop-blur-lg">
    <UPopover v-model:open="pagePopoverOpen" :content="{ align: 'center', side: 'top', sideOffset: 8 }">
      <UButton color="neutral" variant="ghost" size="lg" class="font-medium text-muted hover:text-default"
        :disabled="disabled">
        <span>{{ page }}</span>
        <span class="text-dimmed">/</span>
        <span>{{ normalizedTotalPages }}</span>
      </UButton>

      <template #content>
        <div class="flex flex-col gap-2 p-2">
          <UInput v-model="pageInput" type="number" color="neutral" class="w-18" :min="1" :max="normalizedTotalPages"
            :disabled="disabled" aria-label="이동할 페이지"
            :ui="{ base: '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none' }"
            @keydown.enter.prevent="goToInputPage" />
          <div class="flex">
            <UTooltip text="첫 페이지" :delay-duration="0">
              <UButton icon="i-tabler-chevrons-left" color="neutral" variant="ghost" size="lg"
                :disabled="disabled || page <= 1" @click="setPage(1)" />
            </UTooltip>
            <UTooltip text="마지막 페이지" :delay-duration="0">
              <UButton icon="i-tabler-chevrons-right" color="neutral" variant="ghost" size="lg"
                :disabled="disabled || page >= normalizedTotalPages" @click="setPage(normalizedTotalPages)" />
            </UTooltip>
          </div>
        </div>
      </template>
    </UPopover>

    <UTooltip text="이전 페이지" :delay-duration="0">
      <UButton icon="i-tabler-chevron-left" color="neutral" variant="ghost" size="lg" :disabled="disabled || page <= 1"
        @click="setPage(page - 1)" />
    </UTooltip>
    <UTooltip text="다음 페이지" :delay-duration="0">
      <UButton icon="i-tabler-chevron-right" color="neutral" variant="ghost" size="lg"
        :disabled="disabled || page >= normalizedTotalPages" @click="setPage(page + 1)" />
    </UTooltip>
  </div>
</template>
