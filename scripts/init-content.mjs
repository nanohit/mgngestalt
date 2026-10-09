import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const repo = "nanohit/mgngestalt";
try {
  execFileSync("gh", ["api", `repos/${repo}/git/ref/heads/content`], {
    stdio: "ignore",
  });
  console.log("content branch already exists.");
  process.exit(0);
} catch {}
await mkdir("artifacts", { recursive: true });
async function post(path, body) {
  const file = "artifacts/github-request.json";
  await writeFile(file, JSON.stringify(body));
  return JSON.parse(
    execFileSync(
      "gh",
      ["api", `repos/${repo}/${path}`, "--method", "POST", "--input", file],
      { encoding: "utf8" },
    ),
  );
}
const json = await readFile("public/data/site.json", "utf8");
const blob = await post("git/blobs", { content: json, encoding: "utf-8" });
const tree = await post("git/trees", {
  tree: [
    { path: "data/site.json", mode: "100644", type: "blob", sha: blob.sha },
  ],
});
const commit = await post("git/commits", {
  message: "content: initialize public community catalog",
  tree: tree.sha,
  parents: [],
});
await post("git/refs", { ref: "refs/heads/content", sha: commit.sha });
console.log("Public content branch initialized.");
