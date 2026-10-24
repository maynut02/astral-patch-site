import { reactive, computed, watch } from 'vue'
import { launchWindowsPatcher } from '~/utils/patcher-launch'
import { PATCH_ROUTE_ITEMS } from '~/utils/patch-routes'

type SupportedRoute = 'INT_STEAM' | 'CN_STEAM' | 'INT_ANDROID' | 'CN_ANDROID'
type GuideAnswerKey = 'route' | 'steamMethod' | 'resources' | 'patcher' | 'plugin' | 'started' | 'shizuku'

export function useHomeInstallGuide() {
  const routeOptions = PATCH_ROUTE_ITEMS
  const yesNoOptions = [
    { label: '예', value: 'yes' },
    { label: '아니오', value: 'no' }
  ]
  const steamMethodOptions = [
    { label: 'Windows 플러그인', value: 'plugin', icon: 'i-tabler-plug' },
    { label: 'Windows 패치 프로그램', value: 'patcher', icon: 'i-tabler-app-window' }
  ]
  const patcherOptions = [
    { label: '예', value: 'yes' },
    { label: '아니오', value: 'no' },
    { label: '사용하지 않음', value: 'manual' }
  ]

  const answers = reactive<Record<GuideAnswerKey, string | null>>({
    route: null,
    steamMethod: null,
    resources: null,
    patcher: null,
    plugin: null,
    started: null,
    shizuku: null
  })

  const selectedRoute = computed<SupportedRoute | null>(() => {
    const route = answers.route
    return route === 'INT_STEAM' || route === 'CN_STEAM' || route === 'INT_ANDROID' || route === 'CN_ANDROID' ? route : null
  })
  const isSteam = computed(() => selectedRoute.value === 'INT_STEAM' || selectedRoute.value === 'CN_STEAM')
  const isAndroid = computed(() => selectedRoute.value === 'INT_ANDROID' || selectedRoute.value === 'CN_ANDROID')

  function resetAnswers(...keys: GuideAnswerKey[]): void {
    for (const key of keys) {
      answers[key] = null
    }
  }

  watch(() => answers.route, () => {
    resetAnswers('steamMethod', 'resources', 'patcher', 'plugin', 'started', 'shizuku')
  })
  watch(() => answers.steamMethod, () => {
    resetAnswers('resources', 'patcher', 'plugin', 'started')
  })
  watch(() => answers.resources, () => {
    resetAnswers('patcher', 'plugin', 'started')
  })
  watch(() => answers.patcher, () => {
    resetAnswers('started', 'shizuku')
  })

  function launchSelectedSteam(action: 'install' | 'remove'): void {
    if (selectedRoute.value === 'INT_STEAM' || selectedRoute.value === 'CN_STEAM') {
      launchWindowsPatcher(action, selectedRoute.value)
    }
  }

  return { answers, routeOptions, yesNoOptions, steamMethodOptions, patcherOptions, selectedRoute, isSteam, isAndroid, launchSelectedSteam }
}
