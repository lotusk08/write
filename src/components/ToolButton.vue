<script setup lang="ts">
import Icon from "./Icon.vue";
import type { IconName } from "./icons.ts";

defineProps<{ title: string; icon?: IconName; label?: string; active?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ press: [] }>();
</script>

<template>
  <button
    type="button"
    :class="['tool', { 'is-active': active }]"
    :title="title"
    :aria-label="title"
    :aria-pressed="active"
    :disabled="disabled"
    @mousedown.prevent
    @click="emit('press')"
  >
    <Icon v-if="icon" :name="icon" />
    <span v-else class="tool-text">{{ label }}</span>
  </button>
</template>
