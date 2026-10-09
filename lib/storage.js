import { HttpError } from "./validation.js";
const PREFIX = "mgg:v1:";
export const key = (s) => PREFIX + s;
export async function redis(...command) {
  const res = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok)
    throw new HttpError(
      503,
      "Хранилище временно недоступно. Попробуйте позже.",
    );
  const data = await res.json();
  if (data.error) throw new HttpError(503, "Хранилище временно недоступно.");
  return data.result;
}
export async function rateLimit(scope, id, limit, seconds) {
  const n = await redis(
    "EVAL",
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
    1,
    key(`rate:${scope}:${id}`),
    seconds,
  );
  if (n > limit)
    throw new HttpError(
      429,
      "Слишком много попыток. Попробуйте через несколько минут.",
    );
}
export async function withLock(work) {
  const token = crypto.randomUUID(),
    lock = key("write-lock");
  if (!(await redis("SET", lock, token, "NX", "EX", 90)))
    throw new HttpError(
      409,
      "Сейчас сохраняется другое изменение. Попробуйте ещё раз через несколько секунд.",
    );
  try {
    return await work();
  } finally {
    await redis(
      "EVAL",
      "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]); end; return 0",
      1,
      lock,
      token,
    ).catch(() => {});
  }
}
export async function userRead(login) {
  const raw = await redis("HGET", key("users"), login);
  return raw ? JSON.parse(raw) : null;
}
export async function userWrite(user) {
  await redis("HSET", key("users"), user.login, JSON.stringify(user));
}
export async function listUsers() {
  const raw = await redis("HVALS", key("users"));
  return (raw || []).map((s) => JSON.parse(s));
}
function repoPath(path) {
  const repo = process.env.GITHUB_REPOSITORY || "nanohit/mgngestalt";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new HttpError(503, "Проверьте конфигурацию репозитория.");
  return `https://api.github.com/repos/${repo}/contents/${path}`;
}
export async function github(path, options = {}) {
  const res = await fetch(repoPath(path), {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_CONTENT_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok)
    throw new HttpError(
      res.status === 409 || res.status === 422 ? 409 : 503,
      "Не удалось обновить публикацию в GitHub. Черновик сохранён; повторите публикацию позже.",
    );
  return res.json();
}
export async function readContent() {
  const branch = process.env.CONTENT_BRANCH || "content";
  const data = await github(`data/site.json?ref=${encodeURIComponent(branch)}`);
  return {
    site: JSON.parse(Buffer.from(data.content, "base64").toString()),
    sha: data.sha,
  };
}
export async function writeContent(site, sha) {
  const branch = process.env.CONTENT_BRANCH || "content";
  site.updatedAt = new Date().toISOString();
  await github("data/site.json", {
    method: "PUT",
    body: JSON.stringify({
      message: "content: update public community data",
      branch,
      sha,
      content: Buffer.from(JSON.stringify(site, null, 2) + "\n").toString(
        "base64",
      ),
    }),
  });
  // Mutable branch URLs can be cached by jsDelivr. Purge after each successful write.
  const repo = process.env.GITHUB_REPOSITORY || "nanohit/mgngestalt";
  let delayed = false;
  try {
    const r = await fetch(
      `https://purge.jsdelivr.net/gh/${repo}@${branch}/data/site.json`,
      { signal: AbortSignal.timeout(4000) },
    );
    const d = await r.json();
    delayed = !r.ok || d.status !== "finished";
  } catch {
    delayed = true;
  }
  return { delayed };
}
export async function writePhoto(base64) {
  const path = `uploads/${crypto.randomUUID()}.webp`,
    branch = process.env.CONTENT_BRANCH || "content";
  await github(path, {
    method: "PUT",
    body: JSON.stringify({
      message: "content: add compressed profile photo",
      branch,
      content: base64,
    }),
  });
  return path;
}
