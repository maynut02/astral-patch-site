<script setup lang="ts">
import {
  EDITOR_COMMENT_MAX_LENGTH as COMMENT_MAX_LENGTH,
  type EditorComment,
  type EditorCommentsResponse
} from '#shared/types/editor-comment'
import type { AstralEditorCommentCreatedMessage } from '#shared/types/websocket'
import { useEditorVisualViewportInset } from '~/composables/editor-visual-viewport'

type CommentScope = 'item' | 'all'
type CommentRequestStatus = 'idle' | 'pending' | 'success' | 'error'

const props = defineProps<{
  itemId: string | null
  itemKey: string
}>()

const emit = defineEmits<{
  navigateItem: [comment: EditorComment]
}>()

const COMMENT_BOTTOM_THRESHOLD = 72
const DAY_MS = 86_400_000

const scope = ref<CommentScope>('item')
const comments = ref<EditorComment[]>([])
const status = ref<CommentRequestStatus>('idle')
const nextCursor = ref<string | null>(null)
const loadingOlder = ref(false)
const sending = ref(false)
const composer = ref('')
const unseenCount = ref(0)
const listElement = ref<HTMLElement | null>(null)
const clock = ref(Date.now())
const requestId = ref(0)
const isComposerFocused = ref(false)
const { keyboardInset, updateKeyboardInset } = useEditorVisualViewportInset(isComposerFocused, {
  mediaQuery: '(max-width: 1023px)',
  onUpdate: () => {
    if (isNearBottom()) void nextTick(() => scrollToBottom())
  }
})
const { loggedIn } = useUserSession()
const { showToast, showLoginRequiredToast } = useAppToast()

let clockTimer: ReturnType<typeof setInterval> | undefined

const scopeTabs = [
  { label: '현재 항목', value: 'item' },
  { label: '전체', value: 'all' }
]

const queryKey = computed(() => scope.value === 'all'
  ? 'all'
  : `item:${props.itemId ?? ''}`)
const composerLength = computed(() => Array.from(composer.value).length)
const submitDisabled = computed(() => (
  !props.itemId
  || !composer.value.trim()
  || composerLength.value > COMMENT_MAX_LENGTH
  || sending.value
))

const timeOfDayFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
})

const dayPartFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric'
})

const fullDateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
})

function getSeoulDayValue(date: Date): number {
  const parts = dayPartFormatter.formatToParts(date)
  const year = Number(parts.find(part => part.type === 'year')?.value || 0)
  const month = Number(parts.find(part => part.type === 'month')?.value || 0)
  const day = Number(parts.find(part => part.type === 'day')?.value || 0)

  return Date.UTC(year, month - 1, day)
}

function formatCommentTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  const now = new Date(clock.value)
  const dayDifference = (getSeoulDayValue(now) - getSeoulDayValue(date)) / DAY_MS
  const time = timeOfDayFormatter.format(date)

  if (dayDifference === 0) {
    return `오늘 ${time}`
  }

  if (dayDifference === 1) {
    return `어제 ${time}`
  }

  if (dayDifference >= 2 && dayDifference < 7) {
    return `${dayDifference}일 전 ${time}`
  }

  return fullDateTimeFormatter.format(date)
}

function getCommentQuery(before?: string): Record<string, string> {
  const query: Record<string, string> = {}

  if (scope.value === 'item' && props.itemId) {
    query.itemId = props.itemId
  }

  if (before) {
    query.before = before
  }

  return query
}

function compareComments(left: EditorComment, right: EditorComment): number {
  const timeDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  return timeDifference || left.id.localeCompare(right.id)
}

function mergeComments(current: EditorComment[], incoming: EditorComment[]): EditorComment[] {
  const byId = new Map(current.map(comment => [comment.id, comment]))

  for (const comment of incoming) {
    byId.set(comment.id, comment)
  }

  return [...byId.values()].sort(compareComments)
}

function isNearBottom(): boolean {
  const element = listElement.value

  if (!element) {
    return true
  }

  return element.scrollHeight - element.scrollTop - element.clientHeight <= COMMENT_BOTTOM_THRESHOLD
}

function scrollToBottom(behavior: ScrollBehavior = 'auto'): void {
  const element = listElement.value

  if (!element) {
    return
  }

  element.scrollTo({
    top: element.scrollHeight,
    behavior
  })
  unseenCount.value = 0
}

function handleScroll(): void {
  if (isNearBottom()) {
    unseenCount.value = 0
  }
}

function handleComposerFocus(): void {
  isComposerFocused.value = true

  requestAnimationFrame(() => {
    updateKeyboardInset()
  })
}

function handleComposerBlur(): void {
  isComposerFocused.value = false
  keyboardInset.value = 0
}

function isVisibleInCurrentScope(comment: EditorComment): boolean {
  return scope.value === 'all' || comment.unitId === props.itemId
}

