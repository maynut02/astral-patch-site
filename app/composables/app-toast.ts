interface AppToastOptions {
  id: string
  title: string
  description?: string
}

export function useAppToast() {
  const toast = useToast()

  function showToast(options: AppToastOptions): void {
    toast.add({
      id: options.id,
      title: options.title,
      ...(options.description ? { description: options.description } : {}),
      color: 'neutral',
      progress: false
    })
  }

  function showLoginRequiredToast(id: string): void {
    showToast({
      id,
      title: '로그인이 필요한 기능입니다.'
    })
  }

  return {
    showToast,
    showLoginRequiredToast
  }
}
