// js/vs-cards.js: VS Mode result cards (share images, 1400x1120, same size as the game celebration cards).
//   WINNER card: gold, light rays, confetti, crown on the crest, celebratory lines.
//   LOSER card:  drained of color, red cracks, "L" stamp on the crest, the team name crossed out, harsh lines, wall of shame.
//   DRAW card:   both crests, neutral.
// Data comes from vs.js (window.openVsResultCards builds it).
import { cardKit, loadFonts } from './game-profile/celebration-cards.js';

const { W, H, GREEN, GOLD, BLOCK, BODY, MARKER, loadImage, background, rr, text, fitFont, avatar, header, footer, brush, toBlob } = cardKit;
const RED = '#EF4444';
const FOOT = H - 175;   // keep everything above the footer band

const WIN_LINES = ['NOBODY CAN STOP US', 'BOW DOWN 👑', 'TOO EASY 😮‍💨', 'CHAMPIONS BEHAVIOR', 'NO MERCY. NO DOUBT.', 'TELL YOUR FRIENDS 📣'];
const LOSE_LINES = ['GO HOME. PRACTICE. 🏠', 'THAT WAS EMBARRASSING 😭', 'THE BUS LEFT WITHOUT THEM 🚌', 'FREE 3 POINTS 🎁', 'DELETE THE TEAM CHAT 🗑️',
    'CARDIO MERCHANTS 🏃', 'SOMEBODY CALL THEIR MOMS 📞', 'NOT EVEN CLOSE 🤡'];
const NOSHOW_LINES = ['DIDN\'T EVEN SHOW UP 🤡', 'SCARED? 🐔', 'GHOSTED THE MATCH 👻'];
const DRAW_LINES = ['NOBODY WINS. NOBODY LOSES.', 'SEE YOU IN THE REMATCH 🔁', 'TOO CLOSE TO CALL'];
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

