type SidebarMenu = 'list' | 'history' | 'comments' | 'dictionary' | 'settings'

interface SidebarMenuItem {
  key: SidebarMenu
  label: string
  icon: string
}

export function useEditorLayout() {
  const isSidebarOpen = ref(true)
  const isMobileSidebarOpen = ref(false)
  const activeSidebarMenu = ref<SidebarMenu>('history')

  const listContainer = ref<HTMLElement | null>(null)
  const editorToolbar = ref<HTMLElement | null>(null)
  const editorToolbarHeight = ref(96)
  let editorToolbarResizeObserver: ResizeObserver | null = null
  let mobileSidebarMediaQuery: MediaQueryList | null = null
  let previousBodyOverflow: string | null = null
  let previousDocumentOverflow: string | null = null

  function syncMobileSidebarScrollLock(): void {
    if (!import.meta.client) {
      return
    }

    const shouldLock = Boolean(isMobileSidebarOpen.value && mobileSidebarMediaQuery?.matches)

    if (shouldLock) {
      if (previousBodyOverflow === null) {
        previousBodyOverflow = document.body.style.overflow
        previousDocumentOverflow = document.documentElement.style.overflow
      }

      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
      return
    }

    if (previousBodyOverflow !== null) {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousDocumentOverflow ?? ''
      previousBodyOverflow = null
      previousDocumentOverflow = null
    }
  }

  watch(isMobileSidebarOpen, syncMobileSidebarScrollLock)

  const defaultSidebarMenu = { key: 'list', label: '목록', icon: 'i-tabler-list-search' } satisfies SidebarMenuItem
  const sidebarMenuItems: SidebarMenuItem[] = [
    defaultSidebarMenu,
    { key: 'history', label: '변경 기록', icon: 'i-tabler-history-toggle' },
    { key: 'comments', label: '코멘트', icon: 'i-tabler-message' },
    { key: 'dictionary', label: '사전', icon: 'i-tabler-book' },
    { key: 'settings', label: '에디터 설정', icon: 'i-tabler-settings' }
  ]

  const activeSidebarMenuItem = computed(() =>
    sidebarMenuItems.find(item => item.key === activeSidebarMenu.value) ?? defaultSidebarMenu
  )

  function syncEditorToolbarHeight(): void {
    if (editorToolbar.value) {
      editorToolbarHeight.value = Math.round(editorToolbar.value.getBoundingClientRect().height)
    }
  }

  function selectSidebarMenu(menu: SidebarMenu): void {
    activeSidebarMenu.value = menu

    if (!isSidebarOpen.value) {
      isSidebarOpen.value = true
    }
  }

  function scrollListToTop(): void {
    nextTick(() => {
      if (window.matchMedia('(max-width: 1023px)').matches) {
        window.scrollTo({
          top: 0,
          behavior: 'auto'
        })
        return
      }

      listContainer.value?.scrollTo({
        top: 0,
        behavior: 'auto'
      })
    })
  }

  onMounted(() => {
    syncEditorToolbarHeight()
    mobileSidebarMediaQuery = window.matchMedia('(max-width: 1023px)')
    mobileSidebarMediaQuery.addEventListener('change', syncMobileSidebarScrollLock)
    syncMobileSidebarScrollLock()
    if (typeof ResizeObserver !== 'undefined' && editorToolbar.value) {
      editorToolbarResizeObserver = new ResizeObserver(syncEditorToolbarHeight)
      editorToolbarResizeObserver.observe(editorToolbar.value)
    }
  })

  onBeforeUnmount(() => {
    editorToolbarResizeObserver?.disconnect()
    mobileSidebarMediaQuery?.removeEventListener('change', syncMobileSidebarScrollLock)
    mobileSidebarMediaQuery = null
    isMobileSidebarOpen.value = false
    syncMobileSidebarScrollLock()
  })

  return {
    isSidebarOpen,
    isMobileSidebarOpen,
    activeSidebarMenu,
    listContainer,
    editorToolbar,
    editorToolbarHeight,
    sidebarMenuItems,
    activeSidebarMenuItem,
    selectSidebarMenu,
    scrollListToTop
  }
}
