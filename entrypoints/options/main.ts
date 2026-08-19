import { Settings } from '@/utils/shared';

async function load(): Promise<void> {
  const s = await chrome.storage.local.get('settings');
  const settings = (s.settings as Settings) ?? { apiKey: '', targetLang: '简体中文' };
  (document.getElementById('apiKey') as HTMLInputElement).value = settings.apiKey ?? '';
  (document.getElementById('targetLang') as HTMLSelectElement).value = settings.targetLang ?? '简体中文';
}

document.getElementById('save')!.addEventListener('click', async () => {
  const apiKey = (document.getElementById('apiKey') as HTMLInputElement).value.trim();
  const targetLang = (document.getElementById('targetLang') as HTMLSelectElement).value;
  await chrome.storage.local.set({ settings: { apiKey, targetLang } });
  const status = document.getElementById('status')!;
  status.textContent = '已保存';
  setTimeout(() => (status.textContent = ''), 1500);
});

void load();
