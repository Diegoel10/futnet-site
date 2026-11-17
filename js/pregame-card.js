// js/pregame-card.js: ⚔️ the PRE-GAME card (1400x1120, same size as the other share cards).
//   2 teams:  A  VS  B, each side in its own color with its crest (or a colored badge), name and roster photos.
//   3+ teams: one column per team ("MATCHDAY").
//   A hype line on top from the card lines (Friendly or 🌶 Spicy, the organizer's pick).
// Used by regular games (Team cards) and VS matches.
import { cardKit, loadFonts } from './game-profile/celebration-cards.js';

const { W, H, GREEN, GOLD, BLOCK, BODY, MARKER, loadImage, background, rr, text, fitFont, avatar, header, footer, brush } = cardKit;
const FOOT = H - 175;
const RED = '#E8262B';

const hexOk = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));
/** A color that shows on the dark card (black / navy kits become a light grey). */
function onDark(c) {
    if (!hexOk(c)) return '#9CA3AF';
    const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) < 60 ? '#9CA3AF' : c;
}

/** A team crest from a VS team (photo logo or the drawn crest). Null when there's none. */
export function crestImage(team) {
    const lg = (team && team.logo) || {};
    if (lg.type === 'photo' && lg.url) return loadImage(lg.url);
    const svg = window.teamCrestSvg ? window.teamCrestSvg(team || {}, 400) : '';
    if (!svg) return Promise.resolve(null);
    return loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
}

// "Team 3" → 3, "Orlando FC" → OF, "Topo" → T
function badgeText(name) {
    const n = String(name || '?').trim(), num = n.match(/(\d+)\s*$/);
    if (num) return num[1].slice(-2);
    const w = n.split(/\s+/).filter(Boolean);
    return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?')[0]).toUpperCase();
}
function crestOrBadge(ctx, t, cx, cy, size) {
    const col = onDark(t.color);
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 40;
    if (t.crest) {
        const img = t.crest, s = Math.min(size / img.width, size / img.height);
        ctx.drawImage(img, cx - img.width * s / 2, cy - img.height * s / 2, img.width * s, img.height * s);
        ctx.restore(); return;
    }
    // no logo: a shield in the team color with its first letter
    const w = size * 0.82, h = size;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy - h / 2 + 10); ctx.lineTo(cx + w / 2, cy - h / 2 + 10);
    ctx.lineTo(cx + w / 2, cy + h * 0.05); ctx.quadraticCurveTo(cx + w / 2, cy + h * 0.38, cx, cy + h / 2);
    ctx.quadraticCurveTo(cx - w / 2, cy + h * 0.38, cx - w / 2, cy + h * 0.05); ctx.closePath();
    ctx.fillStyle = hexOk(t.color) ? t.color : '#374151'; ctx.fill();
    ctx.shadowBlur = 0; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
    ctx.restore();
    const n = parseInt((hexOk(t.color) ? t.color : '#374151').slice(1), 16);
    const light = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 160;
    text(ctx, badgeText(t.name), cx, cy - 4, { font: `${Math.round(size * 0.5)}px ${BLOCK}`, color: light ? '#0b0f14' : '#fff', shadow: false });
}

