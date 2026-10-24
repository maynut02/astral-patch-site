<script setup lang="ts">
import type { ReleaseAssetInfo, ReleaseDistribution } from '#shared/types/releases'
import { EXTERNAL_LINKS } from '~/utils/links'

type GuideAnswers = Record<'route' | 'steamMethod' | 'resources' | 'patcher' | 'plugin' | 'started' | 'shizuku', string | null>

// 부모의 reactive 답변 객체를 그대로 받아 필드 단위로 갱신한다.
const answers = defineModel<GuideAnswers>('answers', { required: true })

defineProps<{
  routeOptions: Array<{ label: string, value: string, icon?: string }>
  yesNoOptions: Array<{ label: string, value: string, icon?: string }>
  steamMethodOptions: Array<{ label: string, value: string, icon?: string }>
  patcherOptions: Array<{ label: string, value: string, icon?: string }>
  isSteam: boolean
  isAndroid: boolean
  windowsPatcher: ReleaseDistribution['windowsPatcher']
  windowsPlugin: ReleaseDistribution['windowsPlugin']
  androidPatcher: ReleaseDistribution['androidPatcher']
  steamManualPatch: { asset: ReleaseAssetInfo } | null
  steamPluginTargetFolder: string
  launchSelectedSteam: (action: 'install' | 'remove') => void
  openDeveloperModeHelp: (context: 'shizuku') => void
}>()
</script>

