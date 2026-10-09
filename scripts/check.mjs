import { readdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
for (const dir of ["public", "api", "lib", "scripts"])
  for (const file of await readdir(dir)) {
    if (/\.(js|mjs)$/.test(file))
      execFileSync(process.execPath, ["--check", `${dir}/${file}`], {
        stdio: "inherit",
      });
  }
for (const path of ["vercel.json", "public/data/site.json", "package.json"])
  JSON.parse(await readFile(path, "utf8"));
console.log("JavaScript syntax and JSON checked.");