// ---------- team logo as an image (photo, or the crest drawn as SVG) ----------
function crestImage(team) {
    const lg = (team && team.logo) || {};
    if (lg.type === 'photo' && lg.url) return loadImage(lg.url);
    const svg = window.teamCrestSvg ? window.teamCrestSvg(team || {}, 400) : '';
    if (!svg) return Promise.resolve(null);
    return loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
}
function drawLogo(ctx, img, cx, cy, size, { grey = false, round = false } = {}) {
    if (!img) return;
    const off = document.createElement('canvas'); off.width = off.height = size;
    const o = off.getContext('2d');
    if (round) { o.beginPath(); rrPath(o, 0, 0, size, size, size * 0.18); o.clip(); }
    const s = Math.min(size / img.width, size / img.height) * (round ? Math.max(img.width, img.height) / Math.min(img.width, img.height) : 1);
    const w = img.width * s, h = img.height * s;
    o.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    if (grey) {   // drain the color (works in Safari too, unlike ctx.filter), then cut back to the logo's own shape
        o.globalCompositeOperation = 'saturation'; o.fillStyle = '#808080'; o.fillRect(0, 0, size, size);
        o.globalCompositeOperation = 'destination-in'; o.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        o.globalCompositeOperation = 'source-atop'; o.fillStyle = 'rgba(0,0,0,0.35)'; o.fillRect(0, 0, size, size);
        o.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(off, cx - size / 2, cy - size / 2);
}
function rrPath(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function seeded(seed) { let s = (seed * 9301 + 49297) % 233280; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }

// ---------- effects ----------
function rays(ctx, cx, cy, color) {
    ctx.save(); ctx.translate(cx, cy);
    for (let i = 0; i < 18; i++) {
        ctx.rotate((Math.PI * 2) / 18);
        const g = ctx.createLinearGradient(0, 0, 0, -900);
        g.addColorStop(0, color + '55'); g.addColorStop(1, color + '00');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-55, -900); ctx.lineTo(55, -900); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
}
function confetti(ctx, seed) {
    const rnd = seeded(seed + 7);
    const colors = [GOLD, '#FFFFFF', GREEN, '#F472B6', '#60A5FA', '#FBBF24'];
    for (let i = 0; i < 140; i++) {
        const x = rnd() * W, y = rnd() * (FOOT - 40);
        ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * Math.PI);
        ctx.globalAlpha = 0.55 + rnd() * 0.45;
        ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
        if (rnd() < 0.3) { ctx.beginPath(); ctx.arc(0, 0, 4 + rnd() * 5, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-7, -3, 14 + rnd() * 10, 6 + rnd() * 4);
        ctx.restore();
    }
}
function crown(ctx, cx, cy, w) {
    const h = w * 0.62;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.08);
    ctx.shadowColor = GOLD; ctx.shadowBlur = 30; ctx.fillStyle = GOLD;
    ctx.beginPath(); ctx.moveTo(-w / 2, h / 2); ctx.lineTo(-w / 2, -h / 6); ctx.lineTo(-w / 4, h / 8); ctx.lineTo(0, -h / 2); ctx.lineTo(w / 4, h / 8); ctx.lineTo(w / 2, -h / 6); ctx.lineTo(w / 2, h / 2); ctx.closePath(); ctx.fill();
    ctx.restore();
}
function cracks(ctx, seed) {
    const rnd = seeded(seed + 3);
    ctx.save(); ctx.strokeStyle = 'rgba(239,68,68,0.45)'; ctx.lineWidth = 3; ctx.shadowColor = RED; ctx.shadowBlur = 8;
    for (let k = 0; k < 6; k++) {
        let x = rnd() < 0.5 ? rnd() * 200 : W - rnd() * 200, y = 120 + rnd() * (FOOT - 300);
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let i = 0; i < 7; i++) { x += (x < W / 2 ? 1 : -1) * (30 + rnd() * 60); y += (rnd() - 0.5) * 90; ctx.lineTo(x, y); }
        ctx.stroke();
    }
    ctx.restore();
}
function stamp(ctx, str, cx, cy, size, rot) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.font = `${size}px ${BLOCK}`;
    const w = ctx.measureText(str).width + size * 0.5, h = size * 1.15;
    ctx.lineWidth = Math.max(6, size * 0.08); ctx.strokeStyle = RED; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 12;
    ctx.beginPath(); rrPath(ctx, -w / 2, -h / 2, w, h, size * 0.12); ctx.stroke();
    ctx.restore();
    text(ctx, str, cx, cy + size * 0.05, { font: `${size}px ${BLOCK}`, color: RED, rotate: rot, shadow: false });
}
function scorePill(ctx, a, b, y, color, sub) {
    const w = 380, h = 120;
    ctx.save(); rr(ctx, W / 2 - w / 2, y, w, h, 28); ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = color + 'aa'; ctx.stroke(); ctx.restore();
    text(ctx, `${a} - ${b}`, W / 2, y + h / 2 + 4, { font: `92px ${BLOCK}`, color });
    if (sub) text(ctx, sub, W / 2, y + h + 34, { font: `800 28px ${BODY}`, color: 'rgba(255,255,255,0.8)', maxWidth: 1200 });
}
async function photoRow(ctx, players, top, ring, grey) {
    const list = players.slice(0, 14);
    if (!list.length) return;
    const per = list.length <= 7 ? list.length : Math.ceil(list.length / 2);
    const rows = Math.ceil(list.length / per);
    const avail = FOOT - top - 10, gap = 22, nameH = 40;
    const r = Math.max(24, Math.min(66, (1200 - gap * (per - 1)) / (2 * per), (avail - rows * nameH) / (2 * rows)));
    const imgs = await Promise.all(list.map(p => loadImage(p.avatar)));
    list.forEach((p, i) => {
        const row = Math.floor(i / per), inRow = Math.min(per, list.length - row * per), k = i - row * per;
        const rowW = inRow * r * 2 + (inRow - 1) * gap;
        const cx = W / 2 - rowW / 2 + r + k * (r * 2 + gap), cy = top + r + row * (r * 2 + nameH);
        avatar(ctx, imgs[i], p.name, cx, cy, r, p.captain ? (grey ? '#9CA3AF' : GOLD) : ring, { grey, glow: !grey });
        text(ctx, String(p.name || 'Player').split(' ')[0].toUpperCase(), cx, cy + r + 20, { font: `900 ${Math.round(Math.max(16, r * 0.32))}px ${BODY}`, color: grey ? 'rgba(255,255,255,0.6)' : (p.captain ? GOLD : '#fff'), maxWidth: r * 2 + gap - 4 });
    });
}
const scorerLine = (s) => s.slice(0, 5).map(x => `${x.name.split(' ')[0].toUpperCase()}${x.n > 1 ? ' ×' + x.n : ''}`).join('  ·  ');

