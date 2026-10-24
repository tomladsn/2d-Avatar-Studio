import { readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const project = await realpath(resolve('projects/man'));
  const rig = JSON.parse(await readFile(resolve(project, 'rig.json'), 'utf8'));
  const built = await realpath(resolve(project, 'built'));

  const assets = {};
  async function asset(name) {
    const path = await realpath(resolve(built, name));
    assets[name] = `data:${name.endsWith('.png') ? 'image/png' : 'application/json'};base64,${(await readFile(path)).toString('base64')}`;
  }
  await asset('layers.json');
  const layers = JSON.parse(await readFile(resolve(built, 'layers.json'), 'utf8'));
  await Promise.all(['base', 'hairmask', ...Object.keys(layers.layers)].map(name => asset(`${name}.png`)));

  const server = await createServer({
    root, configFile: false, publicDir: false, appType: 'custom',
    cacheDir: 'node_modules/.vite-mouth-gen', optimizeDeps: { noDiscovery: true, entries: [] },
    plugins: [{
      name: 'mouth-gen-page', configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== '/__mouth_gen__') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><html><body style="margin:0"><canvas id="avatar"></canvas></body></html>');
        });
      }
    }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null, preTransformRequests: false },
    logLevel: 'error'
  });

  await server.listen();
  const address = server.httpServer.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/__mouth_gen__`);
    const results = await page.evaluate(async ({ rig, assets }) => {
      const { createMeshAvatar, PARAMS } = await import('/packages/runtime/src/index.ts');
      const canvas = document.getElementById('avatar');
      canvas.width = rig.image.width;
      canvas.height = rig.image.height;
      canvas.style.width = `${rig.image.width}px`;
      canvas.style.height = `${rig.image.height}px`;
      const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));

      // 4 mouth shapes:
      const vowels = [
        ['mouth_a', { mouthOpen: 0.95, mouthForm: 0.0 }],
        ['mouth_a_half', { mouthOpen: 0.55, mouthForm: 0.0 }],
        ['mouth_i', { mouthOpen: 0.60, mouthForm: -0.85 }],
        ['mouth_o', { mouthOpen: 0.80, mouthForm: 0.85 }],
      ];

      const out = [];
      for (const [name, params] of vowels) {
        const av = await createMeshAvatar(canvas, { rig, assets, manual: true, padTop: 0, padSide: 0 });
        av.setAutoIdle(false);
        av.setAutoMotion(false);
        av.setParameters({ ...defaults, ...params });
        av.advance(1, 60);
        out.push([name, canvas.toDataURL('image/png')]);
        av.destroy();
      }
      return out;
    }, { rig, assets });

    for (const [name, dataUrl] of results) {
      const base64 = dataUrl.split(',')[1];
      const outPath = resolve(project, 'variants', `${name}.png`);
      await writeFile(outPath, Buffer.from(base64, 'base64'));
      console.log(`Rendered 1:1 variant: ${name}.png`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
