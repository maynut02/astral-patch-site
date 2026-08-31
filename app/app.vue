<script setup>
const siteTitle = '아스트랄 파티 한글패치'
const route = useRoute()
const pageUrl = withSiteUrl(computed(() => route.path))

useHead({
  titleTemplate: title => title ? `${title} | ${siteTitle}` : siteTitle,
  meta: [
    {
      name: 'viewport',
      content: 'width=device-width, initial-scale=1, interactive-widget=resizes-content'
    }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'ko',
    class: 'dark'
  }
})

const toaster = { expand: false, position: 'top-center' }

const description = '아스트랄 파티 한글패치의 다운로드, 설치 가이드, 번역 현황과 변경 기록을 제공하는 비공식 한국어 패치 사이트입니다.'

useSeoMeta({
  description,
  ogTitle: siteTitle,
  ogDescription: description,
  ogSiteName: siteTitle,
  ogType: 'website',
  ogUrl: pageUrl,
  twitterCard: 'summary_large_image',
  twitterTitle: siteTitle,
  twitterDescription: description
})

defineOgImage('AstralPatch', {
  title: siteTitle,
  description
}, [
  { key: 'og', width: 1200, height: 630, alt: siteTitle }
])
</script>

<template>
  <UApp :toaster="toaster">
    <NuxtLoadingIndicator
      color="var(--color-neutral-300)"
      :height="2"
    />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
