import { config } from "./config.js";
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const demo = new URLSearchParams(location.search).get("demo") === "1";
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
export function safeUrl(value) {
  try {
    const u = new URL(value);
    if (
      ["https:", "http:", "mailto:", "tel:"].includes(u.protocol) &&
      !u.username &&
      !u.password
    )
      return u.href;
  } catch {}
  return "";
}
export function photoUrl(value) {
  if (!value || !/^uploads\/[a-f0-9-]+\.webp$/.test(value)) return "";
  return `https://cdn.jsdelivr.net/gh/${config.repository}@${config.dataBranch}/${value}`;
}
export const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("");
export const formatLabel = (p) =>
  p.formats?.length === 2
    ? "Очно и онлайн"
    : p.formats?.includes("online")
      ? "Онлайн"
      : "Очно";
export const priceLabel = (p) =>
  p.price != null
    ? `от ${Number(p.price).toLocaleString("ru-RU")} ₽`
    : "Стоимость по запросу";
export function portrait(p, className = "") {
  const src = photoUrl(p.photo);
  return src
    ? `<img class="portrait ${className}" src="${escape(src)}" data-photo-fallback="${escape(p.name)}" alt="${escape(p.name)}" loading="lazy" width="480" height="400">`
    : `<div class="portrait initial-portrait ${className}" aria-label="${escape(p.name)}">${escape(initials(p.name))}</div>`;
}
export function installImageFallbacks(root = document) {
  $$("img[data-photo-fallback]", root).forEach((img) =>
    img.addEventListener(
      "error",
      () => {
        const el = document.createElement("div");
        el.className = "portrait initial-portrait";
        el.textContent = initials(img.dataset.photoFallback);
        img.replaceWith(el);
      },
      { once: true },
    ),
  );
}
export function empty(title, body, action = "") {
  return `<div class="empty-state"><h3>${escape(title)}</h3><p>${escape(body)}</p>${action}</div>`;
}
export function toast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 6000);
}
export function dateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(date));
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}
export function eventTime(date) {
  return new Date(date).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Yekaterinburg",
  });
}
export function eventDate(date) {
  return new Date(date).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Yekaterinburg",
  });
}
export function initShared() {
  if (config.logos[0]) {
    $$("[data-logo]").forEach((el) => {
      const img = document.createElement("img");
      img.src = `https://cdn.jsdelivr.net/gh/${config.repository}@${config.assetRef}/public/assets/${config.logos[0]}`;
      img.alt = "";
      img.width = 48;
      img.height = 48;
      img.addEventListener(
        "error",
        () => {
          img.src = `/assets/${config.logos[0]}`;
        },
        { once: true },
      );
      el.append(img);
    });
  }
  if (config.logos[1] && $(".footer")) {
    const img = document.createElement("img");
    img.className = "institutes-logo";
    img.loading = "lazy";
    img.alt = "ОПП ГП · программа «Московский гештальт институт»";
    img.src = `https://cdn.jsdelivr.net/gh/${config.repository}@${config.assetRef}/public/assets/${config.logos[1]}`;
    img.addEventListener(
      "error",
      () => {
        img.src = `/assets/${config.logos[1]}`;
      },
      { once: true },
    );
    $(".footer").append(img);
  }
  if (demo) {
    const el = document.createElement("div");
    el.className = "demo-banner";
    el.textContent =
      "Демонстрация интерфейса · специалисты и события ниже — примеры";
    document.body.prepend(el);
  }
  $$(".modal-close").forEach((b) =>
    b.addEventListener("click", () => b.closest("dialog").close()),
  );
  $$("dialog").forEach((d) =>
    d.addEventListener("click", (e) => {
      if (e.target === d) {
        const r = d.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          d.close();
      }
    }),
  );
  if ($("#footer-year"))
    $("#footer-year").textContent = new Date().getFullYear();
}
export async function loadSite() {
  if (demo) return (await import("./demo.js")).demoSite;
  const urls = [
    `https://cdn.jsdelivr.net/gh/${config.repository}@${config.dataBranch}/data/site.json`,
    `https://fastly.jsdelivr.net/gh/${config.repository}@${config.dataBranch}/data/site.json`,
    `https://raw.githubusercontent.com/${config.repository}/${config.dataBranch}/data/site.json`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data.therapists) || !Array.isArray(data.events))
        continue;
      return data;
    } catch {}
  }
  const res = await fetch("/data/site.json");
  if (!res.ok)
    throw new Error(
      "Не удалось загрузить данные. Попробуйте обновить страницу.",
    );
  const data = await res.json();
  toast("Показана сохранённая версия. Обновления временно недоступны.");
  return data;
}
export function therapistCard(p) {
  const link = `/therapist/${encodeURIComponent(p.id)}${demo ? "?demo=1" : ""}`;
  return `<article class="therapist-card"><a href="${link}" aria-label="Профиль: ${escape(p.name)}">${portrait(p)}</a><div class="card-body"><p class="card-kicker"><span>Гештальт-терапевт</span><span>${escape(formatLabel(p))}</span></p><h3 class="card-name"><a href="${link}">${escape(p.name)}</a></h3><p class="card-description">${escape(p.summary)}</p><div class="tags">${(
    p.topics || []
  )
    .slice(0, 4)
    .map((t) => `<span class="tag">${escape(t)}</span>`)
    .join(
      "",
    )}</div><div class="card-footer"><span>${escape(priceLabel(p))}${p.duration ? ` · ${escape(p.duration)} мин` : ""}</span><a class="text-link" href="${link}">Анкета и контакты</a></div></div></article>`;
}
