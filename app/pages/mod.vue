<script setup lang="ts">
import type { ModDetailResponse, ModEntry, ModListResponse } from '#shared/types/mod'
import { MOD_PLATFORM_ITEMS, formatModDate, getModPlatformLabel } from '~/utils/mod'

useAstralPageSeo('모드 허브')

const route = useRoute()
const router = useRouter()
const { loggedIn, user } = useUserSession()
const { showToast } = useAppToast()
const requestFetch = useRequestFetch()
const search = ref('')
const platform = ref('all')
const onlyMine = ref(false)
const sort = ref('updated')
const editorOpen = ref(false)
const editingMod = ref<ModEntry | null>(null)
const selectedId = computed(() => typeof route.query.mod === 'string' ? route.query.mod : '')
const platformItems = [{ label: '모든 플랫폼', value: 'all' }, ...MOD_PLATFORM_ITEMS]
const sortItems = [{ label: '최근 등록·수정', value: 'updated' }, { label: '이름순', value: 'name' }]

const { data, status, error, refresh } = await useFetch<ModListResponse>('/api/mods', {
  default: () => ({ mods: [] })
})
const { data: detail, status: detailStatus, error: detailError, refresh: refreshDetail } = await useAsyncData<ModDetailResponse | null>(
  'mod-hub-detail',
  () => selectedId.value ? requestFetch<ModDetailResponse>(`/api/mods/${encodeURIComponent(selectedId.value)}`) : Promise.resolve(null),
  { watch: [selectedId], default: () => null }
)
const selectedDetail = computed(() => detail.value?.mod.id === selectedId.value ? detail.value : null)
const mods = computed(() => data.value?.mods ?? [])
const filteredMods = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('ko-KR')
  return mods.value.filter(mod => (
    (!query || [mod.name, mod.summary, mod.repository, mod.authorHandle ?? ''].some(value => value.toLocaleLowerCase('ko-KR').includes(query)))
    && (platform.value === 'all' || mod.platforms.some(value => value === platform.value))
    && (!onlyMine.value || (loggedIn.value && mod.canEdit))
  )).sort((left, right) => sort.value === 'name'
    ? left.name.localeCompare(right.name, 'ko-KR')
    : Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
})

function openEditor(mod: ModEntry | null = null): void {
  if (!loggedIn.value || (mod && !mod.canEdit)) return
  editingMod.value = mod
  editorOpen.value = true
}

function backToList(): void {
  const query = { ...route.query }
  delete query.mod
  void router.push({ path: '/mod', query })
}

async function handleSaved(mod: ModEntry): Promise<void> {
  const wasSelected = selectedId.value === mod.id
  data.value = { mods: [mod, ...mods.value.filter(entry => entry.id !== mod.id)] }
  await router.push({ path: '/mod', query: { ...route.query, mod: mod.id } })
  if (wasSelected) await refreshDetail()
  showToast({ id: `mod-saved-${mod.id}`, title: editingMod.value ? '모드 정보를 수정했습니다.' : '모드를 등록했습니다.' })
}

watch(() => user.value?.id, async () => {
  onlyMine.value = false
  editorOpen.value = false
  await Promise.allSettled([refresh(), refreshDetail()])
})
</script>

