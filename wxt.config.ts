import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Magic Translate',
    description: '一键整页英文翻译成中文（DeepSeek）',
    version: '0.1.0',
    permissions: ['storage', 'contextMenus'],
    host_permissions: ['https://api.deepseek.com/*'],
    commands: {
      'toggle-translate': {
        suggested_key: { default: 'Alt+T' },
        description: '翻译/还原当前页面'
      }
    },
    action: {
      default_title: 'Magic Translate'
    }
  }
});
