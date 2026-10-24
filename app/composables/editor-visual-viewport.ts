import type { Ref } from 'vue'

export function useEditorVisualViewportInset(enabled: Ref<boolean>, options: {
  mediaQuery?: string
  onUpdate?: () => void
} = {}) {
  const keyboardInset = ref(0)
  let visualViewport: VisualViewport | null = null

  function updateKeyboardInset(): void {
    if (!enabled.value
      || !visualViewport
      || visualViewport.scale !== 1
      || (options.mediaQuery && !window.matchMedia(options.mediaQuery).matches)) {
      keyboardInset.value = 0
      return
    }

    const bottom = visualViewport.offsetTop + visualViewport.height
    const inset = Math.max(0, window.innerHeight - bottom)
    keyboardInset.value = inset >= 80 ? Math.round(inset) : 0
    options.onUpdate?.()
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

  return { keyboardInset, updateKeyboardInset }
}
