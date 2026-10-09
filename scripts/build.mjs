import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
// No transpilation or bundles. HTML loads immutable source files from jsDelivr.
let ref = process.env.VERCEL_GIT_COMMIT_SHA;
try {
  ref ||= execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {}
if (!ref || !/^[a-f0-9]{40}$/.test(ref))
  throw new Error("A source commit is required for CDN assets.");
const cdn = `https://cdn.jsdelivr.net/gh/nanohit/mgngestalt@${ref}/public`;
for (const name of ["index.html", "cabinet.html", "therapist.html"]) {
  const source = await readFile(`public/${name}`, "utf8");
  await writeFile(
    `dist/${name}`,
    source.replace(
      /(src|href)="\/(assets\/[^"<>]+|[a-z-]+\.(?:js|css))"/g,
      (_, attr, path) => `${attr}="${cdn}/${path}"`,
    ),
  );
}
console.log("Static files ready in dist/");