// ---------- the cards ----------
async function drawWinner(ctx, d, A) {
    const t = d.winner, o = d.loser;
    background(ctx, A.bg, GOLD);
    rays(ctx, W / 2, 380, GOLD);
    confetti(ctx, d.seed);
    header(ctx, A.logo, d.info);
    text(ctx, pick(WIN_LINES, d.seed), W - 60, 82, { font: `40px ${MARKER}`, color: GOLD, align: 'right', rotate: -0.05 });

    ctx.save(); ctx.shadowColor = GOLD; ctx.shadowBlur = 40;
    text(ctx, '🏆 WINNERS', W / 2, 205, { font: `120px ${BLOCK}`, color: GOLD, shadow: false, stroke: { width: 10, color: '#3b2a00' } });
    ctx.restore();
    ctx.save(); ctx.shadowColor = GOLD; ctx.shadowBlur = 50; drawLogo(ctx, A.win, W / 2, 365, 180, { round: true }); ctx.restore();
    crown(ctx, W / 2 + 74, 272, 90);
    text(ctx, t.name.toUpperCase(), W / 2, 505, { font: fitFont(ctx, t.name.toUpperCase(), BLOCK, '', 78, 1200), color: '#fff', stroke: { width: 8, color: 'rgba(0,0,0,0.7)' } });
    const sub = d.multi ? `${t.w}W ${t.d}D ${t.l}L  ·  ${t.pts} PTS  ·  ${d.info.format || ''}`.replace(/\s+·\s+$/, '') : `BEAT ${(o && o.name || '').toUpperCase()}${d.forfeit ? ' (NO-SHOW)' : ''}`;
    if (d.multi) text(ctx, sub, W / 2, 590, { font: `900 40px ${BODY}`, color: GOLD });
    else scorePill(ctx, t.gf, t.ga, 555, GOLD, sub);
    let top = d.multi ? 645 : 735;
    if (t.scorers.length) { text(ctx, '⚽ ' + scorerLine(t.scorers), W / 2, top, { font: `900 30px ${BODY}`, color: '#fff', maxWidth: 1260 }); top += 30; }
    await photoRow(ctx, t.players, top + 8, GOLD, false);
    footer(ctx, A.logo);
}

