<template>
  <div class="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
    <div class="flex flex-col gap-4">
      <slot />
    </div>

    <dl class="grid gap-3 border border-default p-3 text-sm">
      <slot name="details" />
    </dl>
  </div>
</template>
