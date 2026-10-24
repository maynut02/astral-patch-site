<script setup lang="ts">
import type { ModEntry, ModListEntry, ModListResponse } from '#shared/types/mod'
import { MOD_PLATFORM_ITEMS, formatModDate, getModPlatformIcon, getModPlatformLabel } from '~/utils/mod'

useAstralPageSeo('모드 허브')

const router = useRouter()
const { loggedIn } = useUserSession()
const { showToast } = useAppToast()
const search = ref('')
const platform = ref('all')
const onlyMine = ref(false)
const sort = ref('created')
const editorOpen = ref(false)
const sessionKey = useSessionKey()
const registrationSession = ref('')
const platformItems = [{ label: '모든 플랫폼', value: 'all' }, ...MOD_PLATFORM_ITEMS]
const sortItems = [
  { label: '최근 등록', value: 'created' },
  { label: '최근 수정', value: 'updated' },
  { label: '이름순', value: 'name' }
]

const { data, status, error, refresh } = await useFetch<ModListResponse>('/api/mods', {
  key: 'mod-hub-list',
  default: () => ({ mods: [] })
})
const mods = computed(() => data.value?.mods ?? [])
const filteredMods = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('ko-KR')
  return mods.value.filter(mod => (
    (!query || [mod.name, mod.githubDescription, mod.repository, mod.authorHandle ?? ''].some(value => value.toLocaleLowerCase('ko-KR').includes(query)))
    && (platform.value === 'all' || mod.platforms.some(value => value === platform.value))
    && (!onlyMine.value || (loggedIn.value && mod.isOwner))
  )).sort((left, right) => {
    if (sort.value === 'name') return left.name.localeCompare(right.name, 'ko-KR')
    const dateKey = sort.value === 'created' ? 'createdAt' : 'updatedAt'
    return Date.parse(right[dateKey]) - Date.parse(left[dateKey])
  })
})

function openEditor(): void {
  if (!loggedIn.value) return
  registrationSession.value = sessionKey.value
  editorOpen.value = true
}

async function handleSaved(mod: ModEntry): Promise<void> {
  if (!loggedIn.value || registrationSession.value !== sessionKey.value) return
  registrationSession.value = ''
  const existing = mods.value.find(entry => entry.id === mod.id && entry.repository === mod.repository)
  const entry: ModListEntry = { ...mod, githubDescription: existing?.githubDescription ?? '' }
  data.value = { mods: [entry, ...mods.value.filter(item => item.id !== mod.id)] }
  showToast({ id: `mod-saved-${mod.id}`, title: '모드를 등록했습니다.' })
  await router.push(`/mod/${mod.id}`)
}

watch(sessionKey, async () => {
  onlyMine.value = false
  editorOpen.value = false
  registrationSession.value = ''
  await refresh()
}, { flush: 'sync' })
</script>

