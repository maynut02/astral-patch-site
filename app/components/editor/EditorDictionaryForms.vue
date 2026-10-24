<script setup lang="ts">
import type { EditorPageState } from '~/utils/editor-page-state'

const props = defineProps<{ state: EditorPageState }>()
const {
  createDictionary, createDictionaryEntry, dictionaryEntryForm, dictionaryEntryModalError,
  dictionaryEntryModalOpen, dictionaryEntryModalSaving, dictionaryForm, dictionaryModalError,
  dictionaryModalOpen, dictionaryModalSaving
} = props.state
</script>

<template>
  <UModal
    v-model:open="dictionaryModalOpen"
    title="새 용어집"
    :ui="{ footer: 'justify-end' }"
  >
    <template #body>
      <UForm
        id="editor-dictionary-form"
        :state="dictionaryForm"
        class="flex flex-col gap-4"
        @submit="createDictionary"
      >
        <UFormField
          name="name"
          label="이름"
          required
        >
          <UInput
            v-model="dictionaryForm.name"
            color="neutral"
            maxlength="100"
            placeholder="용어집 이름"
            class="w-full"
            :ui="{ base: 'h-8 leading-5' }"
          />
        </UFormField>
        <UFormField
          name="description"
          label="설명"
        >
          <UTextarea
            v-model="dictionaryForm.description"
            color="neutral"
            :rows="3"
            maxlength="500"
            placeholder="용어집에 대한 설명"
            class="w-full"
          />
        </UFormField>
        <UFormField
          name="visibility"
          label="공개 범위"
        >
          <USelect
            v-model="dictionaryForm.visibility"
            color="neutral"
            :items="[{ label: '공개', value: 'public' }, { label: '비공개', value: 'private' }]"
            class="w-full"
            :ui="{ base: 'h-8 leading-5' }"
          />
        </UFormField>
        <p
          v-if="dictionaryModalError"
          class="text-sm text-error"
        >
          {{ dictionaryModalError }}
        </p>
      </UForm>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        size="lg"
        @click="dictionaryModalOpen = false"
      >
        취소
      </UButton>
      <UButton
        type="submit"
        form="editor-dictionary-form"
        color="info"
        variant="soft"
        size="lg"
        :loading="dictionaryModalSaving"
      >
        만들기
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="dictionaryEntryModalOpen"
    title="용어 추가"
    :ui="{ footer: 'justify-end' }"
  >
    <template #body>
      <UForm
        id="editor-dictionary-entry-form"
        :state="dictionaryEntryForm"
        class="flex flex-col gap-4"
        @submit="createDictionaryEntry"
      >
        <UFormField
          name="sourceText"
          label="원문"
          required
        >
          <UTextarea
            v-model="dictionaryEntryForm.sourceText"
            color="neutral"
            :rows="3"
            maxlength="500"
            placeholder="원문 용어"
            class="w-full"
          />
        </UFormField>
        <UFormField
          name="translation"
          label="번역"
          required
        >
          <UTextarea
            v-model="dictionaryEntryForm.translation"
            color="neutral"
            :rows="3"
            maxlength="500"
            placeholder="번역 용어"
            class="w-full"
          />
        </UFormField>
        <UFormField
          name="note"
          label="메모"
        >
          <UTextarea
            v-model="dictionaryEntryForm.note"
            color="neutral"
            :rows="3"
            maxlength="1000"
            placeholder="선택 사항"
            class="w-full"
          />
        </UFormField>
        <p
          v-if="dictionaryEntryModalError"
          class="text-sm text-error"
        >
          {{ dictionaryEntryModalError }}
        </p>
      </UForm>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        @click="dictionaryEntryModalOpen = false"
      >
        취소
      </UButton>
      <UButton
        type="submit"
        form="editor-dictionary-entry-form"
        color="info"
        variant="soft"
        :loading="dictionaryEntryModalSaving"
      >
        추가
      </UButton>
    </template>
  </UModal>
</template>
