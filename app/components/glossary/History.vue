<script setup lang="ts">
import type { GlossaryProposal } from '#shared/types/editor-dictionary'
import { GLOSSARY_ACTION_NAMES, GLOSSARY_STATUS_NAMES } from '~/utils/glossary-labels'

defineProps<{ proposals: GlossaryProposal[] }>()
</script>

<template>
  <div class="flex flex-col gap-4 p-4 text-sm">
    <article v-for="proposal in proposals" :key="proposal.id" class="border-b border-default pb-3">
      <p>{{ GLOSSARY_STATUS_NAMES[proposal.status] }} · {{ new Date(proposal.createdAt).toLocaleString('ko-KR') }}</p>
      <p class="mt-1 text-xs text-muted">
        <AppUserIdentity
          :user-id="proposal.createdBy"
          :handle="proposal.creatorHandle"
          fallback="참여자"
          text-class="text-xs text-muted"
        /> 제안
      </p>
      <GlossaryEntryDetails
        :entry="{ translation: proposal.translation, note: proposal.note, metadata: proposal.metadata, revision: proposal.baseRevision + 1 }"
        hide-actions
        :proposed="proposal.status !== 'approved'"
      />
      <p v-for="(event, index) in proposal.history" :key="index" class="mt-2 text-xs text-muted">
        {{ GLOSSARY_ACTION_NAMES[event.action] }}<span v-if="event.reason"> · {{ event.reason }}</span> · <AppUserIdentity :user-id="event.actor" fallback="참여자" text-class="text-xs text-muted" /> · {{ new Date(event.at).toLocaleString('ko-KR') }}
      </p>
    </article><p v-if="!proposals.length" class="text-muted">
      처리 이력이 없습니다.
    </p>
  </div>
</template>
