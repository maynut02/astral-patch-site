<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  description?: string
}>(), {
  title: '아스트랄 파티 한글패치',
  description: '아스트랄 파티 한글패치의 다운로드, 설치 가이드, 번역 현황과 변경 기록을 제공하는 비공식 한국어 패치 사이트입니다.'
})

const characterImage = `/char_${Math.floor(Math.random() * 6) + 1}.png`
</script>

<template>
  <div
    lang="ko"
    class="relative flex h-full w-full overflow-hidden bg-default text-default"
    :style="{ fontFamily: 'Noto Sans KR' }"
  >
    <div class="flex flex-1 flex-col justify-between p-16">
      <img
        src="/logo.png"
        alt=""
        class="size-16 object-contain"
      >

      <div class="flex flex-col gap-4 pr-60">
        <div
          class="text-[36px] text-muted"
          :style="{ fontFamily: 'Noto Sans KR', fontWeight: 500 }"
        >
          아스트랄 파티 한글패치
        </div>
        <div
          class="text-[72px] leading-[1.2] tracking-tight text-default break-keep"
          :style="{ fontFamily: 'Noto Sans KR', fontWeight: 700 }"
        >
          {{ title }}
        </div>
      </div>
    </div>

    <img
      :src="characterImage"
      alt=""
      class="absolute w-120 h-auto object-contain"
      :style="{
        right: '-100px',
        top: '60px'
      }"
    >
  </div>
</template>
