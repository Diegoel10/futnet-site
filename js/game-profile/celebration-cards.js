// js/game-profile/celebration-cards.js
// Makes 3 shareable images (1400x1120) after a session ends:
//   1) CHAMPIONS (winning team)   2) TOP SCORERS (podium)   3) LOSERS (to laugh at)
// Built for WhatsApp: each image tells its story at a glance in the chat preview.
// Drawn on a <canvas>, so they can be shared straight to WhatsApp or downloaded.

const W = 1400, H = 1120;
const GREEN = '#00F296';
const GOLD = '#FCD34D';
const MARKER = '"Permanent Marker", "Marker Felt", "Comic Sans MS", cursive';
const BLOCK = '"Anton", "Bebas Neue", "Inter", "Arial Black", Impact, sans-serif';
const BODY = '"Inter", "Poppins", -apple-system, "Segoe UI", Arial, sans-serif';

const WIN_LINES = ['GOOD GAMES,\nBETTER PEOPLE', 'TOO EASY 😮‍💨', 'NO MERCY TONIGHT'];
const SCORER_LINES = [
    ['PLAYED LIKE HE\nOWNS THE FIELD', 'BALL HOG\nBUT IT WORKED', 'NOT BAD\nFOR A RETIREE'],
    ['SHOWED UP.\nTHAT\'S RARE.', 'ALMOST\nTHE GOAT', 'SILVER SUITS\nHIM'],
    ['CAME TO PLAY…\nAND DID', 'BRONZE\nIS STILL METAL', 'LUCKY BOUNCES\nCOUNT TOO'],
];
const LOSER_LINES = [
    'CARDIO WAS THE\nREAL WIN TONIGHT 🏃',
    'THANKS FOR\nSHOWING UP 😂',
    'NEXT WEEK FOR SURE…\nRIGHT? 🤡',
    'SOMEBODY CHECK\nON THEM 😭',
    'THE DONATION\nTEAM 🎁',
];
const LOSER_SIDE = ['ASÍ NO SE PUEDE 😂', 'ESTÁN DE VACACIONES', 'EL EQUIPO DONANTE 🎁'];

const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

// ---------- loading ----------
let fontsReady = null;
export function loadFonts() {
    if (fontsReady) return fontsReady;
    if (!document.getElementById('celebration-fonts')) {
        const link = document.createElement('link');
        link.id = 'celebration-fonts';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@600;800;900&family=Permanent+Marker&display=swap';
        document.head.appendChild(link);
    }
    fontsReady = Promise.all([
        document.fonts.load('80px "Permanent Marker"'),
        document.fonts.load('80px "Anton"'),
        document.fonts.load('900 40px "Inter"'),
    ]).catch(() => {}).then(() => new Promise(r => setTimeout(r, 50)));
    return fontsReady;
}

const imgCache = new Map();
function loadImage(src) {
    if (!src) return Promise.resolve(null);
    if (imgCache.has(src)) return imgCache.get(src);
    const p = new Promise(resolve => {
        const img = new Image();
        if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
    imgCache.set(src, p);
    return p;
}

// ---------- drawing helpers ----------
function cover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const iw = img.width * s, ih = img.height * s;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

function background(ctx, bg, tint) {
    ctx.fillStyle = '#040E13';
    ctx.fillRect(0, 0, W, H);
    if (bg) cover(ctx, bg, 0, 0, W, H);
    // darken for readability
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(2,8,14,0.55)');
    g.addColorStop(0.45, 'rgba(2,8,14,0.35)');
    g.addColorStop(1, 'rgba(2,8,14,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (tint) {
        const r = ctx.createRadialGradient(W / 2, 520, 50, W / 2, 520, 760);
        r.addColorStop(0, tint + '55');
        r.addColorStop(1, tint + '00');
        ctx.fillStyle = r;
        ctx.fillRect(0, 0, W, H);
    }
}

function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/** A painted brush stroke behind a title. */
function brush(ctx, cx, cy, w, h, color, seed = 1) {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.035);
    ctx.fillStyle = color;
    ctx.beginPath();
    const steps = 26;
    ctx.moveTo(-w / 2, -h / 2 + rnd() * 10);
    for (let i = 1; i <= steps; i++) ctx.lineTo(-w / 2 + (w * i) / steps, -h / 2 + (rnd() - 0.5) * 18);
    ctx.lineTo(w / 2 + 20 + rnd() * 30, -h / 4);
    ctx.lineTo(w / 2 - 10, h / 6);
    ctx.lineTo(w / 2 + 30 + rnd() * 20, h / 2 - 6);
    for (let i = steps; i >= 0; i--) ctx.lineTo(-w / 2 + (w * i) / steps, h / 2 + (rnd() - 0.5) * 20);
    ctx.lineTo(-w / 2 - 30 - rnd() * 20, h / 4);
    ctx.lineTo(-w / 2 + 10, 0);
    ctx.lineTo(-w / 2 - 25 - rnd() * 20, -h / 3);
    ctx.closePath();
    ctx.fill();
    // dry-brush streaks
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < 14; i++) {
        const y = -h / 2 - 14 + rnd() * (h + 28);
        const x0 = -w / 2 + rnd() * w * 0.4;
        ctx.fillRect(x0, y, w * (0.2 + rnd() * 0.5), 2 + rnd() * 4);
    }
    ctx.restore();
}

