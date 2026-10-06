<script setup lang="ts">
import type { ModDetailResponse } from '#shared/types/mod'
import { MOD_PLATFORM_ITEMS, formatModDate } from '~/utils/mod'

const props = defineProps<{ detail: ModDetailResponse, refreshing: boolean }>()
const emit = defineEmits<{ edit: [], refresh: [] }>()
const { loggedIn } = useUserSession()
const tab = ref('about')
const tabs = [
  { label: '소개', value: 'about', icon: 'i-tabler-info-circle' },
  { label: 'README', value: 'readme', icon: 'i-tabler-book' },
  { label: '다운로드', value: 'releases', icon: 'i-tabler-download' },
  { label: '커밋', value: 'commits', icon: 'i-tabler-git-commit' }
]
const mod = computed(() => props.detail.mod)
const github = computed(() => props.detail.github)
const latestRelease = computed(() => github.value?.releases.find(release => !release.prerelease && release.assets.length)
  ?? github.value?.releases.find(release => release.assets.length)
  ?? github.value?.releases[0])
const readmeBaseUrl = computed(() => github.value?.readme?.url)
const readmeImageBaseUrl = computed(() => {
  const snapshot = github.value
  if (!snapshot?.readme) return undefined
  const directory = snapshot.readme.path.split('/').slice(0, -1).map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${snapshot.repository}/${encodeURIComponent(snapshot.defaultBranch)}/${directory ? `${directory}/` : ''}`
})

watch(() => mod.value.id, () => {
  tab.value = 'about'
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-col gap-4 border border-default bg-muted p-5">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex min-w-0 flex-1 items-start gap-3">
          <div class="flex size-11 shrink-0 items-center justify-center border border-default bg-default">
            <UIcon name="i-tabler-package" class="size-6 text-muted" />
          </div>
          <div class="flex min-w-0 flex-col gap-1.5">
            <h2 class="wrap-break-word text-xl font-semibold">
              {{ mod.name }}
            </h2>
            <p class="wrap-break-word text-sm text-muted">
              {{ mod.summary || github?.description || '등록된 소개가 없습니다.' }}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            v-if="loggedIn && mod.canEdit"
            color="neutral"
            variant="soft"
            icon="i-tabler-pencil"
            @click="emit('edit')"
          >
            정보 수정
          </UButton>
          <UButton
            :to="`https://github.com/${mod.repository}`"
            target="_blank"
            rel="noopener noreferrer"
            color="neutral"
            variant="outline"
            icon="i-tabler-brand-github"
          >
            저장소
          </UButton>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <span v-for="platform in mod.platforms" :key="platform" class="inline-flex items-center gap-1.5"><UIcon :name="MOD_PLATFORM_ITEMS.find(item => item.value === platform)?.icon ?? 'i-tabler-device-desktop'" class="size-3.5" />{{ MOD_PLATFORM_ITEMS.find(item => item.value === platform)?.label }}</span>
        <span class="inline-flex items-center gap-1.5">등록자 <AppUserIdentity
          :handle="mod.authorHandle"
          :role="mod.authorRole"
          text-class="text-xs"
          icon-class="size-3.5"
        /></span>
        <UBadge
          v-if="github?.archived"
          color="warning"
          variant="soft"
          size="sm"
        >
          보관된 저장소
        </UBadge>
      </div>
    </header>

    <UAlert
      v-if="detail.githubError"
      color="warning"
      variant="soft"
      title="GitHub 정보를 불러오지 못했습니다."
      :description="detail.githubError"
    >
      <template #actions>
        <UButton
          color="warning"
          variant="outline"
          size="xs"
          :loading="refreshing"
          @click="emit('refresh')"
        >
          다시 시도
        </UButton>
      </template>
    </UAlert>
    <UAlert
      v-if="github?.warnings.length"
      color="warning"
      variant="soft"
      title="일부 GitHub 정보가 표시되지 않을 수 있습니다."
      :description="github.warnings.join(' ')"
    />

    <div class="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div class="flex min-w-0 flex-col gap-4">
        <div class="overflow-x-auto">
          <UTabs
            v-model="tab"
            :items="tabs"
            :content="false"
            color="neutral"
            size="sm"
            class="min-w-max"
            :ui="{ list: 'bg-elevated/50 p-1', trigger: 'px-3' }"
          />
        </div>

        <section v-if="tab === 'about'" aria-label="모드 소개" class="border border-default p-5">
          <ReleaseMarkdown v-if="mod.description" :source="mod.description" />
          <div v-else class="flex flex-col gap-3">
            <p class="text-sm leading-6 text-toned">
              {{ mod.summary || github?.description || '등록자가 추가한 상세정보가 없습니다.' }}
            </p>
            <p class="text-xs text-muted">
              README에서 모드의 설명을 확인하거나 다운로드 탭에서 버전별 파일을 받을 수 있습니다.
            </p>
            <div class="flex gap-2">
              <UButton
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-tabler-book"
                @click="tab = 'readme'"
              >
                README 보기
              </UButton>
              <UButton
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-tabler-download"
                @click="tab = 'releases'"
              >
                다운로드
              </UButton>
            </div>
          </div>
        </section>

        <section v-else-if="tab === 'readme'" aria-label="GitHub README" class="flex min-w-0 flex-col gap-4 border border-default p-5">
          <div class="flex items-center justify-between gap-2 border-b border-default pb-3">
            <h3 class="truncate text-sm font-medium">
              {{ github?.readme?.path || 'README' }}
            </h3>
            <UButton
              v-if="github?.readme"
              :to="github.readme.url"
              target="_blank"
              rel="noopener noreferrer"
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-tabler-external-link"
            >
              원문
            </UButton>
          </div>
          <ReleaseMarkdown
            v-if="github?.readme"
            :source="github.readme.content"
            :base-url="readmeBaseUrl"
            :image-base-url="readmeImageBaseUrl"
            empty-text="README가 비어 있습니다."
          />
          <p v-else class="text-sm text-muted">
            {{ detail.githubError ? 'GitHub 연결을 확인한 뒤 다시 시도해 주세요.' : '이 저장소에는 README가 없습니다.' }}
          </p>
        </section>

        <section v-else-if="tab === 'releases'" aria-label="버전별 다운로드">
          <ModReleases
            :key="mod.id"
            :mod-id="mod.id"
            :releases="github?.releases ?? []"
            :has-more="github?.hasMoreReleases ?? false"
          />
        </section>

        <section v-else aria-label="최근 커밋" class="border border-default">
          <div class="flex items-center justify-between gap-2 bg-muted p-4">
            <h3 class="text-sm font-semibold">
              최근 커밋 <span v-if="github" class="font-normal text-muted">· {{ github.defaultBranch }}</span>
            </h3>
            <UButton
              :to="`https://github.com/${mod.repository}/commits`"
              target="_blank"
              rel="noopener noreferrer"
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-tabler-external-link"
            >
              전체 보기
            </UButton>
          </div>
          <div v-if="github?.commits.length" class="divide-y divide-default border-t border-default">
            <a
              v-for="commit in github.commits"
              :key="commit.sha"
              :href="commit.url"
              target="_blank"
              rel="noopener noreferrer"
              class="flex min-w-0 items-start gap-3 p-4 hover:bg-muted"
            >
              <UIcon name="i-tabler-git-commit" class="mt-0.5 size-4 shrink-0 text-muted" />
              <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                <p class="wrap-break-word text-sm font-medium">{{ commit.message.split('\n')[0] }}</p>
                <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted"><code>{{ commit.sha.slice(0, 7) }}</code><span>{{ commit.author }}</span><time :datetime="commit.date">{{ formatModDate(commit.date) }}</time></p>
              </div>
              <UIcon name="i-tabler-external-link" class="size-3.5 shrink-0 text-dimmed" />
            </a>
          </div>
          <p v-else class="border-t border-default p-5 text-sm text-muted">
            표시할 커밋이 없습니다.
          </p>
        </section>
      </div>

      <aside class="flex flex-col gap-4 max-lg:row-start-1" aria-label="모드 정보">
        <div class="flex flex-col gap-3 border border-default bg-muted p-4">
          <div class="flex items-center gap-2 text-sm font-semibold">
            <UIcon name="i-tabler-package-import" class="size-4" />최신 다운로드
          </div>
          <template v-if="latestRelease">
            <div class="flex flex-wrap items-center gap-2">
              <span class="wrap-break-word text-lg font-semibold">{{ latestRelease.tagName }}</span><UBadge
                v-if="latestRelease.prerelease"
                color="warning"
                variant="soft"
                size="sm"
              >
                사전 릴리즈
              </UBadge>
            </div>
            <span class="text-xs text-muted">{{ formatModDate(latestRelease.publishedAt) }}</span>
            <UButton
              v-if="latestRelease.assets.length === 1"
              :to="latestRelease.assets[0]?.downloadUrl"
              target="_blank"
              rel="noopener noreferrer"
              color="neutral"
              icon="i-tabler-download"
              block
            >
              파일 다운로드
            </UButton>
            <UButton
              v-else
              color="neutral"
              icon="i-tabler-download"
              block
              @click="tab = 'releases'"
            >
              {{ latestRelease.assets.length ? '다운로드 파일 보기' : '릴리즈 보기' }}
            </UButton>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              @click="tab = 'releases'"
            >
              모든 버전 보기
            </UButton>
          </template>
          <p v-else class="text-xs leading-5 text-muted">
            {{ detail.githubError ? 'GitHub 정보를 불러오면 다운로드가 표시됩니다.' : '아직 공개된 릴리즈가 없습니다.' }}
          </p>
        </div>
        <div class="flex flex-col gap-3 border border-default p-4 text-xs">
          <p class="wrap-break-word font-medium text-default">
            {{ mod.repository }}
          </p>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-muted">
            <dt>등록일</dt><dd class="text-right">
              {{ formatModDate(mod.createdAt) }}
            </dd>
            <dt>정보 수정</dt><dd class="text-right">
              {{ formatModDate(mod.updatedAt) }}
            </dd>
            <template v-if="github">
              <dt>저장소 업데이트</dt><dd class="text-right">
                {{ formatModDate(github.pushedAt) }}
              </dd><dt>라이선스</dt><dd class="text-right">
                {{ github.license || '표시 없음' }}
              </dd><dt>별</dt><dd class="text-right">
                {{ github.stars.toLocaleString('ko-KR') }}
              </dd>
            </template>
          </dl>
          <div v-if="github" class="flex items-center justify-between gap-2 border-t border-default pt-2 text-dimmed">
            <span>GitHub 정보 · {{ formatModDate(github.fetchedAt) }}</span>
            <UTooltip text="GitHub 정보 다시 확인">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-tabler-refresh"
                aria-label="GitHub 정보 다시 확인"
                :loading="refreshing"
                @click="emit('refresh')"
              />
            </UTooltip>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
