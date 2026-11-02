<script setup lang="ts">
import { useEditorGlossaryWindow } from '~/composables/editor-glossary-window'
import { useGlossaryWorkspace } from '~/composables/glossary-workspace'

const emit = defineEmits<{ changed: [] }>()
const { open, minimized, request } = useEditorGlossaryWindow()
const workspace = useGlossaryWorkspace({ syncRoute: false })
const windowElement = ref<HTMLElement | null>(null)
// Null until the first drag; CSS then keeps the default top-right placement.
const position = ref<{ x: number, y: number } | null>(null)
const floating = ref(false)
let initialized = false
let drag: { pointerId: number, offsetX: number, offsetY: number } | null = null
let desktopQuery: MediaQueryList | null = null

const fullPageLink = computed(() => ({ path: '/translate/glossary', query: workspace.locationQuery.value }))

watch(request, (next) => {
  if (next?.target) {
    initialized = true
    void workspace.open(next.target)
  } else if (next && !initialized) {
    initialized = true
    void workspace.init()
  }
}, { immediate: true })

function clampPosition(x: number, y: number) {
  const width = windowElement.value?.offsetWidth ?? 0
  const height = windowElement.value?.offsetHeight ?? 0
  return {
    x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - width)),
    y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - height))
  }
}
function keepInViewport() {
  // A hidden or full-screen window has no floating size to clamp against.
  if (!position.value || !floating.value || !open.value || !windowElement.value?.offsetWidth) return
  position.value = clampPosition(position.value.x, position.value.y)
}
function startDrag(event: PointerEvent) {
  if (!floating.value || event.button !== 0 || !windowElement.value) return
  if (event.target instanceof Element && event.target.closest('button, a')) return
  const rect = windowElement.value.getBoundingClientRect()
  drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }
  position.value = { x: rect.left, y: rect.top }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  // Keeps focus and the caret in the translation field while the window moves.
  event.preventDefault()
}
function moveDrag(event: PointerEvent) {
  if (drag?.pointerId === event.pointerId) position.value = clampPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY)
}
function endDrag(event: PointerEvent) {
  if (drag?.pointerId === event.pointerId) drag = null
}
function syncFloating() {
  floating.value = desktopQuery?.matches ?? false
}
watch([open, minimized, floating], () => nextTick(keepInViewport))
onMounted(() => {
  desktopQuery = window.matchMedia('(min-width: 64rem)')
  desktopQuery.addEventListener('change', syncFloating)
  syncFloating()
  window.addEventListener('resize', keepInViewport)
})
onBeforeUnmount(() => {
  desktopQuery?.removeEventListener('change', syncFloating)
  window.removeEventListener('resize', keepInViewport)
})
</script>

<template>
  <section
    v-show="open"
    ref="windowElement"
    role="dialog"
    aria-modal="false"
    aria-labelledby="editor-glossary-window-title"
    class="fixed z-70 flex flex-col overflow-hidden bg-default shadow-xl ring ring-default"
    :class="floating
      ? ['rounded-lg', position ? '' : 'right-6 top-20']
      : minimized ? 'inset-x-3 bottom-18 rounded-lg' : 'inset-0'"
    :style="floating && position ? { left: `${position.x}px`, top: `${position.y}px` } : undefined"
  >
    <header
      class="flex h-11 shrink-0 select-none items-center gap-1 bg-muted pr-1.5 pl-3"
      :class="[floating ? 'cursor-move touch-none' : '', minimized ? 'min-w-72' : 'border-b border-default']"
      @pointerdown="startDrag"
      @pointermove="moveDrag"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @lostpointercapture="endDrag"
    >
      <UIcon name="i-tabler-books" class="size-4 shrink-0 text-muted" />
      <h2 id="editor-glossary-window-title" class="mr-auto min-w-0 truncate text-sm font-medium">
        공통 용어집
      </h2>
      <UButton
        :to="fullPageLink"
        target="_blank"
        icon="i-tabler-external-link"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="전체 화면 용어집 열기"
        title="전체 화면으로 열기"
      />
      <UButton
        :icon="minimized ? 'i-tabler-window-maximize' : 'i-tabler-minus'"
        color="neutral"
        variant="ghost"
        size="sm"
        :aria-label="minimized ? '용어집 창 펼치기' : '용어집 창 최소화'"
        :title="minimized ? '펼치기' : '최소화'"
        @click="minimized = !minimized"
      />
      <UButton
        icon="i-tabler-x"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="용어집 창 닫기"
        title="닫기"
        @click="open = false"
      />
    </header>
    <!-- v-show keeps search, selection and in-progress proposals while minimized. -->
    <div
      v-show="!minimized"
      class="editor-scrollbar overflow-auto overscroll-contain p-4"
      :class="floating
        ? 'h-[min(44rem,calc(100dvh-9rem))] max-h-[calc(100dvh-1rem)] min-h-60 w-xl max-w-[calc(100vw-1rem)] min-w-80 resize'
        : 'min-h-0 h-auto! w-full! flex-1'"
    >
      <GlossaryWorkspace
        :workspace="workspace"
        compact
        :active="open && !minimized"
        @changed="emit('changed')"
      />
    </div>
  </section>
</template>
