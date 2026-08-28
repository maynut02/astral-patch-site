<script setup>
useHead({
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

const title = '아스트랄 파티 한글패치'
const description = ''

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogImage: null,
  twitterCard: null
})
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