function text(ctx, str, x, y, { font, color = '#fff', align = 'center', shadow = true, maxWidth, rotate = 0, stroke } = {}) {
    ctx.save();
    ctx.translate(x, y);
    if (rotate) ctx.rotate(rotate);
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (shadow) { ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3; }
    const lines = String(str).split('\n');
    const size = parseInt(font.match(/(\d+)px/)?.[1] || '30', 10);
    lines.forEach((ln, i) => {
        const yy = (i - (lines.length - 1) / 2) * size * 1.12;
        if (stroke) { ctx.lineWidth = stroke.width; ctx.strokeStyle = stroke.color; ctx.strokeText(ln, 0, yy, maxWidth); }
        ctx.fillStyle = color;
        ctx.fillText(ln, 0, yy, maxWidth);
    });
    ctx.restore();
}

function fitFont(ctx, str, family, weight, start, maxWidth) {
    let size = start;
    do {
        ctx.font = `${weight} ${size}px ${family}`;
        if (ctx.measureText(str).width <= maxWidth) break;
        size -= 2;
    } while (size > 14);
    return `${weight} ${size}px ${family}`;
}

function crown(ctx, cx, cy, w, color) {
    const h = w * 0.62;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(0.12);
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-w / 2, h / 2);
    ctx.lineTo(-w / 2, -h / 6);
    ctx.lineTo(-w / 4, h / 8);
    ctx.lineTo(0, -h / 2);
    ctx.lineTo(w / 4, h / 8);
    ctx.lineTo(w / 2, -h / 6);
    ctx.lineTo(w / 2, h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

/** Round player photo with a glowing ring. Falls back to initials when the photo can't be drawn. */
function avatar(ctx, img, name, cx, cy, r, ring, { grey = false, glow = true, ringWidth } = {}) {
    ctx.save();
    if (glow) { ctx.shadowColor = ring; ctx.shadowBlur = r * 0.6; }
    ctx.beginPath(); ctx.arc(cx, cy, r + (ringWidth || Math.max(4, r * 0.09)), 0, Math.PI * 2);
    ctx.fillStyle = ring; ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    if (img) {
        const size = r * 2;
        if (grey) {
            try {
                const off = document.createElement('canvas');
                off.width = off.height = Math.ceil(size);
                const o = off.getContext('2d');
                cover(o, img, 0, 0, size, size);
                const d = o.getImageData(0, 0, off.width, off.height);
                for (let i = 0; i < d.data.length; i += 4) {
                    const v = d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11;
                    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
                }
                o.putImageData(d, 0, 0);
                ctx.drawImage(off, cx - r, cy - r, size, size);
            } catch (e) {
                cover(ctx, img, cx - r, cy - r, size, size);
                ctx.fillStyle = 'rgba(80,80,80,0.55)'; ctx.fillRect(cx - r, cy - r, size, size);
            }
        } else {
            cover(ctx, img, cx - r, cy - r, size, size);
        }
    } else {
        const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
        g.addColorStop(0, grey ? '#4b5563' : '#0f766e'); g.addColorStop(1, grey ? '#1f2937' : '#064e3b');
        ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        text(ctx, initials(name), cx, cy + 2, { font: `900 ${Math.round(r * 0.8)}px ${BODY}`, shadow: false });
    }
    ctx.restore();
}

function header(ctx, logo, info) {
    // FutNet logo top-left
    if (logo) {
        const h = 92, w = logo.width * (h / logo.height);
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 12;
        ctx.drawImage(logo, 60, 34, w, h); ctx.restore();
    } else {
        text(ctx, 'FUT', 70, 80, { font: `italic 900 64px ${BODY}`, align: 'left' });
        ctx.font = `italic 900 64px ${BODY}`;
        text(ctx, 'NET', 70 + ctx.measureText('FUT').width, 80, { font: `italic 900 64px ${BODY}`, align: 'left', color: GREEN });
    }
}

function infoBar(ctx, info, y) {
    const items = [info.date, info.location, info.format].filter(Boolean);
    if (!items.length) return;
    const icons = ['📅', '📍', '⚽'];
    ctx.font = `800 30px ${BODY}`;
    const parts = items.map((t, i) => ({ t: String(t).toUpperCase(), icon: icons[[info.date, info.location, info.format].indexOf(t)] || '•' }));
    const widths = parts.map(p => ctx.measureText(p.t).width + 50);
    const gap = 60;
    let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1)) / 2;
    parts.forEach((p, i) => {
        text(ctx, p.icon, x + 16, y, { font: `30px ${BODY}`, align: 'center' });
        text(ctx, p.t, x + 44, y, { font: `800 30px ${BODY}`, align: 'left', maxWidth: widths[i] });
        x += widths[i];
        if (i < parts.length - 1) {
            ctx.fillStyle = GREEN + '99'; ctx.fillRect(x + gap / 2 - 1, y - 22, 2, 44);
            x += gap;
        }
    });
}

