import { Database } from "@db/sqlite";

// Database store interface for dependency injection in tests
export interface KVStore {
  get(key: string): string | null;
  set(key: string, value: string | null): void;
  del(key: string): void;
  has(key: string): boolean;
  all(): Array<{ key: string; value: string | null }>;
  clear(): void;
  close(): void;
}

// Create a KV store backed by SQLite
export function createKVStore(dbPath: string | ":memory:"): KVStore {
  const db = new Database(dbPath);

  // Initialize key-value table
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  return {
    get(key: string): string | null {
      const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string | null } | undefined;
      return row?.value ?? null;
    },

    set(key: string, value: string | null): void {
      db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(key, value);
    },

    del(key: string): void {
      db.prepare("DELETE FROM kv WHERE key = ?").run(key);
    },

    has(key: string): boolean {
      const row = db.prepare("SELECT 1 FROM kv WHERE key = ?").get(key);
      return row !== undefined;
    },

    all(): Array<{ key: string; value: string | null }> {
      return db.prepare("SELECT key, value FROM kv").all() as Array<{ key: string; value: string | null }>;
    },

    clear(): void {
      db.exec("DELETE FROM kv");
    },

    close(): void {
      db.close();
    },
  };
}

// Create an in-memory KV store for testing (no SQLite dependency)
export function createInMemoryKVStore(): KVStore {
  const store = new Map<string, string | null>();

  return {
    get(key: string): string | null {
      return store.get(key) ?? null;
    },

    set(key: string, value: string | null): void {
      store.set(key, value);
    },

    del(key: string): void {
      store.delete(key);
    },

    has(key: string): boolean {
      return store.has(key);
    },

    all(): Array<{ key: string; value: string | null }> {
      return Array.from(store.entries()).map(([key, value]) => ({ key, value }));
    },

    clear(): void {
      store.clear();
    },

    close(): void {
      store.clear();
    },
  };
}

// Lazily initialized default store
let defaultStore: KVStore | null = null;

function getDefaultStore(): KVStore {
  if (!defaultStore) {
    throw new Error("Database not initialized. Call init() first.");
  }
  return defaultStore;
}

// Initialize the default store with a given path
export function init(dbPath: string): void {
  if (defaultStore) {
    throw new Error("Database already initialized.");
  }
  defaultStore = createKVStore(dbPath);
}

// Export functions that use the default store
export function get(key: string): string | null {
  return getDefaultStore().get(key);
}

export function set(key: string, value: string | null): void {
  getDefaultStore().set(key, value);
}

export function del(key: string): void {
  getDefaultStore().del(key);
}

export function has(key: string): boolean {
  return getDefaultStore().has(key);
}

export function all(): Array<{ key: string; value: string | null }> {
  return getDefaultStore().all();
}

export function close(): void {
  getDefaultStore().close();
  defaultStore = null;
}
