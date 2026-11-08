import type { Ref } from 'vue';
import { command } from '@/platform';

// Forwards the panel's console output and uncaught errors to the plugin log,
// so plugin developers can debug their panels.
const CONSOLE_HOOK = `<script>
  (function () {
    var orig = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };
    function send(level) {
      return function () {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          parts.push(typeof a === 'string' ? a : (function () { try { return JSON.stringify(a); } catch (e) { return String(a); } })());
        }
        try {
          window.parent.postMessage({
            __micyou: 1,
            id: 'console-' + Math.random().toString(36).slice(2),
            api: 'log',
            args: { level: level, message: parts.join(' ') }
          }, '*');
        } catch (e) {}
        orig[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'].apply(console, arguments);
      };
    }
    console.log = send('info');
    console.warn = send('warn');
    console.error = send('error');
    window.addEventListener('error', function (e) {
      try {
        window.parent.postMessage({
          __micyou: 1,
          id: 'console-' + Math.random().toString(36).slice(2),
          api: 'log',
          args: { level: 'error', message: 'uncaught: ' + (e.message || e.error) }
        }, '*');
      } catch (err) {}
    });
  })();
<\/script>`;

/** Material 3 tokens every panel can rely on. Reading them explicitly keeps
 *  them available on WebKit builds that omit custom properties from the
 *  computed-style enumeration. */
const THEME_TOKENS = [
  '--background',
  '--foreground',
  '--surface',
  '--on-surface',
  '--surface-bright',
  '--surface-container',
  '--surface-container-low',
  '--surface-variant',
  '--on-surface-variant',
  '--outline',
  '--border',
  '--primary',
  '--on-primary',
  '--primary-container',
  '--on-primary-container',
  '--secondary',
  '--on-secondary',
  '--secondary-container',
  '--on-secondary-container',
  '--tertiary',
  '--on-tertiary',
  '--error',
  '--on-error',
  '--radius',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary-foreground',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--input',
  '--ring',
];

/** The host theme as CSS variables, so panels match and follow the app theme.
 *  The values are the raw HSL component triples the host stores (for example
 *  `--surface: 215 15% 98%`), exactly like the main app: panels must write
 *  `hsl(var(--surface))`, not `var(--surface)`. */
function collectThemeVars(): string {
  const style = getComputedStyle(document.documentElement);
  const names = new Set<string>(THEME_TOKENS);
  for (let i = 0; i < style.length; i++) {
    const name = style[i];
    if (name.startsWith('--')) names.add(name);
  }
  const vars: string[] = [];
  for (const name of names) {
    const value = style.getPropertyValue(name).trim();
    if (value) vars.push(`${name}: ${value};`);
  }
  // Native widgets inside a sandboxed iframe (select popups, scrollbars) do
  // not inherit the host's dark class, so forward the resolved mode too.
  const dark = document.documentElement.classList.contains('dark');
  vars.push(`--micyou-color-scheme: ${dark ? 'dark' : 'light'};`);
  return vars.join('\n');
}

/** Replaces the injected theme block when the user changes the app theme. */
const THEME_HOOK = `<script>
  (function () {
    function apply(vars) {
      var style = document.getElementById('micyou-theme-vars');
      if (!style) {
        style = document.createElement('style');
        style.id = 'micyou-theme-vars';
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = ':root{' + vars + '}';
    }
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (d && d.__micyou === 1 && d.type === 'theme' && typeof d.vars === 'string') apply(d.vars);
    });
  })();
<\/script>`;

/** Injects before the first panel script, without putting markup ahead of the
 *  doctype (that would force the iframe into quirks mode). */
function injectIntoHead(html: string, snippet: string): string {
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + snippet + html.slice(at);
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) {
    const at = doctype[0].length;
    return html.slice(0, at) + snippet + html.slice(at);
  }
  return snippet + html;
}

/** Wraps plugin panel HTML with the host theme and the console bridge. */
export function buildPanelDocument(html: string): string {
  const theme = `<style id="micyou-theme-vars">:root{${collectThemeVars()}}</style>`;
  return injectIntoHead(html, `${theme}${CONSOLE_HOOK}${THEME_HOOK}`);
}

/** Push the current theme into a mounted panel without reloading it (a reload
 *  would throw away unsaved edits in the panel's form). */
export function pushPanelTheme(frame: Ref<HTMLIFrameElement | null>): void {
  frame.value?.contentWindow?.postMessage(
    { __micyou: 1, type: 'theme', vars: collectThemeVars() },
    '*',
  );
}

/**
 * 插件面板桥：沙箱 iframe 里的插件 HTML 通过 postMessage 与宿主通信
 *
 * 面板侧协议（面板 HTML 内联脚本）：
 * ```js
 * function call(api, args) {
 *   return new Promise((resolve, reject) => {
 *     const id = Math.random().toString(36).slice(2);
 *     const onMsg = (e) => {
 *       if (e.data && e.data.__micyou === 1 && e.data.id === id) {
 *         window.removeEventListener('message', onMsg);
 *         e.data.ok ? resolve(e.data.value) : reject(new Error(e.data.error));
 *       }
 *     };
 *     window.addEventListener('message', onMsg);
 *     window.parent.postMessage({ __micyou: 1, id, api, args }, '*');
 *   });
 * }
 * ```
 * 可用 api：get_config / set_config / trigger / play / open_window / log / get_logs / get_sync_status / locale
 */
export function usePluginPanelBridge(pluginId: string, frame: Ref<HTMLIFrameElement | null>) {
  async function routeApi(api: string, args: Record<string, unknown>): Promise<unknown> {
    switch (api) {
      case 'get_config':
        return command('get_plugin_config', { id: pluginId });
      case 'set_config':
        return command('set_plugin_config', {
          id: pluginId,
          key: (args.key ?? '') as string,
          value: args.value,
        });
      case 'trigger':
        return command('plugin_trigger', {
          pluginId,
          action: (args.action ?? '') as string,
          payload: (args.payload ?? null) as string | null,
        });
      case 'open_window':
        return command('plugin_trigger', {
          pluginId,
          action: 'open_window',
          payload: JSON.stringify(args),
        });
      case 'play':
        return command('plugin_trigger', {
          pluginId,
          action: 'play',
          payload: JSON.stringify(args),
        });
      case 'log':
        return command('plugin_trigger', {
          pluginId,
          action: 'log',
          payload: JSON.stringify({
            level: args.level ?? 'info',
            message: args.message ?? '',
          }),
        });
      case 'get_logs':
        return command('get_plugin_logs', { id: pluginId });
      case 'get_sync_status':
        return command('get_plugin_sync_status');
      case 'locale':
        return command('get_app_locale');
      default:
        throw new Error(`unknown panel api: ${api}`);
    }
  }

  /** 宿主侧 message 监听器；只接受本插件面板 iframe 发来的消息 */
  function handleMessage(e: MessageEvent) {
    if (!e.source || e.source !== frame.value?.contentWindow) return;
    const d = e.data as Record<string, unknown> | null | undefined;
    if (!d || d.__micyou !== 1 || typeof d.id !== 'string' || typeof d.api !== 'string') {
      return;
    }
    const { id, api, args } = d;
    routeApi(api, (args as Record<string, unknown>) ?? {})
      .then((value) => {
        e.source?.postMessage({ __micyou: 1, id, ok: true, value }, { targetOrigin: '*' });
      })
      .catch((err) => {
        e.source?.postMessage(
          { __micyou: 1, id, ok: false, error: String(err) },
          { targetOrigin: '*' },
        );
      });
  }

  return { handleMessage };
}