/** Roster photos in a box (x0..x0+w, top..bottom), as big as they fit. */
function roster(ctx, players, x0, w, top, bottom, ring, maxCols) {
    const list = (players || []).slice(0, 15);
    if (!list.length) { text(ctx, 'ROSTER TBA', x0 + w / 2, top + 40, { font: `900 26px ${BODY}`, color: 'rgba(255,255,255,0.55)' }); return; }
    let best = null;
    for (let cols = 1; cols <= Math.min(maxCols, list.length); cols++) {
        const rows = Math.ceil(list.length / cols), nameH = 34, gap = 16;
        const r = Math.min(64, (w - gap * (cols - 1)) / (2 * cols), ((bottom - top) - rows * nameH - (rows - 1) * 8) / (2 * rows));
        if (!best || r > best.r) best = { cols, rows, r, nameH, gap };
    }
    const { cols, r, nameH, gap } = best;
    list.forEach((p, i) => {
        const row = Math.floor(i / cols), inRow = Math.min(cols, list.length - row * cols), k = i - row * cols;
        const rowW = inRow * r * 2 + (inRow - 1) * gap;
        const cx = x0 + w / 2 - rowW / 2 + r + k * (r * 2 + gap), cy = top + r + row * (r * 2 + nameH + 8);
        avatar(ctx, p.img, p.name, cx, cy, r, p.captain ? GOLD : ring, { glow: false, ringWidth: Math.max(3, r * 0.08) });
        if (p.captain) {
            ctx.save(); ctx.beginPath(); ctx.arc(cx + r * 0.72, cy - r * 0.72, Math.max(11, r * 0.3), 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill(); ctx.restore();
            text(ctx, 'C', cx + r * 0.72, cy - r * 0.72 + 1, { font: `900 ${Math.round(Math.max(13, r * 0.36))}px ${BODY}`, color: '#0b0f14', shadow: false });
        }
        text(ctx, String(p.name || 'Player').split(' ')[0].toUpperCase(), cx, cy + r + 18, { font: `900 ${Math.round(Math.max(15, Math.min(24, r * 0.4)))}px ${BODY}`, color: p.captain ? GOLD : '#fff', maxWidth: r * 2 + gap - 2 });
    });
}

function infoLine(ctx, info, y) {
    const s = [info.date, info.time, info.location, info.format].filter(Boolean).map(x => String(x).toUpperCase()).join('   ·   ');
    if (s) text(ctx, s, W / 2, y, { font: `800 28px ${BODY}`, color: 'rgba(255,255,255,0.85)', maxWidth: 1260 });
}

function drawTwo(ctx, d, A) {
    const [a, b] = d.teams;
    background(ctx, A.bg, null);
    // each half washed in its team color
    [[a, 0], [b, W / 2]].forEach(([t, x]) => {
        const col = onDark(t.color);
        const g = ctx.createLinearGradient(x === 0 ? 0 : W, 0, W / 2, 0);
        g.addColorStop(0, col + '66'); g.addColorStop(1, col + '00');
        ctx.fillStyle = g; ctx.fillRect(x, 0, W / 2, FOOT);
    });
    // the split
    ctx.save(); ctx.translate(W / 2, 0); ctx.rotate(0.06);
    const sg = ctx.createLinearGradient(0, 300, 0, FOOT); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.7)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg; ctx.fillRect(-2, 300, 4, FOOT - 300); ctx.restore();

    header(ctx, A.logo, d.info);
    if (d.line) text(ctx, d.line, W - 60, 82, { font: fitFont(ctx, d.line, MARKER, '', 42, 760), color: d.spicy ? '#FB923C' : GREEN, align: 'right', rotate: -0.04 });
    brush(ctx, W / 2, 205, 760, 132, RED, 4);
    text(ctx, '⚔️ GAME DAY', W / 2, 203, { font: `104px ${BLOCK}`, color: '#fff', stroke: { width: 8, color: 'rgba(0,0,0,0.6)' } });
    infoLine(ctx, d.info, 300);

    const half = [{ t: a, cx: W / 4 + 10 }, { t: b, cx: W * 3 / 4 - 10 }];
    half.forEach(({ t, cx }) => {
        crestOrBadge(ctx, t, cx, 445, 190);
        const nm = String(t.name || 'Team').toUpperCase();
        text(ctx, nm, cx, 585, { font: fitFont(ctx, nm, BLOCK, '', 64, 560), color: onDark(t.color), stroke: { width: 7, color: 'rgba(0,0,0,0.75)' } });
        if (t.sub) text(ctx, t.sub, cx, 632, { font: `800 22px ${BODY}`, color: 'rgba(255,255,255,0.7)', maxWidth: 560 });
        roster(ctx, t.players, cx - 290, 580, 668, FOOT - 6, onDark(t.color), 5);
    });
    ctx.save(); ctx.shadowColor = RED; ctx.shadowBlur = 40;
    text(ctx, 'VS', W / 2, 445, { font: `150px ${BLOCK}`, color: '#fff', shadow: false, stroke: { width: 12, color: RED } });
    ctx.restore();
    footer(ctx, A.logo);
}

function drawMany(ctx, d, A) {
    const n = d.teams.length;
    background(ctx, A.bg, GREEN);
    header(ctx, A.logo, d.info);
    if (d.line) text(ctx, d.line, W - 60, 82, { font: fitFont(ctx, d.line, MARKER, '', 42, 760), color: d.spicy ? '#FB923C' : GREEN, align: 'right', rotate: -0.04 });
    brush(ctx, W / 2, 205, 760, 132, RED, 4);
    text(ctx, '⚔️ MATCHDAY', W / 2, 203, { font: `104px ${BLOCK}`, color: '#fff', stroke: { width: 8, color: 'rgba(0,0,0,0.6)' } });
    infoLine(ctx, { ...d.info, format: `${n} TEAMS${d.info.format ? ' · ' + d.info.format : ''}` }, 300);
    const pad = 40, gap = 18, w = (W - pad * 2 - gap * (n - 1)) / n;
    const crest = Math.min(150, w * 0.6);
    d.teams.forEach((t, i) => {
        const x0 = pad + i * (w + gap), cx = x0 + w / 2, col = onDark(t.color);
        ctx.save(); rr(ctx, x0, 340, w, FOOT - 350, 26); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = col + 'bb'; ctx.stroke(); ctx.restore();
        ctx.save(); rr(ctx, x0, 340, w, 10, 5); ctx.fillStyle = col; ctx.fill(); ctx.restore();
        crestOrBadge(ctx, t, cx, 350 + 20 + crest / 2, crest);
        const nm = String(t.name || 'Team').toUpperCase();
        const ny = 350 + 40 + crest + 26;
        text(ctx, nm, cx, ny, { font: fitFont(ctx, nm, BLOCK, '', 46, w - 24), color: col, stroke: { width: 6, color: 'rgba(0,0,0,0.75)' } });
        roster(ctx, t.players, x0 + 10, w - 20, ny + 40, FOOT - 22, col, n >= 5 ? 2 : 3);
    });
    footer(ctx, A.logo);
}

/**
 * d = { info:{ title, date, time, location, format }, line, spicy,
 *       teams:[{ name, color, crest (Image|null), sub, players:[{ name, img (Image|null), captain }] }] }
 * Returns a canvas.
 */
export async function makePregameCanvas(d) {
    await loadFonts();
    const [bg, logo] = await Promise.all([
        loadImage('img/celebration_bg.jpg'),
        loadImage('img/celebration_logo.png').then(i => i || loadImage('img/FutnetJustLogo.png')),
    ]);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (d.teams.length <= 2) drawTwo(ctx, { ...d, teams: d.teams.length === 2 ? d.teams : [d.teams[0] || { name: 'TBA' }, { name: 'TBA', players: [] }] }, { bg, logo });
    else drawMany(ctx, d, { bg, logo });
    return c;
}
