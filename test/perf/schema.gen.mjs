import { writeFile } from 'node:fs/promises';

const NT = 60;
const NF = 30;
const lines = [`import { leaf, object, makeQuery } from '../../src/index.js';`];

for (let t = 0; t < NT; t++) {
  const fs = [];
  for (let i = 0; i < NF; i++) fs.push(`  f${i}: leaf<'f${i}', ['!'], string>('f${i}', ['!']),`);
  if (t > 0) fs.push(`  get child() { return object('child', ['!'], T${t - 1}); },`);
  lines.push(`export const T${t} = {\n${fs.join('\n')}\n};`);
}

// Innermost picker selects all NF fields; each level up selects 10 + recurses.
let sel = `(X) => [${Array.from({ length: NF }, (_, i) => `X.f${i}`).join(', ')}]`;
for (let d = 0; d < 8; d++) {
  sel = `(X) => [${Array.from({ length: 10 }, (_, i) => `X.f${i}`).join(', ')}, X.child(${sel})]`;
}
lines.push(`const query = makeQuery(T${NT - 1});`);
// The root builder receives the root field map, so it must enter through a field.
lines.push(`export const deep = query('Deep', ($, R) => [R.child(${sel})]);`);

await writeFile(new URL('./generated.ts', import.meta.url), lines.join('\n\n'));
