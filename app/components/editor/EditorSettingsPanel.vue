<script setup lang="ts">
import type { EditorPageState } from '~/utils/editor-page-state'

const props = defineProps<{ state: EditorPageState }>()
const { diffMode, diffModeOptions, displayLanguageOptions, displayLanguages, toggleDisplayLanguage } = props.state
</script>

<template>
  <div class="editor-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
    <div class="flex flex-col gap-2">
      <p class="text-xs font-medium text-muted">
        원문 표시 언어
      </p>

      <div class="flex flex-col text-sm">
        <button
          v-for="language in displayLanguageOptions"
          :key="language.key"
          type="button"
          class="flex items-center gap-2 py-1 pl-1 transition-colors hover:bg-muted"
          :class="displayLanguages.includes(language.key) ? 'text-default' : 'text-dimmed hover:text-toned'"
          :aria-pressed="displayLanguages.includes(language.key)"
          @click="toggleDisplayLanguage(language.key)"
        >
          <UIcon
            v-if="displayLanguages.includes(language.key)"
            name="i-tabler-check"
            class="size-4"
          />
          <span
            v-else
            class="size-4"
          />
          <span>{{ language.label }}</span>
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-2 border-t border-default pt-4">
      <p class="text-xs font-medium text-muted">
        변경 기록 표시 방식
      </p>

      <div class="flex flex-col text-sm">
        <button
          v-for="mode in diffModeOptions"
          :key="mode.key"
          type="button"
          class="flex items-start gap-2 py-1 pl-1 text-left transition-colors hover:bg-muted"
          :class="diffMode === mode.key ? 'text-default' : 'text-dimmed hover:text-toned'"
          :aria-pressed="diffMode === mode.key"
          @click="diffMode = mode.key"
        >
          <UIcon
            v-if="diffMode === mode.key"
            name="i-tabler-check"
            class="mt-0.5 size-4 shrink-0"
          />
          <span
            v-else
            class="mt-0.5 size-4 shrink-0"
          />
          <span class="min-w-0">
            <span class="block">{{ mode.label }}</span>
            <span class="mt-0.5 block text-xs text-dimmed">{{ mode.description }}</span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
