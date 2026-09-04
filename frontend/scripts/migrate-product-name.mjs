import fs from 'fs';
import { execSync } from 'child_process';

const files = execSync('rg -l "getProductNameColor" src --glob "*.tsx"', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

for (const file of files) {
  if (file.includes('ProductName.tsx') || file.includes('ProductNameColorRulesSettings')) continue;
  let src = fs.readFileSync(file, 'utf8');
  const orig = src;

  if (!src.includes('components/ProductName') && src.includes('getProductNameColor')) {
    const utilsImport = src.match(/import \{[^}]+\} from '(\.\.\/)+lib\/utils';/);
    if (utilsImport) {
      const depth = (utilsImport[1].match(/\.\.\//g) || []).length;
      const prefix = '../'.repeat(depth);
      src = src.replace(
        utilsImport[0],
        `${utilsImport[0]}\nimport ProductName from '${prefix}components/ProductName';`,
      );
    }
  }

  src = src.replace(
    /<(span|div|p|h3|h4|h5|td)([^>]*?)style=\{getProductNameColor\(([^)]+)\) \? \{ color: getProductNameColor\(\3\) \} : undefined\}([^>]*)>\s*\{(\3)\}\s*<\/\1>/g,
    '<ProductName as="$1"$2$4 name={$3} />',
  );

  if (src !== orig) {
    fs.writeFileSync(file, src);
    console.log('updated', file);
  }
}
