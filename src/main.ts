import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";

if ("virtualKeyboard" in navigator) {
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute("content", `${viewport.getAttribute("content")}, interactive-widget=resizes-content`);
}

createApp(App).mount("#root");
