import {
  $,
  escape,
  loadSite,
  initShared,
  portrait,
  installImageFallbacks,
  empty,
  demo,
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
try {
  const site = await loadSite(),
    p = site.therapists.find((p) => p.id === id && p.published);
  $("#profile-status").hidden = true;
  if (!p) {
    $("#profile").innerHTML = empty(
      "Анкета не найдена",
      "Анкета удалена или ещё не опубликована.",
      `<a class="button" href="/${demo ? "?demo=1" : ""}#therapists">Все терапевты</a>`,
    );
  } else {
    document.title = `${p.name} — гештальт-терапевт · Магнитогорск`;
    const contacts = (p.contacts || []).filter((c) => safeUrl(c.url));
    $("#profile").innerHTML =
      `<a class="breadcrumb" href="/${demo ? "?demo=1" : ""}#therapists">← К списку терапевтов</a><div class="profile-layout"><aside class="profile-sidebar">${portrait(p)}<a class="button full" href="#contacts">Контакты для записи</a><p class="muted">${escape(formatLabel(p))} · ${escape(priceLabel(p))}${p.duration ? ` · ${escape(p.duration)} мин` : ""}</p></aside><article class="profile-content"><p class="eyebrow">Гештальт-терапевт · Магнитогорск</p><h1>${escape(p.name)}</h1><p class="lead">${escape(p.summary)}</p><div class="tags">${(p.topics || []).map((t) => `<span class="tag">${escape(t)}</span>`).join("")}</div><section class="profile-block"><h2>О себе и работе</h2><p>${escape(p.about || "Информация не указана.")}</p></section>${p.education ? `<section class="profile-block"><h2>Образование и подготовка</h2><p>${escape(p.education)}</p></section>` : ""}<section class="profile-block" id="contacts"><h2>Контакты</h2><p>Для записи на консультацию свяжитесь с терапевтом.</p><div class="contact-links">${contacts.length ? contacts.map((c) => `<a href="${escape(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">${escape(c.label)} </a>`).join("") : '<p class="muted">Терапевт пока не добавил контакты.</p>'}</div></section></article></div>`;
    installImageFallbacks($("#profile"));
  }
} catch (e) {
  $("#profile-status").textContent = e.message;
}
