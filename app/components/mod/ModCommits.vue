<script setup lang="ts">
import type { ModCommit, ModCommitResponse } from '#shared/types/mod'
import { formatModDate } from '~/utils/mod'

const props = defineProps<{
  modId: string
  repository: string
  defaultBranch: string
  branches: string[]
  commits: ModCommit[]
}>()
const availableBranches = computed(() => [...new Set([props.defaultBranch, ...props.branches].filter(Boolean))])
const selectedBranch = ref(props.defaultBranch)
const entries = ref<ModCommit[]>([])
const loading = ref(false)
const error = ref('')
const allCommitsUrl = computed(() => `https://github.com/${props.repository}/commits${selectedBranch.value ? `/${encodeURIComponent(selectedBranch.value)}/` : ''}`)
const branchCache = new Map<string, ModCommit[]>()
let updatingSnapshot = false
let requestId = 0
let activeController: AbortController | null = null

function cancelRequest(): void {
  requestId++
  activeController?.abort()
  activeController = null
}

async function loadBranch(branch: string, retry = false): Promise<void> {
  cancelRequest()
  entries.value = []
  error.value = ''
  loading.value = false
  if (!branch) return

  const cached = branchCache.get(branch)
  if (cached && !retry) {
    entries.value = cached
    return
  }

  const currentRequest = requestId
  const controller = new AbortController()
  activeController = controller
  loading.value = true
  try {
    const result = await $fetch<ModCommitResponse>(`/api/mods/${props.modId}/commits`, {
      query: { branch },
      signal: controller.signal
    })
    if (currentRequest !== requestId) return
    if (result.branch !== branch) throw new Error('Unexpected commit branch')
    branchCache.set(branch, result.commits)
    entries.value = result.commits
  } catch {
    if (currentRequest === requestId) error.value = '선택한 브랜치의 커밋을 불러오지 못했습니다.'
  } finally {
    if (currentRequest === requestId) {
      loading.value = false
      activeController = null
    }
  }
}

watch(() => [props.modId, props.repository, props.defaultBranch, props.branches, props.commits] as const, (snapshot, previous) => {
  const sameRepository = previous && snapshot[0] === previous[0] && snapshot[1] === previous[1]
  const branch = sameRepository && availableBranches.value.includes(selectedBranch.value)
    ? selectedBranch.value
    : availableBranches.value[0] ?? ''
  cancelRequest()
  branchCache.clear()
  if (props.defaultBranch) branchCache.set(props.defaultBranch, props.commits)
  updatingSnapshot = true
  selectedBranch.value = branch
  updatingSnapshot = false
  void loadBranch(branch)
}, { immediate: true })

watch(selectedBranch, (branch) => {
  if (!updatingSnapshot) void loadBranch(branch)
}, { flush: 'sync' })

onScopeDispose(cancelRequest)
</script>

<template>
  <div class="border-b border-default" :aria-busy="loading">
    <div class="flex items-center justify-between gap-2 py-2">
      <USelect
        v-if="availableBranches.length > 1"
        v-model="selectedBranch"
        :items="availableBranches"
        aria-label="커밋 브랜치 선택"
        icon="i-tabler-git-branch"
        color="neutral"
        variant="ghost"
        size="xs"
        class="min-w-0 max-w-[min(16rem,60%)]"
      />
      <span v-else class="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted">
        <UIcon v-if="selectedBranch" name="i-tabler-git-branch" class="size-4 shrink-0" />
        <span class="truncate">{{ selectedBranch }}</span>
      </span>
      <UButton
        :to="allCommitsUrl"
        target="_blank"
        rel="noopener noreferrer"
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-tabler-external-link"
        class="shrink-0"
      >
        전체 보기
      </UButton>
    </div>
    <p v-if="loading" role="status" class="flex items-center gap-2 border-t border-default p-5 text-sm text-muted">
      <UIcon name="i-tabler-loader-2" class="size-4 animate-spin" />
      커밋을 불러오는 중입니다.
    </p>
    <div v-else-if="error" class="flex flex-wrap items-center justify-between gap-3 border-t border-default p-5">
      <p role="alert" class="text-sm text-error">
        {{ error }}
      </p>
      <UButton
        color="neutral"
        variant="soft"
        size="xs"
        icon="i-tabler-refresh"
        @click="loadBranch(selectedBranch, true)"
      >
        다시 시도
      </UButton>
    </div>
    <div v-else-if="entries.length" class="divide-y divide-default border-t border-default">
      <a
        v-for="commit in entries"
        :key="commit.sha"
        :href="commit.url"
        target="_blank"
        rel="noopener noreferrer"
        class="flex min-w-0 items-start gap-3 p-4 hover:bg-muted relative"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <p class="wrap-break-word text-sm font-medium">{{ commit.message.split('\n')[0] }}</p>
          <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>{{ commit.author }}</span>
            <span>·</span>
            <time :datetime="commit.date">{{ formatModDate(commit.date) }}</time>
            <code class="ml-auto">{{ commit.sha.slice(0, 7) }}</code>
          </p>
        </div>
        <UIcon name="i-tabler-external-link" class="size-3.5 shrink-0 text-dimmed absolute right-4 top-4" />
      </a>
    </div>
    <p v-else class="border-t border-default p-5 text-sm text-muted">
      표시할 커밋이 없습니다.
    </p>
  </div>
</template>
