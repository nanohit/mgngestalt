// Faint watercolour dabs on the page background, echoing the logo wreath.
// Two partial wreaths sit in opposite corners of a fixed canvas, so the
// blocks glide over them while scrolling. Painted once per viewport size
// with a fixed seed: the composition is the same on every visit.

// Colours sampled from the logo, in the order they follow around each arc.
const WARM_TO_GREEN = ["#f6b513", "#e3ad15", "#c8a518", "#a59b1c", "#879421", "#5f8527", "#45762a", "#366b29", "#2a6931", "#1b6a3f"];
const RED_TO_BLUE = ["#fa251f", "#fc4410", "#fd6a0a", "#fda105", "#f6b513", "#9aa838", "#458d4d", "#2f7f6a", "#016f90", "#108797"];

const canvas = document.createElement("canvas");
canvas.className = "backdrop";
canvas.setAttribute("aria-hidden", "true");
document.body.prepend(canvas);

function random(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
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

function wreath(ctx, cx, cy, radius, from, to, colors, size, rand) {
  const count = colors.length;
  for (let i = 0; i < count; i++) {
    const angle = from + ((to - from) * i) / (count - 1) + (rand() - 0.5) * 0.05;
    const r = radius * (1 + (rand() - 0.5) * 0.06);
    const length = size * (0.9 + rand() * 0.2);
    dab(
      ctx,
      cx + Math.cos(angle) * r,
      cy + Math.sin(angle) * r,
      angle + (rand() - 0.5) * 0.18,
      length,
      length * 0.36,
      colors[i],
      rand,
    );
  }
}

let painted = "";
function paint() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  // Mobile toolbars change the height a little while scrolling; ignore that.
  const key = `${width}x${Math.round(height / 160)}`;
  if (!width || !height || key === painted) return;
  painted = key;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.globalCompositeOperation = "multiply";
  const scale = Math.max(Math.min(width, 1600), 640);
  const radius = scale * 0.3;
  const size = radius * 0.58;
  const rand = random(19);
  wreath(ctx, width + scale * 0.03, -scale * 0.03, radius, Math.PI * 0.47, Math.PI * 1.06, WARM_TO_GREEN, size, rand);
  wreath(ctx, -scale * 0.03, height + scale * 0.03, radius * 1.05, Math.PI * 1.44, Math.PI * 2.06, RED_TO_BLUE, size, rand);
  canvas.classList.add("ready");
}

paint();
let timer;
addEventListener("resize", () => {
  clearTimeout(timer);
  timer = setTimeout(paint, 150);
});
