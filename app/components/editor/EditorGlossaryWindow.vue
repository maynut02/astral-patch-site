<script setup lang="ts">
import { useEditorGlossaryWindow } from '~/composables/editor-glossary-window'
import { useGlossaryWorkspace } from '~/composables/glossary-workspace'

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const emit = defineEmits<{ changed: [] }>()
const { open, minimized, request } = useEditorGlossaryWindow()
const workspace = useGlossaryWorkspace({ syncRoute: false })
const windowElement = ref<HTMLElement | null>(null)
// Null until the first drag or resize; CSS then keeps the default top-right placement and size.
const position = ref<{ x: number, y: number } | null>(null)
const size = ref<{ width: number, height: number } | null>(null)
const floating = ref(false)
let initialized = false
let drag: { pointerId: number, offsetX: number, offsetY: number } | null = null
let resize: { pointerId: number, edge: ResizeEdge, startX: number, startY: number, rect: DOMRect } | null = null
let desktopQuery: MediaQueryList | null = null
const MIN_WIDTH = 320
const MIN_HEIGHT = 288
// Handles straddle the outline: mostly outside, so the body scrollbar stays grabbable.
const resizeHandles: { edge: ResizeEdge, class: string }[] = [
  { edge: 'n', class: '-top-1.5 inset-x-3 h-2 cursor-ns-resize' },
  { edge: 's', class: '-bottom-1.5 inset-x-3 h-2 cursor-ns-resize' },
  { edge: 'w', class: '-left-1.5 inset-y-3 w-2 cursor-ew-resize' },
  { edge: 'e', class: '-right-1.5 inset-y-3 w-2 cursor-ew-resize' },
  { edge: 'nw', class: '-top-1.5 -left-1.5 size-4 cursor-nwse-resize' },
  { edge: 'ne', class: '-top-1.5 -right-1.5 size-4 cursor-nesw-resize' },
  { edge: 'sw', class: '-bottom-1.5 -left-1.5 size-4 cursor-nesw-resize' },
  { edge: 'se', class: '-bottom-1.5 -right-1.5 size-4 cursor-nwse-resize' }
]

const fullPageLink = computed(() => ({ path: '/translate/glossary', query: workspace.locationQuery.value }))
// The minimized bar keeps its own width; the stored size returns when it is restored.
const windowStyle = computed(() => floating.value
  ? {
      ...(position.value && { left: `${position.value.x}px`, top: `${position.value.y}px` }),
      ...(size.value && !minimized.value && { width: `${size.value.width}px`, height: `${size.value.height}px` })
    }
  : undefined)

watch(request, (next) => {
  if (next?.target) {
    initialized = true
    void workspace.open(next.target)
  } else if (next && !initialized) {
    initialized = true
    void workspace.init()
  }
}, { immediate: true })

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
function clampPosition(x: number, y: number) {
  // The minimized bar ignores the stored size, so measure what is actually rendered then.
  const width = !minimized.value && size.value ? size.value.width : windowElement.value?.offsetWidth ?? 0
  const height = !minimized.value && size.value ? size.value.height : windowElement.value?.offsetHeight ?? 0
  return {
    x: clamp(x, 0, Math.max(0, window.innerWidth - width)),
    y: clamp(y, 0, Math.max(0, window.innerHeight - height))
  }
}
function keepInViewport() {
  // A hidden or full-screen window has no floating size to clamp against.
  if (!floating.value || !open.value || !windowElement.value?.offsetWidth) return
  if (size.value) {
    size.value = {
      width: Math.min(size.value.width, Math.max(MIN_WIDTH, window.innerWidth)),
      height: Math.min(size.value.height, Math.max(MIN_HEIGHT, window.innerHeight))
    }
  }
  if (position.value) position.value = clampPosition(position.value.x, position.value.y)
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
function startResize(event: PointerEvent, edge: ResizeEdge) {
  if (!floating.value || minimized.value || event.button !== 0 || !windowElement.value) return
  const rect = windowElement.value.getBoundingClientRect()
  resize = { pointerId: event.pointerId, edge, startX: event.clientX, startY: event.clientY, rect }
  position.value = { x: rect.left, y: rect.top }
  size.value = { width: rect.width, height: rect.height }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}
function moveResize(event: PointerEvent) {
  if (resize?.pointerId !== event.pointerId) return
  const { edge, rect } = resize
  const dx = event.clientX - resize.startX
  const dy = event.clientY - resize.startY
  // The opposite edge stays put; the dragged edge stops at the viewport and the minimum size.
  let { left, top, right, bottom } = rect
  if (edge.includes('w')) left = clamp(rect.left + dx, 0, rect.right - MIN_WIDTH)
  if (edge.includes('e')) right = clamp(rect.right + dx, rect.left + MIN_WIDTH, window.innerWidth)
  if (edge.includes('n')) top = clamp(rect.top + dy, 0, rect.bottom - MIN_HEIGHT)
  if (edge.includes('s')) bottom = clamp(rect.bottom + dy, rect.top + MIN_HEIGHT, window.innerHeight)
  position.value = { x: left, y: top }
  size.value = { width: right - left, height: bottom - top }
}
function endResize(event: PointerEvent) {
  if (resize?.pointerId === event.pointerId) resize = null
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
    class="fixed z-70 flex flex-col bg-default shadow-xl ring ring-default"
    :class="floating
      ? ['rounded-lg', position ? '' : 'right-6 top-20', minimized || size ? '' : 'h-[min(46.75rem,calc(100dvh-6.25rem))] w-xl']
      : minimized ? 'inset-x-3 bottom-18 rounded-lg' : 'inset-0'"
    :style="windowStyle"
  >
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
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
        <UTooltip text="전체 화면으로 열기" :delay-duration="0">
          <UButton
            :to="fullPageLink"
            target="_blank"
            icon="i-tabler-external-link"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="전체 화면 용어집 열기"
          />
        </UTooltip>
        <UTooltip :text="minimized ? '펼치기' : '최소화'" :delay-duration="0">
          <UButton
            :icon="minimized ? 'i-tabler-window-maximize' : 'i-tabler-minus'"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="minimized ? '용어집 창 펼치기' : '용어집 창 최소화'"
            @click="minimized = !minimized"
          />
        </UTooltip>
        <UTooltip text="닫기" :delay-duration="0">
          <UButton
            icon="i-tabler-x"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="용어집 창 닫기"
            @click="open = false"
          />
        </UTooltip>
      </header>
      <!-- v-show keeps search, selection and in-progress proposals while minimized. -->
      <div
        v-show="!minimized"
        class="editor-scrollbar min-h-0 flex-1 overflow-auto overscroll-contain p-4"
      >
        <GlossaryWorkspace
          :workspace="workspace"
          compact
          :active="open && !minimized"
          @changed="emit('changed')"
        />
      </div>
    </div>
    <template v-if="floating && !minimized">
      <div
        v-for="handle in resizeHandles"
        :key="handle.edge"
        aria-hidden="true"
        class="absolute touch-none"
        :class="handle.class"
        @pointerdown="startResize($event, handle.edge)"
        @pointermove="moveResize"
        @pointerup="endResize"
        @pointercancel="endResize"
        @lostpointercapture="endResize"
      />
    </template>
  </section>
</template>
