import fs from 'fs';
import { execSync } from 'child_process';

const files = execSync('rg -l "getProductNameColor" src --glob "*.tsx"', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

function ensureImport(src, file) {
  if (src.includes('components/ProductName')) return src;
  const utilsImport = src.match(/import \{[^}]+\} from '(\.\.\/)+lib\/utils';/);
  if (!utilsImport) return src;
  const depth = (utilsImport[1].match(/\.\.\//g) || []).length;
  const prefix = '../'.repeat(depth);
  return src.replace(
    utilsImport[0],
    `${utilsImport[0]}\nimport ProductName from '${prefix}components/ProductName';`,
  );
}

for (const file of files) {
  if (file.includes('ProductName.tsx') || file.includes('ProductNameColorRulesSettings')) continue;
  let src = fs.readFileSync(file, 'utf8');
  const orig = src;
  src = ensureImport(src, file);

  // multiline style + single child
  src = src.replace(
    /<(span|div|p|h3|h4|h5|td|h1)([^>]*?)\s*style=\{getProductNameColor\(([^)]+)\)\s*\?\s*\{\s*color:\s*getProductNameColor\(\3\)\s*\}\s*:\s*undefined\s*\}([^>]*)>\s*\{(\3)\}\s*<\/\1>/gs,
    '<ProductName as="$1"$2$4 name={$3} />',
  );

  // inline single line with extra text like ↳ prefix
  src = src.replace(
    /<span className="([^"]*)" style=\{getProductNameColor\(([^)]+)\) \? \{ color: getProductNameColor\(\2\) \} : undefined\}>↳ \{(\2)\}<\/span>/g,
    '<span className="$1">↳ <ProductName name={$2} /></span>',
  );

  // div with fallback expression child
  src = src.replace(
    /<div className="([^"]*)" style=\{getProductNameColor\(([^)]+)\) \? \{ color: getProductNameColor\(\2\) \} : undefined\}>\{(\2) \|\| '([^']*)'\}<\/div>/g,
    '<ProductName as="div" className="$1" name={$2 || \'$4\'} />',
  );

  // cart lines with brand suffix - only product_name part
  src = src.replace(
    /style=\{getProductNameColor\(item\.product_name\) \? \{ color: getProductNameColor\(item\.product_name\) \} : undefined\}\s*\n\s*\{item\.product_brand_name \? `\$\{item\.product_name\} - \$\{item\.product_brand_name\}` : item\.product_name\}/g,
    '{item.product_brand_name ? (<><ProductName name={item.product_name} /> - {item.product_brand_name}</>) : (<ProductName name={item.product_name} />)}',
  );

  if (src !== orig) {
    fs.writeFileSync(file, src);
    console.log('updated', file);
  }
}
