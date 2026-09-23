interface DocumentPictureInPicture {
  requestWindow: (options: { width: number, height: number }) => Promise<Window>
}

function getDocumentPictureInPicture(): DocumentPictureInPicture | undefined {
  return (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture
}

// Mirror the site's theme and styles, including styles added by Nuxt during use.
function mirrorPictureInPictureStyles(target: Document): () => void {
  const base = target.createElement('base')
  base.href = document.baseURI
  target.head.append(base)
  const viewport = target.createElement('meta')
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1'
  target.head.append(viewport)
  let copiedStyles: Node[] = []

  function syncStyles() {
    const styles = Array.from(document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style, link[rel="stylesheet"]')).map((source) => {
      const copy = source.cloneNode(true) as HTMLStyleElement | HTMLLinkElement
      if (source instanceof HTMLLinkElement) {
        (copy as HTMLLinkElement).href = source.href
      } else if (source.sheet) {
        // CSSOM-inserted rules do not appear in a style element's textContent.
        try {
          copy.textContent = Array.from(source.sheet.cssRules, rule => rule.cssText).join('\n')
        } catch {
          // Keep the cloned text when the stylesheet is not readable.
        }
      }
      return copy
    })
    for (const sheet of document.adoptedStyleSheets) {
      const style = target.createElement('style')
      style.textContent = Array.from(sheet.cssRules, rule => rule.cssText).join('\n')
      styles.push(style)
    }
    for (const style of copiedStyles) style.parentNode?.removeChild(style)
    target.head.append(...styles)
    copiedStyles = styles
  }

  function syncTheme() {
    target.documentElement.className = document.documentElement.className
    target.documentElement.lang = document.documentElement.lang
    target.documentElement.dir = document.documentElement.dir
    target.documentElement.style.cssText = document.documentElement.style.cssText
    target.body.className = document.body.className
    target.body.style.cssText = document.body.style.cssText
    target.body.style.margin = '0'
    target.body.style.height = '100dvh'
    target.body.style.overflow = 'hidden'
    target.title = document.title
  }

  syncStyles()
  syncTheme()
  const stylesObserver = new MutationObserver(syncStyles)
  stylesObserver.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true })
  const themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.documentElement, { attributes: true })
  themeObserver.observe(document.body, { attributes: true })
  return () => {
    stylesObserver.disconnect()
    themeObserver.disconnect()
  }
}

export function usePartyPictureInPicture() {
  const supported = ref(false)
  const target = shallowRef<HTMLElement>()
  const opening = ref(false)
  const error = ref('')
  let pipWindow: Window | undefined
  let disposeStyles: (() => void) | undefined
  let disposed = false

  onMounted(() => {
    supported.value = window.isSecureContext && typeof getDocumentPictureInPicture()?.requestWindow === 'function'
  })

  function restore() {
    disposeStyles?.()
    disposeStyles = undefined
    target.value = undefined
    pipWindow = undefined
  }

  async function close() {
    const current = pipWindow
    restore()
    // Move the existing Vue tree back before closing its destination document.
    await nextTick()
    current?.close()
  }

  async function open() {
    if (opening.value || disposed) return
    if (pipWindow && !pipWindow.closed) {
      pipWindow.focus()
      return
    }
    const api = getDocumentPictureInPicture()
    if (!api) return
    opening.value = true
    error.value = ''
    try {
      // Keep this call before any await: the browser requires a user gesture.
      const current = await api.requestWindow({ width: 440, height: 640 })
      if (disposed || current.closed) {
        current.close()
        return
      }
      pipWindow = current
      current.addEventListener('pagehide', () => {
        if (pipWindow === current) restore()
      }, { once: true })
      disposeStyles = mirrorPictureInPictureStyles(current.document)
      target.value = current.document.body
    } catch {
      await close()
      error.value = 'PiP 창을 열지 못했습니다. 다시 시도해 주세요.'
    } finally {
      opening.value = false
    }
  }

  onBeforeUnmount(() => {
    disposed = true
    const current = pipWindow
    restore()
    current?.close()
  })

  return { supported, target, opening, error, open, close }
}