<template>
  <div class="mx-auto flex h-full w-full max-w-7xl flex-col gap-5 pb-5">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <UIcon name="i-tabler-package" class="size-5" />
          <h1 class="-mt-0.75 text-xl font-semibold">
            모드 허브
          </h1>
        </div>
        <p class="text-sm text-muted">
          커뮤니티 모드를 발견하고, GitHub의 최신 소식과 버전별 파일을 확인하세요.
        </p>
      </div>
      <ClientOnly>
        <UButton
          v-if="loggedIn"
          color="neutral"
          icon="i-tabler-plus"
          @click="openEditor()"
        >
          모드 등록
        </UButton>
        <UButton
          v-else
          :to="`/auth/login?returnTo=${encodeURIComponent(route.fullPath)}`"
          external
          color="neutral"
          variant="soft"
          icon="i-tabler-login"
        >
          로그인하고 등록
        </UButton>
        <template #fallback>
          <USkeleton class="h-8 w-28" />
        </template>
      </ClientOnly>
    </header>

    <template v-if="selectedId">
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-tabler-arrow-left"
        class="self-start -ml-2"
        @click="backToList"
      >
        모드 목록
      </UButton>
      <div v-if="detailStatus === 'pending' && !selectedDetail" class="flex min-h-60 items-center justify-center">
        <AppLoadingSpinner />
      </div>
      <UAlert
        v-else-if="detailError"
        color="error"
        variant="soft"
        title="모드 정보를 불러오지 못했습니다."
        description="등록되지 않은 모드이거나 연결에 문제가 있습니다."
      >
        <template #actions>
          <UButton
            color="error"
            variant="outline"
            size="xs"
            @click="refreshDetail()"
          >
            다시 시도
          </UButton>
        </template>
      </UAlert>
      <ModDetail
        v-else-if="selectedDetail"
        :detail="selectedDetail"
        :refreshing="detailStatus === 'pending'"
        @edit="openEditor(selectedDetail.mod)"
        @refresh="refreshDetail()"
      />
    </template>

    <template v-else>
      <div class="flex flex-wrap items-center gap-3">
        <UInput
          v-model="search"
          icon="i-tabler-search"
          placeholder="모드 이름, 소개, 저장소 검색"
          aria-label="모드 검색"
          color="neutral"
          variant="soft"
          size="lg"
          class="w-full sm:w-80"
        />
        <USelect
          v-model="platform"
          :items="platformItems"
          aria-label="지원 플랫폼"
          color="neutral"
          variant="soft"
          size="lg"
          class="w-36"
        />
        <ClientOnly>
          <USwitch
            v-if="loggedIn"
            v-model="onlyMine"
            label="내 모드"
            color="neutral"
          />
        </ClientOnly>
        <USelect
          v-model="sort"
          :items="sortItems"
          aria-label="모드 정렬"
          color="neutral"
          variant="soft"
          size="lg"
          class="ml-auto w-36"
        />
      </div>
      <div class="flex items-center justify-between text-xs text-muted">
        <span>총 {{ filteredMods.length.toLocaleString('ko-KR') }}개 모드</span>
        <span class="inline-flex items-center gap-1.5"><UIcon name="i-tabler-brand-github" class="size-3.5" />GitHub 연동</span>
      </div>

      <div v-if="status === 'pending' && !mods.length" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div v-for="index in 6" :key="index" class="flex flex-col gap-4 border border-default bg-muted p-5">
          <USkeleton class="size-10" /><USkeleton class="h-5 w-40" /><USkeleton class="h-4 w-full" /><USkeleton class="h-4 w-2/3" />
        </div>
      </div>
      <UAlert
        v-else-if="error"
        color="error"
        variant="soft"
        title="모드 목록을 불러오지 못했습니다."
        description="잠시 후 다시 시도해 주세요."
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
      <div v-else-if="!filteredMods.length" class="flex min-h-72 flex-col items-center justify-center gap-3 border border-dashed border-default bg-muted/50 p-8 text-center">
        <UIcon :name="mods.length ? 'i-tabler-search-off' : 'i-tabler-package'" class="size-9 text-dimmed" />
        <p class="text-base font-semibold">
          {{ mods.length ? '조건에 맞는 모드가 없습니다.' : '첫 번째 모드를 등록해 보세요.' }}
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
        <ClientOnly>
          <UButton
            v-if="loggedIn && !mods.length"
            color="neutral"
            icon="i-tabler-plus"
            class="mt-1"
            @click="openEditor()"
          >
            모드 등록
          </UButton>
        </ClientOnly>
      </div>
      <section v-else aria-label="모드 목록" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article v-for="mod in filteredMods" :key="mod.id" class="group flex min-w-0 flex-col border border-default bg-muted transition-colors hover:border-accented hover:bg-elevated/50">
          <NuxtLink :to="{ path: '/mod', query: { mod: mod.id } }" class="flex flex-1 flex-col gap-4 p-5">
            <div class="flex items-center justify-between gap-2">
              <div class="flex size-10 items-center justify-center border border-default bg-default"><UIcon name="i-tabler-package" class="size-5 text-muted" /></div>
              <div class="flex flex-wrap justify-end gap-1.5"><UBadge
                v-for="item in mod.platforms"
                :key="item"
                color="neutral"
                variant="subtle"
                size="sm"
              >{{ getModPlatformLabel(item) }}</UBadge></div>
            </div>
            <div class="flex flex-col gap-2">
              <h2 class="wrap-break-word text-base font-semibold group-hover:underline underline-offset-4">{{ mod.name }}</h2>
              <p class="line-clamp-2 min-h-10 wrap-break-word text-sm leading-5 text-muted">{{ mod.summary || '상세 화면에서 모드 정보를 확인하세요.' }}</p>
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
            <span class="text-[11px] text-dimmed">{{ formatModDate(mod.updatedAt) }}</span>
          </div>
        </article>
      </section>
    </template>

    <ModEditor v-model:open="editorOpen" :mod="editingMod" @saved="handleSaved" />
  </div>
</template>
