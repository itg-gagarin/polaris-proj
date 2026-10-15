import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@bom/domain', '@bom/engine', '@bom/collab', '@bom/bom-io', '@bom/dictionary', '@bom/sheets', '@bom/exporters', '@bom/workflow', '@bom/ai', '@bom/db', '@bom/fixtures', '@bom/integrations', '@bom/worker', '@bom/sync'],
  serverExternalPackages: ['pg', '@electric-sql/pglite', 'exceljs', 'officecrypto-tool', '@anthropic-ai/sdk'],
  outputFileTracingRoot: root,
  env: {
    BOM_FIXTURES_DIR: resolve(root, 'fixtures'),
    BOM_DATA_FILE: resolve(root, '.data/db.json'),
  },
  typescript: { tsconfigPath: './tsconfig.json' },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
