import { randomUUID, randomBytes } from "node:crypto";
import {
  HttpError,
  requireValue,
  loginName,
  password,
  profileInput,
  eventInput,
  settingsInput,
  text,
} from "./validation.js";
import {
  hashPassword,
  verifyPassword,
  digest,
  sessionToken,
  readBearer,
} from "./auth.js";
import {
  rateLimit,
  withLock,
  userRead,
  userWrite,
  userCreate,
  userDelete,
  listUsers,
  sessionRead,
  sessionWrite,
  sessionDelete,
  readContent,
  writeContent,
  writePhoto,
} from "./storage.js";
const configured = () =>
  ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_PASSWORD_HASH"].every(
    (k) => !!process.env[k],
  );
const adminLogin = () => process.env.ADMIN_LOGIN || "admin";
const publicUser = (u) => ({
  login: u.login,
  id: u.id,
  role: u.role,
  mustChange: u.mustChange,
  profile: u.profile || null,
  revision: u.revision || 0,
});
const accountSummary = (u) => ({
  login: u.login,
  id: u.id,
  role: u.role,
  mustChange: u.mustChange,
  revision: u.revision || 0,
  profile: u.profile
    ? { name: u.profile.name, published: !!u.profile.published }
    : null,
});
// Календарь и настройки для кабинета; анкеты терапевтов ему не нужны.
const adminSite = ({ updatedAt, settings, events }) => ({
  updatedAt,
  settings,
  events,
});
async function session(req) {
  const token = readBearer(req.headers);
  requireValue(token, "Войдите в кабинет.", 401);
  const s = await sessionRead(digest(token));
  requireValue(s, "Сессия завершилась. Войдите снова.", 401);
  const u = await userRead(s.login);
  requireValue(
    u && u.version === s.version,
    "Сессия завершилась. Войдите снова.",
    401,
  );
  return { user: u, token };
}
// Токен уходит клиенту один раз; на сервере хранится только его хеш.
async function issueSession(u) {
  const token = sessionToken();
  await sessionWrite(
    digest(token),
    { login: u.login, version: u.version },
    604800,
  );
  return token;
}
// Сессия передаётся заголовком Authorization, а не cookie, поэтому подделка
// запроса с чужого сайта невозможна; JSON требуется для всех изменений.
function requireJson(req) {
  requireValue(
    String(req.headers["content-type"] || "").split(";")[0] ===
      "application/json",
    "Ожидается JSON.",
    415,
  );
}
const LOGIN = /^[a-z0-9][a-z0-9._-]{2,39}$/;
// «Анна Соколова», «соколова», «Соколова Анна» → одинаковые ключи сравнения.
const personKey = (value) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ");
// Терапевт может войти по фамилии или полному имени из анкеты вместо
// логина, если такое совпадение у него единственное.
async function findByName(input) {
  const key = personKey(input);
  if (key.length < 2) return null;
  const sorted = (s) => s.split(" ").sort().join(" ");
  const matches = (await listUsers()).filter((u) => {
    if (u.role !== "therapist") return false;
    const name = personKey(u.profile?.name);
    return sorted(name) === sorted(key) || name.split(" ").includes(key);
  });
  return matches.length === 1 ? matches[0] : null;
}
// Фото приходит уже сжатым в кабинете: WebP в base64.
function webpInput(value, maxBytes) {
  requireValue(
    typeof value === "string" &&
      value.length <= Math.ceil(maxBytes / 3) * 4 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value),
    "Некорректный файл фотографии.",
  );
  const buffer = Buffer.from(value, "base64");
  requireValue(
    buffer.length >= 20 &&
      buffer.length <= maxBytes &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP",
    "Фотография слишком большая или повреждена. Попробуйте другой файл.",
  );
  return value;
}
async function publishProfile(u) {
  const { site } = await readContent();
  site.therapists = site.therapists.filter((p) => p.id !== u.id);
  if (u.profile?.published) site.therapists.push(u.profile);
  return writeContent(site);
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const send = (status, body) => {
    res.statusCode = status;
    res.end(JSON.stringify(body));
  };
  try {
    requireValue(
      req.method === "GET" || req.method === "POST",
      "Метод не поддерживается.",
      405,
    );
    if (req.method === "GET" && req.query?.action === "status")
      return send(200, { configured: configured() });
    requireValue(
      configured(),
      "Вход временно недоступен. Обратитесь к администратору.",
      503,
    );
    if (req.method === "GET") {
      const { user } = await session(req);
      return send(200, { user: publicUser(user) });
    }
    requireJson(req);
    let body = req.body;
    if (typeof body === "string") {
      requireValue(
        Buffer.byteLength(body) <= 300000,
        "Слишком большой запрос.",
        413,
      );
      body = JSON.parse(body);
    }
    requireValue(
      body && typeof body === "object" && !Array.isArray(body),
      "Проверьте запрос.",
    );
    requireValue(
      Buffer.byteLength(JSON.stringify(body)) <= 300000,
      "Слишком большой запрос.",
      413,
    );
    const ip = digest(
      String(
        req.headers["x-forwarded-for"] ||
          req.socket?.remoteAddress ||
          "unknown",
      )
        .split(",")[0]
        .trim(),
    );
    const action = body.action;
    if (action === "login") {
      await rateLimit("login-ip", ip, 20, 600);
      const input = text(body.login, 100, true);
      await rateLimit("login-user", digest(personKey(input)), 15, 600);
      requireValue(
        typeof body.password === "string" && body.password.length <= 128,
        "Неверный логин или пароль.",
        401,
      );
      const login = input.toLowerCase();
      let u = LOGIN.test(login) ? await userRead(login) : null;
      if (!u) u = await findByName(input);
      if (
        !u &&
        login === adminLogin() &&
        (await verifyPassword(body.password, process.env.ADMIN_PASSWORD_HASH))
      ) {
        const initial = {
          id: "admin",
          login,
          role: "admin",
          passwordHash: process.env.ADMIN_PASSWORD_HASH,
          version: 1,
          mustChange: true,
          revision: 0,
        };
        await userCreate(initial);
        u = await userRead(login);
      }
      // Use a real hash even for unknown users to avoid a cheap username timing oracle.
      const ok = await verifyPassword(
        body.password,
        u?.passwordHash || process.env.ADMIN_PASSWORD_HASH,
      );
      requireValue(u && ok, "Неверный логин или пароль.", 401);
      const token = await issueSession(u);
      return send(200, { user: publicUser(u), token });
    }
    const { user, token } = await session(req);
    const locked = (work) =>
      withLock(async () => {
        const live = await userRead(user.login);
        requireValue(
          live && live.version === user.version,
          "Сессия завершилась. Войдите снова.",
          401,
        );
        return work();
      });
    await rateLimit("account", digest(user.login), 120, 600);
    if (action === "logout") {
      await sessionDelete(digest(token));
      return send(200, { ok: true });
    }
    if (action === "change-password") {
      requireValue(
        await verifyPassword(body.currentPassword, user.passwordHash),
        "Текущий пароль неверен.",
        400,
      );
      const newHash = await hashPassword(password(body.newPassword));
      const updated = await locked(async () => {
        const u = await userRead(user.login);
        requireValue(
          u && u.version === user.version,
          "Данные изменились. Войдите снова.",
          409,
        );
        u.passwordHash = newHash;
        u.version++;
        u.mustChange = false;
        await userWrite(u);
        return u;
      });
      await sessionDelete(digest(token));
      const fresh = await issueSession(updated);
      return send(200, { user: publicUser(updated), token: fresh });
    }
    requireValue(!user.mustChange, "Сначала замените временный пароль.", 403);
    if (action === "save-profile") {
      requireValue(
        user.role === "therapist" || user.role === "admin",
        "Доступ запрещён.",
        403,
      );
      const target = user.role === "admin" ? loginName(body.login) : user.login;
      const result = await locked(async () => {
        const u = await userRead(target);
        requireValue(u?.role === "therapist", "Профиль не найден.", 404);
        requireValue(
          u.revision === body.revision,
          "Профиль изменился. Обновите страницу, чтобы не потерять изменения.",
          409,
        );
        const p = profileInput(body.profile, u.id);
        // A therapist may only use their existing photo or upload their own compressed file.
        requireValue(
          p.photo === (u.profile?.photo || "") &&
            p.thumb === (u.profile?.thumb || ""),
          "Для смены фотографии используйте загрузку файла.",
        );
        if (body.photo) {
          // Кабинет присылает фото для анкеты и уменьшенную копию для карточки.
          const photo = webpInput(body.photo, 150000),
            thumb = body.thumb ? webpInput(body.thumb, 40000) : null;
          [p.photo, p.thumb] = await Promise.all([
            writePhoto(photo, "photo"),
            thumb ? writePhoto(thumb, "thumb") : "",
          ]);
        }
        if (body.removePhoto === true) p.photo = p.thumb = "";
        u.profile = p;
        u.revision++;
        await userWrite(u);
        try {
          return { user: publicUser(u), publication: await publishProfile(u) };
        } catch (e) {
          return { user: publicUser(u), publishError: e.message };
        }
      });
      return send(200, result);
    }
    requireValue(
      user.role === "admin",
      "Доступ только для администратора.",
      403,
    );
    // Список без полных анкет: из РФ длинные ответы обрываются.
    if (action === "list-accounts")
      return send(200, {
        accounts: (await listUsers())
          .filter((u) => u.role === "therapist")
          .map(accountSummary),
      });
    if (action === "get-account") {
      const u = await userRead(loginName(body.login));
      requireValue(u?.role === "therapist", "Кабинет не найден.", 404);
      return send(200, { account: publicUser(u) });
    }
    if (action === "admin-content") {
      const { site } = await readContent();
      return send(200, { site: adminSite(site) });
    }
    if (action === "create-account") {
      const login = loginName(body.login);
      requireValue(login !== adminLogin(), "Этот логин занят.");
      const name = text(body.name, 100, true);
      const tempPassword = randomBytes(15).toString("base64url");
      const passwordHash = await hashPassword(tempPassword);
      const account = await locked(async () => {
        requireValue(!(await userRead(login)), "Этот логин уже занят.", 409);
        const users = await listUsers();
        requireValue(
          users.filter((u) => u.role === "therapist").length < 40,
          "Достигнут лимит 40 терапевтов.",
          409,
        );
        const u = {
          id: randomUUID(),
          login,
          role: "therapist",
          passwordHash,
          version: 1,
          mustChange: true,
          revision: 0,
          profile: {
            id: "",
            name,
            summary: "",
            about: "",
            education: "",
            topics: [],
            formats: ["inperson", "online"],
            price: null,
            duration: 50,
            photo: "",
            contacts: [],
            published: false,
          },
        };
        u.profile.id = u.id;
        await userWrite(u);
        return u;
      });
      return send(201, { account: publicUser(account), tempPassword });
    }
    if (action === "reset-password") {
      const login = loginName(body.login);
      const tempPassword = randomBytes(15).toString("base64url"),
        passwordHash = await hashPassword(tempPassword);
      await locked(async () => {
        const u = await userRead(login);
        requireValue(u?.role === "therapist", "Кабинет не найден.", 404);
        u.passwordHash = passwordHash;
        u.version++;
        u.mustChange = true;
        await userWrite(u);
      });
      return send(200, { login, tempPassword });
    }
    if (action === "delete-account") {
      const login = loginName(body.login);
      await locked(async () => {
        const u = await userRead(login);
        requireValue(u?.role === "therapist", "Кабинет не найден.", 404);
        const { site } = await readContent();
        site.therapists = site.therapists.filter((p) => p.id !== u.id);
        await writeContent(site);
        await userDelete(login);
      });
      return send(200, { ok: true });
    }
    if (
      action === "save-event" ||
      action === "delete-event" ||
      action === "save-settings"
    ) {
      const result = await locked(async () => {
        const { site } = await readContent();
        requireValue(
          body.updatedAt === site.updatedAt,
          "Календарь или настройки изменились. Обновите раздел и повторите изменение.",
          409,
        );
        if (action === "save-settings")
          site.settings = settingsInput(body.settings);
        else if (action === "delete-event") {
          requireValue(
            site.events.some((e) => e.id === body.id),
            "Событие не найдено.",
            404,
          );
          site.events = site.events.filter((e) => e.id !== body.id);
        } else {
          const e = eventInput(body.event);
          if (body.id)
            requireValue(
              site.events.some((e) => e.id === body.id),
              "Событие не найдено.",
              404,
            );
          requireValue(
            body.id || site.events.length < 200,
            "Достигнут лимит 200 событий.",
          );
          e.id = body.id || randomUUID();
          site.events = site.events.filter((x) => x.id !== e.id);
          site.events.push(e);
        }
        await writeContent(site);
        return { site: adminSite(site) };
      });
      return send(200, result);
    }
    throw new HttpError(400, "Неизвестное действие.");
  } catch (e) {
    const status =
      e instanceof HttpError ? e.status : e instanceof SyntaxError ? 400 : 500;
    send(status, {
      error:
        e instanceof HttpError
          ? e.message
          : status === 400
            ? "Некорректный запрос."
            : "Не удалось выполнить действие. Попробуйте позже.",
    });
  }
}
