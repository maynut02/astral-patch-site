<script setup lang="ts">
import type { Notice, NoticesResponse } from '#shared/types/notice'

useAstralPageSeo('공지사항')

const NOTICE_TITLE_MAX_LENGTH = 160
const NOTICE_BODY_MAX_LENGTH = 10_000

const { user } = useUserSession()
const { showToast } = useAppToast()
const title = ref('')
const body = ref('')
const submitting = ref(false)

const isAdmin = computed(() => user.value?.role === 'admin')
const titleLength = computed(() => Array.from(title.value).length)
const bodyLength = computed(() => Array.from(body.value).length)
const submitDisabled = computed(() => (
  !title.value.trim()
  || !body.value.trim()
  || titleLength.value > NOTICE_TITLE_MAX_LENGTH
  || bodyLength.value > NOTICE_BODY_MAX_LENGTH
  || submitting.value
))

const defaultNotices: NoticesResponse = { notices: [] }
const {
  data: noticesData,
  status: noticesStatus
} = await useFetch<NoticesResponse>('/api/notices', {
  default: () => defaultNotices
})

const notices = computed(() => noticesData.value?.notices ?? [])

const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
})

function formatNoticeTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date)
}

async function submitNotice(): Promise<void> {
  if (!isAdmin.value || submitDisabled.value) {
    return
  }

  submitting.value = true

  try {
    const notice = await $fetch<Notice>('/api/notices', {
      method: 'POST',
      body: {
        title: title.value,
        body: body.value
      }
    })

    noticesData.value = {
      notices: [notice, ...notices.value.filter(item => item.id !== notice.id)]
    }
    title.value = ''
    body.value = ''
    showToast({
      id: `notice-created-${notice.id}`,
      title: '공지사항을 등록했습니다.'
    })
  } catch {
    showToast({
      id: 'notice-create-failed',
      title: '공지사항을 등록하지 못했습니다.',
      description: '잠시 후 다시 시도해 주세요.'
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex h-full w-full max-w-7xl flex-col gap-5">
    <header class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <UIcon
          name="i-tabler-speakerphone"
          class="size-5"
        />
        <h1 class="-mt-0.75 text-xl font-semibold">
          공지사항
        </h1>
      </div>
    </header>

    <form
      v-if="isAdmin"
      class="flex flex-col border border-default"
      @submit.prevent="submitNotice"
    >
      <div class="flex items-center gap-2 border-b border-default bg-muted px-4 py-3">
        <UIcon
          name="i-tabler-pencil-plus"
          class="size-5 text-muted"
        />
        <h2 class="text-sm font-semibold text-default">
          공지 작성
        </h2>
      </div>

      <div class="flex flex-col gap-3 p-4">
        <UInput
          v-model="title"
          color="neutral"
          variant="soft"
          placeholder="제목"
          :maxlength="NOTICE_TITLE_MAX_LENGTH"
        />

        <UTextarea
          v-model="body"
          color="neutral"
          variant="soft"
          autoresize
          :rows="6"
          :maxrows="16"
          :maxlength="NOTICE_BODY_MAX_LENGTH"
          placeholder="공지 내용을 입력하세요."
        />

        <div class="flex items-center justify-between gap-3">
          <span class="text-xs text-dimmed">
            {{ bodyLength.toLocaleString('ko-KR') }} / {{ NOTICE_BODY_MAX_LENGTH.toLocaleString('ko-KR') }}
          </span>
          <UButton
            type="submit"
            color="neutral"
            icon="i-tabler-speakerphone"
            :loading="submitting"
            :disabled="submitDisabled"
          >
            등록
          </UButton>
        </div>
      </div>
    </form>

    <div
      v-if="noticesStatus === 'pending' && !notices.length"
      class="flex min-h-40 items-center justify-center text-muted"
    >
      <AppLoadingSpinner />
    </div>

    <UAlert
      v-else-if="noticesStatus === 'error' && !notices.length"
      color="error"
      variant="soft"
      title="공지사항을 불러오지 못했습니다."
      description="잠시 후 다시 시도해 주세요."
    />

    <div
      v-else-if="!notices.length"
      class="flex min-h-40 flex-col items-center justify-center gap-2 border border-default bg-elevated/30 p-6 text-center text-muted"
    >
      <UIcon
        name="i-tabler-speakerphone"
        class="size-7 text-dimmed"
      />
      <p class="text-sm">
        등록된 공지사항이 없습니다.
      </p>
    </div>

    <section
      v-else
      class="flex flex-col gap-5"
      aria-label="공지사항 목록"
    >
      <UCollapsible
        v-for="notice in notices"
        :key="notice.id"
        as="article"
        class="border border-default bg-muted"
      >
        <template #default="{ open }">
          <button
            type="button"
            class="group flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-elevated/60"
          >
            <div class="flex min-w-0 flex-1 flex-col gap-2">
              <h2 class="wrap-break-word text-base font-semibold text-default">
                {{ notice.title }}
              </h2>
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dimmed">
                <AppUserIdentity
                  :handle="notice.authorHandle"
                  :role="notice.authorRole"
                  :link="false"
                  text-class="text-xs text-muted"
                  icon-class="size-3.5"
                />
                <span aria-hidden="true">·</span>
                <time :datetime="notice.createdAt">
                  {{ formatNoticeTime(notice.createdAt) }}
                </time>
              </div>
            </div>

            <UIcon
              name="i-tabler-chevron-down"
              class="size-5 shrink-0 text-muted transition-transform duration-200 group-hover:text-default"
              :class="open ? 'rotate-180' : ''"
            />
          </button>
        </template>

        <template #content>
          <p class="whitespace-pre-wrap wrap-break-word border-t border-default bg-default/75 p-4 text-sm leading-6 text-toned">
            {{ notice.body }}
          </p>
        </template>
      </UCollapsible>
    </section>
  </div>
</template>
