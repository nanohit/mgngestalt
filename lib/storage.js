import { HttpError, PHOTO_URL } from "./validation.js";
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
async function remove(paths) {
  if (!paths.length) return;
  const res = await fetch(
    `${env("SUPABASE_URL")}/storage/v1/object/${BUCKET}`,
    {
      method: "DELETE",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: paths }),
      signal: AbortSignal.timeout(12000),
    },
  );
  if (!res.ok) throw new HttpError(503, "Не удалось убрать старые файлы.");
}
// Из РФ соединения с Supabase (Cloudflare) обрываются после ~16 КБ, поэтому
// посетителю отдаётся короткий список, а длинные тексты — отдельными файлами,
// которые грузятся только на странице анкеты или при открытии события.
const CARD_FIELDS = ["id", "name", "summary", "formats", "topics", "price", "duration", "published"];
export function publicIndex(site) {
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
  return {
    version: site.version,
    updatedAt: site.updatedAt,
    settings: site.settings,
    // Карточке хватает уменьшенной копии фото; полное — в файле анкеты.
    therapists: site.therapists.map((p) => ({
      ...pick(p, CARD_FIELDS),
      ...(p.thumb ? { thumb: p.thumb } : p.photo ? { photo: p.photo } : {}),
    })),
    events: site.events.map(({ description, ...e }) => e),
  };
}
const details = (site) =>
  new Map([
    ...site.therapists.map((p) => [`data/therapists/${p.id}.json`, JSON.stringify(p)]),
    ...site.events.map((e) => [`data/events/${e.id}.json`, JSON.stringify(e)]),
  ]);
// Источник истины — Postgres; публичные файлы — копия для посетителей.
// republish: залить все отдельные файлы заново (первый переход на этот формат).
export async function writeContent(site, { republish = false } = {}) {
  const previous = await get("site");
  site.updatedAt = new Date(
    Math.max(Date.now(), Date.parse(previous?.updatedAt || 0) + 1),
  ).toISOString();
  const before = previous ? details(previous) : new Map();
  const after = details(site);
  // Сначала отдельные файлы, затем список, который на них ссылается.
  for (const [path, body] of after)
    if (republish || before.get(path) !== body)
      await upload(path, body, "application/json", "max-age=10");
  const json = (value) => JSON.stringify(publicIndex(value));
  await upload("data/site.json", json(site), "application/json", "max-age=10");
  try {
    await set("site", site);
  } catch (error) {
    // Restore the previous public list if the database commit fails.
    if (previous)
      await upload(
        "data/site.json", json(previous), "application/json", "max-age=10",
      ).catch(() => {});
    throw error;
  }
  await remove([...before.keys()].filter((path) => !after.has(path))).catch(
    () => {},
  );
  return {};
}
// Фото раздаёт ImgBB: из РФ он открывается целиком, без обрыва на 16 КБ.
// Короткое имя файла — короче адрес в списке для главной.
export async function writePhoto(base64, name = "photo") {
  const key = env("IMGBB_API_KEY");
  if (!key)
    throw new HttpError(503, "Загрузка фото временно недоступна. Попробуйте позже.");
  const res = await fetch(
    `https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ image: base64, name }),
      signal: AbortSignal.timeout(20000),
    },
  ).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  const url = data?.success && data.data?.url;
  if (!PHOTO_URL.test(url || ""))
    throw new HttpError(503, "Не удалось загрузить фото. Попробуйте ещё раз.");
  return url;
}
