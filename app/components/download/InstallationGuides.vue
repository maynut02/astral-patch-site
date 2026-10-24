<script setup lang="ts">
import { EXTERNAL_LINKS } from '~/utils/links'

const installationGuideItems = [
  {
    label: 'Windows 패치 플러그인 설치 및 사용 방법',
    icon: 'i-tabler-plug',
    value: 'windows-plugin',
    slot: 'windows-plugin'
  },
  {
    label: 'Windows 패치 프로그램 설치 및 사용 방법',
    icon: 'i-tabler-app-window',
    value: 'windows-patcher',
    slot: 'windows-patcher'
  },
  {
    label: 'Android 패치 앱 설치 및 사용 방법',
    icon: 'i-tabler-brand-android',
    value: 'android-patcher',
    slot: 'android-patcher'
  }
]
</script>

<template>
  <section class="mt-3 flex flex-col gap-3">
    <span class="font-medium">
      설치 및 사용 방법
    </span>

    <div class="border border-default bg-muted">
      <UAccordion
        :items="installationGuideItems"
        color="neutral"
        :ui="{
          trigger: 'px-3 py-4 sm:px-5',
          body: 'px-3 pb-5 sm:px-5'
        }"
      >
        <template #windows-plugin-body>
          <div class="flex flex-col gap-6 pt-1">
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div class="flex items-center gap-2 bg-elevated px-3 py-2.5 text-sm text-toned">
                <UIcon
                  name="i-tabler-check"
                  class="size-4 shrink-0 text-success"
                />
                Steam 글로벌·중국 버전 지원
              </div>
              <div class="flex items-center gap-2 bg-elevated px-3 py-2.5 text-sm text-toned">
                <UIcon
                  name="i-tabler-check"
                  class="size-4 shrink-0 text-success"
                />
                게임 실행 시 패치 자동 확인
              </div>
              <div class="flex items-center gap-2 bg-elevated px-3 py-2.5 text-sm text-toned">
                <UIcon
                  name="i-tabler-alert-circle"
                  class="size-4 shrink-0 text-warning"
                />
                BepInEx 별도 설치 필요
              </div>
            </div>

            <ol class="flex flex-col gap-5">
              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">1</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    게임 설치 경로 열기
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    Steam에서 라이브러리 → Astral Party → 관리 → 로컬 파일 탐색 순서로 게임 설치 폴더를 엽니다.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">2</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    사용하는 버전의 폴더로 이동
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    글로벌 버전은 <code class="text-default">8vJXnINT</code>, 중국 버전은 <code class="text-default">8vJXn6CN</code> 폴더로 이동합니다. 게임 실행 파일(<code class="text-default">AstralParty_INT.exe</code> 또는 <code class="text-default">AstralParty_CN.exe</code>)이 있는 이 폴더에 BepInEx와 플러그인을 설치합니다.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">3</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    BepInEx 설치
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    <a
                      :href="EXTERNAL_LINKS.bepinexBuilds"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-info hover:underline"
                    >BepInEx 빌드 페이지</a>에서 BepInEx 6 Unity IL2CPP Windows x64 배포물을 다운로드하고, 압축파일 안의 내용물을 모두 해당 게임 폴더에 붙여넣습니다. 플러그인 압축파일에는 BepInEx가 포함되어 있지 않습니다.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">4</span>
                <div class="flex flex-col gap-2">
                  <h3 class="font-medium text-default">
                    BepInEx 설정
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    게임을 처음 실행하기 전에 <code class="text-default">BepInEx/config/BepInEx.cfg</code>를 열고 아래 세 항목을 적용합니다. 폴더나 파일이 없으면 직접 만들고, 파일 이름이 <code class="text-default">BepInEx.cfg.txt</code>로 저장되지 않도록 확인합니다. 기존 설정 파일이 있다면 같은 항목을 중복으로 추가하지 말고 값만 바꿉니다.
                  </p>
                  <pre class="overflow-x-auto bg-elevated p-3 font-mono text-xs leading-5 text-default"><code>[Logging]
UnityLogListening = false

[Logging.Console]
Enabled = false

