<script setup lang="ts">
import type {
  EditorReviewAction,
  EditorTranslationLogEntry,
  EditorTranslationLogResponse
} from '#shared/types/editor'
import { getEditorDiffParts } from '~/utils/editor-diff'
import { formatEditorDate } from '~/utils/editor-helpers'

definePageMeta({ middleware: 'reviewer' })
useAstralPageSeo('번역 승인')

const defaultData: EditorTranslationLogResponse = {
  entries: [],
  total: 0,
  page: 1,
  pageSize: 50,
  totalPages: 1
}

const page = ref(1)
const reviewingId = ref<string | null>(null)
const { showToast } = useAppToast()

const {
  data,
  status,
  error,
  refresh
} = await useFetch<EditorTranslationLogResponse>('/api/editor/review', {
  query: computed(() => ({ page: page.value })),
  default: () => defaultData
})

const entries = computed(() => data.value?.entries ?? [])

async function review(entry: EditorTranslationLogEntry, action: EditorReviewAction): Promise<void> {
  if (reviewingId.value) {
    return
  }

  reviewingId.value = entry.id

  try {
    await $fetch(`/api/editor/changes/${encodeURIComponent(entry.id)}`, {
      method: 'PATCH',
      body: { action }
    })

    showToast({
      id: `translation-review-${entry.id}`,
      title: action === 'approve' ? '번역을 승인했습니다.' : '번역을 반려했습니다.'
    })

    await refresh()

    if (!entries.value.length && page.value > 1) {
      page.value -= 1
    }
  } catch (reviewError) {
    showToast({
      id: `translation-review-failed-${entry.id}`,
      title: '번역 검토를 처리하지 못했습니다.',
      description: reviewError instanceof Error ? reviewError.message : undefined
    })
  } finally {
    reviewingId.value = null
  }
}
</script>

<template>
  <section class="mx-auto flex w-full max-w-400 flex-col gap-5">
    <header class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-tabler-checkup-list"
            class="size-5 text-muted"
          />
          <h1 class="text-xl font-semibold text-default">
            번역 승인
          </h1>
        </div>
      </div>

      <UBadge
        color="warning"
        variant="soft"
        size="md"
        class="w-fit shrink-0"
      >
        승인 대기 {{ (data?.total ?? 0).toLocaleString() }}건
      </UBadge>
    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="승인 대기 목록을 불러오지 못했습니다."
      description="잠시 후 다시 시도해 주세요."
    >
      <template #actions>
        <UButton
          color="error"
          variant="outline"
          size="sm"
          @click="refresh()"
        >
          다시 시도
        </UButton>
      </template>
    </UAlert>

    <div
      v-if="status === 'pending' && !entries.length"
      class="flex flex-col gap-4"
    >
      <div
        v-for="index in 5"
        :key="index"
        class="flex flex-col gap-3 border border-default p-4"
      >
        <USkeleton class="h-5 w-1/3" />
        <USkeleton class="h-16 w-full" />
        <USkeleton class="h-4 w-1/4" />
      </div>
    </div>

    <UAlert
      v-else-if="!error && !entries.length"
      color="neutral"
      variant="soft"
      icon="i-tabler-circle-check"
      title="승인 대기 중인 번역이 없습니다."
      description="현재 검토가 필요한 번역 제안이 모두 처리되었습니다."
    />

    <div
      v-else-if="!error"
      class="flex flex-col gap-4"
    >
      <article
        v-for="entry in entries"
        :key="entry.id"
        class="flex flex-col border border-default bg-muted"
      >
        <header class="flex flex-wrap items-center gap-2 border-b border-default px-4 py-3">
          <UBadge
            color="warning"
            variant="soft"
            size="sm"
          >
            승인 대기
          </UBadge>
          <NuxtLink
            :to="{
              path: '/translate/editor',
              query: {
                file: entry.category,
                search: `${entry.category}_${entry.unitKey}`,
                searchType: 'key',
                match: 'exact',
                page: '1'
              }
            }"
            class="min-w-0 flex-1 truncate text-sm font-medium text-default hover:underline underline-offset-2"
          >
            {{ entry.category }}_{{ entry.unitKey }}
          </NuxtLink>
          <time
            class="shrink-0 text-xs text-muted"
            :datetime="entry.createdAt"
          >
            {{ formatEditorDate(entry.createdAt) }}
          </time>
        </header>

        <div class="flex flex-col gap-1.5">
          <p class="whitespace-pre-wrap wrap-break-word bg-default/75 p-4 text-sm leading-6 text-toned">
            <template
              v-for="(part, partIndex) in getEditorDiffParts(entry.previousText ?? '', entry.proposedText)"
              :key="`${part.type}-${partIndex}`"
            >
              <span
                :class="part.type === 'removed'
                  ? 'bg-error/10 text-error'
                  : part.type === 'added'
                    ? 'bg-success/10 text-success'
                    : 'text-toned'"
              >{{ part.text }}</span>
            </template>
            <span v-if="!entry.previousText && !entry.proposedText">빈 문자열</span>
          </p>
        </div>

        <div class="flex flex-col gap-4 px-4 py-3">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-center gap-2 text-xs text-muted">
              <UIcon
                name="i-tabler-git-pull-request"
                class="size-3.5 shrink-0"
              />
              <AppUserIdentity
                :handle="entry.handle"
                :role="entry.actorRole"
                fallback="익명"
                text-class="text-xs"
                icon-class="size-3.5"
              />
            </div>

            <div class="flex flex-wrap justify-end gap-2">
              <UButton
                :to="{
                  path: '/translate/editor',
                  query: {
                    file: entry.category,
                    search: `${entry.category}_${entry.unitKey}`,
                    searchType: 'key',
                    match: 'exact',
                    page: '1'
                  }
                }"
                icon="i-tabler-external-link"
                color="neutral"
                variant="soft"
                size="md"
              >
                에디터에서 확인
              </UButton>
              <UButton
                icon="i-tabler-x"
                color="error"
                variant="soft"
                size="md"
                :loading="reviewingId === entry.id"
                :disabled="Boolean(reviewingId)"
                @click="review(entry, 'reject')"
              >
                반려
              </UButton>
              <UButton
                icon="i-tabler-check"
                color="success"
                variant="soft"
                size="md"
                :loading="reviewingId === entry.id"
                :disabled="Boolean(reviewingId)"
                @click="review(entry, 'approve')"
              >
                승인
              </UButton>
            </div>
          </div>
        </div>
      </article>
    </div>

    <div
      v-if="!error && (data?.totalPages ?? 1) > 1"
      class="flex justify-center border-t border-default pt-5"
    >
      <UPagination
        v-model:page="page"
        :total="data?.total ?? 0"
        :items-per-page="data?.pageSize ?? 50"
        color="neutral"
      />
    </div>
  </section>
</template>
