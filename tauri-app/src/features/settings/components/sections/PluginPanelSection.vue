<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { command } from '@/platform';
import {
  buildPanelDocument,
  pushPanelTheme,
  usePluginPanelBridge,
} from '@/features/plugins/composables/usePluginPanelBridge';
import { useTheme } from '@/features/theme/composables/useTheme';

// The settings window keys this component by panel, so props never change
// while it is mounted.
const props = defineProps<{
  pluginId: string;
  panelId: string;
}>();

const { locale } = useI18n();
const theme = useTheme();
const frame = ref<HTMLIFrameElement | null>(null);
const { handleMessage } = usePluginPanelBridge(props.pluginId, frame);

const panelHtml = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

// Everything that changes the injected CSS tokens. Watching this instead of
// only `colorMode` also covers accent, custom and packaged themes.
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
    const html = await command('get_plugin_panel', {
      pluginId: props.pluginId,
      panelId: props.panelId,
    });
    panelHtml.value = buildPanelDocument(html);
  } catch (e) {
    error.value = String(e);
    panelHtml.value = '';
  } finally {
    loading.value = false;
  }
}

// Re-inject tokens without reloading: a reload would discard unsaved edits.
watch(themeKey, () => {
  void nextTick(() => pushPanelTheme(frame));
});
// Text is baked into the document, so a language switch reloads it.
watch(locale, () => void load());

onMounted(() => {
  window.addEventListener('message', handleMessage);
  void load();
});
onUnmounted(() => window.removeEventListener('message', handleMessage));
</script>

<template>
  <div class="space-y-4">
    <div v-if="loading" class="flex items-center gap-2 text-sm text-on-surface-variant">
      <span
        class="animate-spin inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full"
      ></span>
      {{ $t('plugins.loading') }}
    </div>
    <div
      v-else-if="error"
      class="text-sm text-red-400 bg-red-500/10 rounded-xl p-4 font-mono break-all"
    >
      {{ error }}
    </div>
    <iframe
      v-else
      ref="frame"
      :srcdoc="panelHtml"
      sandbox="allow-scripts allow-popups"
      class="w-full h-[600px] rounded-2xl border border-border"
      style="background: hsl(var(--surface))"
    ></iframe>
  </div>
</template>
