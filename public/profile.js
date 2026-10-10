import {
  $,
  $$,
  escape,
  loadTherapist,
  cachedCard,
  initShared,
  portrait,
  photoUrl,
  installImageFallbacks,
  empty,
  demo,
  base,
  formatLabel,
  priceLabel,
  safeUrl,
} from "./core.js";
initShared();
const id = decodeURIComponent(
  location.pathname.split("/therapist/")[1] ||
    new URLSearchParams(location.search).get("id") ||
    "",
);
const home = `${base || "/"}${demo ? "?demo=1" : ""}#therapists`;
// full = false: анкета собрана из карточки сохранённого списка; описание
// и контакты появятся, когда загрузится файл анкеты.
function show(p, full) {
  $("#profile-status").hidden = true;
  if (!p) {
    $("#profile").innerHTML = empty(
      "Анкета не найдена",
      "Анкета удалена или ещё не опубликована.",
      `<a class="button" href="${home}">Все терапевты</a>`,
    );
    return;
  }
  document.title = `${p.name} — гештальт-терапевт · Магнитогорск`;
  const pending = '<p class="muted" data-pending>Загрузка…</p>';
  const contacts = (p.contacts || []).filter((c) => safeUrl(c.url));
  $("#profile").innerHTML =
    `<a class="breadcrumb" href="${home}">← К списку терапевтов</a><div class="profile-layout"><aside class="profile-sidebar">${portrait(p, { eager: true })}<a class="button full" href="#contacts">Контакты для записи</a><p class="profile-facts muted"><span>${escape(formatLabel(p))}</span><span>${escape(priceLabel(p))}</span>${p.duration ? `<span>${escape(p.duration)} мин</span>` : ""}</p></aside><article class="profile-content"><p class="eyebrow">Гештальт-терапевт · Магнитогорск</p><h1>${escape(p.name)}</h1><p class="lead">${escape(p.summary)}</p><div class="tags">${(p.topics || []).map((t) => `<span class="tag">${escape(t)}</span>`).join("")}</div><section class="profile-block"><h2>О себе и работе</h2>${full ? `<p>${escape(p.about || "Информация не указана.")}</p>` : pending}</section>${p.education ? `<section class="profile-block"><h2>Образование и подготовка</h2><p>${escape(p.education)}</p></section>` : ""}<section class="profile-block" id="contacts"><h2>Контакты</h2><p>Для записи на консультацию свяжитесь с терапевтом.</p><div class="contact-links">${!full ? pending : contacts.length ? contacts.map((c) => `<a href="${escape(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">${escape(c.label)} </a>`).join("") : '<p class="muted">Терапевт пока не добавил контакты.</p>'}</div></section></article></div>`;
  // Пока грузится полное фото, под ним видна уменьшенная копия из списка.
  const img = $("#profile img.portrait");
  if (img && p.thumb && p.thumb !== p.photo)
    img.style.backgroundImage = `url("${photoUrl(p.thumb)}")`;
  installImageFallbacks($("#profile"));
}
const card = id ? cachedCard(id) : null;
if (card?.published) show(card, false);
try {
  const found = id
    ? await loadTherapist(id, (p) => show(p.published ? p : null, true))
    : null;
  show(found?.published ? found : null, true);
} catch (e) {
  if (card?.published)
    $$("[data-pending]").forEach((el) => (el.textContent = e.message));
  else $("#profile-status").textContent = e.message;
}
