/**
 * Hosted entry point: serves the production build in `dist/` with the same
 * provider middleware as local development, behind an access key.
 *
 *   GEV_ACCESS_KEY  required, at least 16 characters
 *   GEV_PUBLIC_HOST the hostname browsers use, e.g. gev.concise.design
 *   PORT            listen port (Passenger and most hosts set this)
 *
 * Provider keys (OPENAI_API_KEY, AISSTREAM_API_KEY, ...) are read from the
 * environment or a `.env` file in the project root, as in local development.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { accessGatePlugin } from './access-gate.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

if (!existsSync(new URL('../../dist/index.html', import.meta.url))) {
  throw new Error(
    'dist/ is missing: run `npm run build` before starting the hosted server.',
  );
}

const publicHost = process.env.GEV_PUBLIC_HOST?.trim();
const server = await preview({
  root,
  configFile: fileURLToPath(
    new URL('../standalone/vite.config.js', import.meta.url),
  ),
  plugins: [accessGatePlugin(process.env.GEV_ACCESS_KEY)],
  preview: {
    host: process.env.HOST || '0.0.0.0',
    port: parseInt(process.env.PORT, 10) || 4173,
    strictPort: true,
    allowedHosts: publicHost ? [publicHost] : true,
    open: false,
  },
});

server.printUrls();