const FOOTER_TOP = H - 165; // nothing else is drawn below this line

function footer(ctx) {
    // dark band so the address pops on any background
    const g = ctx.createLinearGradient(0, FOOTER_TOP - 10, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.35, 'rgba(0,0,0,0.7)');
    g.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, FOOTER_TOP - 10, W, H - FOOTER_TOP + 10);

    text(ctx, 'FIND AND ORGANIZE SOCCER GAMES AROUND YOUR AREA!', W / 2, H - 128,
        { font: `800 24px ${BODY}`, color: 'rgba(255,255,255,0.85)' });
    // the big one
    ctx.save();
    ctx.shadowColor = GREEN; ctx.shadowBlur = 30;
    text(ctx, 'FUTNET.SITE', W / 2, H - 62, {
        font: `96px ${BLOCK}`, color: GREEN, shadow: false,
        stroke: { width: 8, color: 'rgba(0,0,0,0.85)' },
    });
    ctx.restore();
}

function scribble(ctx, str, x, y, rot, color = GREEN, size = 40) {
    text(ctx, str, x, y, { font: `${size}px ${MARKER}`, color, rotate: rot });
}

/** Lays out photos in rows so any team size fits. Returns the y after the last row. */
async function photoRows(ctx, players, { top, maxRowWidth, ring, grey, showNames }) {
    const n = players.length || 1;
    const perRow = n <= 5 ? n : n <= 8 ? Math.ceil(n / 2) : n <= 12 ? Math.ceil(n / 2) : Math.ceil(n / 3);
    const rows = Math.ceil(n / perRow);
    const gap = 26;
    const extra = showNames ? 62 : 26;
    const fitH = ((FOOTER_TOP - 15 - top) / rows - extra) / 2; // never run into the footer
    const r = Math.max(30, Math.min(78, (maxRowWidth - gap * (perRow - 1)) / perRow / 2, fitH));
    const rowH = r * 2 + extra;
    const imgs = await Promise.all(players.map(p => loadImage(p.avatar)));
    for (let i = 0; i < players.length; i++) {
        const row = Math.floor(i / perRow), col = i % perRow;
        const inRow = Math.min(perRow, players.length - row * perRow);
        const rowW = inRow * r * 2 + (inRow - 1) * gap;
        const cx = W / 2 - rowW / 2 + r + col * (r * 2 + gap);
        const cy = top + r + row * rowH;
        avatar(ctx, imgs[i], players[i].name, cx, cy, r, ring, { grey });
        if (showNames) {
            text(ctx, String(players[i].name || 'Player').split(' ')[0].toUpperCase(), cx, cy + r + 30,
                { font: `900 ${Math.round(Math.max(20, r * 0.36))}px ${BODY}`, maxWidth: r * 2 + gap - 4 });
        }
    }
    return top + rows * rowH;
}

