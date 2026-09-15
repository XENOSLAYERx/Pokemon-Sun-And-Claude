/**
 * Browser save storage.
 *
 * `SaveManager` owns the write protocol — temp key, verify, promote, keep a
 * backup — so all this has to do is be a reliable key/value store, and be
 * honest when it is not one. localStorage throws rather than returning an
 * error in a private window and when the quota is exceeded, and a save system
 * that treats a throw as "no save exists" silently deletes people's games.
 */
import type { SaveStorage } from '@alola/save';

export class LocalStorageAdapter implements SaveStorage {
  private readonly prefix: string;

  constructor(prefix = '') {
    this.prefix = prefix;
  }

  /** Is localStorage actually usable here? */
  static available(): boolean {
    try {
      const probe = '__alola_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  read(key: string): Promise<string | null> {
    return Promise.resolve(window.localStorage.getItem(this.prefix + key));
  }

  write(key: string, value: string): Promise<void> {
    try {
      window.localStorage.setItem(this.prefix + key, value);
      return Promise.resolve();
    } catch (error) {
      // Surface it. SaveManager's verify step would otherwise read back the
      // *previous* value, find it different, and report a corrupt write when
      // the real problem is a full quota.
      return Promise.reject(
        new Error(`Could not write save data — browser storage refused it (${String(error)}).`),
      );
    }
  }

  delete(key: string): Promise<void> {
    window.localStorage.removeItem(this.prefix + key);
    return Promise.resolve();
  }

  list(): Promise<string[]> {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key === null) continue;
      if (this.prefix && !key.startsWith(this.prefix)) continue;
      keys.push(this.prefix ? key.slice(this.prefix.length) : key);
    }
    return Promise.resolve(keys);
  }
}
