<script setup lang="ts">
import type { ModReleasePageResponse } from '#shared/types/mod'
import type { ReleaseNoteEntry } from '#shared/types/releases'
import { formatModDate, formatModFileSize } from '~/utils/mod'
import { getRequestErrorMessage } from '~/utils/request-error'

const props = defineProps<{ modId: string, releases: ReleaseNoteEntry[], hasMore: boolean }>()
const entries = ref<ReleaseNoteEntry[]>([])
const page = ref(1)
const moreAvailable = ref(false)
const loading = ref(false)
const error = ref('')
let generation = 0

watch(() => [props.modId, props.releases, props.hasMore] as const, () => {
  generation++
  entries.value = [...props.releases]
  page.value = 1
  moreAvailable.value = props.hasMore
  error.value = ''
  loading.value = false
}, { immediate: true })

async function loadMore(): Promise<void> {
  if (loading.value || !moreAvailable.value) return
  const currentGeneration = generation
  loading.value = true
  error.value = ''
  try {
    const result = await $fetch<ModReleasePageResponse>(`/api/mods/${props.modId}/releases`, { query: { page: page.value + 1 } })
    if (currentGeneration !== generation) return
    entries.value = [...new Map([...entries.value, ...result.releases].map(release => [release.id, release])).values()]
    page.value = result.page
    moreAvailable.value = result.hasMore
  } catch (cause) {
    if (currentGeneration === generation) error.value = getRequestErrorMessage(cause, '이전 릴리즈를 불러오지 못했습니다.')
  } finally {
    if (currentGeneration === generation) loading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="!entries.length" class="flex flex-col items-center gap-2 border border-default bg-muted p-8 text-center text-muted">
      <UIcon name="i-tabler-package-off" class="size-7" />
      <p class="text-sm">
        아직 공개된 릴리즈가 없습니다.
      </p>
      <p class="text-xs">
        저장소에 릴리즈와 파일이 올라오면 여기에 표시됩니다.
      </p>
    </div>

    <article v-for="release in entries" :key="release.id" class="flex min-w-0 flex-col border border-default">
      <div class="flex flex-wrap items-start justify-between gap-3 bg-muted p-4">
        <div class="flex min-w-0 flex-col gap-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="wrap-break-word text-base font-semibold">
              {{ release.title }}
            </h3>
            <UBadge
              v-if="release.prerelease"
              color="warning"
              variant="soft"
              size="sm"
            >
              사전 릴리즈
            </UBadge>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span class="inline-flex items-center gap-1"><UIcon name="i-tabler-tag" class="size-3.5" />{{ release.tagName }}</span>
            <span aria-hidden="true">·</span>
            <time :datetime="release.publishedAt">{{ formatModDate(release.publishedAt) }}</time>
          </div>
        </div>
        <UButton
          :to="release.url"
          target="_blank"
          rel="noopener noreferrer"
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-tabler-external-link"
        >
          GitHub
        </UButton>
      </div>

      <div v-if="release.assets.length" class="divide-y divide-default border-t border-default">
        <a
          v-for="asset in release.assets"
          :key="asset.id"
          :href="asset.downloadUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted"
        >
          <UIcon name="i-tabler-file-zip" class="size-5 shrink-0 text-muted" />
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="wrap-break-word text-sm font-medium group-hover:underline underline-offset-2">{{ asset.name }}</span>
            <span class="text-xs text-muted">{{ formatModFileSize(asset.size) }} · {{ asset.downloadCount.toLocaleString('ko-KR') }}회 다운로드</span>
          </div>
          <UIcon name="i-tabler-download" class="size-4 shrink-0 text-muted group-hover:text-default" />
        </a>
      </div>
      <p v-else class="border-t border-default p-4 text-sm text-muted">
        이 버전에는 첨부된 다운로드 파일이 없습니다.
      </p>

      <UCollapsible v-if="release.body.trim()" class="border-t border-default">
        <template #default="{ open }">
          <button type="button" class="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-xs text-muted hover:bg-muted">
            릴리즈 노트
            <UIcon name="i-tabler-chevron-down" class="size-4" :class="open ? 'rotate-180' : ''" />
          </button>
        </template>
        <template #content>
          <ReleaseMarkdown :source="release.body" :base-url="`${release.url}/`" class="border-t border-default p-4" />
        </template>
      </UCollapsible>
    </article>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :title="error"
    />
    <UButton
      v-if="moreAvailable"
      color="neutral"
      variant="soft"
      icon="i-tabler-chevron-down"
      class="self-center"
      :loading="loading"
      @click="loadMore"
    >
      이전 버전 더 보기
    </UButton>
  </div>
</template>
