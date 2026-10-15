// Writes the class of every test design (test/fixtures.mjs) to .verify/abap,
// for 7.40 and for 7.02 (*_702.clas.abap), for the abap2UI5 linter (npm run
// check:abap), abaplint's 7.02 check (npm run check:abap702) and the runtime
// check (npm run verify:abap) - and an imported, edited class, whose
// export is the patched original (src/clas.js).
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { allDesigns, allDesigns702, importedDesigns } from '../test/fixtures.mjs';
import { generateClass, fileName } from '../src/abap.js';
import { fromClass, generateClassSource } from '../src/clas.js';

export const WORK = fileURLToPath(new URL('../.verify', import.meta.url));

export async function writeClasses() {
  const designs = [...allDesigns(), ...allDesigns702(), ...importedDesigns(fromClass, generateClass)];
  await rm(WORK, { recursive: true, force: true });
  await mkdir(`${WORK}/abap`, { recursive: true });
  for (const [, d] of designs) await writeFile(`${WORK}/abap/${fileName(d.className, 'clas.abap')}`, generateClassSource(d));
  return designs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const designs = await writeClasses();
  console.log(`${designs.length} classes -> .verify/abap`);
}
