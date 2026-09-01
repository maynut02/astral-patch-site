<script setup lang="ts">
interface GuideOption {
  label: string
  value: string
  icon?: string
  disabled?: boolean
}

type GuideStepStatus = 'info' | 'warning' | 'success'

const props = withDefaults(defineProps<{
  step: number
  title: string
  description?: string
  modelValue?: string | null
  options?: GuideOption[]
  status?: GuideStepStatus
  complete?: boolean
}>(), {
  description: undefined,
  modelValue: null,
  options: () => [],
  status: 'info',
  complete: false
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const visualStatus = computed<GuideStepStatus>(() => props.complete ? 'success' : props.status)

const indicatorClass = computed(() => ({
  info: 'text-info bg-info/10',
  warning: 'text-warning bg-warning/10',
  success: 'text-success bg-success/10'
})[visualStatus.value])

const titleClass = computed(() => ({
  info: 'text-default',
  warning: 'text-warning',
  success: 'text-success'
})[visualStatus.value])
</script>

<template>
  <section class="flex gap-3 group">
    <div class="flex flex-col">
      <span
        class="flex size-8 items-center justify-center text-sm font-semibold rounded-full"
        :class="indicatorClass"
      >
        <span class="-mt-px">{{ step }}</span>
      </span>

      <div class="group-last:hidden flex justify-center flex-1 py-1">
        <div class="w-0.5 h-full bg-info/10 rounded-full" />
      </div>
    </div>

    <div class="flex flex-1 min-w-0 flex-col gap-3 pb-10">
      <div class="flex flex-col">
        <div class="flex items-center gap-2">
          <h2
            class="text-base font-medium"
            :class="titleClass"
          >
            {{ title }}
          </h2>
          <UBadge
            v-if="visualStatus === 'warning'"
            color="warning"
            variant="soft"
            size="sm"
          >
            대기
          </UBadge>
          <UBadge
            v-else-if="visualStatus === 'success'"
            color="success"
            variant="soft"
            size="sm"
          >
            완료
          </UBadge>
        </div>
        <p
          v-if="description"
          class="text-sm text-muted"
        >
          {{ description }}
        </p>
      </div>

      <slot name="before-options" />

      <div
        v-if="options.length"
        class="flex w-fit flex-col border border-default"
      >
        <UButton
          v-for="option in options"
          :key="option.value"
          color="neutral"
          :variant="modelValue === option.value ? 'soft' : 'link'"
          :icon="option.icon"
          :disabled="option.disabled"
          size="lg"
          class="px-4 py-2.5"
          @click="emit('update:modelValue', option.value)"
        >
          {{ option.label }}
        </UButton>
      </div>

      <slot />
    </div>
  </section>
</template>