function insertIncomingComment(comment: EditorComment, forceScroll = false): void {
  if (!isVisibleInCurrentScope(comment)) {
    return
  }

  const alreadyExists = comments.value.some(entry => entry.id === comment.id)

  if (!alreadyExists) {
    const shouldStickToBottom = forceScroll || isNearBottom()
    comments.value = mergeComments(comments.value, [comment])

    if (shouldStickToBottom) {
      void nextTick(() => scrollToBottom())
    } else {
      unseenCount.value += 1
    }
    return
  }

  if (forceScroll) {
    void nextTick(() => scrollToBottom())
  }
}

async function loadInitialComments(): Promise<void> {
  const currentRequestId = ++requestId.value

  if (scope.value === 'item' && !props.itemId) {
    comments.value = []
    nextCursor.value = null
    unseenCount.value = 0
    status.value = 'idle'
    return
  }

  status.value = 'pending'
  unseenCount.value = 0

  try {
    const response = await $fetch<EditorCommentsResponse>('/api/editor/comments', {
      query: getCommentQuery()
    })

    if (currentRequestId !== requestId.value) {
      return
    }

    comments.value = response.comments
    nextCursor.value = response.nextCursor
    status.value = 'success'
    await nextTick()
    scrollToBottom()
  } catch {
    if (currentRequestId !== requestId.value) {
      return
    }

    comments.value = []
    nextCursor.value = null
    status.value = 'error'
  }
}

async function loadOlderComments(): Promise<void> {
  if (!nextCursor.value || loadingOlder.value) {
    return
  }

  const element = listElement.value
  const previousScrollHeight = element?.scrollHeight ?? 0
  const previousScrollTop = element?.scrollTop ?? 0
  const cursor = nextCursor.value
  loadingOlder.value = true

  try {
    const response = await $fetch<EditorCommentsResponse>('/api/editor/comments', {
      query: getCommentQuery(cursor)
    })

    comments.value = mergeComments(response.comments, comments.value)
    nextCursor.value = response.nextCursor
    await nextTick()

    if (element) {
      element.scrollTop = element.scrollHeight - previousScrollHeight + previousScrollTop
    }
  } catch {
    showToast({
      id: 'editor-comments-load-older-error',
      title: '이전 코멘트를 불러오지 못했습니다.'
    })
  } finally {
    loadingOlder.value = false
  }
}

async function syncLatestComments(): Promise<void> {
  if (scope.value === 'item' && !props.itemId) {
    return
  }

  try {
    const response = await $fetch<EditorCommentsResponse>('/api/editor/comments', {
      query: getCommentQuery()
    })
    const knownIds = new Set(comments.value.map(comment => comment.id))
    const incoming = response.comments.filter(comment => !knownIds.has(comment.id))

    for (const comment of incoming) {
      insertIncomingComment(comment)
    }
  } catch {
    // 재연결 동기화 실패는 다음 웹소켓 이벤트 또는 수동 조회에서 복구한다.
  }
}

async function submitComment(): Promise<void> {
  if (!props.itemId || sending.value) {
    return
  }

  if (!loggedIn.value) {
    showLoginRequiredToast('editor-comment-login-required')
    return
  }

  const body = composer.value.trim()

  if (!body || Array.from(body).length > COMMENT_MAX_LENGTH) {
    return
  }

  sending.value = true

  try {
    const comment = await $fetch<EditorComment>('/api/editor/comments', {
      method: 'POST',
      body: {
        unitId: props.itemId,
        body
      }
    })

    composer.value = ''
    insertIncomingComment(comment, true)
  } catch {
    showToast({
      id: 'editor-comment-create-error',
      title: '코멘트를 등록하지 못했습니다.',
      description: '잠시 후 다시 시도해 주세요.'
    })
  } finally {
    sending.value = false
  }
}

const {
  onMessage: onWsMessage,
  onReconnect: onWsReconnect
} = useAstralWebSocket({
  topics: ['editor:comment']
})

onWsMessage('EDITOR_COMMENT_CREATED', (message) => {
  const comment = (message as AstralEditorCommentCreatedMessage).comment

  if (!comment || typeof comment.id !== 'string' || typeof comment.unitId !== 'string') {
    return
  }

  insertIncomingComment(comment)
})

onWsReconnect(() => {
  void syncLatestComments()
})

watch(queryKey, () => {
  void loadInitialComments()
}, { immediate: true })

onMounted(() => {
  clockTimer = setInterval(() => {
    clock.value = Date.now()
  }, 60_000)
})

