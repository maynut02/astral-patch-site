<script setup lang="ts">
import type { UserRole } from '~/utils/user-role'
import {
  formatHandle,
  getErrorStatus,
  getHandleInitial
} from '~/utils/profile'

definePageMeta({
  validate: (route) => {
    const username = route.params.username

    return typeof username === 'string' && /^@[A-Za-z0-9]+$/.test(username)
  }
})

const route = useRoute()
const rawUsername = typeof route.params.username === 'string' ? route.params.username : ''

if (!/^@[A-Za-z0-9]+$/.test(rawUsername)) {
  throw createError({
    statusCode: 404,
    statusMessage: '사용자를 찾을 수 없습니다.'
  })
}

const handle = rawUsername.slice(1)
const { data: profile, error } = await useAsyncData(`public-user-${handle}`, () =>
  $fetch<{ handle: string, role: UserRole }>(`/api/users/${encodeURIComponent(handle)}`)
)

if (error.value || !profile.value) {
  throw createError({
    statusCode: getErrorStatus(error.value) || 404,
    statusMessage: '사용자를 찾을 수 없습니다.'
  })
}

const publicProfile = profile.value
const displayHandle = computed(() => formatHandle(publicProfile.handle || handle))
const initial = computed(() => getHandleInitial(publicProfile.handle || handle))

useHead({ title: displayHandle })
</script>

<template>
  <div class="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-4 py-10 sm:px-6">
    <UCard :ui="{ root: 'w-full max-w-md rounded-xl', body: 'p-6 sm:p-8' }">
      <div class="flex flex-col items-center text-center">
        <div
          class="flex size-20 items-center justify-center rounded-full bg-inverted text-2xl font-semibold text-inverted"
        >
          {{ initial }}
        </div>

        <AppUserIdentity
          :handle="publicProfile.handle || handle"
          :role="publicProfile.role"
          :link="false"
          text-class="text-2xl font-semibold text-default"
          icon-class="size-5"
          class="mt-5 gap-2"
        />
      </div>
    </UCard>
  </div>
</template>
