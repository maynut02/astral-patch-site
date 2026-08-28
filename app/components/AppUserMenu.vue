<script setup lang="ts">
import { getHandleInitial } from '~/utils/profile'

const props = withDefaults(defineProps<{
  context?: 'default' | 'editor'
}>(), {
  context: 'default'
})

const { ready, loggedIn, user } = useUserSession()
const route = useRoute()

const initial = computed(() => getHandleInitial(user.value?.handle))

const triggerClass = computed(() => props.context === 'editor'
  ? 'size-9 hover:bg-elevated/75 lg:size-10'
  : 'size-9 hover:bg-elevated/75'
)

function login() {
  const returnTo = encodeURIComponent(route.fullPath)

  return navigateTo(`/auth/login?returnTo=${returnTo}`, { external: true })
}
</script>

<template>
  <AppUserMenuContent v-if="ready && loggedIn" side="bottom">
    <template #trigger="{ open }">
      <button
        type="button"
        aria-label="사용자 메뉴"
        :aria-expanded="open"
        aria-haspopup="menu"
        class="flex shrink-0 items-center justify-center text-sm font-semibold text-default transition-colors"
        :class="[triggerClass, open ? 'bg-accented/75' : '', 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary']"
      >
        <span class="flex size-6 items-center justify-center rounded-full bg-inverted text-xs text-inverted">
          {{ initial }}
        </span>
      </button>
    </template>
  </AppUserMenuContent>

  <button
    v-else-if="ready"
    type="button"
    aria-label="Google 로그인"
    :class="triggerClass"
    class="flex shrink-0 items-center justify-center text-muted transition-colors hover:text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    @click="login"
  >
    <UIcon
      name="i-tabler-user-key"
      class="size-5"
    />
  </button>

  <div
    v-else
    :class="triggerClass"
    class="flex shrink-0 items-center justify-center border border-accented/30 bg-elevated/60 text-muted backdrop-blur-lg"
    aria-label="로그인 상태 확인 중"
    role="status"
    aria-live="polite"
  >
    <AppLoadingSpinner />
  </div>
</template>
