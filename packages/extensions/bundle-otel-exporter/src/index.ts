/**
 * Placeholder entry for `@deepseek-ai/dsh-bundle-otel-exporter`.
 *
 * The implementation lands behind this contract; until then the package
 * exports a no-op bundle so the workspace stays importable.
 */

import type { Context } from '@deepseek-ai/cordis';

export interface OtelExporterConfig {
  endpoint?: string;
  allowExternal?: boolean;
}

export const OtelExporterBundle = {
  name: '@deepseek-ai/dsh-bundle-otel-exporter',
  apply(ctx: Context, config: OtelExporterConfig = {}): void {
    if (!config.endpoint) return;
    // Implementation lands here once the OTLP gRPC / HTTP client lands.
  },
};

export default OtelExporterBundle;