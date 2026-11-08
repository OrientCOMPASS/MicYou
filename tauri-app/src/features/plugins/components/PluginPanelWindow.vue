<script setup lang="ts">
/**
 * 插件面板独立窗口
 * 由 open_plugin_window 命令创建，hash 路由 #/plugin/:pluginId/:panelId
 * 复用设置对话框的面板渲染逻辑（沙箱 iframe + postMessage 桥 + 主题注入）
 */
import { computed, nextTick, ref, onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buildPanelDocument,
  pushPanelTheme,
  usePluginPanelBridge,
} from '../composables/usePluginPanelBridge';
import { appWindow, command } from '@/platform';
import { useWindowTransition } from '@/features/window/composables/useWindowTransition';
import { useTheme } from '@/features/theme/composables/useTheme';

const hash = window.location.hash; // #/plugin/<pluginId>/<panelId>
const parts = hash.replace('#/plugin/', '').split('/');
const pluginId = decodeURIComponent(parts[0] ?? '');
const panelId = decodeURIComponent(parts[1] ?? '');

// This window is a separate webview: App.vue/SettingsWindow never mount here,
// so apply the theme tokens and the dark class explicitly.
const theme = useTheme();
const { locale } = useI18n();
const panelHtml = ref('');
const loading = ref(true);
const error = ref<string | null>(null);
const frame = ref<HTMLIFrameElement | null>(null);
const { handleMessage } = usePluginPanelBridge(pluginId, frame);

const themeKey = computed(() =>
  [
    theme.colorMode.value,
    theme.themeMode.value,
    theme.themeColor.value,
    theme.customH.value,
    theme.customS.value,
    theme.customL.value,
    theme.customVariant.value,
    theme.uiStyle.value,
    theme.installedThemeId.value,
    theme.installedThemeCss.value,
    theme.customCss.value,
    theme.customCssEnabled.value,
    theme.systemAccent.value.hex,
  ].join('\u0001'),
);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const html = await command('get_plugin_panel', { pluginId, panelId });
    panelHtml.value = buildPanelDocument(html);
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

watch(themeKey, () => {
  void nextTick(() => pushPanelTheme(frame));
});
watch(locale, () => void load());

const windowRoot = ref<HTMLElement | null>(null);
const transition = useWindowTransition(windowRoot);

let closing = false;
async function closeWindow() {
  if (closing) return;
  closing = true;
  await transition.exit();
  await appWindow.destroyCurrentWindow().catch((e) => console.error('Closing panel failed:', e));
}

onMounted(() => {
  void transition.enter();
  window.addEventListener('message', handleMessage);
  void load();
});
onUnmounted(() => window.removeEventListener('message', handleMessage));
</script>

<template>
  <div
    ref="windowRoot"
    class="h-screen w-screen overflow-hidden rounded-2xl flex flex-col origin-center"
    style="background: hsl(var(--surface))"
  >
    <header
      data-tauri-drag-region
      class="flex items-center justify-between px-4 py-2.5 shrink-0 border-b"
      style="border-color: hsl(var(--border))"
    >
      <div
        data-tauri-drag-region
        class="flex items-center gap-2 text-sm font-semibold"
        style="color: hsl(var(--on-surface))"
      >
        <span
          class="inline-block w-2 h-2 rounded-full"
          style="background: hsl(var(--primary))"
        ></span>
        {{ pluginId }} · {{ panelId }}
      </div>
      <button
        @click="closeWindow"
        class="text-xs px-2.5 py-1 rounded-lg transition-colors hover:opacity-80"
        style="background: hsl(var(--surface-variant)); color: hsl(var(--on-surface-variant))"
      >
        ✕
      </button>
    </header>
    <div class="flex-1 overflow-hidden p-4">
      <div v-if="loading" class="text-sm" style="color: hsl(var(--on-surface-variant))">
        {{ $t('plugins.panelLoading') }}
      </div>
      <div
        v-else-if="error"
        class="text-xs font-mono break-all rounded-xl p-4"
        style="
          color: hsl(var(--error));
          background: color-mix(in srgb, hsl(var(--error)) 10%, transparent);
        "
      >
        {{ error }}
      </div>
      <iframe
        v-else
        ref="frame"
        :srcdoc="panelHtml"
        sandbox="allow-scripts allow-popups"
        class="w-full h-full rounded-xl border"
        style="border-color: hsl(var(--border)); background: hsl(var(--surface))"
      ></iframe>
    </div>
  </div>
</template>
