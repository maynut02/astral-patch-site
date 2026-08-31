import { computed, toValue, type MaybeRefOrGetter } from 'vue'

export const ASTRAL_SITE_TITLE = '아스트랄 파티 한글패치'
export const ASTRAL_SITE_DESCRIPTION = '아스트랄 파티 한글패치의 다운로드, 설치 가이드, 번역 현황과 변경 기록을 제공하는 비공식 한국어 패치 사이트입니다.'

export function useAstralPageSeo(
  title: MaybeRefOrGetter<string>,
  description: MaybeRefOrGetter<string> = ASTRAL_SITE_DESCRIPTION
): void {
  const route = useRoute()
  const pageTitle = computed(() => toValue(title))
  const pageDescription = computed(() => toValue(description))
  const socialTitle = computed(() => `${pageTitle.value} | ${ASTRAL_SITE_TITLE}`)
  const pageUrl = withSiteUrl(computed(() => route.path))

  useHead({ title: pageTitle })

  useSeoMeta({
    description: pageDescription,
    ogTitle: socialTitle,
    ogDescription: pageDescription,
    ogSiteName: ASTRAL_SITE_TITLE,
    ogType: 'website',
    ogUrl: pageUrl,
    twitterCard: 'summary_large_image',
    twitterTitle: socialTitle,
    twitterDescription: pageDescription
  })

  defineOgImage('AstralPatch', {
    title: pageTitle,
    description: pageDescription
  }, [
    { key: 'og', width: 1200, height: 630, alt: ASTRAL_SITE_TITLE }
  ])
}
