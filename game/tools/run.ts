/**
 * Generic tool dispatcher, so tool agents never edit package.json:
 *
 *   npm run tool -- <name> [args…]      runs tools/<name>/index.ts (with process.argv = [node, script, …args])
 *   npm run tool                        lists the available tools
 *
 * A tool is a folder tools/<name>/ with an index.ts that does its work when imported (top-level
 * code or a `main()` call). Tools may import src/sim and src/content, never src/client.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOLS_DIR = fileURLToPath(new URL('.', import.meta.url));

function availableTools(): string[] {
  return readdirSync(TOOLS_DIR)
    .filter((name) => statSync(join(TOOLS_DIR, name)).isDirectory() && existsSync(join(TOOLS_DIR, name, 'index.ts')))
    .sort();
}

async function main(): Promise<void> {
  const [name, ...args] = process.argv.slice(2);
  const tools = availableTools();
  if (name === undefined || name === '--help' || name === '-h') {
    console.log(`usage: npm run tool -- <name> [args…]\navailable tools: ${tools.join(', ') || '(none)'}`);
    return;
  }
  if (!/^[a-z][a-z0-9-]*$/.test(name) || !tools.includes(name)) {
    console.error(`unknown tool '${name}'. Available: ${tools.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const entry = join(TOOLS_DIR, name, 'index.ts');
  process.argv = [process.argv[0] as string, entry, ...args];
  await import(pathToFileURL(entry).href);
}

await main();
