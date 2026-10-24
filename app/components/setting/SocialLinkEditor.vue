<script setup lang="ts">
import { SOCIAL_LINK_LABEL_MAX_LENGTH, SOCIAL_LINK_MAX_COUNT, SOCIAL_LINK_URL_MAX_LENGTH } from '#shared/types/profile'

defineProps<{
  links: { key: string, id: string, label: string, url: string }[]
  errors: { label: string, url: string }[]
  loading: boolean
}>()
const emit = defineEmits<{ add: [], remove: [index: number] }>()
</script>

<template>
  <div class="flex flex-col gap-3 border-t border-default pt-5">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="text-sm font-medium text-default">
          소셜미디어 링크
        </h3>
        <p class="mt-0.5 text-xs text-muted">
          최대 {{ SOCIAL_LINK_MAX_COUNT }}개까지 등록할 수 있습니다.
        </p>
      </div>
      <UButton
        type="button"
        icon="i-tabler-plus"
        color="neutral"
        variant="soft"
        size="md"
        :disabled="loading || links.length >= SOCIAL_LINK_MAX_COUNT"
        @click="emit('add')"
      >
        링크 추가
      </UButton>
    </div>

    <div
      v-if="links.length"
      class="flex flex-col gap-3"
    >
      <div
        v-for="(link, index) in links"
        :key="link.key"
        class="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.6fr)_auto]"
      >
        <UFormField :error="errors[index]?.label || undefined">
          <UInput
            v-model="link.label"
            :maxlength="SOCIAL_LINK_LABEL_MAX_LENGTH"
            color="neutral"
            class="w-full"
            placeholder="예: X, YouTube, GitHub"
            :disabled="loading"
            :ui="{ base: 'h-8 leading-5' }"
          />
        </UFormField>

        <UFormField :error="errors[index]?.url || undefined">
          <UInput
            v-model="link.url"
            :maxlength="SOCIAL_LINK_URL_MAX_LENGTH"
            type="url"
            color="neutral"
            class="w-full"
            placeholder="https://..."
            :disabled="loading"
            :ui="{ base: 'h-8 leading-5' }"
          />
        </UFormField>

        <UButton
          type="button"
          icon="i-tabler-trash"
          color="error"
          variant="ghost"
          class="self-start"
          aria-label="소셜 링크 삭제"
          :disabled="loading"
          @click="emit('remove', index)"
        />
      </div>
    </div>

    <p
      v-else
      class="text-sm text-muted"
    >
      등록된 소셜미디어 링크가 없습니다.
    </p>
  </div>
</template>
