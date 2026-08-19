import { defineContentScript } from 'wxt/utils/define-content-script';
import { ContentMessage, TranslateRequest } from '@/utils/shared';

const SKIP_SELECTOR =
  'code,pre,kbd,samp,script,style,noscript,textarea,select,option,iframe,template,svg,math,' +
  '[class*="katex"],[contenteditable="true"],[contenteditable=""],[aria-hidden="true"],[hidden],' +
  '[style*="display:none"],[style*="display: none"],.sr-only,.visually-hidden,.hidden,[data-mt-ui]';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    let translated = false;
    let noKeyNotified = false;
    let invalidKeyNotified = false;
    let originals = new Map<Text, string>();
    let activeSessions = new Set<string>();
    let sessionNodes = new Map<string, Text[]>();
    let sessionRemaining = new Map<string, number>();
    let totalBatches = 0;
    let doneBatches = 0;
    let failedBatches = 0;
    let statusRoot: HTMLElement | null = null;
    let port: chrome.runtime.Port | null = null;
    let observer: MutationObserver | null = null;
    let debounceTimer: number | null = null;

    chrome.runtime.onMessage.addListener((msg: ContentMessage) => {
      if (!msg) return;
      switch (msg.type) {
        case 'TOGGLE_TRANSLATE':
          if (translated) restore();
          else startTranslate();
          break;
        case 'TRANSLATE_START':
          if (!translated) startTranslate();
          break;
        case 'RESTORE':
          if (translated) restore();
          break;
        case 'BATCH_TRANSLATED':
          applyBatch(msg.payload);
          break;
        case 'BATCH_FAILED':
          onBatchFailed(msg.payload);
          break;
      }
    });

    function startTranslate(): void {
      const nodes = collectNodes(pickRoot());
      if (nodes.length === 0) {
        flash('没有检测到可翻译的英文内容');
        return;
      }
      translated = true;
      noKeyNotified = false;
      invalidKeyNotified = false;
      startObserver();
      translateNodes(nodes);
    }

    function translateNodes(nodes: Text[]): void {
      if (nodes.length === 0) return;
      sortViewportFirst(nodes);
      for (const n of nodes) originals.set(n, n.textContent ?? '');

      const batches = buildBatches(nodes);
      if (batches.length === 0) return;

      const sessionId = 's' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      activeSessions.add(sessionId);
      sessionNodes.set(sessionId, nodes);
      sessionRemaining.set(sessionId, batches.length);
      totalBatches += batches.length;

      openPort();
      showStatus();

      const req: TranslateRequest = { sessionId, batches };
      chrome.runtime.sendMessage({ type: 'TRANSLATE_PAGE', payload: req }).catch(() => {});
    }

    function applyBatch(payload: {
      sessionId: string;
      batchId: number;
      translations: { id: number; text: string }[];
    }): void {
      if (!activeSessions.has(payload.sessionId)) return;
      const sessionId = payload.sessionId;
      const nodes = sessionNodes.get(sessionId);
      if (!nodes) return;

      requestAnimationFrame(() => {
        // 二次校验：会话可能已取消/还原
        if (!activeSessions.has(sessionId)) return;
        for (const t of payload.translations) {
          const node = nodes[t.id];
          if (!node) continue;
          const orig = originals.get(node);
          if (orig == null) continue; // 已被还原
          node.textContent = restoreWhitespace(orig, t.text);
        }
      });

      doneBatches++;
      decrementSession(sessionId);
      updateStatus();
    }

    function onBatchFailed(payload: { sessionId: string; batchId: number; reason: string }): void {
      if (!activeSessions.has(payload.sessionId)) return;

      // 无 Key / Key 无效：整页都不会被翻译，重置状态，避免残留"已翻译"假象
      if (payload.reason === 'NO_API_KEY' || payload.reason === 'INVALID_KEY') {
        cancelAllSessions();
        originals.clear();
        totalBatches = 0;
        doneBatches = 0;
        failedBatches = 0;
        translated = false;
        removeStatus();
        if (payload.reason === 'NO_API_KEY') {
          if (!noKeyNotified) {
            noKeyNotified = true;
            flash('请右键扩展图标 →「选项」填写 DeepSeek API Key');
          }
        } else if (!invalidKeyNotified) {
          invalidKeyNotified = true;
          flash('API Key 无效，请检查后重新填写');
        }
        return;
      }

      failedBatches++;
      decrementSession(payload.sessionId);
      updateStatus();
    }

    function decrementSession(sessionId: string): void {
      const r = sessionRemaining.get(sessionId);
      if (r == null) return;
      const nr = r - 1;
      if (nr <= 0) {
        sessionRemaining.delete(sessionId);
        activeSessions.delete(sessionId);
        sessionNodes.delete(sessionId);
        maybeClosePort();
      } else {
        sessionRemaining.set(sessionId, nr);
      }
    }

    function restore(): void {
      cancelAllSessions();
      observer?.disconnect();
      observer = null;
      for (const [node, orig] of originals) {
        node.textContent = orig;
      }
      originals.clear();
      totalBatches = 0;
      doneBatches = 0;
      failedBatches = 0;
      translated = false;
      removeStatus();
      flash('已还原原文');
    }

    function cancel(): void {
      cancelAllSessions();
      updateStatus('已取消，保留已翻译内容');
    }

    function cancelAllSessions(): void {
      for (const s of activeSessions) {
        chrome.runtime
          .sendMessage({ type: 'CANCEL_SESSION', payload: { sessionId: s } })
          .catch(() => {});
      }
      activeSessions.clear();
      sessionRemaining.clear();
      sessionNodes.clear();
      closePort();
    }

    // ---------- 保活 ----------

    function openPort(): void {
      if (!port) {
        try {
          port = chrome.runtime.connect({ name: 'mt-translate' });
        } catch {
          port = null;
        }
      }
    }

    function closePort(): void {
      port?.disconnect();
      port = null;
    }

    function maybeClosePort(): void {
      if (activeSessions.size === 0 && sessionRemaining.size === 0) closePort();
    }

    // ---------- 动态内容 ----------

    function startObserver(): void {
      if (observer) return;
      observer = new MutationObserver(() => {
        if (debounceTimer != null) clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
          if (!translated) return;
          const nodes = collectNodes(pickRoot());
          if (nodes.length > 0) translateNodes(nodes);
        }, 500);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    // ---------- 提取 ----------

    function collectNodes(root: ParentNode): Text[] {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const out: Text[] = [];
      let n: Node | null;
      while ((n = walker.nextNode())) {
        if (originals.has(n as Text)) continue;
        const text = (n.textContent ?? '').trim();
        if (!text) continue;
        const parent = n.parentElement;
        if (!parent) continue;
        if (parent.closest(SKIP_SELECTOR)) continue;
        if (text.length < 2) continue;

        let latin = 0;
        for (let i = 0; i < text.length; i++) {
          const c = text.charCodeAt(i);
          if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) latin++;
        }
        if (latin < 2) continue;

        out.push(n as Text);
      }
      return out;
    }

    function pickRoot(): ParentNode {
      const cand = document.querySelector(
        'article, main, [role="main"], .markdown-body, .main-content'
      );
      return (cand as Element) ?? document.body;
    }

    function sortViewportFirst(nodes: Text[]): void {
      const vh = window.innerHeight;
      nodes.sort((a, b) => {
        const ra = a.parentElement?.getBoundingClientRect();
        const rb = b.parentElement?.getBoundingClientRect();
        const inA = ra && ra.top < vh + 800 && ra.bottom > -800 ? 1 : 0;
        const inB = rb && rb.top < vh + 800 && rb.bottom > -800 ? 1 : 0;
        return inB - inA;
      });
    }

    function buildBatches(nodes: Text[]): { batchId: number; items: { id: number; text: string }[] }[] {
      const batches: { batchId: number; items: { id: number; text: string }[] }[] = [];
      let cur: { batchId: number; items: { id: number; text: string }[] } = { batchId: 0, items: [] };
      let chars = 0;
      let isFirst = true;

      nodes.forEach((n, id) => {
        const text = (n.textContent ?? '').trim();
        if (!text) return;
        const itemLimit = isFirst ? 6 : 15;
        const charLimit = isFirst ? 1000 : 2500;
        if (cur.items.length >= itemLimit || chars + text.length > charLimit) {
          if (cur.items.length) {
            batches.push(cur);
            isFirst = false;
          }
          cur = { batchId: batches.length, items: [] };
          chars = 0;
        }
        cur.items.push({ id, text });
        chars += text.length;
      });
      if (cur.items.length) batches.push(cur);
      return batches;
    }

    function restoreWhitespace(original: string, translated: string): string {
      const lead = original.match(/^\s*/)?.[0] ?? '';
      const trail = original.match(/\s*$/)?.[0] ?? '';
      return lead + translated.trim() + trail;
    }

    // ---------- 状态 UI ----------

    function ensureStatus(): HTMLElement {
      if (!statusRoot || !document.body.contains(statusRoot)) {
        statusRoot = document.createElement('div');
        statusRoot.id = '__magic_translate_status';
        statusRoot.setAttribute('data-mt-ui', '');
        statusRoot.style.cssText =
          'position:fixed;top:8px;right:8px;z-index:2147483647;background:#111827;color:#fff;' +
          'padding:8px 12px;border-radius:8px;font:13px/1.5 system-ui,Segoe UI,sans-serif;' +
          'box-shadow:0 2px 12px rgba(0,0,0,.35);display:flex;align-items:center;gap:10px;max-width:80vw;';
        document.body.appendChild(statusRoot);
      }
      return statusRoot;
    }

    function showStatus(): void {
      const el = ensureStatus();
      el.innerHTML =
        `<span id="__mt_text">翻译中 0/${totalBatches}</span>` +
        `<button id="__mt_cancel" style="cursor:pointer;border:0;background:#374151;color:#fff;` +
        `padding:3px 8px;border-radius:5px;font:inherit;">取消</button>`;
      el.querySelector('#__mt_cancel')?.addEventListener('click', cancel);
    }

    function updateStatus(text?: string): void {
      const el = statusRoot;
      if (!el || !document.body.contains(el)) return;
      const t = el.querySelector('#__mt_text');
      if (t) {
        if (text) t.textContent = text;
        else {
          t.textContent =
            failedBatches > 0
              ? `翻译中 ${doneBatches}/${totalBatches}（${failedBatches} 段失败）`
              : `翻译中 ${doneBatches}/${totalBatches}`;
        }
      }
      if (doneBatches + failedBatches >= totalBatches && activeSessions.size === 0) {
        setTimeout(() => {
          const t2 = el.querySelector('#__mt_text');
          if (t2) t2.textContent = failedBatches > 0 ? `完成（${failedBatches} 段失败）` : '完成';
        }, 400);
      }
    }

    function removeStatus(): void {
      statusRoot?.remove();
      statusRoot = null;
    }

    function flash(text: string): void {
      const el = document.createElement('div');
      el.setAttribute('data-mt-ui', '');
      el.textContent = text;
      el.style.cssText =
        'position:fixed;top:8px;right:8px;z-index:2147483647;background:#111827;color:#fff;' +
        'padding:8px 12px;border-radius:8px;font:13px/1.5 system-ui,Segoe UI,sans-serif;' +
        'box-shadow:0 2px 12px rgba(0,0,0,.35);';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3000);
    }
  }
});