async function drawLoser(ctx, d, A) {
    const t = d.loser, o = d.winner;
    background(ctx, A.bg, null);
    // drain the photo, then a cold red bruise
    ctx.save(); ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
    const v = ctx.createRadialGradient(W / 2, 420, 100, W / 2, 420, 900); v.addColorStop(0, 'rgba(127,29,29,0.15)'); v.addColorStop(1, 'rgba(127,29,29,0.75)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    cracks(ctx, d.seed);
    header(ctx, A.logo, d.info);
    text(ctx, d.forfeit ? 'NO-SHOW' : 'DEFEATED', W - 60, 82, { font: `46px ${MARKER}`, color: '#FCA5A5', align: 'right', rotate: 0.05 });

    brush(ctx, W / 2, 205, 700, 140, '#7F1D1D', 11);
    text(ctx, 'LOSERS 💀', W / 2, 205, { font: `112px ${BLOCK}`, color: '#FECACA', shadow: false, stroke: { width: 8, color: '#1a0505' } });
    drawLogo(ctx, A.lose, W / 2, 365, 180, { grey: true, round: true });
    stamp(ctx, 'L', W / 2 + 92, 410, 120, -0.22);
    const nm = t.name.toUpperCase(), font = fitFont(ctx, nm, BLOCK, '', 78, 1200);
    text(ctx, nm, W / 2, 505, { font, color: '#9CA3AF', stroke: { width: 8, color: 'rgba(0,0,0,0.7)' } });
    ctx.font = font; const nw = ctx.measureText(nm).width;   // crossed out
    ctx.save(); ctx.strokeStyle = RED; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(W / 2 - nw / 2 - 20, 517); ctx.lineTo(W / 2 + nw / 2 + 20, 493); ctx.stroke(); ctx.restore();
    const line = d.forfeit ? pick(NOSHOW_LINES, d.seed) : pick(LOSE_LINES, d.seed);
    if (d.multi) {
        text(ctx, `${t.w}W ${t.d}D ${t.l}L  ·  ${t.pts} PTS  ·  LAST PLACE`, W / 2, 590, { font: `900 40px ${BODY}`, color: '#FCA5A5' });
        text(ctx, line, W / 2, 650, { font: `46px ${MARKER}`, color: '#fff', rotate: -0.02, maxWidth: 1260 });
    } else {
        scorePill(ctx, t.gf, t.ga, 555, RED, `LOST TO ${(o && o.name || '').toUpperCase()}`);
        text(ctx, line, W / 2, 748, { font: `46px ${MARKER}`, color: '#fff', rotate: -0.02, maxWidth: 1260 });
    }
    const top = d.multi ? 700 : 792;
    if (t.players.length) {
        text(ctx, 'WALL OF SHAME', W / 2, top + 4, { font: `900 24px ${BODY}`, color: '#FCA5A5' });
        await photoRow(ctx, t.players, top + 26, '#7F1D1D', true);
    }
    text(ctx, '🤡', 95, 640, { font: `100px ${BODY}`, rotate: -0.2 });
    text(ctx, '🤡', W - 95, 700, { font: `100px ${BODY}`, rotate: 0.2 });
    footer(ctx, A.logo);
}

async function drawDraw(ctx, d, A) {
    const [a, b] = d.pair;
    background(ctx, A.bg, '#00B4AE');
    header(ctx, A.logo, d.info);
    text(ctx, '🤝 DRAW', W / 2, 205, { font: `120px ${BLOCK}`, color: '#E5E7EB', stroke: { width: 10, color: 'rgba(0,0,0,0.7)' } });
    drawLogo(ctx, A.win, W / 2 - 300, 420, 220, { round: true });
    drawLogo(ctx, A.lose, W / 2 + 300, 420, 220, { round: true });
    text(ctx, 'VS', W / 2, 420, { font: `90px ${BLOCK}`, color: '#E8262B', stroke: { width: 8, color: '#000' } });
    text(ctx, a.name.toUpperCase(), W / 2 - 300, 560, { font: fitFont(ctx, a.name.toUpperCase(), BLOCK, '', 52, 520), color: '#fff' });
    text(ctx, b.name.toUpperCase(), W / 2 + 300, 560, { font: fitFont(ctx, b.name.toUpperCase(), BLOCK, '', 52, 520), color: '#fff' });
    scorePill(ctx, a.gf, b.gf, 620, '#E5E7EB', pick(DRAW_LINES, d.seed));
    const sc = [...a.scorers, ...b.scorers];
    if (sc.length) text(ctx, '⚽ ' + scorerLine(sc), W / 2, 830, { font: `900 30px ${BODY}`, color: '#fff', maxWidth: 1260 });
    footer(ctx, A.logo);
}

const OG_LINES = ['SCORED FOR THE WRONG TEAM 🙈', 'THANKS FOR THE ASSIST 🎁', 'WRONG GOAL, BRO 🤦', 'DOUBLE AGENT 🕵️', 'GPS NOT WORKING 🧭'];
async function drawScorers(ctx, d, A) {
    background(ctx, A.bg, GOLD);
    header(ctx, A.logo, d.info);
    text(ctx, 'GOLDEN BOOT', W - 60, 82, { font: `42px ${MARKER}`, color: GOLD, align: 'right', rotate: -0.05 });
    brush(ctx, W / 2, 200, 820, 140, '#1D4ED8', 5);
    text(ctx, '⚽ TOP SCORERS', W / 2, 198, { font: `100px ${MARKER}`, color: '#fff', maxWidth: 780 });
    const top = d.scorers.slice(0, 3), rest = d.scorers.slice(3, 6);
    const og = (d.ownGoals || []).slice(0, 3);
    const imgs = await Promise.all([...top, ...og].map(p => loadImage(p.avatar)));
    // podium: #1 in the middle, bigger
    const order = top.length === 3 ? [1, 0, 2] : top.length === 2 ? [0, 1] : [0];
    const slotsX = top.length === 3 ? [W / 2 - 400, W / 2, W / 2 + 400] : top.length === 2 ? [W / 2 - 220, W / 2 + 220] : [W / 2];
    const yTop = og.length ? 400 : 430;
    order.forEach((idx, k) => {
        const p = top[idx]; if (!p) return;
        const first = idx === 0, r = first ? 110 : 82, cx = slotsX[k], cy = yTop + (first ? 0 : 30);
        const ring = idx === 0 ? GOLD : idx === 1 ? '#D1D5DB' : '#D97706';
        avatar(ctx, imgs[idx], p.name, cx, cy, r, ring, {});
        if (first) { ctx.save(); ctx.shadowColor = GOLD; ctx.shadowBlur = 20; text(ctx, '👑', cx, cy - r - 30, { font: `64px ${BODY}`, shadow: false }); ctx.restore(); }
        text(ctx, p.name.split(' ')[0].toUpperCase(), cx, cy + r + 40, { font: `900 ${first ? 40 : 32}px ${BODY}`, color: first ? GOLD : '#fff', maxWidth: 360 });
        text(ctx, `${p.n} ${p.n === 1 ? 'GOAL' : 'GOALS'}`, cx, cy + r + 88, { font: `${first ? 56 : 44}px ${BLOCK}`, color: ring });
        text(ctx, p.team.toUpperCase(), cx, cy + r + 128, { font: `800 22px ${BODY}`, color: p.kit === '#000000' ? '#9ca3af' : p.kit, maxWidth: 360 });
    });
    if (rest.length && !og.length) {
        text(ctx, rest.map((p, i) => `${i + 4}. ${p.name.split(' ')[0].toUpperCase()} ${p.n}`).join('    '), W / 2, FOOT - 40, { font: `900 30px ${BODY}`, color: 'rgba(255,255,255,0.85)', maxWidth: 1260 });
    }
    if (og.length) {   // the cheeky part
        const y0 = FOOT - 175, h = 160;
        ctx.save(); rr(ctx, 70, y0, W - 140, h, 26); ctx.fillStyle = 'rgba(127,29,29,0.55)'; ctx.fill(); ctx.setLineDash([14, 10]); ctx.lineWidth = 3; ctx.strokeStyle = '#FCA5A5'; ctx.stroke(); ctx.restore();
        text(ctx, '🙈 OWN GOAL HALL OF SHAME', 110, y0 + 34, { font: `900 28px ${BODY}`, color: '#FECACA', align: 'left' });
        text(ctx, pick(OG_LINES, d.seed), W - 110, y0 + 34, { font: `34px ${MARKER}`, color: '#fff', align: 'right', rotate: -0.03 });
        const step = (W - 220) / og.length;
        og.forEach((p, i) => {
            const cx = 110 + step * i + 50, cy = y0 + 104;
            avatar(ctx, imgs[top.length + i], p.name, cx, cy, 38, '#EF4444', { grey: true, glow: false });
            text(ctx, '🤡', cx + 32, cy - 26, { font: `34px ${BODY}`, shadow: false });
            text(ctx, `${p.name.split(' ')[0].toUpperCase()}  ×${p.n}`, cx + 56, cy - 6, { font: `900 28px ${BODY}`, align: 'left', maxWidth: step - 120 });
            text(ctx, `🎁 a gift for ${String(p.team).toUpperCase()}`, cx + 56, cy + 24, { font: `800 18px ${BODY}`, color: 'rgba(255,255,255,0.65)', align: 'left', maxWidth: step - 120 });
        });
    }
    footer(ctx, A.logo);
}

/** d = { info:{title,date,location,format}, winner, loser, pair (draw), draw, multi, forfeit }  team = { name, logo, colors, short, gf, ga, w, d, l, pts, scorers:[{name,n}], players:[{name,avatar,captain}] } */
export async function makeVsCards(d) {
    await loadFonts();
    const first = d.draw ? d.pair[0] : d.winner, second = d.draw ? d.pair[1] : d.loser;
    const [bg, logo, win, lose] = await Promise.all([
        loadImage('img/celebration_bg.jpg'),
        loadImage('img/celebration_logo.png').then(i => i || loadImage('img/FutnetJustLogo.png')),
        crestImage(first), crestImage(second),
    ]);
    const A = { bg, logo, win, lose };
    d = { ...d, seed: Math.floor(Math.random() * 1000) };
    const out = [];
    const make = async (key, title, fn) => { const c = document.createElement('canvas'); c.width = W; c.height = H; await fn(c.getContext('2d'), d, A); out.push({ key, title, canvas: c }); };
    if (d.draw) await make('draw', 'Draw', drawDraw);
    else {
        if (d.winner) await make('winner', 'Winner', drawWinner);
        if (d.loser) await make('loser', 'Loser', drawLoser);
    }
    if ((d.scorers || []).length || (d.ownGoals || []).length) await make('scorers', 'Top Scorers', drawScorers);
    return out;
}

/** Full-screen viewer with Share / Save under each image. */
export async function openVsCards(d) {
    let m = document.getElementById('vs-cards-modal');
    if (!m) { m = document.createElement('div'); m.id = 'vs-cards-modal'; document.body.appendChild(m); }
    m.className = 'fixed inset-0 z-[190] bg-[#040E13] text-white overflow-y-auto';
    m.innerHTML = '<div class="h-full flex items-center justify-center text-sm text-white/70"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Making your images…</div>';
    let cards = [];
    try { cards = await makeVsCards(d); } catch (e) { console.error(e); }
    const slug = String(d.info.title || 'vs-match').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const files = [];
    for (const c of cards) { try { files.push(new File([await toBlob(c.canvas)], `${slug}-${c.key}.jpg`, { type: 'image/jpeg' })); } catch (e) { files.push(null); } }
    m.innerHTML = `<div class="max-w-2xl mx-auto p-4 pb-16 space-y-4">
        <div class="flex items-center justify-between sticky top-0 bg-[#040E13] py-2 z-10">
            <div><div class="text-base font-black">Result cards 📸</div><div class="text-[11px] text-white/60">Winners, losers and top scorers. Send them one by one.</div></div>
            <button onclick="document.getElementById('vs-cards-modal').remove()" aria-label="Close" class="w-9 h-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-xmark text-sm"></i></button>
        </div>
        ${files.some(f => !f) ? '<div class="text-xs bg-amber-500/10 border border-amber-400/40 rounded-xl p-3">Some photos couldn\'t be added to the images. Take a screenshot instead.</div>' : ''}
        ${cards.length ? '' : '<p class="text-sm text-white/60">No result to share yet.</p>'}
        <div id="vs-cards-list" class="space-y-5"></div></div>`;
    const list = m.querySelector('#vs-cards-list');
    cards.forEach((c, i) => {
        const box = document.createElement('div'); box.className = 'space-y-2';
        c.canvas.className = 'w-full h-auto rounded-2xl border border-white/10 shadow-xl'; box.appendChild(c.canvas);
        const file = files[i], canShare = file && navigator.canShare && navigator.canShare({ files: [file] });
        const row = document.createElement('div'); row.className = 'flex gap-2';
        row.innerHTML = `${canShare ? `<button data-act="share" class="flex-1 bg-[#25D366] text-slate-950 font-black py-3 rounded-xl text-sm"><i class="fa-brands fa-whatsapp mr-1"></i> Share ${c.title}</button>` : ''}
            ${file ? `<button data-act="save" class="${canShare ? '' : 'flex-1 '}bg-black/60 border border-white/20 text-white font-bold py-3 px-4 rounded-xl text-sm"><i class="fa-solid fa-download mr-1"></i> Save</button>` : ''}`;
        row.querySelector('[data-act="share"]')?.addEventListener('click', async () => { try { await navigator.share({ files: [file] }); } catch (e) { /* cancelled */ } });
        row.querySelector('[data-act="save"]')?.addEventListener('click', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); });
        box.appendChild(row); list.appendChild(box);
    });
}
