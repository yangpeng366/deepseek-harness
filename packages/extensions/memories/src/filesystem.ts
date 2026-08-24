/**
 * Placeholder filesystem provider for `@deepseek-ai/dsh-memories`.
 *
 * The implementation lands behind this contract: one record round-trips under
 * `~/.dsh/memories/<profile>/<scope>/`. Until then the provider throws on
 * record and returns an empty list on recall, so callers see a defined shape
 * without touching the filesystem.
 */

import type { MemoryEntry, MemoryQuery } from './index.js';

export interface FilesystemMemoryProviderOptions {
  profile: string;
  rootDir?: string;
}

export class FilesystemMemoryProvider {
  readonly #profile: string;
  readonly #rootDir: string;

  constructor(options: FilesystemMemoryProviderOptions) {
    this.#profile = options.profile;
    this.#rootDir = options.rootDir ?? `~/.dsh/memories/${options.profile}`;
  }

  async recall(_query: MemoryQuery): Promise<MemoryEntry[]> {
    return [];
  }

  async record(_scope: string, _key: string, _value: string): Promise<void> {
    throw new Error('@deepseek-ai/dsh-memories: filesystem provider not yet implemented');
  }
}

export default FilesystemMemoryProvider;