[Logging.Disk]
WriteUnityLog = false</code></pre>
                  <p class="text-sm leading-6 text-muted">
                    설정을 저장한 뒤 Steam에서 게임을 한 번 실행하고 종료합니다. 최초 실행은 BepInEx 초기화 때문에 시간이 걸릴 수 있습니다.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">5</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    플러그인 파일 복사
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    게임을 종료한 상태에서 다운로드한 AstralPartyKoreanPlugin 압축파일을 열고, 안의 <code class="text-default">BepInEx</code> 폴더를 해당 게임 폴더에 붙여넣어 기존 폴더와 합칩니다. 설치 후 <code class="text-default">BepInEx/patchers/AstralPartyKoreanPlugin.dataUnity3dRedirect.dll</code>과 <code class="text-default">BepInEx/plugins/AstralPartyKoreanPatch/AstralPartyKoreanPlugin.dll</code>이 있어야 합니다.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">6</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    게임 실행
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    평소처럼 Steam에서 게임을 실행하면 한글패치 확인과 다운로드 진행 창이 표시됩니다. 준비가 끝나면 게임이 시작되고, 게임 내 오버레이에서 패치 적용 상태를 확인할 수 있습니다.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">7</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    업데이트 및 플러그인 제거
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    업데이트할 때는 게임을 종료하고 새 압축파일의 DLL 두 개로 교체합니다. 제거하려면 설치한 DLL 두 개를 삭제하고, 내려받은 리소스까지 지우려면 <code class="text-default">BepInEx/AstralPartyKoreanPatch</code> 폴더도 삭제합니다. 게임 원본 파일은 덮어쓰지 않으므로 별도 복원은 필요 없습니다.
                  </p>
                </div>
              </li>
            </ol>

            <UAlert
              icon="i-tabler-alert-triangle-filled"
              color="warning"
              variant="soft"
              title="이전 버전 플러그인에서 업데이트하는 경우"
            >
              <template #description>
                <code>BepInEx/patchers/AstralParty.DataUnity3dRedirect.dll</code>과 <code>BepInEx/plugins/AstralPartyKoreanPatch/AstralParty.AddressablesInProcessPatch.dll</code>이 남아 있다면 삭제하고, 각 DLL은 최신 이름으로 하나씩만 유지해 주세요. <code>BepInEx/AstralPartyKoreanPatch</code>의 리소스 캐시는 그대로 사용할 수 있습니다.
              </template>
            </UAlert>
          </div>
        </template>

        <template #windows-patcher-body>
          <div class="flex flex-col gap-6 pt-1">
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div class="flex items-center gap-2 bg-elevated px-3 py-2.5 text-sm text-toned">
                <UIcon
                  name="i-tabler-check"
                  class="size-4 shrink-0 text-success"
                />
                게임 리소스 다운로드 필요
              </div>
            </div>

            <ol class="flex flex-col gap-5">
              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">1</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    게임 설치 및 리소스 준비
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    Steam에서 Astral Party를 설치합니다. 게임을 한 번 실행해 최신 리소스 다운로드를 완료한 뒤 게임을 종료해 주세요.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">2</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    Windows 패치 프로그램 실행
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    다운로드한 AstralWindowsPatcher.exe를 실행합니다. 처음 실행하면 최신 프로그램 버전을 확인하고, 웹사이트의 원클릭 버튼과 연동할 수 있도록 프로그램을 등록합니다. 이후에는 다운로드한 파일을 다시 찾지 않아도 웹사이트에서 패처를 열 수 있습니다.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">3</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    Steam 지역과 경로 확인
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    패처가 Steam 게임 경로와 리소스 경로를 자동으로 찾습니다. 경로를 찾지 못했거나 다른 버전을 사용한다면 ‘Steam 설정’에서 Steam 글로벌·중국 지역을 선택하고 ‘게임 경로 자동 찾기’를 실행해 주세요. 필요한 경우 두 경로를 직접 입력할 수도 있습니다.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">4</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    한글패치 설치
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    다운로드 페이지에서 사용하는 버전의 ‘원클릭 한글패치 설치’를 누르거나, 프로그램에서 ‘Steam 패치 설치 / 업데이트’를 선택합니다. 호환 패치 확인, 다운로드, 원본 백업, 파일 검증과 적용이 자동으로 진행되므로 완료 메시지가 나올 때까지 프로그램을 종료하지 마세요.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 items-center justify-center bg-elevated text-sm font-semibold md:size-8">5</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    업데이트 및 패치 제거
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    게임이나 한글패치가 업데이트되면 업데이트 작업을 다시 실행합니다. 한글패치를 제거하려면 웹사이트의 원클릭 삭제 버튼이나 프로그램의 ‘Steam 패치 제거’를 사용하면 원본 파일을 복원합니다.
                  </p>
                </div>
              </li>
            </ol>

            <UAlert
              icon="i-tabler-help-filled"
              color="info"
              variant="soft"
              title="경로 탐지 또는 패치 제거에 실패한 경우"
              description="Steam 설정에서 경로를 다시 찾고, 게임 파일이 외부에서 변경되어 제거할 수 없다면 Steam 파일 무결성 검사를 완료한 뒤 다시 시도해 주세요."
            />
          </div>
        </template>

        <template #android-patcher-body>
          <div class="flex flex-col gap-6 pt-1">
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div class="flex items-center gap-2 bg-elevated px-3 py-2.5 text-sm text-toned">
                <UIcon
                  name="i-tabler-check"
                  class="size-4 shrink-0 text-success"
                />
                WIFI 필요
              </div>
              <div class="flex items-center gap-2 bg-elevated px-3 py-2.5 text-sm text-toned">
                <UIcon
                  name="i-tabler-x"
                  class="size-4 shrink-0 text-error"
                />
                일본 Google 계정 불필요
              </div>
              <div class="flex items-center gap-2 bg-elevated px-3 py-2.5 text-sm text-toned">
                <UIcon
                  name="i-tabler-x"
                  class="size-4 shrink-0 text-error"
                />
                VPN 불필요
              </div>
              <div class="flex items-center gap-2 bg-elevated px-3 py-2.5 text-sm text-toned">
                <UIcon
                  name="i-tabler-x"
                  class="size-4 shrink-0 text-error"
                />
                PC 불필요
              </div>
            </div>

            <ol class="flex flex-col gap-5">
              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 md:size-8 items-center justify-center bg-elevated text-sm font-semibold">1</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    패치 앱과 Shizuku 설치
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    Android 패치 앱을 설치해 실행한 뒤 Shizuku 설치 버튼을 누릅니다. 출처를 알 수 없는 앱 설치 권한을 요청하면 허용해 주세요. Shizuku 설정을 이미 완료했다면 4단계로 넘어가면 됩니다.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 md:size-8 items-center justify-center bg-elevated text-sm font-semibold">2</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    개발자 옵션과 디버깅 활성화
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    설정 → 스마트폰·태블릿 정보 → 소프트웨어 정보에서 빌드 번호를 연속으로 눌러 개발자 모드를 활성화합니다. 개발자 옵션에서 USB 디버깅과 무선 디버깅을 켜 주세요.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 md:size-8 items-center justify-center bg-elevated text-sm font-semibold">3</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    Shizuku 페어링 및 시작
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    Shizuku에서 페어링을 누르고 알림을 허용합니다. 개발자 옵션의 ‘페어링 코드로 기기 페어링’을 선택한 뒤, 알림창의 Shizuku 코드 입력란에 표시된 코드를 입력합니다. Shizuku로 돌아와 시작을 누르고 안내 창이 사라질 때까지 기다려 주세요.
                  </p>
                  <p class="text-xs leading-5 text-dimmed">
                    페어링 코드 방식은 Android 11 이상에서 사용할 수 있습니다.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 md:size-8 items-center justify-center bg-elevated text-sm font-semibold">4</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    패치 앱 권한 허용
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    Android 패치 앱으로 돌아와 권한 허용을 누른 뒤 ‘항상 허용’을 선택합니다. Shizuku 상태가 초록색이면 준비가 끝난 것입니다. 이 설정은 처음 한 번만 하면 되며, 초록색이 아니라면 페어링과 시작 과정을 다시 진행해 주세요.
                  </p>
                </div>
              </li>

              <li class="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 md:gap-3">
                <span class="flex size-7 md:size-8 items-center justify-center bg-elevated text-sm font-semibold">5</span>
                <div class="flex flex-col gap-1">
                  <h3 class="font-medium text-default">
                    게임 준비 및 한글패치 적용
                  </h3>
                  <p class="text-sm leading-6 text-muted">
                    패치 앱에서 게임 설치를 누르고, 설치가 끝나면 게임을 한 번 실행해 리소스 다운로드를 완료합니다. 다시 패치 앱으로 돌아와 한글패치 적용을 누르세요. 이미 완료된 항목은 초록색으로 표시되므로 건너뛰면 됩니다.
                  </p>
                </div>
              </li>
            </ol>

            <UAlert
              icon="i-tabler-help-filled"
              color="info"
              variant="soft"
              title="게임 또는 한글패치가 업데이트된 경우"
              description="패치 앱에서 노란색으로 표시된 항목의 버튼만 누르면 필요한 항목을 자동으로 업데이트합니다."
            />

            <div class="flex justify-end">
              <UButton
                :href="EXTERNAL_LINKS.androidGuide"
                external
                icon="i-tabler-external-link"
                color="neutral"
                variant="soft"
                size="sm"
              >
                이미지가 포함된 가이드 보기
              </UButton>
            </div>
          </div>
        </template>
      </UAccordion>
    </div>
  </section>
</template>
