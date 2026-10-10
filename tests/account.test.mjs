import test from "node:test";
import assert from "node:assert/strict";
import handler from "../lib/api.js";
import { writeContent } from "../lib/storage.js";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { profileInput, contactUrl, eventInput } from "../lib/validation.js";
const adminPassword = "A secure admin password 123";
process.env.SUPABASE_URL = "https://db.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
process.env.ADMIN_PASSWORD_HASH = await hashPassword(adminPassword);
const strings = new Map(), users = new Map();
let site = {version:1, updatedAt:new Date(0).toISOString(), settings:{about:"About",contactLabel:"",contactUrl:""},therapists:[],events:[]}, storageBroken = false;
const realFetch = globalThis.fetch;
const copy = value => value == null ? value : structuredClone(value);
const files = new Map(), photos = [];
globalThis.fetch = async (url, options = {}) => {
  const { host, pathname: path } = new URL(url);
  if (host === "api.imgbb.com") {
    const form = new URLSearchParams(options.body);
    photos.push(form.get("image"));
    return Response.json({ success: true, data: { url: `https://i.ibb.co/Ab${photos.length}/${form.get("name")}.webp` } });
  }
  assert.equal(options.headers.apikey, "test-service");
  if (path.startsWith("/rest/v1/rpc/")) {
    const b=JSON.parse(options.body);
    const map=b.p_key?.startsWith("user:")?users:strings;
    const key=b.p_key?.startsWith("user:")?b.p_key.slice(5):b.p_key;
    if (path.endsWith("mgg_get")) return Response.json(copy(key==="site"?site:map.get(key)??null));
    if (path.endsWith("mgg_set")) {
      if (b.p_only_new && map.has(key)) return Response.json(false);
      if (key==="site") site=copy(b.p_value);
      else map.set(key,copy(b.p_value));
      return Response.json(true);
    }
    if (path.endsWith("mgg_del")) {
      if (b.p_if_value!==null && map.get(key)!==b.p_if_value) return Response.json(false);
      return Response.json(map.delete(key));
    }
    if (path.endsWith("mgg_list")) return Response.json(copy([...users.values()]));
    if (path.endsWith("mgg_incr")) {
      const n=(strings.get(key)||0)+1;strings.set(key,n);return Response.json(n);
    }
  }
  if (path === "/storage/v1/object/site" && options.method === "DELETE") {
    for (const prefix of JSON.parse(options.body).prefixes) files.delete(prefix);
    return Response.json([]);
  }
  if (path.startsWith("/storage/v1/object/site/")) {
    if (storageBroken) return Response.json({}, {status:503});
    files.set(path.slice("/storage/v1/object/site/".length), String(options.body));
    return Response.json({Key:path});
  }
  throw new Error("Unexpected network URL");
};
const call = async (action, body = {}, sessionToken = "", extra = {}) => {
  const req = {
    method: action === "me" ? "GET" : "POST",
    headers: {
      host: "community.example.test",
      origin: "https://community.example.test",
      "content-type": "application/json",
      authorization: sessionToken ? `Bearer ${sessionToken}` : "",
      "x-forwarded-for": crypto.randomUUID(),
      ...extra,
    },
    body: { action, ...body },
    query: {},
  };
  const headers = {};
  let result;
  const res = {
    setHeader: (k, v) => (headers[k] = v),
    end: (s) => {
      result = { status: res.statusCode, data: JSON.parse(s), headers };
    },
  };
  await handler(req, res);
  return result;
};
const tokenOf = (r) => r.data.token;
test("passwords are salted and constant-length; unsafe contacts are rejected", async () => {
  const a = await hashPassword("A long passphrase 123"),
    b = await hashPassword("A long passphrase 123");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("A long passphrase 123", a), true);
  assert.equal(await verifyPassword("wrong", a), false);
  assert.throws(() => contactUrl("javascript:alert(1)"));
  assert.throws(() => contactUrl("https://user:password@example.org"));
  assert.equal(contactUrl("tel:+79001234567"), "tel:+79001234567");
  assert.throws(() =>
    eventInput({ title: "x", type: "x", location: "x", startsAt: "bad" }),
  );
});
test("admin → account → mandatory password → publish → reset → deletion", async () => {
  let admin = await call("login", { login: "admin", password: adminPassword });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.user.role, "admin");
  let ac = tokenOf(admin);
  if (admin.data.user.mustChange) {
    admin = await call(
      "change-password",
      {
        currentPassword: adminPassword,
        newPassword: "A new admin password 123",
      },
      ac,
    );
    ac = tokenOf(admin);
  }
  let create = await call(
    "create-account",
    { login: "anna", name: "Анна" },
    ac,
  );
  assert.equal(create.status, 201);
  assert.equal(create.data.account.profile.published, false);
  const temp = create.data.tempPassword;
  let logged = await call("login", { login: "anna", password: temp });
  assert.equal(logged.status, 200);
  let tc = tokenOf(logged);
  assert.equal(logged.data.user.mustChange, true);
  assert.equal((await call("save-profile", {}, tc)).status, 403);
  let change = await call(
    "change-password",
    { currentPassword: temp, newPassword: "A personal password 123" },
    tc,
  );
  assert.equal(change.status, 200);
  const old = tc;
  tc = tokenOf(change);
  assert.equal((await call("me", {}, old)).status, 401);
  const profile = {
    ...create.data.account.profile,
    name: "Анна <script>",
    summary: "О встречах",
    contacts: [{ label: "Telegram", url: "https://t.me/test" }],
    topics: ["Тревога"],
    published: true,
  };
  let saved = await call(
    "save-profile",
    { profile, revision: 0, login: "admin" },
    tc,
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.data.user.login, "anna");
  assert.equal(site.therapists.length, 1);
  assert.equal(site.therapists[0].id, create.data.account.id);
  assert.equal(JSON.stringify(site).includes("passwordHash"), false);
  assert.equal(
    (await call("create-account", { login: "evil", name: "x" }, tc)).status,
    403,
  );
  assert.equal(
    (await call("save-profile", { profile, revision: 0 }, tc)).status,
    409,
  );
  assert.equal(
    (
      await call(
        "save-profile",
        {
          profile: { ...profile, photo: "uploads/deadbeef.webp" },
          revision: 1,
        },
        tc,
      )
    ).status,
    400,
  );
  const cross = await call("reset-password", { login: "anna" }, "", {
    origin: "https://evil.example",
  });
  assert.equal(cross.status, 401);
  const html = await call("reset-password", { login: "anna" }, ac, {
    "content-type": "text/plain",
  });
  assert.equal(html.status, 415);
  const reset = await call("reset-password", { login: "anna" }, ac);
  assert.equal(reset.status, 200);
  assert.equal((await call("me", {}, tc)).status, 401);
  assert.equal(
    (
      await call("login", {
        login: "anna",
        password: "A personal password 123",
      })
    ).status,
    401,
  );
  const relog = await call("login", {
    login: "anna",
    password: reset.data.tempPassword,
  });
  assert.equal(relog.status, 200);
  assert.equal(relog.data.user.mustChange, true);
  const deleted = await call("delete-account", { login: "anna" }, ac);
  assert.equal(deleted.status, 200);
  assert.equal(site.therapists.length, 0);
  assert.equal((await call("me", {}, tokenOf(relog))).status, 401);
  assert.equal(
    (await call("delete-account", { login: "admin" }, ac)).status,
    404,
  );
});
test("draft is retained if publication fails; rate limits and maximum accounts hold", async () => {
  const existing = users.get("admin");
  const admin = await call("login", {
    login: "admin",
    password: existing.mustChange ? adminPassword : "A new admin password 123",
  });
  assert.equal(admin.status, 200);
  const ac = tokenOf(admin);
  const create = await call(
    "create-account",
    { login: "boris", name: "Борис" },
    ac,
  );
  const account = create.data.account;
  storageBroken = true;
  const r = await call(
    "save-profile",
    {
      login: "boris",
      revision: 0,
      profile: {
        ...account.profile,
        summary: "Пример",
        contacts: [{ label: "Почта", url: "mailto:test@example.org" }],
        published: true,
      },
    },
    ac,
  );
  assert.equal(r.status, 200);
  assert.ok(r.data.publishError);
  assert.equal(users.get("boris").profile.published, true);
  storageBroken = false;
  for (let i = 0; i < 38; i++)
    users.set(
      "filler" + i,
      {
        login: "filler" + i,
        id: crypto.randomUUID(),
        role: "therapist",
      },
    );
  assert.equal(
    (await call("create-account", { login: "fortieth", name: "Сороковой" }, ac))
      .status,
    201,
  );
  assert.equal(
    [...users.values()].filter((u) => u.role === "therapist").length,
    40,
  );
  assert.equal(
    (await call("create-account", { login: "one-more", name: "Лишний" }, ac))
      .status,
    409,
  );
  const ip = "same-ip";
  let response;
  for (let i = 0; i < 21; i++)
    response = await call(
      "login",
      { login: "missing" + i, password: "wrong" },
      "",
      { "x-forwarded-for": ip },
    );
  assert.equal(response.status, 429);
});
test("published profiles require contacts, IDs and roles cannot come from input", () => {
  const p = {
    name: "Test",
    summary: "Summary",
    formats: ["online"],
    topics: [],
    published: true,
    contacts: [],
  };
  assert.throws(() => profileInput(p, "server-id"));
  const safe = profileInput(
    {
      ...p,
      id: "hacked",
      role: "admin",
      contacts: [{ label: "Mail", url: "mailto:test@example.org" }],
    },
    "server-id",
  );
  assert.equal(safe.id, "server-id");
  assert.equal(safe.role, undefined);
});
test("topics are free text, optional, trimmed and de-duplicated", () => {
  const p = { name: "Test", summary: "Summary", formats: ["online"] };
  assert.deepEqual(profileInput(p, "id").topics, []);
  assert.deepEqual(
    profileInput(
      { ...p, topics: ["  тревога ", "Тревога", "ПТСР", "отношения   в паре", ""] },
      "id",
    ).topics,
    ["Тревога", "ПТСР", "Отношения в паре"],
  );
  const many = Array.from({ length: 13 }, (_, i) => `тема ${i}`);
  assert.throws(() => profileInput({ ...p, topics: many }, "id"));
  assert.throws(() => profileInput({ ...p, topics: ["x".repeat(41)] }, "id"));
  assert.throws(() => profileInput({ ...p, topics: "тревога" }, "id"));
});
test.after(() => {
  globalThis.fetch = realFetch;
});

