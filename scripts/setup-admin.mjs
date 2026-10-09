import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { hashPassword } from "../lib/auth.js";
const scope = "vfeb8c02646d6999bcd7afce8";
// Inspect exactly this project's link. Never read or print authentication tokens.
execFileSync("vercel", ["project", "inspect", "mgngestalt", "--scope", scope], {
  stdio: "inherit",
});
const temporary = randomBytes(18).toString("base64url"),
  hash = await hashPassword(temporary);
const result = spawnSync(
  "vercel",
  [
    "env",
    "add",
    "ADMIN_PASSWORD_HASH",
    "production",
    "--sensitive",
    "--scope",
    scope,
  ],
  { input: hash, encoding: "utf8" },
);
if (result.status !== 0) {
  console.error(
    "Could not set admin hash. Existing values are never overwritten automatically.",
  );
  process.exit(1);
}
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/admin-access.local",
  `Вход: https://mgngestalt.vercel.app/cabinet\nЛогин: admin\nВременный пароль: ${temporary}\nПри первом входе замените пароль.\n`,
  { mode: 0o600 },
);
console.log(
  "Admin password hash set. Temporary credentials saved only to artifacts/admin-access.local (gitignored, permissions 0600).",
);
