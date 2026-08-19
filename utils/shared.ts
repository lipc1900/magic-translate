export interface Settings {
  apiKey: string;
  targetLang: string;
}

export interface TranslateItem {
  id: number;
  text: string;
}

export interface TranslateBatch {
  batchId: number;
  items: TranslateItem[];
}

export interface TranslateRequest {
  sessionId: string;
  batches: TranslateBatch[];
}

export interface BatchTranslation {
  id: number;
  text: string;
}

export interface BatchResult {
  sessionId: string;
  batchId: number;
  translations: BatchTranslation[];
}

export type ContentMessage =
  | { type: 'TOGGLE_TRANSLATE' }
  | { type: 'TRANSLATE_START' }
  | { type: 'RESTORE' }
  | { type: 'BATCH_TRANSLATED'; payload: BatchResult }
  | { type: 'BATCH_FAILED'; payload: { sessionId: string; batchId: number; reason: string } };

export type BackgroundMessage =
  | { type: 'TRANSLATE_PAGE'; payload: TranslateRequest }
  | { type: 'CANCEL_SESSION'; payload: { sessionId: string } };

/** 折叠空白并去首尾，用于缓存 key，避免同一文本因空白差异重复请求 */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** FNV-1a 32bit + 长度，作为缓存 key（碰撞概率对个人缓存可忽略） */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + '_' + s.length.toString(16);
}