function statPills(ctx, stats, y, accent) {
    const w = 170, h = 104, gap = 18;
    let x = W / 2 - (stats.length * w + (stats.length - 1) * gap) / 2;
    stats.forEach(([v, label, color]) => {
        ctx.save();
        rr(ctx, x, y, w, h, 22);
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = (color || accent) + '88'; ctx.stroke();
        ctx.restore();
        text(ctx, String(v), x + w / 2, y + 44, { font: `64px ${BLOCK}`, color: color || '#fff' });
        text(ctx, label, x + w / 2, y + 86, { font: `800 17px ${BODY}`, color: 'rgba(255,255,255,0.7)' });
        x += w + gap;
    });
}

// ---------- the three cards ----------
async function drawChampions(ctx, d, assets) {
    const t = d.winner;
    const color = d.accent(t.color);
    background(ctx, assets.bg, color);
    header(ctx, assets.logo, d.info);
    scribble(ctx, pick(WIN_LINES, d.seed), W - 210, 110, -0.18, GREEN, 38);

    brush(ctx, W / 2, 238, 820, 150, color, 3);
    text(ctx, '🏆 CHAMPIONS', W / 2, 236, { font: `110px ${MARKER}`, color: '#0b0f14', shadow: false, maxWidth: 780 });
    text(ctx, t.name.toUpperCase(), W / 2, 352, { font: fitFont(ctx, t.name.toUpperCase(), BLOCK, '', 66, 1000), color, stroke: { width: 6, color: 'rgba(0,0,0,0.6)' } });
    infoBar(ctx, d.info, 420);

    const gd = t.gf - t.ga;
    statPills(ctx, [[t.points, 'POINTS', color], [t.wins, 'WINS'], [t.draws, 'DRAWS'], [t.losses, 'LOSSES'], [gd > 0 ? '+' + gd : gd, 'GOAL DIFF', GREEN]], 470, color);
    await photoRows(ctx, t.players, { top: 616, maxRowWidth: 1180, ring: color, showNames: true });
    footer(ctx, assets.logo);
}

