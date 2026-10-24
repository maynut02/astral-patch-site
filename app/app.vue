<script setup>
import { ASTRAL_SITE_TITLE as siteTitle, ASTRAL_SITE_DESCRIPTION as description } from '~/composables/page-seo'

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
