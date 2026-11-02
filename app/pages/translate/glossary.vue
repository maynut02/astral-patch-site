<script setup lang="ts">
import { useGlossaryWorkspace } from '~/composables/glossary-workspace'

useAstralPageSeo('공통 용어집')
const workspace = useGlossaryWorkspace()
onMounted(workspace.init)
</script>

<template>
  <div class="mx-auto max-w-400">
    <GlossaryWorkspace :workspace="workspace" />
  </div>
</template>
