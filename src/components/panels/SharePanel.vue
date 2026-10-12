<script setup lang="ts">
import { computed } from "vue";
import { participantColor, participantName } from "../../lib/participants.ts";
import Icon from "../Icon.vue";
import type { ShareState } from "../types.ts";

const props = defineProps<{ state: ShareState }>();
const emit = defineEmits<{ name: [name: string]; copy: []; disable: [] }>();

const others = computed(() => props.state.peers.filter((peer) => !peer.you));
const mine = computed(() => props.state.peers.find((peer) => peer.you)?.color ?? participantColor(props.state.name));

const onBlur = () => {
  if (!props.state.name.trim()) {
    emit("name", participantName());
  }
};
</script>

<template>
  <div class="share-panel">
    <p v-if="state.error" class="notice warn">{{ state.error }}</p>

    <template v-if="state.sharing">
      <div class="peers" role="group" aria-label="Here now">
        <label class="peer is-you" title="Your name, as the others see it — tap to change it">
          <span class="peer-dot" :style="{ background: mine }" />
          <input
            class="peer-name"
            :value="state.name"
            :style="{ width: `${Math.max(6, state.name.length) + 0.5}ch` }"
            maxlength="40"
            placeholder="Your name"
            aria-label="Your name, as the others see it"
            @input="emit('name', ($event.target as HTMLInputElement).value)"
            @blur="onBlur"
          />
          <span class="peer-you">(you)</span>
        </label>
        <span v-for="peer in others" :key="peer.key" class="peer">
          <span class="peer-dot" :style="{ background: peer.color }" />
          {{ peer.name }}
        </span>
      </div>

      <div class="share-actions">
        <button type="button" class="btn" :disabled="!state.link" title="Copy the share link" @click="emit('copy')">
          <Icon name="copy" />
          Copy link
        </button>
        <button
          type="button"
          class="btn danger"
          :disabled="state.busy"
          :title="state.owner ? 'End the link for everyone; your copy stays here' : 'Leave; the share stays live for the others'"
          @click="emit('disable')"
        >
          {{ state.owner ? "Stop" : "Leave" }}
        </button>
      </div>
    </template>
  </div>
</template>
