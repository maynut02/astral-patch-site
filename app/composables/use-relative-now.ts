export function useRelativeNow(intervalMs = 1000) {
  const now = ref<number | null>(null)
  let timer: ReturnType<typeof setInterval> | undefined

  onMounted(() => {
    now.value = Date.now()
    timer = setInterval(() => {
      now.value = Date.now()
    }, intervalMs)
  })

  onBeforeUnmount(() => {
    clearInterval(timer)
  })

  return now
}
