import { randomBytes } from "node:crypto";
import { writeFile, mkdir, chmod } from "node:fs/promises";
import { hashPassword } from "../lib/auth.js";
const project = "uwcvheonmfsibqtcfosw";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error("Set SUPABASE_ACCESS_TOKEN in your terminal environment first.");
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const endpoint = `https://api.supabase.com/v1/projects/${project}`;
const check = await fetch(`${endpoint}/database/query`, {
  method: "POST", headers,
  body: JSON.stringify({ query: "select key from public.mgg_kv where key = 'user:admin'" }),
});
if (!check.ok) throw new Error(`Database check failed: ${check.status}`);
if ((await check.json()).length) throw new Error("An administrator already exists. Use the cabinet to change its password.");
const temporary = randomBytes(24).toString("base64url");
const hash = await hashPassword(temporary);
const res = await fetch(`${endpoint}/secrets`, {
  method: "POST", headers,
  body: JSON.stringify([{ name: "ADMIN_PASSWORD_HASH", value: hash }]),
});
if (!res.ok) throw new Error(`Could not set administrator hash: ${res.status}`);
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/admin-access.local", `Вход: https://mgngestalt.vercel.app/cabinet\nЛогин: admin\nВременный пароль: ${temporary}\nПри первом входе замените пароль.\n`, { mode: 0o600 });
await chmod("artifacts/admin-access.local", 0o600);
console.log("Bootstrap configured. Password saved to artifacts/admin-access.local (0600, ignored by Git).");
