<script setup lang="ts">
const languageItems = ['중국어 간체', '영어', '일본어', '중국어 번체']
const editorPageValue = ref(1)
</script>

<template>
  <div class="flex flex-col gap-4">
    <UInput icon="i-tabler-search" size="lg" color="neutral" variant="soft" placeholder="검색..."
      :ui="{ base: 'rounded-xl' }" />

    <div class="flex flex-col gap-2">
      <p class="text-xs text-muted font-medium">카테고리</p>

      <div class="flex flex-col flex-wrap gap-2 text-sm">
        <div class="flex flex-col">
          <div class="flex h-7 justify-between hover:bg-muted transition-color rounded-xl">
            <span class="flex items-center">STRCategory</span>
            <button class="flex items-center justify-center px-2 text-error hover:text-error/70 transition-colors">
              <UIcon name="i-tabler-x" class="size-4" />
            </button>
          </div>
          <div class="flex h-7 justify-between hover:bg-muted transition-color rounded-xl">
            <span class="flex items-center">STRCategory</span>
            <button class="flex items-center justify-center px-2 text-error hover:text-error/70 transition-colors">
              <UIcon name="i-tabler-x" class="size-4" />
            </button>
          </div>
          <div class="flex h-7 justify-between hover:bg-muted transition-color rounded-xl">
            <span class="flex items-center">STRCategory</span>
            <button class="flex items-center justify-center px-2 text-error hover:text-error/70 transition-colors">
              <UIcon name="i-tabler-x" class="size-4" />
            </button>
          </div>
        </div>

        <UButton icon="i-tabler-plus" color="neutral" variant="soft" size="sm" label="카테고리 추가"
          class="w-full rounded-full justify-center bg-muted hover:bg-elevated py-1.5" />
      </div>
    </div>

    <USeparator />

    <div class="flex flex-col gap-2">
      <p class="text-xs text-muted font-medium">버전 조회</p>

      <div class="flex flex-col flex-wrap gap-2 text-sm">
        <div class="flex flex-col">
          <div class="flex h-7 justify-between hover:bg-muted transition-color rounded-xl">
            <span class="flex items-center">v3.2.0_r102</span>
            <button class="flex items-center justify-center px-2 text-error hover:text-error/70 transition-colors">
              <UIcon name="i-tabler-x" class="size-4" />
            </button>
          </div>
          <div class="flex h-7 justify-between hover:bg-muted transition-color rounded-xl">
            <span class="flex items-center">v3.2.0_r102</span>
            <button class="flex items-center justify-center px-2 text-error hover:text-error/70 transition-colors">
              <UIcon name="i-tabler-x" class="size-4" />
            </button>
          </div>
          <div class="flex h-7 justify-between hover:bg-muted transition-color rounded-xl">
            <span class="flex items-center">v3.2.0_r102</span>
            <button class="flex items-center justify-center px-2 text-error hover:text-error/70 transition-colors">
              <UIcon name="i-tabler-x" class="size-4" />
            </button>
          </div>
        </div>

        <UButton icon="i-tabler-plus" color="neutral" variant="soft" size="sm" label="버전 추가"
          class="w-full rounded-full justify-center bg-muted hover:bg-elevated py-1.5" />
      </div>
    </div>

    <USeparator />

    <div class="flex flex-col gap-2">
      <p class="text-xs text-muted font-medium">표시 언어</p>

      <div class="flex flex-col text-sm">
        <button v-for="language in languageItems" :key="language"
          class="flex items-center gap-2 py-1 hover:bg-muted transition-colors rounded-xl">
          <UIcon name="i-tabler-check" class="size-4" />
          <span>{{ language }}</span>
        </button>
        <button v-for="language in languageItems" :key="language"
          class="flex items-center gap-2 py-1 hover:bg-muted transition-colors rounded-xl text-dimmed">
          <div class="size-4" />
          <span>{{ language }}</span>
        </button>
      </div>
    </div>

    <USeparator />

    <div class="flex flex-col gap-2">
      <p class="text-xs text-muted font-medium">미번역 항목만 표시</p>

      <div class="flex flex-wrap gap-2 text-sm">
        <UTabs :content="false" :items="[{ label: 'OFF' }, { label: 'ON' }]" color="neutral" size="xs" class=""
          :ui="{ list: 'rounded-xl bg-muted', indicator: 'rounded-xl', trigger: 'px-3' }" />
      </div>
    </div>

    <USeparator />

    <div class="flex flex-col gap-2">
      <p class="text-xs text-muted font-medium">페이지</p>

      <div class="flex flex-wrap gap-2 text-sm">
        <UButton icon="i-tabler-chevron-left" color="neutral" variant="soft"
          class="rounded-full bg-muted hover:bg-elevated px-3" />
        <UInput v-model="editorPageValue" color="neutral" variant="soft" :ui="{ base: 'rounded-xl px-4 text-center' }"
          class="flex-1">
          <template #trailing>
            <div id="max-page" class="text-xs text-muted tabular-nums" aria-live="polite" role="status">
              / 120
            </div>
          </template>
        </UInput>
        <UButton icon="i-tabler-chevron-right" color="neutral" variant="soft"
          class="rounded-full bg-muted hover:bg-elevated px-3" />
      </div>
    </div>
  </div>
</template>