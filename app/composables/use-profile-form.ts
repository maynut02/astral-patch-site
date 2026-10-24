import { validateGameInviteCode, validateGameUid, validateHandle } from '~/utils/profile'
import { getRequestErrorStatus } from '~/utils/request-error'

interface ProfileFormSubmitOptions<T> {
  validate: () => boolean
  body: () => object
  onSaved: (profile: T) => Promise<void>
  failureMessage: string
}

export function useProfileForm() {
  const state = reactive({
    handle: '',
    gameUid: '',
    gameInviteCode: ''
  })
  const errors = reactive({
    handle: '',
    gameUid: '',
    gameInviteCode: ''
  })
  const submitting = ref(false)
  const serverError = ref('')

  function validate(): boolean {
    errors.handle = validateHandle(state.handle)
    errors.gameUid = validateGameUid(state.gameUid)
    errors.gameInviteCode = validateGameInviteCode(state.gameInviteCode)

    return !errors.handle && !errors.gameUid && !errors.gameInviteCode
  }

  function normalizedState() {
    return {
      handle: state.handle.trim(),
      gameUid: state.gameUid.trim(),
      gameInviteCode: state.gameInviteCode.trim()
    }
  }

  async function submit<T>(options: ProfileFormSubmitOptions<T>): Promise<void> {
    serverError.value = ''

    if (!options.validate()) {
      return
    }

    submitting.value = true

    try {
      const profile = await $fetch<T>('/api/profile', {
        method: 'PATCH',
        body: options.body()
      })
      await options.onSaved(profile)
    } catch (error: unknown) {
      if (getRequestErrorStatus(error) === 409) {
        errors.handle = '이미 사용 중인 핸들이에요.'
      } else {
        serverError.value = options.failureMessage
      }
    } finally {
      submitting.value = false
    }
  }

  return { state, errors, submitting, serverError, validate, normalizedState, submit }
}
