/**
 * Save storage backends (design §29.9: IndexedDB on the web). Metadata and blobs live in separate
 * object stores so listing saves never reads the (large) blobs. `MemorySaveBackend` serves tests
 * and browsers where IndexedDB is unavailable (private windows); it keeps saves for the session.
 */

/** What the Save/Load screen lists for each slot. */
export interface SaveMeta {
  /** Slot id: 'manual-<n>', 'auto-1'…'auto-3', or 'ironman-<seed>'. */
  id: string;
  kind: 'manual' | 'auto' | 'ironman';
  /** Player-entered name (manual) or generated label. */
  name: string;
  /** Wall-clock time of the save (ms since epoch; client-side only). */
  savedAt: number;
  /** Game hour of the saved state. */
  hour: number;
  rulerName: string;
  houseName: string;
  capitalName: string;
  seed: string;
  difficulty: string;
  ironman: boolean;
  playtimeSec: number;
  gameVersion: string;
  /** Size of the save blob in characters. */
  size: number;
}

export interface SaveBackend {
  /** All save metadata (unsorted). */
  list(): Promise<SaveMeta[]>;
  getBlob(id: string): Promise<string | undefined>;
  put(meta: SaveMeta, blob: string): Promise<void>;
  delete(id: string): Promise<void>;
}

/** In-memory backend (tests, fallback). */
export class MemorySaveBackend implements SaveBackend {
  private readonly metas: Record<string, SaveMeta> = {};
  private readonly blobs: Record<string, string> = {};

  async list(): Promise<SaveMeta[]> {
    return Object.values(this.metas).map((m) => ({ ...m }));
  }
  async getBlob(id: string): Promise<string | undefined> {
    return Object.hasOwn(this.blobs, id) ? this.blobs[id] : undefined;
  }
  async put(meta: SaveMeta, blob: string): Promise<void> {
    this.metas[meta.id] = { ...meta };
    this.blobs[meta.id] = blob;
  }
  async delete(id: string): Promise<void> {
    delete this.metas[id];
    delete this.blobs[id];
  }
}

const DB_NAME = 'bardia';
const DB_VERSION = 1;
const META = 'saveMeta';
const BLOBS = 'saveBlobs';

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

/** IndexedDB backend: database 'bardia', stores 'saveMeta' and 'saveBlobs' (keyPath 'id'). */
export class IndexedDbSaveBackend implements SaveBackend {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly dbName: string = DB_NAME,
  ) {}

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = this.factory.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open the save database'));
      req.onblocked = () => reject(new Error('The save database is blocked by another tab'));
    });
    return this.dbPromise;
  }

  async list(): Promise<SaveMeta[]> {
    const db = await this.db();
    const tx = db.transaction(META, 'readonly');
    return (await promisify(tx.objectStore(META).getAll())) as SaveMeta[];
  }

  async getBlob(id: string): Promise<string | undefined> {
    const db = await this.db();
    const tx = db.transaction(BLOBS, 'readonly');
    const row = (await promisify(tx.objectStore(BLOBS).get(id))) as { id: string; blob: string } | undefined;
    return row?.blob;
  }

  async put(meta: SaveMeta, blob: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([META, BLOBS], 'readwrite');
    tx.objectStore(BLOBS).put({ id: meta.id, blob });
    tx.objectStore(META).put(meta);
    await txDone(tx);
  }

  async delete(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([META, BLOBS], 'readwrite');
    tx.objectStore(BLOBS).delete(id);
    tx.objectStore(META).delete(id);
    await txDone(tx);
  }
}

/** The best backend available in this environment. */
export function createDefaultBackend(): SaveBackend {
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB !== null) return new IndexedDbSaveBackend(indexedDB);
  } catch {
    // Access to indexedDB can throw in sandboxed contexts.
  }
  return new MemorySaveBackend();
}
