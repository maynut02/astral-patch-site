<script setup lang="ts">
import type { ContributorListItem, ContributorListResponse } from '#shared/types/contributors'

type ContributorSort = 'translations' | 'approved'

useAstralPageSeo('기여자')

const sortMode = ref<ContributorSort>('translations')
const sortItems = [
  { label: '번역 요청순', value: 'translations' },
  { label: '승인 번역순', value: 'approved' }
]

const {
  data,
  status,
  error,
  refresh
} = await useFetch<ContributorListResponse>('/api/contributors', {
  default: () => ({ contributors: [], total: 0 })
})

const contributors = computed(() => data.value?.contributors ?? [])
const isLoading = computed(() => status.value === 'idle' || status.value === 'pending')

const sortedContributors = computed<ContributorListItem[]>(() => {
  return [...contributors.value].sort((left, right) => {
    if (sortMode.value === 'approved') {
      return right.approvedTranslationCount - left.approvedTranslationCount
        || right.translationCount - left.translationCount
        || left.handle.localeCompare(right.handle, 'ko-KR')
    }

    return right.translationCount - left.translationCount
      || right.approvedTranslationCount - left.approvedTranslationCount
      || left.handle.localeCompare(right.handle, 'ko-KR')
  })
})
</script>

<template>
  <div class="mx-auto flex h-full w-full max-w-7xl flex-col gap-5">
    <header class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <UIcon
          name="i-tabler-user-heart"
          class="size-5"
        />
        <h1 class="-mt-0.75 text-xl font-semibold">
          기여자
        </h1>
      </div>
    </header>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">
        총 {{ data?.total.toLocaleString() ?? '0' }}명
      </span>

      <USelect
        v-model="sortMode"
        :items="sortItems"
        color="neutral"
        variant="soft"
        class="h-9 w-36"
        :ui="{ base: 'h-9 leading-5' }"
      />
    </div>

    <div
      v-if="isLoading"
      class="flex flex-col gap-3"
    >
      <div
        v-for="index in 6"
        :key="index"
        class="grid min-h-18 grid-cols-[2.5rem_1fr] items-center gap-3 border-b border-r border-accented bg-elevated/50 p-4 sm:grid-cols-[2.5rem_1fr_auto]"
      >
        <USkeleton class="h-5 w-6" />
        <div class="flex items-center gap-3">
          <USkeleton class="size-10 shrink-0" />
          <USkeleton class="h-5 w-28" />
        </div>
        <div class="col-start-2 flex gap-5 sm:col-start-auto">
          <USkeleton class="h-8 w-20" />
          <USkeleton class="h-8 w-20" />
        </div>
      </div>
    </div>

    <UAlert
      v-else-if="error"
      icon="i-tabler-alert-triangle"
      color="error"
      variant="subtle"
      title="기여자 목록을 불러오지 못했습니다."
      :actions="[{ label: '다시 시도', color: 'error', variant: 'soft', onClick: () => refresh() }]"
    />

    <div
      v-else-if="!sortedContributors.length"
      class="flex min-h-40 flex-col items-center justify-center gap-2 border border-default bg-elevated/30 px-5 py-10 text-center"
    >
      <UIcon
        name="i-tabler-users-minus"
        class="size-7 text-muted"
      />
      <p class="text-sm text-muted">
        아직 번역에 참여한 사용자가 없습니다.
      </p>
    </div>

    <div
      v-else
      class="flex flex-col gap-3 pb-5"
    >
      <NuxtLink
        v-for="(contributor, index) in sortedContributors"
        :key="contributor.handle"
        :to="`/@${contributor.handle}`"
        class="group grid min-h-18 grid-cols-[2.5rem_1fr] items-center gap-3 border border-default bg-muted p-4 transition-colors hover:bg-elevated sm:grid-cols-[2.5rem_1fr_auto]"
      >
        <span class="text-center text-sm font-semibold tabular-nums text-muted">
          {{ index + 1 }}
        </span>

        <div class="flex min-w-0 items-center gap-3">
          <AppUserIdentity
            :handle="contributor.handle"
            :role="contributor.role"
            :link="false"
            text-class="truncate text-base font-semibold text-default"
            icon-class="size-4"
          />
        </div>

        <div class="col-start-2 flex items-center gap-5 sm:col-start-auto sm:justify-end">
          <div class="flex min-w-18 flex-col">
            <span class="text-xs text-muted">번역 요청</span>
            <span class="font-semibold tabular-nums text-default">
              {{ contributor.translationCount.toLocaleString() }}
            </span>
          </div>
          <div class="flex min-w-18 flex-col">
            <span class="text-xs text-muted">승인 번역</span>
            <span class="font-semibold tabular-nums text-success">
              {{ contributor.approvedTranslationCount.toLocaleString() }}
            </span>
          </div>
          <UIcon
            name="i-tabler-chevron-right"
            class="ml-auto size-5 shrink-0 text-dimmed transition-transform group-hover:translate-x-0.5 group-hover:text-default sm:ml-0"
          />
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
