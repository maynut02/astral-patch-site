export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/fonts', '@nuxt/ui', 'nuxt-auth-utils', 'nuxt-og-image'],

  devtools: {
    enabled: false
  },

  css: ['~/assets/css/main.css'],

  site: {
    url: 'https://astral.maynutlab.com',
    name: '아스트랄 파티 한글패치'
  },

  ui: {
    colorMode: false,
    experimental: {
      componentDetection: true
    }
  },

  runtimeConfig: {
    session: {
      maxAge: 60 * 60 * 24 * 30
    },
    databaseUrl: process.env.DATABASE_URL || '',
    aiApiKey: process.env.AI_API_KEY || '',
    aiBaseUrl: process.env.AI_BASE_URL || ''
  },

  routeRules: {
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
      }
    }
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    compressPublicAssets: true
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  fonts: {
    families: [
      {
        name: 'Noto Sans KR',
        provider: 'google',
        weights: [400, 500, 600, 700],
        styles: ['normal'],
        global: true
      },
      {
        name: 'Noto Sans SC',
        provider: 'google',
        weights: [400, 500, 600, 700],
        styles: ['normal'],
        global: true
      },
      {
        name: 'Noto Sans TC',
        provider: 'google',
        weights: [400, 500, 600, 700],
        styles: ['normal'],
        global: true
      },
      {
        name: 'Noto Sans JP',
        provider: 'google',
        weights: [400, 500, 600, 700],
        styles: ['normal'],
        global: true
      }
    ]
  },

  icon: {
    clientBundle: {
      scan: true,
      sizeLimitKb: 128
    }
  }
})