async function drawScorers(ctx, d, assets) {
    background(ctx, assets.bg, GOLD);
    header(ctx, assets.logo, d.info);
    scribble(ctx, 'THE REAL MVP…\nIS THE GROUP CHAT 😉', 230, 905, -0.2, GREEN, 34);
    scribble(ctx, 'NEXT GAME\nWE RUN IT ↙', W - 200, 905, -0.22, GREEN, 34);

    brush(ctx, W / 2, 212, 860, 150, GREEN, 5);
    text(ctx, '⚽ TOP SCORERS', W / 2, 210, { font: `104px ${MARKER}`, color: '#0b0f14', shadow: false, maxWidth: 820 });
    infoBar(ctx, d.info, 316);

    const top3 = d.scorers.slice(0, 3);
    const imgs = await Promise.all(top3.map(s => loadImage(s.avatar)));
    // podium order: 2nd, 1st, 3rd
    const slots = [
        { i: 1, x: 300, y: 520, w: 340, h: 330, ring: '#38BDF8', medal: '#CBD5E1' },
        { i: 0, x: 700, y: 480, w: 400, h: 380, ring: GOLD, medal: GOLD },
        { i: 2, x: 1100, y: 520, w: 340, h: 330, ring: '#F97316', medal: '#D97706' },
    ];
    for (const s of slots) {
        const p = top3[s.i];
        if (!p) continue;
        const x0 = s.x - s.w / 2;
        ctx.save();
        ctx.shadowColor = s.ring; ctx.shadowBlur = 28;
        rr(ctx, x0, s.y, s.w, s.h, 28);
        ctx.fillStyle = 'rgba(4,10,16,0.88)'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = s.ring; ctx.stroke();
        ctx.restore();
        const r = s.i === 0 ? 92 : 78;
        avatar(ctx, imgs[s.i], p.name, s.x, s.y - 4, r, s.ring);
        if (s.i === 0) crown(ctx, s.x + 62, s.y - r - 20, 72, GOLD);
        // rank number on a brush
        brush(ctx, x0 + 62, s.y + 58, 92, 74, s.medal, 7 + s.i);
        text(ctx, String(s.i + 1), x0 + 62, s.y + 56, { font: `70px ${MARKER}`, color: '#0b0f14', shadow: false });
        text(ctx, p.name.toUpperCase(), s.x, s.y + r + 70, { font: fitFont(ctx, p.name.toUpperCase(), MARKER, '', s.i === 0 ? 46 : 38, s.w - 30) });
        ctx.fillStyle = s.ring + '66'; ctx.fillRect(x0 + 40, s.y + r + 104, s.w - 80, 2);
        text(ctx, `${p.goals} ${p.goals === 1 ? 'GOAL' : 'GOALS'}`, s.x, s.y + r + 146, { font: `${s.i === 0 ? 56 : 48}px ${BLOCK}`, color: s.ring });
        text(ctx, pick(SCORER_LINES[s.i], d.seed + s.i), s.x, s.y + r + 210, { font: `${s.i === 0 ? 26 : 24}px ${MARKER}`, color: 'rgba(255,255,255,0.85)', rotate: -0.05 });
    }
    // 4th and 5th
    const rest = d.scorers.slice(3, 5);
    if (rest.length) {
        const line = rest.map((p, k) => `${k + 4}. ${p.name.split(' ')[0].toUpperCase()} · ${p.goals}`).join('     ');
        text(ctx, line, W / 2, 920, { font: `800 26px ${BODY}`, color: 'rgba(255,255,255,0.75)' });
    }
    footer(ctx, assets.logo);
}

async function drawLosers(ctx, d, assets) {
    const t = d.loser;
    const RED = '#EF4444';
    const color = d.accent(t.color);
    background(ctx, assets.bg, RED);
    header(ctx, assets.logo, d.info);
    scribble(ctx, pick(LOSER_SIDE, d.seed), W - 230, 110, -0.16, '#FCA5A5', 36);

    brush(ctx, W / 2, 238, 760, 150, RED, 9);
    text(ctx, '😂 LOSERS', W / 2, 236, { font: `118px ${MARKER}`, color: '#0b0f14', shadow: false, maxWidth: 720 });
    text(ctx, t.name.toUpperCase(), W / 2, 352, { font: fitFont(ctx, t.name.toUpperCase(), BLOCK, '', 66, 1000), color, stroke: { width: 6, color: 'rgba(0,0,0,0.6)' } });
    text(ctx, pick(LOSER_LINES, d.seed).replace('\n', ' '), W / 2, 422, { font: `40px ${MARKER}`, color: '#fff', rotate: -0.015, maxWidth: 1240 });

    const gd = t.gf - t.ga;
    statPills(ctx, [[t.points, 'POINTS', '#FCA5A5'], [t.wins, 'WINS'], [t.draws, 'DRAWS'], [t.losses, 'LOSSES', RED], [gd > 0 ? '+' + gd : gd, 'GOAL DIFF', RED]], 470, RED);
    await photoRows(ctx, t.players, { top: 616, maxRowWidth: 1060, ring: RED, showNames: true });
    scribble(ctx, '🤡', 110, 700, -0.2, '#fff', 100);
    scribble(ctx, '🤡', W - 110, 760, 0.2, '#fff', 100);
    footer(ctx, assets.logo);
}

/**
 * Makes the 3 images. `results` comes from computeSessionResults(ev).
 * Returns [{ key, title, canvas }].
 */
