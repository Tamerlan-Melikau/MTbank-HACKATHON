// Генерирует src/ui/theme/tokens.css из design-system/project/tokens.json.
// Источник правды — дизайн-система; CSS вручную не правим.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'design-system/project/tokens.json');
const out = resolve(root, 'src/ui/theme/tokens.css');
const t = JSON.parse(readFileSync(src, 'utf8'));

const light = [];
const dark = [];
const common = [];

for (const tok of t.color.tokens) {
  light.push(`  --${tok.name}: ${tok.value.light};`);
  dark.push(`  --${tok.name}: ${tok.value.dark};`);
}
for (const tok of t.shadow.tokens) {
  light.push(`  --${tok.name}: ${tok.value.light};`);
  dark.push(`  --${tok.name}: ${tok.value.dark};`);
}
for (const [name, value] of Object.entries(t.type.families)) common.push(`  --font-${name}: ${value};`);
for (const g of t.type.groups) {
  for (const s of g.styles) {
    common.push(`  --type-${s.name}-size: ${s.fontSize};`);
    common.push(`  --type-${s.name}-line: ${s.lineHeight};`);
    common.push(`  --type-${s.name}-weight: ${s.fontWeight};`);
  }
}
for (const tok of t.spacing.tokens) common.push(`  --${tok.name}: ${tok.value};`);
for (const tok of t.radius.tokens) common.push(`  --${tok.name}: ${tok.value};`);

const css = `/* Сгенерировано scripts/build-tokens.mjs из design-system/project/tokens.json. Не редактировать. */
:root {
${common.join('\n')}
}
:root, [data-theme="light"] {
  color-scheme: light;
${light.join('\n')}
}
[data-theme="dark"] {
  color-scheme: dark;
${dark.join('\n')}
}
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, css);
console.log(`tokens.css: ${t.color.tokens.length} цветов, ${common.length} общих переменных`);
