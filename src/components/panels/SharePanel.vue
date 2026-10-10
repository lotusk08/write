<script setup lang="ts">
import { participantName } from "../../lib/share.ts";
import type { ShareState } from "../types.ts";

const props = defineProps<{ state: ShareState }>();
const emit = defineEmits<{ name: [name: string]; enable: []; disable: [] }>();

const onBlur = () => {
  if (!props.state.name.trim()) {
    emit("name", participantName());
  }
};
</script>

<template>
  <div class="share-panel">
    <ul class="switch-list">
      <li>
        <label class="switch">
          <input
            type="checkbox"
            :checked="state.sharing"
            :disabled="state.busy"
            @change="state.sharing ? emit('disable') : emit('enable')"
          />
          <span>
            Shared editing
            <em>
              {{
                state.owner
                  ? "Anyone with the link can open this draft and edit it live"
                  : "You joined this draft through its link — everyone edits the same live copy"
              }}
            </em>
          </span>
        </label>
      </li>
    </ul>

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

    <div v-if="state.sharing && state.peers.length > 0" class="field">
      <span class="field-label">Here now</span>
      <div class="peers">
        <span v-for="peer in state.peers" :key="peer.key" class="peer">
          <span class="peer-dot" :style="{ background: peer.color }" />
          {{ peer.name }}{{ peer.you ? " (you)" : "" }}
        </span>
      </div>
    </div>

    <div v-if="state.sharing && state.link" class="share-link">
      <input class="input mono" readonly :value="state.link" @focus="($event.target as HTMLInputElement).select()" />
    </div>

    <p v-if="state.error" class="hint" style="color: var(--danger)">{{ state.error }}</p>

    <p class="hint">
      {{
        state.sharing
          ? state.owner
            ? "Everyone edits the same live copy while their tab is open. Turning the switch off ends the link for all of them."
            : "Everyone edits the same live copy while their tab is open. Turning the switch off just leaves — the share stays live for the others, and this copy stays yours."
          : "The writing stays private until the switch goes on."
      }}
    </p>
  </div>
</template>