test("therapists can sign in by surname or full name when it is unique", async () => {
  const password = "A therapist password 123";
  const passwordHash = await hashPassword(password);
  const add = (login, name) =>
    users.set(login, {
      id: crypto.randomUUID(),
      login,
      role: "therapist",
      passwordHash,
      version: 1,
      mustChange: false,
      revision: 0,
      profile: { name },
    });
  add("elkina", "Ирина Ёлкина");
  add("petrov1", "Иван Петров");
  add("petrov2", "Олег Петров");
  for (const login of ["Ёлкина", "елкина", "Ирина  Ёлкина", "Ёлкина Ирина", "elkina"]) {
    const r = await call("login", { login, password });
    assert.equal(r.status, 200, login);
    assert.equal(r.data.user.login, "elkina");
  }
  // Ambiguous surname: the login or the full name is needed.
  assert.equal((await call("login", { login: "Петров", password })).status, 401);
  const full = await call("login", { login: "Олег Петров", password });
  assert.equal(full.data.user.login, "petrov2");
  assert.equal(
    (await call("login", { login: "Ёлкина", password: "A wrong password 123" })).status,
    401,
  );
});
test("visitors get a short list; full profiles and events are separate files", async () => {
  process.env.IMGBB_API_KEY = "test-imgbb";
  const password = "A therapist password 123";
  const passwordHash = await hashPassword(password);
  users.set("vera", {
    id: "vera-id", login: "vera", role: "therapist", passwordHash,
    version: 1, mustChange: false, revision: 0, profile: { name: "Вера Гордеева" },
  });
  const login = await call("login", { login: "Гордеева", password });
  const tc = tokenOf(login);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(20)]).toString("base64");
  const saved = await call("save-profile", {
    revision: 0,
    photo: webp,
    thumb: webp,
    profile: {
      name: "Вера Гордеева", summary: "Коротко", about: "Длинный рассказ о работе",
      education: "МГИ", formats: ["online"], topics: ["Тревога"], duration: 50,
      contacts: [{ label: "Telegram", url: "https://t.me/vera" }], published: true, photo: "",
    },
  }, tc);
  assert.equal(saved.status, 200);
  assert.match(saved.data.user.profile.photo, /^https:\/\/i\.ibb\.co\/Ab\d+\/photo\.webp$/);
  assert.match(saved.data.user.profile.thumb, /^https:\/\/i\.ibb\.co\/Ab\d+\/thumb\.webp$/);
  const index = JSON.parse(files.get("data/site.json"));
  const card = index.therapists.find((p) => p.id === "vera-id");
  assert.equal(card.name, "Вера Гордеева");
  // The list carries only the small copy of the photo.
  assert.equal(card.thumb, saved.data.user.profile.thumb);
  assert.equal(card.photo, undefined);
  assert.equal(card.about, undefined);
  assert.equal(card.contacts, undefined);
  const full = JSON.parse(files.get("data/therapists/vera-id.json"));
  assert.equal(full.about, "Длинный рассказ о работе");
  assert.equal(full.photo, saved.data.user.profile.photo);
  // The photo URLs can only be changed by uploading a file.
  assert.equal((await call("save-profile", {
    revision: 1,
    profile: { ...saved.data.user.profile, thumb: "https://i.ibb.co/Zz1/thumb.webp" },
  }, tc)).status, 400);
  assert.equal(full.contacts[0].url, "https://t.me/vera");
  // Unpublishing removes the separate public file.
  const hidden = await call("save-profile", {
    revision: 1,
    profile: { ...saved.data.user.profile, published: false },
  }, tc);
  assert.equal(hidden.status, 200);
  assert.equal(files.has("data/therapists/vera-id.json"), false);
  assert.equal(JSON.parse(files.get("data/site.json")).therapists.some((p) => p.id === "vera-id"), false);
});
test("the cabinet lists names only and loads one full profile for editing", async () => {
  const existing = users.get("admin");
  const admin = await call("login", {
    login: "admin",
    password: existing.mustChange ? adminPassword : "A new admin password 123",
  });
  const ac = tokenOf(admin);
  const list = await call("list-accounts", {}, ac);
  const vera = list.data.accounts.find((a) => a.login === "vera");
  assert.deepEqual(Object.keys(vera.profile).sort(), ["name", "published"]);
  const full = await call("get-account", { login: "vera" }, ac);
  assert.equal(full.data.account.profile.about, "Длинный рассказ о работе");
  const content = await call("admin-content", {}, ac);
  assert.equal(content.data.site.therapists, undefined);
  assert.ok(Array.isArray(content.data.site.events));
});
test("failed public upload keeps the catalogue version unchanged", async () => {
  const before=structuredClone(site);
  storageBroken=true;
  try { await assert.rejects(writeContent({...before,settings:{...before.settings,about:"Unsaved"}})); }
  finally { storageBroken=false; }
  assert.deepEqual(site,before);
});
