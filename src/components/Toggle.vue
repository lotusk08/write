<script setup lang="ts" generic="T extends string">
import { computed } from "vue";
import type { ToggleOption } from "./types.ts";

const props = defineProps<{ label: string; options: ToggleOption<T>[]; value: string }>();
const emit = defineEmits<{ change: [id: T] }>();

const at = computed(() => props.options.findIndex((option) => option.id === props.value));
</script>

<template>
  <div class="toggle" role="group" :aria-label="label">
    <span v-if="at !== -1" class="toggle-knob" :style="{ '--at': at, '--count': options.length }" />
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      :class="{ 'is-on': value === option.id }"
      :aria-pressed="value === option.id"
      :title="option.title"
      @click="emit('change', option.id)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
