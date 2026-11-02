import type { InjectionKey, Ref, ShallowRef } from 'vue'
import type { GlossaryWorkspaceTarget } from '~/composables/glossary-workspace'

export interface EditorGlossaryWindow {
  open: Ref<boolean>
  minimized: Ref<boolean>
  /** Latest open request; a fresh object per `show` so repeating the same target still navigates. */
  request: ShallowRef<{ target: GlossaryWorkspaceTarget | null } | null>
  show: (target?: GlossaryWorkspaceTarget | null) => void
  toggle: () => void
}

function createEditorGlossaryWindow(): EditorGlossaryWindow {
  const open = ref(false)
  const minimized = ref(false)
  const request: EditorGlossaryWindow['request'] = shallowRef(null)
  function show(target: GlossaryWorkspaceTarget | null = null) {
    open.value = true
    minimized.value = false
    request.value = { target }
  }
  function toggle() {
    if (open.value && !minimized.value) open.value = false
    else show()
  }
  return { open, minimized, request, show, toggle }
}

const editorGlossaryWindowKey: InjectionKey<EditorGlossaryWindow> = Symbol('editor-glossary-window')

export function provideEditorGlossaryWindow() {
  const controller = createEditorGlossaryWindow()
  provide(editorGlossaryWindowKey, controller)
  return controller
}

export function useEditorGlossaryWindow() {
  const controller = inject(editorGlossaryWindowKey)
  if (!controller) throw new Error('The editor glossary window is only available inside the translation editor.')
  return controller
}
