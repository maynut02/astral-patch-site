<script setup lang="ts">
import { useReleaseFeed, useReleaseDistribution } from '~/composables/use-release-feed'

const route = useRoute()

const supportedRoutes = {
  INT_STEAM: 'Steam 글로벌 버전',
  CN_STEAM: 'Steam 중국 버전'
} as const

const supportedActions = {
  install: {
    protocol: 'install',
    title: '한글패치 설치 모드'
  },
  uninstall: {
    protocol: 'remove',
    title: '한글패치 제거 모드'
  }
} as const

type SupportedRoute = keyof typeof supportedRoutes
type SupportedAction = keyof typeof supportedActions

const routeParam = Array.isArray(route.params.route) ? route.params.route[0] : route.params.route
const actionParam = Array.isArray(route.params.action) ? route.params.action[0] : route.params.action

if (!(routeParam && routeParam in supportedRoutes) || !(actionParam && actionParam in supportedActions)) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Page Not Found'
  })
}

const patchRoute = routeParam as SupportedRoute
const patchAction = actionParam as SupportedAction
const routeName = supportedRoutes[patchRoute]
const action = supportedActions[patchAction]
const protocolUrl = `astral://${action.protocol}/${patchRoute}`

useAstralPageSeo(
  `${routeName} ${action.title}`,
  `${routeName}용 아스트랄 파티 한글패치를 ${patchAction === 'install' ? '설치' : '제거'}하기 위해 Windows 패치 프로그램을 실행합니다.`
)

useHead({
  meta: [
    { name: 'robots', content: 'noindex, nofollow' }
  ]
})

const {
  data: releaseFeed,
  status,
  error,
  refresh
} = await useReleaseFeed('patcher-release-feed')

const { windowsPatcher } = useReleaseDistribution(releaseFeed)
const isLoading = computed(() => status.value === 'idle' || status.value === 'pending')

function launchPatcher(): void {
  if (!import.meta.client) {
    return
  }

  window.location.href = protocolUrl
}

function reloadRelease(): void {
  void refresh()
}

onMounted(() => {
  launchPatcher()
})
</script>

<template>
  <div class="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center justify-center">
    <section class="w-full">
      <div class="flex flex-col gap-6 p-3">
        <div class="flex flex-col gap-4">
          <UIcon
            :name="patchAction === 'install' ? 'i-tabler-download' : 'i-tabler-trash'"
            class="size-8"
          />

          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-muted">{{ patchRoute }}</span>
            <h1 class="text-2xl font-semibold">
              {{ routeName }} {{ action.title }}
            </h1>
          </div>
        </div>

        <UAlert
          icon="i-tabler-app-window"
          color="info"
          variant="outline"
          title="패치 프로그램을 실행하고 있습니다."
          description="브라우저에서 외부 프로그램 실행 확인 창이 표시되면 허용해 주세요."
        />

        <div class="flex flex-col gap-2">
          <UButton
            icon="i-tabler-external-link"
            color="info"
            variant="soft"
            size="lg"
            block
            class="py-3"
            @click="launchPatcher"
          >
            패치 프로그램 열기
          </UButton>

          <UButton
            :href="windowsPatcher?.index.downloadUrl"
            :disabled="!windowsPatcher"
            :loading="isLoading"
            external
            icon="i-tabler-download"
            color="neutral"
            variant="ghost"
            size="lg"
            block
            class="py-3"
          >
            Windows 패치 프로그램 다운로드
          </UButton>
        </div>

        <div class="border-t border-default pt-4 text-sm text-dimmed">
          패치 프로그램이 실행되지 않으면 위 버튼을 다시 누르거나 Windows 패치 프로그램을 설치한 뒤 재시도해 주세요.
        </div>
      </div>

      <div
        v-if="error || (!isLoading && !windowsPatcher)"
        class="border-t border-default bg-default/75 p-4"
      >
        <UAlert
          color="error"
          variant="soft"
          title="최신 Windows 패처 정보를 불러오지 못했습니다."
          description="패치 프로그램이 이미 설치되어 있다면 위 실행 버튼은 그대로 사용할 수 있습니다."
        >
          <template #actions>
            <UButton
              color="error"
              variant="soft"
              size="sm"
              @click="reloadRelease"
            >
              다시 불러오기
            </UButton>
            <UButton
              to="/download"
              color="neutral"
              variant="soft"
              size="sm"
            >
              다운로드 페이지
            </UButton>
          </template>
        </UAlert>
      </div>
    </section>
  </div>
</template>
