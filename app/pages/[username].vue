<script setup lang="ts">
import type { UserProfileDetails } from '#shared/types/profile'
import {
  formatHandle,
  getErrorStatus,
  getHandleInitial,
  getSocialLinkIcon
} from '~/utils/profile'

definePageMeta({
  validate: (route) => {
    const username = route.params.username

    return typeof username === 'string' && /^@[A-Za-z0-9]+$/.test(username)
  }
})

interface PublicUserProfile extends UserProfileDetails {
  translationCount: number
  approvedTranslationCount: number
  createdAt: string
}

const route = useRoute()
const { showToast } = useAppToast()
const rawUsername = typeof route.params.username === 'string' ? route.params.username : ''

if (!/^@[A-Za-z0-9]+$/.test(rawUsername)) {
  throw createError({
    statusCode: 404,
    statusMessage: '사용자를 찾을 수 없습니다.'
  })
}

const handle = rawUsername.slice(1)
const { data: profile, error } = await useAsyncData(`public-user-${handle}`, () =>
  $fetch<PublicUserProfile>(`/api/users/${encodeURIComponent(handle)}`)
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
const hasGameInfo = computed(() => Boolean(publicProfile.gameUid || publicProfile.gameInviteCode))
const hasProfileDetails = computed(() => hasGameInfo.value || publicProfile.socialLinks.length > 0)
const socialLinks = computed(() => publicProfile.socialLinks.map(link => ({
  ...link,
  icon: getSocialLinkIcon(link.url)
})))

async function copyProfileValue(value: string, label: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand('copy')
      textarea.remove()

      if (!copied) {
        throw new Error('Copy command failed')
      }
    }

    showToast({
      id: `profile-copy-${label}`,
      title: `${label}를 복사했습니다.`
    })
  } catch {
    showToast({
      id: `profile-copy-${label}-failed`,
      title: `${label}를 복사하지 못했습니다.`
    })
  }
}

useHead({ title: displayHandle })
</script>

<template>
  <div class="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center p-3 md:p-5">
    <UCard :ui="{ root: 'w-full max-w-md rounded-xl', body: 'px-5 py-8' }">
      <div class="flex flex-col items-center text-center">
        <div
          class="flex size-20 items-center justify-center rounded-full bg-inverted text-4xl font-semibold text-inverted">
          {{ initial }}
        </div>

        <AppUserIdentity :handle="publicProfile.handle || handle" :role="publicProfile.role" :link="false"
          text-class="text-2xl font-semibold text-default" icon-class="size-5" class="mt-5 gap-2" />
      </div>

      <div class="mt-5 grid grid-cols-2 gap-3">
        <div class="flex flex-col items-center rounded-lg bg-muted px-3 py-3 text-center">
          <span class="text-xl font-semibold text-default">{{ publicProfile.translationCount.toLocaleString() }}</span>
          <span class="mt-1 text-xs text-muted">번역 횟수</span>
        </div>
        <div class="flex flex-col items-center rounded-lg bg-muted px-3 py-3 text-center">
          <span class="text-xl font-semibold text-default">{{ publicProfile.approvedTranslationCount.toLocaleString()
          }}</span>
          <span class="mt-1 text-xs text-muted">승인된 번역</span>
        </div>
      </div>

      <div v-if="hasProfileDetails" class="mt-5 flex flex-col gap-5">
        <div v-if="hasGameInfo" class="grid gap-3 sm:grid-cols-2 border-t border-default pt-5">
          <div v-if="publicProfile.gameUid" class="min-w-0">
            <p class="text-xs text-dimmed">게임 UID</p>
            <button type="button" class="flex min-w-0 items-center gap-2 text-left group" title="클릭하여 복사"
              aria-label="게임 UID 복사" @click="copyProfileValue(publicProfile.gameUid, '게임 UID')">
              <span class="mt-1 break-all text-sm font-medium text-default">{{ publicProfile.gameUid }}</span>
              <UIcon name="i-tabler-copy" class="mt-1 size-3.5 shrink-0 text-dimmed group-hover:text-default" />
            </button>
          </div>

          <div v-if="publicProfile.gameInviteCode" class="min-w-0">
            <p class="text-xs text-dimmed">게임 초대 코드</p>
            <button type="button" class="flex min-w-0 items-center gap-2 text-left group" title="클릭하여 복사"
              aria-label="게임 초대 코드 복사" @click="copyProfileValue(publicProfile.gameInviteCode, '게임 초대 코드')">
              <span class="mt-1 break-all text-sm font-medium text-default">{{ publicProfile.gameInviteCode }}</span>
              <UIcon name="i-tabler-copy" class="mt-1 size-3.5 shrink-0 text-dimmed group-hover:text-default" />
            </button>
          </div>
        </div>

        <div v-if="publicProfile.socialLinks.length" class="flex flex-col gap-2 border-t border-default pt-5">
          <p class="text-xs text-dimmed">소셜미디어</p>
          <div class="flex flex-wrap gap-2">
            <a v-for="link in socialLinks" :key="link.id" :href="link.url" target="_blank" rel="noopener noreferrer"
              class="inline-flex min-w-0 items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm font-medium text-default transition-colors hover:bg-elevated">
              <UIcon v-if="link.icon" :name="link.icon" class="size-4 shrink-0" />
              <span class="max-w-48 truncate">{{ link.label }}</span>
              <UIcon name="i-tabler-external-link" class="size-4 shrink-0 text-muted" />
            </a>
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>