onBeforeUnmount(() => {
  if (clockTimer) {
    clearInterval(clockTimer)
  }
})
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col"
    :style="keyboardInset ? { paddingBottom: `${keyboardInset}px` } : undefined"
  >
    <div class="shrink-0 border-b border-default p-3">
      <UTabs
        v-model="scope"
        :items="scopeTabs"
        :content="false"
        color="neutral"
        size="sm"
        :ui="{ trigger: 'h-7 leading-4 px-3', list: 'h-9 bg-elevated/50 p-1' }"
        class="w-fit"
      />
    </div>

    <div class="relative min-h-0 flex-1">
      <div
        ref="listElement"
        class="editor-scrollbar h-full overflow-y-auto overscroll-contain"
        @scroll="handleScroll"
      >
        <div
          v-if="scope === 'item' && !itemId"
          class="flex h-full items-center justify-center p-5 text-center text-sm text-muted"
        >
          <div>
            <UIcon
              name="i-tabler-click"
              class="mx-auto size-6 text-dimmed"
            />
            <p class="mt-2">
              코멘트를 확인할 항목을 선택하세요.
            </p>
          </div>
        </div>

        <div
          v-else-if="status === 'pending'"
          class="flex h-full items-center justify-center p-5 text-muted"
        >
          <AppLoadingSpinner />
        </div>

        <div
          v-else-if="status === 'error'"
          class="p-3"
        >
          <UAlert
            color="error"
            variant="soft"
            title="코멘트를 불러오지 못했습니다."
            description="잠시 후 다시 시도해 주세요."
          />
        </div>

        <div
          v-else
          class="flex min-h-full flex-col justify-end py-2"
        >
          <div
            v-if="nextCursor"
            class="flex justify-center px-3 pb-2"
          >
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-tabler-chevron-up"
              :loading="loadingOlder"
              @click="loadOlderComments"
            >
              이전 코멘트 불러오기
            </UButton>
          </div>

          <div
            v-if="!comments.length"
            class="flex flex-1 items-center justify-center p-5 text-center text-sm text-muted"
          >
            아직 등록된 코멘트가 없습니다.
          </div>

          <article
            v-for="comment in comments"
            :key="comment.id"
            class="px-4 py-2.5 transition-colors hover:bg-elevated/40"
          >
            <div class="flex min-w-0 items-center gap-2 text-xs">
              <button
                type="button"
                class="min-w-0 flex-1 truncate text-left font-mono text-dimmed transition-colors hover:text-default hover:underline focus-visible:text-default focus-visible:underline focus-visible:outline-none"
                :title="comment.itemKey"
                @click="emit('navigateItem', comment)"
              >
                {{ comment.itemKey }}
              </button>
              <AppUserIdentity
                :handle="comment.authorHandle"
                :role="comment.authorRole"
                text-class="text-xs text-muted"
                icon-class="size-3.5"
                stop-propagation
              />
            </div>
            <p class="mt-1 whitespace-pre-wrap wrap-break-word text-sm leading-5 text-toned">
              {{ comment.body }}
            </p>
            <time
              class="mt-1 block text-[11px] text-dimmed"
              :datetime="comment.createdAt"
            >
              {{ formatCommentTime(comment.createdAt) }}
            </time>
          </article>
        </div>
      </div>

      <UButton
        v-if="unseenCount > 0"
        color="neutral"
        variant="solid"
        size="xs"
        icon="i-tabler-arrow-down"
        class="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-sm"
        @click="scrollToBottom('smooth')"
      >
        새 코멘트 {{ unseenCount }}개
      </UButton>
    </div>

    <form
      class="shrink-0 border-t border-default p-3"
      @submit.prevent="submitComment"
    >
      <div class="flex items-end gap-2">
        <UTextarea
          v-model="composer"
          color="neutral"
          variant="soft"
          autoresize
          :rows="1"
          :maxrows="5"
          :maxlength="COMMENT_MAX_LENGTH"
          :readonly="!loggedIn"
          :disabled="!itemId || sending"
          :placeholder="itemId ? '코멘트를 입력하세요.' : '코멘트를 작성할 항목을 선택하세요.'"
          :ui="{ base: 'min-h-9 max-h-32 py-2 text-sm' }"
          class="min-w-0 flex-1"
          @click="!loggedIn && showLoginRequiredToast('editor-comment-input-login-required')"
          @focus="handleComposerFocus"
          @blur="handleComposerBlur"
          @keydown.enter.exact.prevent="submitComment"
        />
        <UButton
          type="submit"
          color="neutral"
          variant="solid"
          size="lg"
          icon="i-tabler-send-2"
          aria-label="코멘트 보내기"
          :loading="sending"
          :disabled="submitDisabled"
        />
      </div>
      <div class="mt-1 flex items-center gap-2 text-[11px] text-dimmed">
        <span class="min-w-0 flex-1 truncate">
          {{ itemKey || '선택된 항목 없음' }}
        </span>
        <span :class="composerLength > COMMENT_MAX_LENGTH ? 'text-error' : ''">
          {{ composerLength.toLocaleString('ko-KR') }} / {{ COMMENT_MAX_LENGTH.toLocaleString('ko-KR') }}
        </span>
      </div>
    </form>
  </div>
</template>
