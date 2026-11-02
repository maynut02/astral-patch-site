<script setup lang="ts">
import type { EditorItem } from '#shared/types/editor'
import { EDITOR_STATUS_META } from '~/utils/editor-progress'
import { getTranslationSyntaxWarning } from '~/utils/editor-validation'
import type { EditorPageState } from '~/utils/editor-page-state'

const props = defineProps<{
  state: EditorPageState
  item: EditorItem
}>()
const { getItemStatus, glossaryEntries, glossaryFailed, glossaryLoading, refreshGlossary, handleItemTranslationInput, hasItemDraft, isSaving, loggedIn, retainItemTranslation, retainingItemId, selectDictionaryReference, selectItem, selectedItemId, showLoginRequiredToast, visibleSourceLanguageItems } = props.state
const item = computed(() => props.item)
const status = computed(() => getItemStatus(item.value))
const statusMeta = computed(() => EDITOR_STATUS_META[status.value])
const syntaxWarning = computed(() => getTranslationSyntaxWarning(item.value))
</script>

<template>
  <article
    class="flex shrink-0 flex-col border-b border-default transition-colors duration-150 lg:flex-row lg:border-b-0"
    :class="selectedItemId === item.id ? 'bg-elevated/70' : 'odd:bg-muted/40'"
    @click="selectItem(item)"
  >
    <div class="flex min-w-0 w-full shrink-0 lg:flex-1">
      <div class="flex shrink-0">
        <div
          class="w-0.5"
          :class="statusMeta.color"
          :title="statusMeta.label"
        />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-2 py-3 pl-4.5 pr-3 lg:py-2.5 lg:pr-2">
        <span class="text-xs font-medium text-muted lg:hidden">원문</span>
        <div
          v-for="source in visibleSourceLanguageItems"
          :key="source.key"
          class="flex flex-col min-w-0 gap-0.5 text-sm"
        >
          <span class="shrink-0 text-[10px] text-dimmed">{{ source.label }}</span>
          <p class="min-w-0 whitespace-pre-wrap">
            <EditorSourceText
              :text="item[source.key] || null"
              :lang="source.lang"
              :language="source.key"
              :glossary-entries="selectedItemId === item.id ? glossaryEntries : []"
              @select="selectDictionaryReference"
            >
              <template #empty>
                —
              </template>
            </EditorSourceText>
          </p>
        </div>

        <span class="break-all text-xs font-medium text-dimmed">
          {{ item.category }}_{{ item.unitKey }}
        </span>
        <p v-if="selectedItemId === item.id && glossaryLoading" class="text-xs text-dimmed">
          용어집 확인 중
        </p>
        <p v-else-if="selectedItemId === item.id && glossaryFailed" class="text-xs text-muted">
          용어 기준을 불러오지 못했습니다.
          <button type="button" class="text-info underline underline-offset-2" @click.stop="refreshGlossary">
            다시 불러오기
          </button>
        </p>
      </div>
    </div>

    <div class="relative flex min-w-0 w-full shrink-0 border-t border-default lg:flex-1 lg:border-t-0">
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="px-4 pt-2.5 text-xs font-medium text-muted lg:hidden">한국어 번역</span>
        <UTextarea
          :model-value="item.ko"
          color="neutral"
          variant="none"
          autoresize
          placeholder="미번역"
          :readonly="!loggedIn"
          :ui="{ base: 'min-h-24 p-3 pt-1.5 pl-4 pr-10 h-full lg:min-h-0 lg:pt-3 lg:pl-5' }"
          class="w-full min-w-0"
          @focus="selectItem(item)"
          @click="!loggedIn && showLoginRequiredToast('editor-translation-login-required')"
          @update:model-value="handleItemTranslationInput(item, $event)"
        />
      </div>

      <UIcon
        v-if="syntaxWarning"
        name="i-tabler-alert-triangle"
        class="absolute bottom-2.5 right-2.5 size-4 text-warning"
        :title="syntaxWarning"
      />

      <UButton
        v-if="status === 'warning' && !hasItemDraft(item)"
        label="유지"
        icon="i-tabler-check"
        color="warning"
        variant="soft"
        size="xs"
        class="absolute right-2 top-2 z-10"
        :loading="retainingItemId === item.id"
        :disabled="Boolean(retainingItemId) || isSaving"
        @click.stop="retainItemTranslation(item)"
      />

      <UIcon
        v-if="hasItemDraft(item)"
        name="i-tabler-switch-2"
        class="absolute right-2.5 top-2.5 size-4 text-info"
        title="변경됨"
      />
    </div>
  </article>
</template>