<template>
  <div class="mx-auto flex h-full w-full max-w-7xl flex-col gap-5 pb-5">
    <header class="flex items-center gap-2">
      <UIcon name="i-tabler-package" class="size-5" />
      <h1 class="-mt-0.75 text-xl font-semibold">
        모드 허브
      </h1>
    </header>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex w-full min-w-0 flex-wrap items-center gap-3 lg:w-auto lg:flex-1 lg:flex-nowrap">
        <UInput
          v-model="search"
          icon="i-tabler-search"
          placeholder="모드 이름, 소개, 저장소 검색"
          aria-label="모드 검색"
          color="neutral"
          variant="soft"
          size="lg"
          class="w-full sm:w-64 lg:min-w-40 lg:max-w-80 lg:flex-1"
        />
        <USelect
          v-model="platform"
          :items="platformItems"
          aria-label="지원 플랫폼"
          color="neutral"
          variant="soft"
          size="lg"
          class="w-36 shrink-0"
        />
      </div>
      <div class="ml-auto flex shrink-0 items-center gap-3">
        <ClientOnly>
          <USwitch
            v-if="loggedIn"
            v-model="onlyMine"
            label="내 모드"
            color="neutral"
            class="whitespace-nowrap"
          />
          <template #fallback />
        </ClientOnly>
        <USelect
          v-model="sort"
          :items="sortItems"
          aria-label="모드 정렬"
          color="neutral"
          variant="soft"
          size="lg"
          class="w-36 shrink-0"
        />
      </div>
    </div>
    <p class="text-xs text-muted">
      총 {{ filteredMods.length.toLocaleString('ko-KR') }}개 모드
    </p>

    <section aria-label="모드 목록" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <template v-if="status === 'pending' && !mods.length">
        <div v-for="index in 6" :key="index" class="flex flex-col gap-4 border border-default bg-muted p-5">
          <USkeleton class="size-10" /><USkeleton class="h-5 w-40" /><USkeleton class="h-4 w-full" /><USkeleton class="h-4 w-2/3" />
        </div>
      </template>
      <UAlert
        v-else-if="error"
        color="error"
        variant="soft"
        title="모드 목록을 불러오지 못했습니다."
        description="잠시 후 다시 시도해 주세요."
        :class="loggedIn ? 'xl:col-span-2' : 'col-span-full'"
      >
        <template #actions>
          <UButton
            color="error"
            variant="outline"
            size="xs"
            @click="refresh()"
          >
            다시 시도
          </UButton>
        </template>
      </UAlert>
      <div
        v-else-if="!filteredMods.length"
        class="flex min-h-60 flex-col items-center justify-center gap-3 p-8 text-center col-span-full"
      >
        <UIcon :name="mods.length ? 'i-tabler-search-off' : 'i-tabler-package'" class="size-9 text-dimmed" />
        <p class="text-base font-semibold">
          {{ mods.length ? '조건에 맞는 모드가 없습니다.' : loggedIn ? '첫 번째 모드를 등록해 보세요.' : '등록된 모드가 없습니다.' }}
        </p>
        <p class="max-w-md text-sm leading-6 text-muted">
          {{ mods.length ? '검색어나 플랫폼 조건을 바꿔 보세요.' : 'GitHub 저장소를 연결하면 README, 최근 커밋, 버전별 다운로드를 한곳에서 볼 수 있습니다.' }}
        </p>
        <UButton
          v-if="mods.length"
          color="neutral"
          variant="soft"
          @click="search = ''; platform = 'all'; onlyMine = false"
        >
          필터 초기화
        </UButton>
      </div>
      <template v-else>
        <ClientOnly>
          <article v-if="loggedIn" class="mod-card group relative min-w-0 bg-accented">
            <button
              type="button"
              class="mod-card-surface relative flex h-full min-h-40 w-full flex-col items-center justify-center gap-3 border border-default bg-muted p-5 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              @click="openEditor()"
            >
              <UIcon name="i-tabler-plus" class="size-8 text-info" />
              <span class="text-base font-semibold">모드 등록</span>
              <span class="max-w-xs text-sm leading-5 text-muted">GitHub 저장소를 연결해 새 모드를 등록하세요.</span>
            </button>
          </article>
          <template #fallback />
        </ClientOnly>
        <article v-for="mod in filteredMods" :key="mod.id" class="mod-card group relative min-w-0 bg-accented">
          <div class="mod-card-surface relative flex h-full flex-col border border-default bg-muted">
            <NuxtLink :to="`/mod/${mod.id}`" class="flex flex-1 flex-col gap-4 p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              <div class="flex flex-wrap items-center gap-2">
                <UTooltip v-for="item in mod.platforms" :key="item" :text="getModPlatformLabel(item)">
                  <UIcon
                    :name="getModPlatformIcon(item)"
                    role="img"
                    :aria-label="getModPlatformLabel(item)"
                    class="size-5 text-muted"
                  />
                </UTooltip>
              </div>
              <div class="flex flex-col gap-1">
                <h2 class="wrap-break-word text-base font-semibold group-hover:underline underline-offset-4">{{ mod.name }}</h2>
                <p class="line-clamp-2 min-h-10 wrap-break-word text-sm leading-5 text-muted">{{ mod.githubDescription || '설명 없음' }}</p>
              </div>
              <span class="inline-flex min-w-0 items-center gap-1.5 text-xs text-dimmed"><UIcon name="i-tabler-brand-github" class="size-3.5 shrink-0" /><span class="truncate">{{ mod.repository }}</span></span>
            </NuxtLink>
            <div class="flex items-center justify-between gap-3 border-t border-default px-5 py-3">
              <AppUserIdentity
                :handle="mod.authorHandle"
                :role="mod.authorRole"
                text-class="text-xs text-muted"
                icon-class="size-3.5"
              />
              <time
                :datetime="sort === 'updated' ? mod.updatedAt : mod.createdAt"
                :title="sort === 'updated' ? '최근 수정일' : '등록일'"
                class="text-[11px] text-dimmed"
              >{{ formatModDate(sort === 'updated' ? mod.updatedAt : mod.createdAt) }}</time>
            </div>
          </div>
        </article>
      </template>
    </section>
    <ModEditor
      v-if="loggedIn"
      :key="sessionKey"
      v-model:open="editorOpen"
      @saved="handleSaved"
    />
  </div>
</template>

<style scoped>
.mod-card-surface {
  transition: transform 180ms ease-out, border-color 180ms ease-out;
}

.mod-card:focus-within > .mod-card-surface {
  transform: translate(4px, -4px);
  border-color: var(--ui-border-accented);
}

@media (hover: hover) and (pointer: fine) {
  .mod-card:hover > .mod-card-surface {
    transform: translate(4px, -4px);
    border-color: var(--ui-border-accented);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mod-card-surface {
    transition: none;
  }

  .mod-card:hover > .mod-card-surface,
  .mod-card:focus-within > .mod-card-surface {
    transform: none;
  }
}
</style>