export async function makeCelebrationCards(results, info, opts = {}) {
    await loadFonts();
    const [bg, logo] = await Promise.all([
        loadImage(opts.background || 'img/celebration_bg.jpg'),
        loadImage(opts.logo || 'img/celebration_logo.png').then(i => i || loadImage('img/FutnetJustLogo.png')),
    ]);
    const assets = { bg, logo };
    const d = {
        winner: results.winner,
        scorers: results.scorers || [],
        loser: results.standings && results.standings.length > 1 ? results.standings[results.standings.length - 1] : null,
        info,
        accent: opts.accent || (c => c),
        seed: Math.floor(Math.random() * 1000),
    };
    const out = [];
    const make = async (key, title, fn) => {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        await fn(c.getContext('2d'), d, assets);
        out.push({ key, title, canvas: c });
    };
    if (d.winner) await make('champions', 'Champions', drawChampions);
    if (d.scorers.length) await make('scorers', 'Top scorers', drawScorers);
    if (d.loser && d.winner && d.loser.index !== d.winner.index) await make('losers', 'Losers', drawLosers);
    return out;
}

const toBlob = (canvas) => new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));

/** Shows the 3 images with Share / Download buttons. */
export async function openCelebrationCards(results, info, opts = {}) {
    let m = document.getElementById('celebration-cards-modal');
    if (!m) { m = document.createElement('div'); m.id = 'celebration-cards-modal'; document.body.appendChild(m); }
    m.className = 'fixed inset-0 z-[190] bg-[#040E13] text-white overflow-y-auto';
    m.innerHTML = `<div class="h-full flex items-center justify-center text-sm text-white/70"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Making your images…</div>`;

    let cards = [];
    try { cards = await makeCelebrationCards(results, info, opts); }
    catch (e) { console.error(e); }

    const slug = (info.title || 'futnet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const files = [];
    let tainted = false;
    for (const c of cards) {
        try {
            const blob = await toBlob(c.canvas);
            files.push(new File([blob], `${slug}-${c.key}.jpg`, { type: 'image/jpeg' }));
        } catch (e) { tainted = true; files.push(null); }
    }

    m.innerHTML = `
        <div class="max-w-2xl mx-auto p-4 pb-16 space-y-4">
            <div class="flex items-center justify-between sticky top-0 bg-[#040E13] py-2 z-10">
                <div>
                    <div class="text-base font-black">Share the results 🎉</div>
                    <div class="text-[11px] text-white/60">Send them one by one so each one pops in the chat.</div>
                </div>
                <button onclick="document.getElementById('celebration-cards-modal').remove()" aria-label="Close" class="w-9 h-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-xmark text-sm"></i></button>
            </div>
            ${tainted ? `<div class="text-xs bg-amber-500/10 border border-amber-400/40 rounded-xl p-3">Some photos couldn't be added to the images. Take a screenshot of each one instead.</div>` : ''}
            ${cards.length ? '' : '<p class="text-sm text-white/60">No results to share yet.</p>'}
            <div id="celebration-cards-list" class="space-y-5"></div>
        </div>`;
    const list = m.querySelector('#celebration-cards-list');
    cards.forEach((c, i) => {
        const box = document.createElement('div');
        box.className = 'space-y-2';
        c.canvas.className = 'w-full h-auto rounded-2xl border border-white/10 shadow-xl';
        box.appendChild(c.canvas);
        const row = document.createElement('div');
        row.className = 'flex gap-2';
        const file = files[i];
        const canShare = file && navigator.canShare && navigator.canShare({ files: [file] });
        row.innerHTML = `
            ${canShare ? `<button data-act="share" class="flex-1 bg-[#25D366] text-slate-950 font-black py-3 rounded-xl text-sm"><i class="fa-brands fa-whatsapp mr-1"></i> Share ${c.title}</button>` : ''}
            ${file ? `<button data-act="save" class="${canShare ? '' : 'flex-1 '}bg-black/60 border border-white/20 text-white font-bold py-3 px-4 rounded-xl text-sm"><i class="fa-solid fa-download mr-1"></i> Save</button>` : ''}`;
        row.querySelector('[data-act="share"]')?.addEventListener('click', async () => {
            try { await navigator.share({ files: [file] }); } catch (e) { /* cancelled */ }
        });
        row.querySelector('[data-act="save"]')?.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(file); a.download = file.name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        });
        box.appendChild(row);
        list.appendChild(box);
    });
}