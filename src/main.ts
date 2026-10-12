import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";

// Chromium shrinks the page for the keyboard when asked; Safari, which has no such key, logs an error for it.
if ("virtualKeyboard" in navigator) {
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute("content", `${viewport.getAttribute("content")}, interactive-widget=resizes-content`);
}

createApp(App).mount("#root");
