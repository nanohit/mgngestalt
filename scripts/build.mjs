import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
// No transpilation, bundles or runtime dependencies. Pin images to the source commit.
let ref = process.env.VERCEL_GIT_COMMIT_SHA;
try { ref ||= execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
if (ref) {
  const source = await readFile('dist/config.js', 'utf8');
  await writeFile('dist/config.js', source.replace("assetRef: 'main'", `assetRef: '${ref}'`));
}
console.log('Static files ready in dist/');
