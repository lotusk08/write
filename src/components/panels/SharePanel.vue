<script setup lang="ts">
import { participantName } from "../../lib/participants.ts";
import type { ShareState } from "../types.ts";

const props = defineProps<{ state: ShareState }>();
const emit = defineEmits<{ name: [name: string]; disable: [] }>();

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
      <p class="hint">
        {{
          state.busy
            ? "Turning on…"
            : state.owner
              ? "Live — anyone with the link opens this draft and edits it with you."
              : "You joined this draft through its link — everyone edits the same live copy."
        }}
      </p>

      <div class="field">
        <span class="field-label">Your name</span>
        <input
          class="input"
          :value="state.name"
          maxlength="40"
          placeholder="How you are listed to the others"
          @input="emit('name', ($event.target as HTMLInputElement).value)"
          @blur="onBlur"
        />
      </div>

      <div v-if="state.peers.length > 0" class="field">
        <span class="field-label">Here now</span>
        <div class="peers">
          <span v-for="peer in state.peers" :key="peer.key" class="peer">
            <span class="peer-dot" :style="{ background: peer.color }" />
            {{ peer.name }}{{ peer.you ? " (you)" : "" }}
          </span>
        </div>
      </div>

      <div v-if="state.link" class="share-link">
        <input class="input mono" readonly :value="state.link" @focus="($event.target as HTMLInputElement).select()" />
        <button type="button" class="btn danger" :disabled="state.busy" @click="emit('disable')">
          {{ state.owner ? "Stop" : "Leave" }}
        </button>
      </div>

      <p class="hint">
        {{
          state.owner
            ? "Stop ends the link for everyone. Your copy stays here."
            : "Leave keeps your copy; the share stays live for the others."
        }}
      </p>
    </template>
  </div>
</template>
