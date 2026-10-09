import { HttpError } from "./validation.js";
// Supabase: Postgres (через RPC с серверным ключом) хранит аккаунты, сессии,
// счётчики попыток и опубликованный каталог; публичный Storage раздаёт копию
// каталога и фотографии посетителям.
const BUCKET = "site";
const env = (name) => process.env[name];
const headers = (extra = {}) => ({
  apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
  Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
  ...extra,
});
async function rpc(name, args) {
  const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok)
    throw new HttpError(
      503,
      "Хранилище временно недоступно. Попробуйте позже.",
    );
  return res.json();
}
const get = (key) => rpc("mgg_get", { p_key: key });
const set = (key, value, ttl = null, onlyNew = false) =>
  rpc("mgg_set", { p_key: key, p_value: value, p_ttl: ttl, p_only_new: onlyNew });
const del = (key, ifValue = null) =>
  rpc("mgg_del", { p_key: key, p_if_value: ifValue });

export async function rateLimit(scope, id, limit, seconds) {
  const n = await rpc("mgg_incr", {
    p_key: `rate:${scope}:${id}`,
    p_ttl: seconds,
  });
  if (n > limit)
    throw new HttpError(
      429,
      "Слишком много попыток. Попробуйте через несколько минут.",
    );
}
export async function withLock(work) {
  const token = crypto.randomUUID(),
    lock = "write-lock";
  if (!(await set(lock, token, 90, true)))
    throw new HttpError(
      409,
      "Сейчас сохраняется другое изменение. Попробуйте ещё раз через несколько секунд.",
    );
  try {
    return await work();
  } finally {
    await del(lock, token).catch(() => {});
  }
}

export const userRead = (login) => get(`user:${login}`);
export const userWrite = (user) => set(`user:${user.login}`, user);
// Создаёт аккаунт, только если такого логина ещё нет.
export const userCreate = (user) => set(`user:${user.login}`, user, null, true);
export const userDelete = (login) => del(`user:${login}`);
export const listUsers = () => rpc("mgg_list", { p_prefix: "user:" });

export const sessionRead = (id) => get(`session:${id}`);
export const sessionWrite = (id, data, seconds) =>
  set(`session:${id}`, data, seconds);
export const sessionDelete = (id) => del(`session:${id}`);

const emptySite = () => ({
  version: 1,
  updatedAt: new Date(0).toISOString(),
  settings: { about: "", contactLabel: "", contactUrl: "" },
  therapists: [],
  events: [],
});
export async function readContent() {
  return { site: (await get("site")) || emptySite() };
}
async function upload(path, body, contentType, cacheControl) {
  const res = await fetch(
    `${env("SUPABASE_URL")}/storage/v1/object/${BUCKET}/${path}`,
    {
      method: "POST",
      headers: headers({
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        "x-upsert": "true",
      }),
      body,
      signal: AbortSignal.timeout(12000),
    },
  );
  if (!res.ok)
    throw new HttpError(
      503,
      "Не удалось обновить публикацию. Черновик сохранён; повторите сохранение позже.",
    );
}
// Источник истины — Postgres; публичный файл — его копия для посетителей.
export async function writeContent(site) {
  const previous = await get("site");
  site.updatedAt = new Date(
    Math.max(Date.now(), Date.parse(previous?.updatedAt || 0) + 1),
  ).toISOString();
  await upload(
    "data/site.json",
    JSON.stringify(site),
    "application/json",
    "max-age=10",
  );
  try {
    await set("site", site);
  } catch (error) {
    // Restore the previous public snapshot if the database commit fails.
    if (previous)
      await upload(
        "data/site.json", JSON.stringify(previous), "application/json", "max-age=10",
      ).catch(() => {});
    throw error;
  }
  return {};
}
// Новое фото — новый путь, поэтому файл можно кэшировать навсегда.
export async function writePhoto(base64) {
  const path = `uploads/${crypto.randomUUID()}.webp`;
  await upload(
    path,
    Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
    "image/webp",
    "max-age=31536000, immutable",
  );
  return path;
}
