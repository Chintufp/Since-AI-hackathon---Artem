/**
 * desktop (B2): api keys for the hosted model provider. The key is encrypted with Electron safeStorage (the macOS
 * keychain holds the encryption key) in the main process and written only to the app's userData folder, never the
 * repo or data/; the service receives it in memory (POST /models/key) when it is saved and after each service start.
 * Pure helpers (no Electron import) so they are testable; main.ts wires safeStorage and ipcMain.
 */
export const KEY_VENDORS = ['anthropic', 'gemini'] as const;
export type KeyVendor = (typeof KEY_VENDORS)[number];
export const KEY_FILE = 'model-keys.json';
const MAX_KEY = 400;

/** Validated `{vendor, key}` from the renderer, or undefined. An empty key means "forget". */
export function parseKeyPayload(p: unknown): { vendor: KeyVendor; key: string } | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const { vendor, key } = p as { vendor?: unknown; key?: unknown };
  if (typeof vendor !== 'string' || !(KEY_VENDORS as readonly string[]).includes(vendor)) return undefined;
  if (typeof key !== 'string') return undefined;
  const k = key.trim();
  if (k.length > MAX_KEY || !/^[\x21-\x7e]*$/.test(k)) return undefined;
  return { vendor: vendor as KeyVendor, key: k };
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

export interface KeyFileIo {
  read(): string | undefined;
  write(text: string): void;
}

interface KeyFile { version: 1; keys: Partial<Record<KeyVendor, string>> }

export interface Keychain {
  /** Encrypt and store; `stored` is false when the OS offers no encryption (the key then lives only in the service's memory). */
  save(vendor: KeyVendor, key: string): { stored: boolean };
  forget(vendor: KeyVendor): { stored: boolean };
  /** Every stored key, decrypted (for handing to a freshly started service). Unreadable entries are skipped. */
  load(): Array<{ vendor: KeyVendor; key: string }>;
}

export function createKeychain(safe: SafeStorageLike, io: KeyFileIo): Keychain {
  const readFile = (): KeyFile => {
    try {
      const j = JSON.parse(io.read() ?? '') as KeyFile;
      return j && j.version === 1 && j.keys && typeof j.keys === 'object' ? j : { version: 1, keys: {} };
    } catch {
      return { version: 1, keys: {} };
    }
  };
  return {
    save(vendor, key) {
      if (!safe.isEncryptionAvailable()) return { stored: false };
      const f = readFile();
      f.keys[vendor] = safe.encryptString(key).toString('base64');
      io.write(JSON.stringify(f));
      return { stored: true };
    },
    forget(vendor) {
      const f = readFile();
      delete f.keys[vendor];
      io.write(JSON.stringify(f));
      return { stored: false };
    },
    load() {
      if (!safe.isEncryptionAvailable()) return [];
      const f = readFile();
      const out: Array<{ vendor: KeyVendor; key: string }> = [];
      for (const vendor of KEY_VENDORS) {
        const c = f.keys[vendor];
        if (!c) continue;
        try {
          out.push({ vendor, key: safe.decryptString(Buffer.from(c, 'base64')) });
        } catch { /* encrypted by another user or machine: skip */ }
      }
      return out;
    },
  };
}

type PostFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Hand a key to the service (memory only there). */
export async function sendKeyToService(serviceUrl: string, vendor: KeyVendor, key: string, fetchFn: PostFetch = (u, i) => fetch(u, i)): Promise<{ present: boolean }> {
  const res = await fetchFn(`${serviceUrl}/models/key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: vendor, key }), signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error('the service did not accept the key');
  const j = (await res.json()) as { present?: boolean };
  return { present: !!j.present };
}
