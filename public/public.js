import {
  $,
  $$,
  escape,
  loadSite,
  loadEvent,
  initShared,
  therapistCard,
  installImageFallbacks,
  empty,
  demo,
  dateParts,
  eventDate,
  eventTime,
  safeUrl,
  toast,
} from "./core.js";
initShared();
let site,
  selectedDay = null;
const now = dateParts(new Date());
let year = Number(now.year),
  month = Number(now.month) - 1;
$("#filters").addEventListener("submit", (e) => e.preventDefault());
for (const id of ["search", "format", "topic"])
  $("#" + id).addEventListener(
    id === "search" ? "input" : "change",
    renderTherapists,
  );
$("#month-prev").addEventListener("click", () => changeMonth(-1));
$("#month-next").addEventListener("click", () => changeMonth(1));
$("#clear-day").addEventListener("click", () => {
  selectedDay = null;
  renderCalendar();
});
function renderTherapists() {
  if (!site) return;
  const q = $("#search").value.trim().toLocaleLowerCase("ru"),
    format = $("#format").value,
    topic = $("#topic").value;
  const all = site.therapists.filter((p) => p.published);
  const people = all.filter(
    (p) =>
      (!q ||
        [p.name, p.summary, ...(p.topics || [])]
          .join(" ")
          .toLocaleLowerCase("ru")
          .includes(q)) &&
      (!format || p.formats?.includes(format)) &&
      (!topic ||
        p.topics?.some((t) => t.toLocaleLowerCase("ru") === topic)),
  );
  $("#results-label").textContent = all.length
    ? `Специалистов: ${people.length}${people.length !== all.length ? ` из ${all.length}` : ""}`
    : "Опубликованных анкет пока нет";
  $("#therapist-grid").innerHTML = people.length
    ? people.map(therapistCard).join("")
    : all.length
      ? empty(
          "Специалисты не найдены",
          "Измените поисковый запрос или сбросьте фильтры.",
          '<button class="button secondary" id="reset-search">Сбросить фильтры</button>',
        )
      : empty(
          "Анкеты пока не опубликованы",
          "Администратор добавит специалистов после заполнения анкет.",
        );
  $("#reset-search")?.addEventListener("click", () => {
    $("#filters").reset();
    renderTherapists();
  });
  installImageFallbacks($("#therapist-grid"));
}
// Темы в фильтре — только те, что терапевты сами указали в опубликованных анкетах.
function renderTopics() {
  const topics = new Map();
  for (const p of site.therapists.filter((p) => p.published))
    for (const t of p.topics || []) {
      const key = t.toLocaleLowerCase("ru");
      if (!topics.has(key)) topics.set(key, t);
    }
  const sorted = [...topics].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  $("#topic").innerHTML =
    '<option value="">Любая</option>' +
    sorted
      .map(([key, t]) => `<option value="${escape(key)}">${escape(t)}</option>`)
      .join("");
  $("#topic").closest("label").hidden = !sorted.length;
}
function changeMonth(step) {
  month += step;
  if (month < 0) {
    month = 11;
    year--;
  }
  if (month > 11) {
    month = 0;
    year++;
  }
  selectedDay = null;
  renderCalendar();
}
function renderCalendar() {
  if (!site) return;
  $("#calendar-month").textContent = new Date(year, month, 1)
    .toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
    .replace(" г.", "");
  const events = site.events
    .filter((e) => {
      const d = dateParts(e.startsAt);
      return Number(d.year) === year && Number(d.month) === month + 1;
    })
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const days = new Date(year, month + 1, 0).getDate(),
    offset = (new Date(year, month, 1).getDay() + 6) % 7;
  $("#calendar-days").innerHTML =
    "<span></span>".repeat(offset) +
    Array.from({ length: days }, (_, i) => {
      const day = i + 1,
        has = events.some((e) => Number(dateParts(e.startsAt).day) === day),
        today =
          Number(now.year) === year &&
          Number(now.month) === month + 1 &&
          Number(now.day) === day;
      return `<button type="button" data-day="${day}" ${has ? "" : "disabled"} class="${has ? "event-day " : ""}${today ? "today " : ""}${selectedDay === day ? "selected" : ""}" aria-label="${day} ${escape($("#calendar-month").textContent)}${has ? ", есть события" : ""}" aria-pressed="${selectedDay === day}">${day}</button>`;
    }).join("");
  $$("#calendar-days button.event-day").forEach((b) =>
    b.addEventListener("click", () => {
      selectedDay = Number(b.dataset.day);
      renderCalendar();
    }),
  );
  $("#clear-day").hidden = !selectedDay;
  const shown = events.filter(
    (e) => !selectedDay || Number(dateParts(e.startsAt).day) === selectedDay,
  );
  $("#event-list").innerHTML = shown.length
    ? shown
        .map(
          (e) =>
            `<button type="button" class="event-row" data-event="${escape(e.id)}"><span class="event-date">${Number(dateParts(e.startsAt).day)}<small>${escape(new Date(e.startsAt).toLocaleDateString("ru-RU", { month: "short", timeZone: "Asia/Yekaterinburg" }))}</small></span><span class="event-info"><span>${escape(e.type)}</span><h3>${escape(e.title)}</h3><p>${eventTime(e.startsAt)} · ${escape(e.location)}${e.price ? ` · ${escape(e.price)}` : ""}</p></span></button>`,
        )
        .join("")
    : empty(
        "Мероприятий в этом месяце нет",
        "Выберите другой месяц.",
      );
  $$("[data-event]").forEach((b) =>
    b.addEventListener("click", () =>
      openEvent(site.events.find((e) => e.id === b.dataset.event)),
    ),
  );
}
// The list has no long descriptions; the full event is loaded on open.
async function openEvent(e) {
  renderEvent(e, e.description ?? null);
  $("#event-dialog").showModal();
  if (e.description != null) return;
  try {
    const full = await loadEvent(e.id);
    renderEvent(e, full?.description || "");
  } catch (error) {
    renderEvent(e, "");
    toast(error.message);
  }
}
function renderEvent(e, description) {
  const contact = safeUrl(e.contactUrl);
  $("#event-detail").innerHTML =
    `<p class="eyebrow">${escape(e.type)}</p><h2>${escape(e.title)}</h2><div class="tags"><span class="tag">${eventDate(e.startsAt)}</span><span class="tag">${eventTime(e.startsAt)} · время Магнитогорска</span><span class="tag">${escape(e.location)}</span>${e.price ? `<span class="tag">${escape(e.price)}</span>` : ""}</div><p class="detail-text${description == null ? " muted" : ""}">${escape(description ?? "Загрузка описания…")}</p>${contact ? `<a class="button" href="${escape(contact)}" target="_blank" rel="noopener noreferrer">${escape(e.contactLabel || "Контакты организатора")}</a>` : '<p class="muted">Контакт для записи не указан.</p>'}`;
}
try {
  site = await loadSite();
  $("#about-copy").textContent = site.settings.about;
  const contact = safeUrl(site.settings.contactUrl);
  if (contact) {
    $("#community-contact").href = contact;
    $("#community-contact").textContent =
      site.settings.contactLabel || "Связаться с сообществом";
    $("#community-contact").hidden = false;
    $("#community-contact-section").hidden = false;
    $("#community-contact").target = "_blank";
    $("#community-contact").rel = "noopener noreferrer";
  }
  renderTopics();
  renderTherapists();
  renderCalendar();
} catch (e) {
  $("#therapist-grid").innerHTML = empty(
    "Не получилось загрузить каталог",
    e.message,
  );
  $("#results-label").textContent = "";
  $("#event-list").innerHTML = empty(
    "Календарь временно недоступен",
    "Обновите страницу чуть позже.",
  );
  toast(e.message);
}
