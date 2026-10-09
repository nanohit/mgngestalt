// Faint watercolour wreaths on the page background, echoing the logo.
// Each wreath is a full ring of brush dabs painted once on its own canvas
// and centred on a screen corner, so only a quarter of it shows. While the
// page scrolls the rings slowly turn (via CSS transforms, no repainting):
// the visible dabs drift up with the content and their colours change.

// Colours sampled around the logo, by angle in degrees (0° points right,
// angles grow clockwise). The logo's open gap lies between 292° and 348°.
const STOPS = [
  [-12, "#fa251f"], [10, "#fc3311"], [25, "#fc3e0a"], [40, "#fd4e0a"],
  [48, "#fd770a"], [55, "#fda105"], [70, "#fbae0b"], [85, "#fab009"],
  [100, "#f6b513"], [115, "#b6a117"], [130, "#879421"], [145, "#45762a"],
  [160, "#366b29"], [175, "#407530"], [190, "#2a6931"], [205, "#1b6a3f"],
  [220, "#10634f"], [235, "#108797"], [250, "#016f90"], [265, "#458d4d"],
  [280, "#9aa838"], [292, "#a7ad3a"],
];
const DABS = 30;
// How fast the dabs move relative to the scrolled content.
const DRIFT = 0.45;

const layer = document.createElement("div");
layer.className = "backdrop";
layer.setAttribute("aria-hidden", "true");
const rings = [
  // Top-right corner turns clockwise; at rest it shows yellow to green.
  { canvas: document.createElement("canvas"), turn: 1, offset: 0, seed: 19 },
  // Bottom-left corner turns the other way; at rest it shows red to amber.
  { canvas: document.createElement("canvas"), turn: -1, offset: 270, seed: 7 },
];
for (const ring of rings) layer.append(ring.canvas);
document.body.prepend(layer);

function random(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function colorAt(degrees) {
  let i = 1;
  while (i < STOPS.length - 1 && STOPS[i][0] < degrees) i++;
  const [a, from] = STOPS[i - 1];
  const [b, to] = STOPS[i];
  const t = Math.min(1, Math.max(0, (degrees - a) / (b - a)));
  const channel = (hex, k) => parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16);
  const mix = [0, 1, 2].map((k) =>
    Math.round(channel(from, k) + (channel(to, k) - channel(from, k)) * t),
  );
  return `rgb(${mix.join(" ")})`;
}

// One brush dab, drawn from its base to its tip along +x: a blurred wash
// plus bristles of uneven length, so the edges and the tip stay ragged.
function dab(ctx, x, y, angle, length, width, color, rand) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.translate(-length / 2, 0);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  const bend = (rand() - 0.5) * width * 0.5;
  const curve = (t) => bend * 4 * t * (1 - t);

  ctx.globalAlpha = 0.12;
  if ("filter" in ctx) ctx.filter = `blur(${(width * 0.06).toFixed(1)}px)`;
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const t = 0.04 + (i / 24) * 0.86;
    ctx.lineTo(t * length, curve(t) - (width / 2) * Math.sqrt(Math.sin(Math.PI * t)));
  }
  for (let i = 24; i >= 0; i--) {
    const t = 0.04 + (i / 24) * 0.86;
    ctx.lineTo(t * length, curve(t) + (width / 2) * Math.sqrt(Math.sin(Math.PI * t)));
  }
  ctx.fill();
  if ("filter" in ctx) ctx.filter = "none";

  const bristles = Math.round(width / 1.3);
  for (let i = 0; i < bristles; i++) {
    const across = rand() * 2 - 1;
    const edge = Math.abs(across);
    const from = 0.02 + (1 - Math.sqrt(1 - edge * edge)) * 0.3 + rand() * 0.05;
    const to = 0.98 - edge * edge * 0.35 - rand() * 0.22;
    if (to <= from) continue;
    const offset = across * width * 0.48;
    ctx.globalAlpha = rand() < 0.06 ? 0.24 : 0.06 + rand() * 0.11;
    ctx.lineWidth = 1 + rand() * 2.8;
    ctx.beginPath();
    ctx.moveTo(from * length, offset + curve(from));
    ctx.quadraticCurveTo(
      ((from + to) / 2) * length,
      offset + bend * 2 * (1 - edge * 0.3) + (rand() - 0.5) * 3,
      to * length,
      offset + curve(to) + (rand() - 0.5) * 3,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function paintRing(ring, radius, size) {
  const side = Math.ceil((radius * 1.05 + size * 0.6) * 2);
  // Keep each canvas within ~2048px so memory stays modest on big screens.
  const ratio = Math.min(window.devicePixelRatio || 1, 2, 2048 / side);
  const { canvas } = ring;
  canvas.width = Math.round(side * ratio);
  canvas.height = Math.round(side * ratio);
  canvas.style.width = `${side}px`;
  canvas.style.height = `${side}px`;
  ring.side = side;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.globalCompositeOperation = "multiply";
  const rand = random(ring.seed);
  const first = STOPS[0][0];
  const last = STOPS[STOPS.length - 1][0];
  for (let i = 0; i < DABS; i++) {
    const degrees = first + ((last - first) * i) / (DABS - 1);
    const angle = ((degrees + ring.offset) * Math.PI) / 180 + (rand() - 0.5) * 0.04;
    const r = radius * (1 + (rand() - 0.5) * 0.06);
    const length = size * (0.9 + rand() * 0.2);
    dab(
      ctx,
      side / 2 + Math.cos(angle) * r,
      side / 2 + Math.sin(angle) * r,
      angle + (rand() - 0.5) * 0.18,
      length,
      length * 0.36,
      colorAt(degrees),
      rand,
    );
  }
}

let painted = 0;
let radius = 0;
function layout() {
  const width = layer.clientWidth;
  const height = layer.clientHeight;
  if (!width || !height) return;
  const scale = Math.max(Math.min(width, 1600), 640);
  if (scale !== painted) {
    painted = scale;
    radius = scale * 0.3;
    for (const ring of rings) paintRing(ring, radius, radius * 0.58);
  }
  rings[0].x = width + scale * 0.03;
  rings[0].y = -scale * 0.03;
  rings[1].x = -scale * 0.03;
  rings[1].y = height + scale * 0.03;
  place();
  layer.classList.add("ready");
}

let shown = 0;
function place() {
  const turn = (shown * DRIFT) / radius;
  for (const ring of rings) {
    const half = ring.side / 2;
    ring.canvas.style.transform = `translate(${ring.x - half}px, ${ring.y - half}px) rotate(${turn * ring.turn}rad)`;
  }
}

// Ease towards the scroll position so the rings keep a little inertia.
let frame = 0;
function follow() {
  shown += (window.scrollY - shown) * 0.1;
  if (Math.abs(window.scrollY - shown) < 0.5) shown = window.scrollY;
  place();
  frame = shown === window.scrollY ? 0 : requestAnimationFrame(follow);
}

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!still) shown = window.scrollY;
layout();
if (!still)
  addEventListener(
    "scroll",
    () => {
      if (!frame) frame = requestAnimationFrame(follow);
    },
    { passive: true },
  );
let timer;
addEventListener("resize", () => {
  clearTimeout(timer);
  timer = setTimeout(layout, 150);
});
