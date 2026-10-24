<script setup lang="ts">
import type { ModDetailResponse } from '#shared/types/mod'
import { formatModDate, getModPlatformIcon, getModPlatformLabel } from '~/utils/mod'

const props = withDefaults(defineProps<{ detail: ModDetailResponse, refreshing: boolean, managementEnabled?: boolean }>(), {
  managementEnabled: true
})
const emit = defineEmits<{ edit: [], delete: [], refresh: [] }>()
const { loggedIn } = useUserSession()
const tab = ref('readme')
const tabs = [
  { label: '소개', value: 'readme', icon: 'i-tabler-book' },
  { label: '커밋', value: 'commits', icon: 'i-tabler-git-commit' },
  { label: '다운로드', value: 'releases', icon: 'i-tabler-download' }
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
  tab.value = 'readme'
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <header class="flex flex-col gap-4">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 class="wrap-break-word text-xl font-semibold">
            {{ mod.name }}
          </h1>
          <p v-if="github?.description" class="wrap-break-word whitespace-pre-line text-sm text-muted">
            {{ github.description }}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            v-if="loggedIn && managementEnabled && mod.canEdit"
            color="neutral"
            variant="ghost"
            icon="i-tabler-pencil"
            @click="emit('edit')"
          >
            정보 수정
          </UButton>
          <UButton
            v-if="loggedIn && managementEnabled && mod.canDelete"
            color="error"
            variant="ghost"
            icon="i-tabler-trash"
            @click="emit('delete')"
          >
            삭제
          </UButton>
          <UButton
            :to="`https://github.com/${mod.repository}`"
            target="_blank"
            rel="noopener noreferrer"
            color="neutral"
            variant="outline"
            icon="i-tabler-brand-github"
          >
            GitHub
          </UButton>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
        <span v-for="platform in mod.platforms" :key="platform" class="inline-flex items-center gap-1 text-xs text-muted">
          <UIcon :name="getModPlatformIcon(platform)" class="size-4" />
          {{ getModPlatformLabel(platform, '') }}
        </span>
        <span class="inline-flex items-center gap-1">
          <UTooltip text="등록자">
            <UIcon
              name="i-tabler-user"
              role="img"
              aria-label="등록자"
              class="size-4 shrink-0"
            />
          </UTooltip>
          <AppUserIdentity
            :handle="mod.authorHandle"
            :role="mod.authorRole"
            text-class="text-xs"
            icon-class="size-4"
          />
        </span>
        <UBadge
          v-if="github?.archived"
          color="warning"
          variant="soft"
          size="sm"
        >
          보관됨
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

    <div class="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div class="flex min-w-0 flex-col gap-4">
        <UTabs
          v-model="tab"
          :items="tabs"
          :content="false"
          color="neutral"
          size="md"
          variant="link"
          :ui="{ leadingIcon: 'size-4' }"
          class="sticky z-1 top-14 md:top-0 bg-default -mx-2"
        />

        <section v-if="tab === 'readme'" aria-label="모드 소개" class="flex min-w-0 flex-col gap-4">
          <ReleaseMarkdown
            v-if="github?.readme"
            :source="github.readme.content"
            :base-url="readmeBaseUrl"
            :image-base-url="readmeImageBaseUrl"
            empty-text="README가 비어 있습니다."
          />
          <p v-else class="text-sm text-muted">
            {{ detail.githubError ? 'GitHub 연결을 확인한 뒤 다시 시도해 주세요.' : 'GitHub에 README가 등록되어 있지 않습니다.' }}
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

        <section v-else aria-label="커밋">
          <ModCommits
            :mod-id="mod.id"
            :repository="mod.repository"
            :default-branch="github?.defaultBranch ?? ''"
            :branches="github?.branches ?? []"
            :commits="github?.commits ?? []"
          />
        </section>
      </div>

      <aside class="flex flex-col gap-4 max-lg:row-start-1" aria-label="모드 정보">
        <div class="flex flex-col gap-3 border border-default p-4">
          <div class="flex items-center gap-2 text-sm font-semibold">
            <UIcon name="i-tabler-package-import" class="size-4" />최신 버전
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
              color="info"
              variant="soft"
              icon="i-tabler-download"
              block
              @click="tab = 'releases'"
            >
              {{ latestRelease.assets.length ? '다운로드 파일 보기' : '릴리즈 보기' }}
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
            <dt>등록</dt><dd class="text-right">
              {{ formatModDate(mod.createdAt) }}
            </dd>
            <dt>수정</dt><dd class="text-right">
              {{ formatModDate(mod.updatedAt) }}
            </dd>
            <template v-if="github">
              <dt>업데이트</dt><dd class="text-right">
                {{ formatModDate(github.pushedAt) }}
              </dd><dt>라이선스</dt><dd class="text-right">
                {{ github.license || '표시 없음' }}
              </dd><dt>스타</dt><dd class="text-right">
                {{ github.stars.toLocaleString('ko-KR') }}
              </dd>
            </template>
          </dl>
          <div v-if="github" class="flex items-center justify-between gap-2 border-t border-default pt-2 text-dimmed">
            <span>{{ formatModDate(github.fetchedAt) }} 기준</span>
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
