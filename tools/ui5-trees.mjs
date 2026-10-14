// Assembles OpenUI5 resource trees from the @openui5/* npm packages, for a
// machine that cannot reach the OpenUI5 CDN - the browser tests and the
// metadata dump take them through tools/serve.mjs:
//
//   node tools/ui5-trees.mjs 1.144.0 1.71.80      -> .ui5/<version>/
//   UI5_RESOURCES=.ui5/1.144.0 UI5_RESOURCES_171=.ui5/1.71.80 npm run test:e2e
//   UI5_RESOURCES=.ui5/1.71.80 npm run ui5:metadata
//
// A tree is the src/ of each package copied into one folder: sap.ui.core,
// sap.m, sap.ui.layout, sap.ui.unified, sap.f, sap.uxap, sap.ui.table and the theme libraries the canvas
// offers. Nothing is downloaded twice: a tree that is there is kept.
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LIBS = ['sap.ui.core', 'sap.m', 'sap.ui.layout', 'sap.ui.unified', 'sap.f', 'sap.uxap', 'sap.ui.table', 'themelib_sap_fiori_3', 'themelib_sap_belize'];

for (const version of process.argv.slice(2)) {
  const tree = join(ROOT, '.ui5', version);
  if (await stat(join(tree, 'sap-ui-core.js')).catch(() => null)) { console.log(`${version}: ${tree} is there`); continue; }
  const minor = Number(version.split('.')[1]);
  const libs = minor >= 102 ? [...LIBS, 'themelib_sap_horizon'] : LIBS;
  const work = join(ROOT, '.ui5', `_pkg-${version}`);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await writeFile(join(work, 'package.json'), '{"name":"ui5-tree","private":true}\n');
  console.log(`${version}: installing ${libs.length} packages…`);
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock', ...libs.map((l) => `@openui5/${l}@${version}`)], { cwd: work, stdio: 'inherit' });
  await mkdir(tree, { recursive: true });
  for (const l of libs) await cp(join(work, 'node_modules', '@openui5', l, 'src'), tree, { recursive: true });
  await rm(work, { recursive: true, force: true });
  console.log(`${version}: ${tree}`);
}