<template>
  <section class="mx-auto flex w-full max-w-3xl flex-col gap-5 py-5">
    <header class="flex items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">
        한글패치 설치 도우미
      </h1>

      <UButton
        to="/download"
        trailing-icon="i-tabler-arrow-right"
        color="neutral"
        variant="link"
        size="md"
        class="shrink-0"
      >
        전체 보기
      </UButton>
    </header>

    <div class="flex flex-col">
      <HomeGuideStep
        v-model="answers.route"
        :step="1"
        title="어떤 플랫폼의 한글패치가 필요하나요?"
        description="한글패치를 설치할 플랫폼을 선택해 주세요."
        :options="routeOptions"
      />

      <template v-if="isSteam">
        <HomeGuideStep
          v-model="answers.steamMethod"
          :step="2"
          title="어떤 방식으로 한글패치를 설치할까요?"
          description="게임 실행 시 자동으로 패치를 확인하는 Windows 플러그인 또는 별도 패치 프로그램을 선택할 수 있습니다."
          :options="steamMethodOptions"
        />

        <template v-if="answers.steamMethod === 'plugin'">
          <HomeGuideStep
            v-model="answers.plugin"
            :step="3"
            title="Windows 플러그인을 설치했나요?"
            description="BepInEx 6 Unity IL2CPP를 먼저 설치한 뒤, 플러그인 압축 파일의 BepInEx 폴더를 Astral Party 설치 폴더 안의 사용 중인 버전 폴더에 복사합니다."
            :options="yesNoOptions"
            :status="answers.plugin === 'no' ? 'warning' : 'info'"
          >
            <div
              v-if="answers.plugin === 'no'"
              class="flex flex-col gap-4 bg-muted p-4"
            >
              <div class="flex flex-col gap-1">
                <p class="text-sm font-medium text-default">
                  Windows 플러그인을 다운로드해 설치해 주세요.
                </p>
                <p class="text-sm text-muted">
                  Steam → 라이브러리 → Astral Party → 관리 → 로컬 파일 탐색으로 설치 폴더를 연 뒤 <code class="text-default">{{ steamPluginTargetFolder }}</code> 폴더로 이동합니다.
                </p>
                <p class="text-sm text-muted">
                  이 폴더에 BepInEx 6 Unity IL2CPP Windows x64를 먼저 설치하고, 게임을 처음 실행하기 전에 <code class="text-default">BepInEx/config/BepInEx.cfg</code> 설정을 적용합니다. 설정 방법은 자세한 설치 방법에서 확인할 수 있습니다.
                </p>
                <p class="text-sm text-muted">
                  그다음 다운로드한 압축 파일 안의 <code class="text-default">BepInEx</code> 폴더를 해당 폴더에 붙여넣어 기존 폴더와 합칩니다.
                </p>
              </div>

              <div class="flex flex-wrap gap-2">
                <UButton
                  :href="windowsPlugin?.index.downloadUrl"
                  :disabled="!windowsPlugin"
                  external
                  icon="i-tabler-file-zip"
                  color="info"
                  variant="soft"
                  size="lg"
                  class="px-4 py-2.5"
                >
                  Windows 플러그인 다운로드
                </UButton>
                <UButton
                  to="/download"
                  icon="i-tabler-help"
                  color="neutral"
                  variant="soft"
                  size="lg"
                  class="px-4 py-2.5"
                >
                  자세한 설치 방법
                </UButton>
              </div>
            </div>
          </HomeGuideStep>

          <HomeGuideStep
            v-if="answers.plugin === 'yes'"
            :step="4"
            title="준비가 완료되었습니다."
            description="이제 평소처럼 Steam에서 게임을 실행하면 플러그인이 한글패치 상태를 자동으로 확인합니다."
            complete
          >
            <UAlert
              color="info"
              variant="soft"
              icon="i-tabler-info-circle"
              title="최초 실행은 평소보다 오래 걸릴 수 있습니다."
              description="처음 실행할 때는 BepInEx 초기화와 한글패치 리소스 다운로드 때문에 시간이 걸릴 수 있습니다. 진행 창이 끝나고 게임이 시작될 때까지 게임을 강제 종료하지 마세요."
            />
          </HomeGuideStep>
        </template>

        <template v-else-if="answers.steamMethod === 'patcher'">
          <HomeGuideStep
            v-model="answers.resources"
            :step="3"
            title="인게임 리소스 다운로드를 완료했나요?"
            description="한글패치를 적용하기 전에 게임 안에서 필요한 리소스 다운로드가 완료되어 있어야 합니다."
            :options="yesNoOptions"
            :status="answers.resources === 'no' ? 'warning' : 'info'"
          >
            <UAlert
              v-if="answers.resources === 'no'"
              color="neutral"
              variant="soft"
              class="bg-muted"
              title="먼저 인게임 리소스 다운로드를 완료해 주세요."
              description="게임을 실행해 필요한 리소스를 모두 받은 뒤 '예'를 선택하세요."
            />
          </HomeGuideStep>

          <HomeGuideStep
            v-if="answers.resources === 'yes'"
            v-model="answers.patcher"
            :step="4"
            title="Windows 패치 프로그램을 설치했나요?"
            description="프로그램을 사용하지 않는 경우 수동 패치 파일을 받을 수 있습니다."
            :options="patcherOptions"
            :status="answers.patcher === 'no' ? 'warning' : answers.patcher === 'manual' ? 'success' : 'info'"
          >
            <div
              v-if="answers.patcher === 'no'"
              class="flex flex-col gap-3 bg-muted p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p class="text-sm font-medium text-default">
                  Windows 패치 프로그램 설치가 필요합니다.
                </p>
                <p class="mt-1 text-sm text-muted">
                  프로그램을 다운로드하고 한 번 실행한 뒤 '예'를 선택하세요.
                </p>
              </div>
              <UButton
                :href="windowsPatcher?.index.downloadUrl"
                :disabled="!windowsPatcher"
                external
                icon="i-tabler-download"
                color="info"
                variant="soft"
                size="lg"
                class="shrink-0 justify-center px-4 py-2.5"
              >
                Windows 패치 프로그램 다운로드
              </UButton>
            </div>

            <div
              v-if="answers.patcher === 'manual'"
              class="flex flex-col gap-3 bg-muted p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p class="text-sm font-medium text-default">
                  수동 설치 파일을 사용합니다.
                </p>
                <p class="mt-1 text-sm text-muted">
                  압축 파일 내의 설치 안내에 따라 직접 파일을 복사해 주세요.
                </p>
              </div>
              <UButton
                :href="steamManualPatch?.asset.downloadUrl"
                :disabled="!steamManualPatch"
                external
                icon="i-tabler-file-zip"
                color="info"
                variant="soft"
                size="lg"
                class="shrink-0 justify-center px-4 py-2.5"
              >
                수동 패치 파일 다운로드
              </UButton>
            </div>
          </HomeGuideStep>

          <HomeGuideStep
            v-if="answers.resources === 'yes' && answers.patcher === 'yes'"
            v-model="answers.started"
            :step="5"
            title="Windows 패치 프로그램을 한 번 실행했나요?"
            description="다운로드 후 최소 한번은 실행해야 사이트를 통해 프로그램을 실행시킬 수 있습니다."
            :options="yesNoOptions"
            :status="answers.started === 'no' ? 'warning' : 'info'"
          >
            <UAlert
              v-if="answers.started === 'no'"
              color="neutral"
              variant="soft"
              class="bg-muted"
              title="Windows 패치 프로그램을 먼저 한 번 실행해 주세요."
              description="프로그램 창이 정상적으로 열리는 것을 확인한 뒤 '예'를 선택하세요."
            />
          </HomeGuideStep>

          <HomeGuideStep
            v-if="answers.resources === 'yes' && answers.patcher === 'yes' && answers.started === 'yes'"
            :step="6"
            title="준비가 완료되었습니다."
            description="원하는 작업을 선택하면 Windows 패치 프로그램이 바로 실행됩니다."
            complete
          >
            <div class="flex flex-wrap gap-2">
              <UButton
                icon="i-tabler-wand"
                color="info"
                variant="soft"
                size="lg"
                class="px-4 py-2.5"
                @click="launchSelectedSteam('install')"
              >
                원클릭 한글패치 설치
              </UButton>
              <UButton
                icon="i-tabler-trash"
                color="error"
                variant="soft"
                size="lg"
                class="px-4 py-2.5"
                @click="launchSelectedSteam('remove')"
              >
                원클릭 한글패치 삭제
              </UButton>
            </div>
          </HomeGuideStep>
        </template>
      </template>

      <template v-if="isAndroid">
        <HomeGuideStep
          v-model="answers.patcher"
          :step="2"
          title="Android 패치 앱을 설치했나요?"
          description="패치 앱을 통해 게임 앱과 한글패치 리소스를 관리합니다."
          :options="yesNoOptions"
          :status="answers.patcher === 'no' ? 'warning' : 'info'"
        >
          <div
            v-if="answers.patcher === 'no'"
            class="flex flex-col gap-3 bg-muted p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p class="text-sm font-medium text-default">
                Android 패치 앱 설치가 필요합니다.
              </p>
              <p class="mt-1 text-sm text-muted">
                Android 패치 앱을 다운로드해 설치한 뒤 '예'를 선택하세요.
              </p>
            </div>
            <UButton
              :href="androidPatcher?.index.downloadUrl"
              :disabled="!androidPatcher"
              external
              icon="i-tabler-download"
              color="info"
              variant="soft"
              size="lg"
              class="shrink-0 justify-center px-4 py-2.5"
            >
              Android 패치 앱 다운로드
            </UButton>
          </div>
        </HomeGuideStep>

        <HomeGuideStep
          v-if="answers.patcher === 'yes'"
          v-model="answers.shizuku"
          :step="3"
          title="Shizuku를 설치하고 설정을 완료하였나요?"
          description="Android 패치 앱이 게임을 설치하고 한글패치를 적용하기 위해서는 Shizuku 권한이 필요합니다."
          :options="yesNoOptions"
          :status="answers.shizuku === 'no' ? 'warning' : 'info'"
        >
          <template #before-options>
            <UButton
              icon="i-tabler-settings-code"
              color="neutral"
              variant="soft"
              size="lg"
              class="w-fit px-4 py-2.5"
              @click="openDeveloperModeHelp('shizuku')"
            >
              개발자 모드 활성화 방법
            </UButton>
          </template>

          <UAlert
            v-if="answers.shizuku === 'no'"
            color="neutral"
            variant="soft"
            class="bg-muted"
            title="Shizuku 설정을 완료해 주세요."
            :description="`1. [Shizuku 다운로드 및 설치] 버튼을 탭해 Shizuku를 설치하세요.\n2. [Shizuku 열기] 버튼을 탭해 Shizuku를 실행하세요.\n3. [페어링] 버튼을 탭하고, [알림 옵션] 버튼을 탭해 알림을 허용해 주세요.\n4. '개발자 옵션'으로 이동한 다음 'USB 디버깅'과 '무선 디버깅'을 활성화해 주세요.\n5. '무선 디버깅'의 왼쪽을 탭한 다음 '페어링 코드로 기기 페어링'을 탭하세요.\n6. 알림창의 '페어링 코드 입력'을 탭해 기기 페어링 코드를 입력하세요.\n7. Shizuku로 돌아가 [시작] 버튼을 탭하세요.\n8. 완료된 경우 한글패치 앱으로 돌아가 [Shizuku 권한 허용] 버튼을 탭해 접근을 허용해 주세요.`"
            :ui="{ description: 'whitespace-pre-line leading-7' }"
          />
        </HomeGuideStep>

        <HomeGuideStep
          v-if="answers.patcher === 'yes' && answers.shizuku === 'yes'"
          :step="4"
          title="준비가 완료되었습니다."
          description="Android 패치 앱에서 최신 게임 및 한글패치 설치를 진행합니다."
          complete
        >
          <UButton
            :href="EXTERNAL_LINKS.android"
            external
            icon="i-tabler-device-mobile-down"
            color="info"
            variant="soft"
            size="lg"
            class="w-fit px-4 py-2.5"
          >
            Android 패치 앱 실행
          </UButton>
        </HomeGuideStep>
      </template>
    </div>
  </section>
</template>
