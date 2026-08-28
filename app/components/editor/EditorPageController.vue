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
const keyboardInset = ref(0)
const isPageInputFocused = ref(false)
let visualViewport: VisualViewport | null = null

const KEYBOARD_INSET_THRESHOLD = 80

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

function updateKeyboardInset(): void {
  if (!isPageInputFocused.value || !visualViewport || visualViewport.scale !== 1) {
    keyboardInset.value = 0
    return
  }

  const visualViewportBottom = visualViewport.offsetTop + visualViewport.height
  const nextInset = Math.max(0, window.innerHeight - visualViewportBottom)

  keyboardInset.value = nextInset >= KEYBOARD_INSET_THRESHOLD ? Math.round(nextInset) : 0
}

function handlePageInputFocus(event: FocusEvent): void {
  isPageInputFocused.value = true

  if (window.matchMedia('(max-width: 767px)').matches) {
    const target = event.target instanceof HTMLElement ? event.target : null

    requestAnimationFrame(() => {
      target?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      })
      updateKeyboardInset()
    })
    return
  }

  updateKeyboardInset()
}

function handlePageInputBlur(): void {
  isPageInputFocused.value = false
  keyboardInset.value = 0
}

onMounted(() => {
  visualViewport = window.visualViewport

  window.addEventListener('resize', updateKeyboardInset)
  visualViewport?.addEventListener('resize', updateKeyboardInset)
  visualViewport?.addEventListener('scroll', updateKeyboardInset)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateKeyboardInset)
  visualViewport?.removeEventListener('resize', updateKeyboardInset)
  visualViewport?.removeEventListener('scroll', updateKeyboardInset)
})

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
  <div class="flex bg-elevated/70 p-1 shadow-md backdrop-blur-lg"
    :style="keyboardInset ? { bottom: `${keyboardInset}px` } : undefined">
    <UPopover v-model:open="pagePopoverOpen" :content="{ align: 'center', side: 'top', sideOffset: 8 }">
      <UButton color="neutral" variant="ghost" size="lg"
        class="font-medium text-muted hover:text-default hover:bg-accented/50" :disabled="disabled">
        <span>{{ page }}</span>
        <span class="text-dimmed">/</span>
        <span>{{ normalizedTotalPages }}</span>
      </UButton>

      <template #content>
        <div class="flex flex-col gap-2 p-2">
          <UInput v-model="pageInput" type="number" color="neutral" size="lg" class="w-18" :min="1"
            :max="normalizedTotalPages" :disabled="disabled" aria-label="이동할 페이지"
            :ui="{ base: 'h-9 leading-5 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none' }"
            @focus="handlePageInputFocus" @blur="handlePageInputBlur" @keydown.enter.prevent="goToInputPage" />
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
      <UButton icon="i-tabler-chevron-left" color="neutral" variant="ghost" size="lg" class="hover:bg-accented/50"
        :disabled="disabled || page <= 1" @click="setPage(page - 1)" />
    </UTooltip>
    <UTooltip text="다음 페이지" :delay-duration="0">
      <UButton icon="i-tabler-chevron-right" color="neutral" variant="ghost" size="lg" class="hover:bg-accented/50"
        :disabled="disabled || page >= normalizedTotalPages" @click="setPage(page + 1)" />
    </UTooltip>
  </div>
</template>
