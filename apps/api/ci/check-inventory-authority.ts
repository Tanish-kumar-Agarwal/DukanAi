import * as fs from 'fs';
import * as path from 'path';

function scanDir(dir: string, regexes: RegExp[]): string[] {
  let results: string[] = [];
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      results = results.concat(scanDir(fullPath, regexes));
    } else if (fullPath.endsWith('.ts') && !fullPath.includes('node_modules')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const regex of regexes) {
          if (regex.test(lines[i])) {
            // Check if it's in the allowed list
            const isAllowed = 
              fullPath.includes('inventory-mutation.engine.ts') || 
              fullPath.includes('auth-bypass.service.ts') ||
              fullPath.includes('check-inventory-authority.ts') ||
              fullPath.includes('inventory-domain.service.ts'); // creation is fine, only updates to onHand are forbidden
            
            if (!isAllowed) {
              results.push(`${fullPath}:${i + 1} - ${lines[i].trim()}`);
            }
          }
        }
      }
    }
  }
  return results;
}

function main() {
  const targetDir = path.join(__dirname, '../src');
  const forbiddenPatterns = [
    /prisma\.inventoryItem\.(update|updateMany|upsert|delete)\(/,
    /\$executeRaw.*UPDATE\s+(Product|InventoryItem)/i
  ];

  console.log(`Scanning repository: ${targetDir} for forbidden Inventory bypasses...`);
  const violations = scanDir(targetDir, forbiddenPatterns);

  if (violations.length > 0) {
    console.error(`\n❌ ERROR: Forbidden Inventory API usage detected outside InventoryMutationEngine!`);
    console.error(`You must use InventoryMutationEngine for all inventory modifications.`);
    violations.forEach(v => console.error(`  - ${v}`));
    process.exit(1);
  } else {
    console.log(`\n✅ CI Check Passed: No forbidden API bypasses detected.`);
    process.exit(0);
  }
}

main();
