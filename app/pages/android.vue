<script setup lang="ts">
import type { ReleaseFeedResponse } from '#shared/types/releases'

useAstralPageSeo('Android 패치 앱 실행')

definePageMeta({
  layout: false
})

const {
  data: releaseFeed,
  status,
  error,
  refresh
} = await useFetch<ReleaseFeedResponse>('/api/releases')

const androidPatcher = computed(() => releaseFeed.value?.distribution.androidPatcher ?? null)
const isLoading = computed(() => status.value === 'idle' || status.value === 'pending')
const androidIntentUrl = 'intent://astral.maynutlab.com/android#Intent;scheme=https;package=com.maynutlab.astralpatcher;end'

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / (1024 ** unitIndex)
  const fractionDigits = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2

  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
}

function reloadRelease(): void {
  void refresh()
}
</script>

<template>
  <div class="w-full h-dvh flex justify-center items-center">
    <section class="flex w-full flex-col">
      <div class="flex flex-col items-center px-5 py-10 text-center sm:px-10 sm:py-14">
        <div class="flex size-16 items-center justify-center">
          <UIcon
            name="i-tabler-brand-android"
            class="size-9 text-muted"
          />
        </div>

        <h1 class="mt-2 text-2xl font-semibold text-default sm:text-3xl">
          Android 패치 앱 실행
        </h1>
        <p class="mt-3 max-w-xl text-sm leading-6 text-muted sm:text-base">
          Android 패치 앱이 설치되어 있지 않다면 최신 버전을 다운로드해 설치해 주세요.
        </p>

        <div
          v-if="androidPatcher"
          class="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-dimmed"
        >
          <span>v{{ androidPatcher.index.version }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ formatFileSize(androidPatcher.index.size) }}</span>
        </div>

        <UButton
          :href="androidIntentUrl"
          external
          icon="i-tabler-external-link"
          color="info"
          size="xl"
          class="mt-7 justify-center px-4"
        >
          Android 패치 앱 열기
        </UButton>

        <UButton
          :href="androidPatcher?.index.downloadUrl"
          :disabled="!androidPatcher"
          :loading="isLoading"
          external
          icon="i-tabler-download"
          color="info"
          variant="soft"
          size="xl"
          class="mt-3 justify-center px-4"
        >
          Android 패치 앱 다운로드
        </UButton>

        <UButton
          to="/"
          icon="i-tabler-arrow-back-up"
          color="neutral"
          variant="link"
          size="xl"
          class="mt-7 justify-center px-4"
        >
          홈으로 이동하기
        </UButton>
      </div>

      <div
        v-if="error || (!isLoading && !androidPatcher)"
        class="border-t border-default bg-default/75 p-4"
      >
        <UAlert
          color="error"
          variant="soft"
          title="최신 Android 패처 정보를 불러오지 못했습니다."
          description="잠시 후 다시 시도하거나 다운로드 페이지를 확인해 주세요."
        >
          <template #actions>
            <UButton
              color="error"
              variant="soft"
              size="sm"
              @click="reloadRelease"
            >
              다시 불러오기
            </UButton>
            <UButton
              to="/download"
              color="neutral"
              variant="soft"
              size="sm"
            >
              다운로드 페이지
            </UButton>
          </template>
        </UAlert>
      </div>
    </section>
  </div>
</template>
