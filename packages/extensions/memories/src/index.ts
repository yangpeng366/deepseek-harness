/**
 * Placeholder entry for `@deepseek-ai/dsh-memories`.
 *
 * The seam (`ctx.memories`) and the model-facing `memory_recall` tool land
 * behind this contract; until then the package exports a no-op service so
 * the workspace stays importable.
 */

import type { Context } from '@deepseek-ai/cordis';
import { FilesystemMemoryProvider } from './filesystem.js';

export interface MemoryEntry {
  scope: string;
  key: string;
  value: string;
  recordedAt: number;
}

export interface MemoryQuery {
  scope: string;
  query?: string;
  limit?: number;
}

export interface MemoriesService {
  recall(query: MemoryQuery): Promise<MemoryEntry[]>;
  record(scope: string, key: string, value: string): Promise<void>;
}

export interface MemoriesConfig {
  profile: string;
  rootDir?: string;
}

export const MemoriesService = {
  name: '@deepseek-ai/dsh-memories',
  apply(ctx: Context, config: MemoriesConfig): MemoriesService {
    const provider = new FilesystemMemoryProvider({
      profile: config.profile,
      rootDir: config.rootDir,
    });
    return {
      recall: (query) => provider.recall(query),
      record: (scope, key, value) => provider.record(scope, key, value),
    };
  },
};

export { FilesystemMemoryProvider } from './filesystem.js';
export default MemoriesService;