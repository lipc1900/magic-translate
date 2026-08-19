import { defineBackground } from 'wxt/utils/define-background';
import {
  BackgroundMessage,
  ContentMessage,
  Settings,
  TranslateBatch,
  TranslateRequest,
  hashText,
  normalizeText
} from '@/utils/shared';

const SYSTEM_PROMPT =
  '你是专业的中英译者。把用户 items 数组里的每段英文翻译成简体中文，严格只输出一个 JSON 对象，格式为 ' +
  '{"translations":["译文1","译文2",...]}，数组长度必须与 items 完全一致、顺序一致。' +
  '要求：1) 术语准确、语句通顺自然；2) 只输出译文，不要解释、不要遗漏、不要新增条目；' +
  '3) 技术标识符（变量名、API 名、命令、路径）保持原文不翻译。';

let lastOptionsOpen = 0;

export default defineBackground(() => {
  const activeSessions = new Set<string>();

  async function getSettings(): Promise<Settings> {
    const s = await chrome.storage.local.get('settings');
    return (s.settings as Settings) ?? { apiKey: '', targetLang: '简体中文' };
  }

  async function cacheGet(key: string): Promise<string | null> {
    const r = await chrome.storage.local.get('cache:' + key);
    return (r['cache:' + key] as string) ?? null;
  }

  async function cacheSet(key: string, val: string): Promise<void> {
    try {
      await chrome.storage.local.set({ ['cache:' + key]: val });
    } catch {
      // 超配额 / 单条超 8KB 时忽略缓存，不影响翻译结果
    }
  }

  class InvalidKeyError extends Error {}

  async function translateItems(items: { id: number; text: string }[], apiKey: string): Promise<string[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          response_format: { type: 'json_object' },
          temperature: 0.2,
          top_p: 0.9,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify({ items: items.map((i) => i.text) }) }
          ]
        })
      });

      if (res.status === 401) throw new InvalidKeyError('API Key 无效');
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`DeepSeek ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = await res.json();
      const content: string = data.choices?.[0]?.message?.content ?? '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new Error('DeepSeek 返回的不是合法 JSON');
      }
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { translations?: unknown })?.translations)
          ? (parsed as { translations: unknown[] }).translations
          : [];
      return arr.map((x) => String(x ?? ''));
    } finally {
      clearTimeout(timer);
    }
  }

  async function processBatch(tabId: number, req: TranslateRequest, batch: TranslateBatch): Promise<void> {
    if (!activeSessions.has(req.sessionId)) return;

    const settings = await getSettings();
    if (!settings.apiKey) {
      openOptions();
      send(tabId, {
        type: 'BATCH_FAILED',
        payload: { sessionId: req.sessionId, batchId: batch.batchId, reason: 'NO_API_KEY' }
      });
      return;
    }

    const resolved = await Promise.all(
      batch.items.map(async (item) => ({ item, cached: await cacheGet(hashText(normalizeText(item.text))) }))
    );

    const translations: { id: number; text: string }[] = [];
    const missing: { id: number; text: string }[] = [];
    for (const { item, cached } of resolved) {
      if (cached != null) translations.push({ id: item.id, text: cached });
      else missing.push(item);
    }

    if (missing.length > 0) {
      const keys = missing.map((m) => hashText(normalizeText(m.text)));
      let out: string[];
      try {
        out = await translateItems(missing, settings.apiKey);
      } catch (e) {
        if (e instanceof InvalidKeyError) {
          openOptions();
          send(tabId, {
            type: 'BATCH_FAILED',
            payload: { sessionId: req.sessionId, batchId: batch.batchId, reason: 'INVALID_KEY' }
          });
          return;
        }
        await sleep(600);
        try {
          out = await translateItems(missing, settings.apiKey);
        } catch (e2) {
          if (e2 instanceof InvalidKeyError) {
            openOptions();
            send(tabId, {
              type: 'BATCH_FAILED',
              payload: { sessionId: req.sessionId, batchId: batch.batchId, reason: 'INVALID_KEY' }
            });
            return;
          }
          throw e2 instanceof Error ? e2 : new Error(String(e2));
        }
      }
      for (let i = 0; i < missing.length; i++) {
        const t = (out[i] ?? '').trim();
        if (t) {
          translations.push({ id: missing[i].id, text: t });
          await cacheSet(keys[i], t);
        } else {
          translations.push({ id: missing[i].id, text: missing[i].text });
        }
      }
    }

    if (!activeSessions.has(req.sessionId)) return; // 翻译期间被取消
    send(tabId, {
      type: 'BATCH_TRANSLATED',
      payload: { sessionId: req.sessionId, batchId: batch.batchId, translations }
    });
  }

  function openOptions(): void {
    if (Date.now() - lastOptionsOpen > 10000) {
      lastOptionsOpen = Date.now();
      chrome.runtime.openOptionsPage().catch(() => {});
    }
  }

  function send(tabId: number, msg: ContentMessage): void {
    chrome.tabs.sendMessage(tabId, msg).catch(() => {});
  }

  function runQueue(tabId: number, req: TranslateRequest): void {
    activeSessions.add(req.sessionId);
    const batches = req.batches;
    const limit = 3;
    let idx = 0;
    let remaining = batches.length;

    const finish = () => {
      remaining--;
      if (remaining <= 0) activeSessions.delete(req.sessionId);
    };

    const worker = async () => {
      while (idx < batches.length) {
        if (!activeSessions.has(req.sessionId)) return;
        const b = batches[idx++];
        try {
          await processBatch(tabId, req, b);
        } catch (e) {
          if (activeSessions.has(req.sessionId)) {
            send(tabId, {
              type: 'BATCH_FAILED',
              payload: { sessionId: req.sessionId, batchId: b.batchId, reason: String(e) }
            });
          }
        } finally {
          finish();
        }
      }
    };

    const n = Math.min(limit, batches.length);
    for (let i = 0; i < n; i++) void worker();
  }

  chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender, sendResponse) => {
    if (msg?.type === 'TRANSLATE_PAGE' && sender.tab?.id != null) {
      runQueue(sender.tab.id, msg.payload);
      sendResponse({ ok: true });
    } else if (msg?.type === 'CANCEL_SESSION') {
      activeSessions.delete(msg.payload.sessionId);
      sendResponse({ ok: true });
    }
    return false;
  });

  chrome.action.onClicked.addListener((tab) => {
    if (tab.id != null) send(tab.id, { type: 'TOGGLE_TRANSLATE' });
  });

  chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-translate') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const id = tabs[0]?.id;
        if (id != null) send(id, { type: 'TOGGLE_TRANSLATE' });
      });
    }
  });

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: 'mt-translate', title: '翻译本页为中文', contexts: ['page'] });
      chrome.contextMenus.create({ id: 'mt-restore', title: '还原原文', contexts: ['page'] });
      chrome.contextMenus.create({ id: 'mt-settings', title: '设置（API Key）', contexts: ['action'] });
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (tab?.id == null) return;
    if (info.menuItemId === 'mt-translate') send(tab.id, { type: 'TRANSLATE_START' });
    else if (info.menuItemId === 'mt-restore') send(tab.id, { type: 'RESTORE' });
    else if (info.menuItemId === 'mt-settings') chrome.runtime.openOptionsPage().catch(() => {});
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
