// js/game-profile/draft-replay.js
// 1) "Watch the draft": the captains' picks played back one by one (pick 1, pick 2, ...), drawn on a canvas so it
//    can also be saved / shared as a video (MediaRecorder; mp4 on iPhone/Safari, webm elsewhere).
// 2) "Team card": one image with every team (captain first, gold C), like the celebration cards.
import { cardKit, loadFonts } from './celebration-cards.js';
import { mountShareBar } from './card-share.js';

const { W, H, GREEN, GOLD, BLOCK, BODY, loadImage, background, rr, text, fitFont, avatar, header, footer, toBlob } = cardKit;
const AV_FALLBACK = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';

const STEP = 1.6;        // seconds per pick
const INTRO = 2.2;       // captains shown first
const OUTRO = 3.2;       // final teams held at the end

const listOf = (ta, i) => ((ta || {})[i] ?? (ta || {})[String(i)] ?? []).filter(p => p && p.uid);
const capOf = (ev, i) => String(((ev.teamCaptains || {})[i] ?? (ev.teamCaptains || {})[String(i)]) || '');
// Same photo the rest of the site shows (their current profile picture), including photos saved
// inside the profile (data:image). Made-up initials avatars are skipped: the card draws its own.
const photo = (p, ev) => {
    const person = { uid: p.uid, name: p.name, avatar: p.avatar || (ev.attendees || []).find(x => String(x.uid) === String(p.uid))?.avatar };
    const a = String((window.resolvePlayerAvatar ? window.resolvePlayerAvatar(person) : person.avatar) || '');
    if (a.includes('api.dicebear.com')) return '';
    return /^https?:\/\//.test(a) || /^data:image\//.test(a) ? a : '';
};

/** Everything the drawings need, from the game. */
async function dataOf(ev) {
    const count = ev.teamsCount || 3;
    const names = window.getTeamNames(ev), colors = window.getTeamColors(ev);
    const ta = ev.teamAssignments || {};
    const picks = ((ev.capsDraft && ev.capsDraft.picks) || []).filter(p => !p.removed).sort((a, b) => (a.no || 0) - (b.no || 0));
    const teams = Array.from({ length: count }, (_, i) => {
        const players = listOf(ta, i);
        const cu = capOf(ev, i);
        const cap = players.find(p => String(p.uid) === cu) || null;
        return { name: names[i], color: colors[i], ring: window.teamAccent(colors[i]), captain: cap, players: cap ? [cap, ...players.filter(p => p !== cap)] : players };
    });
    // photos
    const people = new Map();
    teams.forEach(t => t.players.forEach(p => people.set(String(p.uid), p)));
    picks.forEach(p => { if (!people.has(String(p.uid))) people.set(String(p.uid), { uid: p.uid, name: p.name }); });
    const imgs = {};
    await Promise.all([...people.values()].map(async p => { imgs[String(p.uid)] = await loadImage(photo(p, ev)); }));
    const [bg, logo] = await Promise.all([
        loadImage('img/celebration_bg.jpg'),
        loadImage('img/celebration_logo.png').then(i => i || loadImage('img/FutnetJustLogo.png')),
    ]);
    const info = [ev.date, ev.location].filter(Boolean).join('  ·  ');
    return { ev, count, teams, picks, imgs, bg, logo, title: ev.title || 'FutNet game', info, people };
}

// ---------------------------------------------------------------- layout
const TOP = 300, BOTTOM = H - 190;
function columns(d) {
    const pad = 50, gap = 24;
    const w = (W - pad * 2 - gap * (d.count - 1)) / d.count;
    return Array.from({ length: d.count }, (_, i) => ({ x: pad + i * (w + gap), w }));
}
function rowSize(d, maxRows) {
    const avail = BOTTOM - (TOP + 96);
    return Math.max(38, Math.min(92, avail / Math.max(1, maxRows)));
}
/** Where row r of team i goes (center of the photo). */
function spot(d, cols, i, r, rh) {
    return { x: cols[i].x + 18 + rh * 0.36, y: TOP + 96 + r * rh + rh / 2, r: rh * 0.36 };
}

function drawFrame(ctx, d, { shownPicks, anim, heading, sub, finalTeams }) {
    background(ctx, d.bg, GREEN);
    header(ctx, d.logo);
    text(ctx, heading, W / 2, 175, { font: fitFont(ctx, heading, BLOCK, '', 92, W - 200), color: '#fff', stroke: { width: 6, color: 'rgba(0,0,0,0.7)' } });
    text(ctx, sub, W / 2, 245, { font: `800 30px ${BODY}`, color: GREEN, maxWidth: W - 160 });

    const cols = columns(d);
    // who is on each team in this frame
    const rows = d.teams.map(t => (t.captain ? [{ p: t.captain, cap: true }] : []));
    if (finalTeams) d.teams.forEach((t, i) => { rows[i] = t.players.map(p => ({ p, cap: p === t.captain, no: p.pickNo })); });
    else shownPicks.forEach(pk => { const p = d.people.get(String(pk.uid)) || pk; if (rows[pk.team]) rows[pk.team].push({ p, no: pk.no }); });
    const maxRows = Math.max(...d.teams.map((t, i) => finalTeams ? t.players.length : Math.max(rows[i].length, 1 + Math.ceil(d.picks.length / d.count))), 1);
    const rh = rowSize(d, maxRows);

    d.teams.forEach((t, i) => {
        const c = cols[i];
        ctx.save();
        rr(ctx, c.x, TOP, c.w, BOTTOM - TOP, 26); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = t.ring + 'cc'; ctx.stroke();
        rr(ctx, c.x, TOP, c.w, 78, 26); ctx.fillStyle = t.color; ctx.fill();
        ctx.restore();
        const nameColor = window.teamTextOn ? window.teamTextOn(t.color) : '#fff';
        text(ctx, String(t.name).toUpperCase(), c.x + c.w / 2, TOP + 40, { font: fitFont(ctx, String(t.name).toUpperCase(), BLOCK, '', 46, c.w - 30), color: nameColor, shadow: false });
        rows[i].forEach((row, r) => {
            const s = spot(d, cols, i, r, rh);
            avatar(ctx, d.imgs[String(row.p.uid)], row.p.name, s.x, s.y, s.r, t.ring, { glow: false, ringWidth: 4 });
            if (row.cap) {
                ctx.save(); ctx.beginPath(); ctx.arc(s.x + s.r * 0.8, s.y - s.r * 0.75, s.r * 0.42, 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill(); ctx.restore();
                text(ctx, 'C', s.x + s.r * 0.8, s.y - s.r * 0.72, { font: `900 ${Math.round(s.r * 0.5)}px ${BODY}`, color: '#0b0f14', shadow: false });
            }
            const nm = String(row.p.name || 'Player');
            const nx = s.x + s.r + 16, maxW = c.x + c.w - nx - (row.no ? 64 : 16);
            text(ctx, nm, nx, s.y, { font: fitFont(ctx, nm, BODY, 800, Math.min(32, rh * 0.42), maxW), align: 'left', maxWidth: maxW });
            if (row.no) text(ctx, `#${row.no}`, c.x + c.w - 20, s.y, { font: `900 ${Math.round(Math.min(26, rh * 0.34))}px ${BODY}`, align: 'right', color: GOLD });
        });
    });

    // the pick being made: big in the middle, then it flies to its spot
    if (anim) {
        const { pk, p: t } = anim;
        const person = d.people.get(String(pk.uid)) || pk;
        const team = d.teams[pk.team];
        const target = spot(d, cols, pk.team, rows[pk.team].length, rh);
        const hold = Math.min(1, t / 0.55);            // grow
        const fly = Math.max(0, (t - 0.62) / 0.38);     // move
        const e = fly * fly * (3 - 2 * fly);
        const cx = W / 2 + (target.x - W / 2) * e, cy = 640 + (target.y - 640) * e;
        const r = (130 * hold) * (1 - e) + target.r * e;
        if (fly < 0.6) {
            ctx.save(); ctx.globalAlpha = 0.8 * (1 - fly / 0.6); ctx.fillStyle = '#000'; ctx.fillRect(0, TOP - 10, W, BOTTOM - TOP + 20); ctx.restore();
            ctx.save(); ctx.globalAlpha = 1 - fly / 0.6;
            text(ctx, `PICK ${pk.no}`, W / 2, 440, { font: `110px ${BLOCK}`, color: GOLD, stroke: { width: 8, color: 'rgba(0,0,0,0.8)' } });
            text(ctx, String(person.name || 'Player').toUpperCase(), W / 2, 840, { font: fitFont(ctx, String(person.name || 'Player').toUpperCase(), BLOCK, '', 84, W - 200), stroke: { width: 6, color: 'rgba(0,0,0,0.8)' } });
            text(ctx, `→ ${String(team ? team.name : '').toUpperCase()}`, W / 2, 925, { font: `900 44px ${BODY}`, color: team ? team.ring : GREEN });
            ctx.restore();
        }
        if (r > 2) avatar(ctx, d.imgs[String(pk.uid)], person.name, cx, cy, r, team ? team.ring : GREEN, { glow: true, ringWidth: Math.max(4, r * 0.07) });
    }
    footer(ctx);
}

// ---------------------------------------------------------------- the replay
let playing = null;
function canvasOk(c) { try { c.getContext('2d').getImageData(0, 0, 1, 1); return true; } catch (e) { return false; } }
function recorderType() {
    if (!window.MediaRecorder) return '';
    return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || '';
}

function play(canvas, d, { onDone } = {}) {
    if (playing) cancelAnimationFrame(playing.raf);
    const ctx = canvas.getContext('2d');
    const total = INTRO + d.picks.length * STEP + OUTRO;
    const start = performance.now();
    const frame = (now) => {
        const t = (now - start) / 1000;
        if (t < INTRO) {
            drawFrame(ctx, d, { shownPicks: [], heading: 'THE DRAFT', sub: 'THE CAPTAINS', finalTeams: false });
        } else if (t < INTRO + d.picks.length * STEP) {
            const k = Math.floor((t - INTRO) / STEP);
            const p = ((t - INTRO) % STEP) / STEP;
            drawFrame(ctx, d, { shownPicks: d.picks.slice(0, k), anim: { pk: d.picks[k], p }, heading: 'THE DRAFT', sub: d.title.toUpperCase(), finalTeams: false });
        } else {
            drawFrame(ctx, d, { shownPicks: d.picks, heading: 'TEAMS ARE SET', sub: d.info.toUpperCase() || d.title.toUpperCase(), finalTeams: false });
        }
        if (t < total) playing.raf = requestAnimationFrame(frame);
        else { playing = null; onDone && onDone(); }
    };
    playing = { raf: requestAnimationFrame(frame) };
    return total;
}

function modalShell(id, title) {
    document.getElementById(id)?.remove();
    const m = document.createElement('div');
    m.id = id;
    m.className = 'fixed inset-0 z-[195] bg-[#040E13] text-white overflow-y-auto';
    m.innerHTML = `<div class="max-w-2xl mx-auto p-4 pb-16 space-y-3">
        <div class="flex items-center justify-between sticky top-0 bg-[#040E13] py-2 z-10">
            <div class="text-base font-black">${title}</div>
            <button data-close aria-label="Close" class="w-9 h-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-xmark text-sm"></i></button>
        </div>
        <div data-body class="space-y-3"><div class="py-16 text-center text-sm text-white/70"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Getting it ready…</div></div>
    </div>`;
    m.querySelector('[data-close]').onclick = () => { if (playing) cancelAnimationFrame(playing.raf); playing = null; m.remove(); };
    document.body.appendChild(m);
    return m;
}

function shareOrSave(file) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file] }).catch(() => {});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const slug = (s) => String(s || 'futnet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'futnet';

window.openDraftReplay = async function(eventId) {
    const ev = (window.eventsList || []).find(e => e.id === eventId);
    if (!ev || !ev.capsDraft || !(ev.capsDraft.picks || []).length) { window.showToast && window.showToast('No picks to show yet.', 'error'); return; }
    const m = modalShell('draft-replay-modal', '🎬 The draft');
    await loadFonts();
    const d = await dataOf(ev);
    const body = m.querySelector('[data-body]');
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.className = 'w-full h-auto rounded-2xl border border-white/10 shadow-xl';
    body.innerHTML = '';
    body.appendChild(canvas);
    const row = document.createElement('div');
    row.className = 'flex gap-2';
    const type = recorderType();
    const recordable = !!type && !!canvas.captureStream;
    row.innerHTML = `<button data-replay class="flex-1 bg-black/60 border border-white/20 text-white font-bold py-3 rounded-xl text-sm"><i class="fa-solid fa-rotate-right mr-1"></i> Replay</button>
        ${recordable ? '<button data-video class="flex-1 bg-[#00F296] text-slate-950 font-black py-3 rounded-xl text-sm"><i class="fa-solid fa-video mr-1"></i> Save video</button>' : ''}`;
    body.appendChild(row);
    const note = document.createElement('p');
    note.className = 'text-[11px] text-white/50 text-center';
    note.textContent = `${d.picks.length} picks in order. The number next to each name is when they were picked.`;
    body.appendChild(note);
    play(canvas, d);
    row.querySelector('[data-replay]').onclick = () => play(canvas, d);
    row.querySelector('[data-video]')?.addEventListener('click', async (e) => {
        const b = e.currentTarget;
        if (!canvasOk(canvas)) { b.textContent = "Some photos can't go in a video. Use screen recording instead."; b.disabled = true; return; }
        b.disabled = true; b.innerHTML = '<i class="fa-solid fa-circle text-red-600 mr-1 animate-pulse"></i> Recording… keep this open';
        const stream = canvas.captureStream(30);
        const chunks = [];
        let rec;
        try { rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5000000 }); }
        catch (err) { b.textContent = "This browser can't save videos. Use screen recording instead."; return; }
        rec.ondataavailable = (ev2) => { if (ev2.data && ev2.data.size) chunks.push(ev2.data); };
        rec.onstop = () => {
            const mime = type.split(';')[0];
            const file = new File(chunks, `${slug(d.title)}-draft.${mime === 'video/mp4' ? 'mp4' : 'webm'}`, { type: mime });
            b.disabled = false; b.innerHTML = '<i class="fa-solid fa-share-nodes mr-1"></i> Share / save video';
            b.onclick = () => shareOrSave(file);
            shareOrSave(file);
        };
        rec.start(250);
        play(canvas, d, { onDone: () => setTimeout(() => rec.state !== 'inactive' && rec.stop(), 200) });
    });
};

// ---------------------------------------------------------------- squad card: one team on its half of the pitch
async function drawSquad(ctx, d, t, ti, pitch) {
    background(ctx, d.bg, t.ring);
    header(ctx, d.logo);
    const ev = d.ev;
    const rowsDef = (window.teamFormationRows ? window.teamFormationRows(ev, ti) : [3, 2, 1]) || [3, 2, 1];
    const rows = [...rowsDef].reverse();               // forwards on top, keeper at the bottom
    const slots = rows.reduce((a, b) => a + b, 0) + 1;
    // Each player in their saved spot (empty spots stay empty), everyone else on the bench.
    const spotMap = window.teamPitchSpots ? window.teamPitchSpots(ev, ti) : null;
    let onPitch, bench;
    if (spotMap && Object.keys(spotMap).length) {
        const byUid = new Map(t.players.map(p => [String(p.uid), p]));
        onPitch = Array.from({ length: slots }, (_, k) => byUid.get(String(spotMap[k] || '')) || null);
        bench = t.players.filter(p => !onPitch.includes(p));
    } else { onPitch = t.players.slice(0, slots); bench = t.players.slice(slots); }

    // the pitch (our half: middle line at the top, our goal at the bottom)
    const px = 60, py = 175, pw = 860, ph = H - 190 - py - 10;
    ctx.save();
    rr(ctx, px, py, pw, ph, 28); ctx.clip();
    if (pitch) ctx.drawImage(pitch, 0, 640, pitch.width, pitch.height - 640 - 60, px, py, pw, ph);
    else { ctx.fillStyle = '#0b3d1f'; ctx.fillRect(px, py, pw, ph); }
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(px, py, pw, ph);
    ctx.restore();
    ctx.save(); rr(ctx, px, py, pw, ph, 28); ctx.lineWidth = 5; ctx.strokeStyle = t.ring; ctx.stroke(); ctx.restore();

    const lines = [...rows, 1];
    const top = py + 72, bottom = py + ph - 100;
    const r = Math.max(30, Math.min(48, (ph - 120) / lines.length / 2 - 16));
    let k = 0;
    lines.forEach((n, li) => {
        const y = lines.length === 1 ? (top + bottom) / 2 : top + (bottom - top) * li / (lines.length - 1);
        for (let c = 0; c < n; c++) {
            const x = px + pw * (c + 1) / (n + 1);
            const p = onPitch[k];
            const label = li === lines.length - 1 ? 'GK' : (li === 0 ? 'FWD' : (li === lines.length - 2 ? 'DEF' : 'MID'));
            if (p) {
                avatar(ctx, d.imgs[String(p.uid)], p.name, x, y, r, t.ring, { glow: true, ringWidth: 5 });
                if (p === t.captain) {
                    ctx.save(); ctx.beginPath(); ctx.arc(x + r * 0.78, y - r * 0.78, r * 0.36, 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#0b0f14'; ctx.stroke(); ctx.restore();
                    text(ctx, 'C', x + r * 0.78, y - r * 0.75, { font: `900 ${Math.round(r * 0.44)}px ${BODY}`, color: '#0b0f14', shadow: false });
                }
                const nm = String(p.name || 'Player').split(' ')[0];
                const font = fitFont(ctx, nm, BODY, 900, 24, pw / (n + 1) - 10);
                ctx.font = font;
                const tw = ctx.measureText(nm).width + 22;
                ctx.save(); rr(ctx, x - tw / 2, y + r + 8, tw, 34, 17); ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fill(); ctx.restore();
                text(ctx, nm, x, y + r + 26, { font, shadow: false });
            } else {
                ctx.save(); ctx.setLineDash([8, 7]); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.55)';
                ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
                text(ctx, label, x, y, { font: `900 20px ${BODY}`, color: 'rgba(255,255,255,0.75)' });
            }
            k++;
        }
    });

    // right side: team name, formation, bench
    const rx = 950, rw = W - rx - 60;
    ctx.save(); rr(ctx, rx, py, rw, ph, 24); ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = t.ring + '88'; ctx.stroke(); ctx.restore();
    ctx.save(); rr(ctx, rx, py, rw, 120, 24); ctx.fillStyle = t.color; ctx.fill(); ctx.restore();
    const nameColor = window.teamTextOn ? window.teamTextOn(t.color) : '#fff';
    text(ctx, String(t.name).toUpperCase(), rx + rw / 2, py + 48, { font: fitFont(ctx, String(t.name).toUpperCase(), BLOCK, '', 60, rw - 30), color: nameColor, shadow: false });
    text(ctx, `${t.players.length} PLAYERS`, rx + rw / 2, py + 96, { font: `900 22px ${BODY}`, color: nameColor, shadow: false });
    text(ctx, 'FORMATION', rx + rw / 2, py + 170, { font: `800 24px ${BODY}`, color: 'rgba(255,255,255,0.7)' });
    text(ctx, rowsDef.join('-'), rx + rw / 2, py + 228, { font: `84px ${BLOCK}`, color: GREEN, stroke: { width: 6, color: 'rgba(0,0,0,0.7)' } });
    if (t.captain) {
        text(ctx, 'CAPTAIN', rx + rw / 2, py + 300, { font: `800 24px ${BODY}`, color: 'rgba(255,255,255,0.7)' });
        text(ctx, String(t.captain.name || ''), rx + rw / 2, py + 340, { font: fitFont(ctx, String(t.captain.name || ''), BODY, 900, 36, rw - 20), color: GOLD });
    }
    if (bench.length) {
        let y = py + 400;
        text(ctx, 'BENCH', rx + rw / 2, y, { font: `800 24px ${BODY}`, color: 'rgba(255,255,255,0.7)' });
        bench.slice(0, 5).forEach((p, i) => {
            const yy = y + 50 + i * 62;
            avatar(ctx, d.imgs[String(p.uid)], p.name, rx + 46, yy, 24, t.ring, { glow: false, ringWidth: 3 });
            text(ctx, String(p.name || 'Player'), rx + 84, yy, { font: fitFont(ctx, String(p.name || 'Player'), BODY, 800, 28, rw - 100), align: 'left' });
        });
        if (bench.length > 5) text(ctx, `+${bench.length - 5} more`, rx + rw / 2, y + 50 + 5 * 62, { font: `800 24px ${BODY}`, color: 'rgba(255,255,255,0.7)' });
    }
    text(ctx, (d.info || d.title).toUpperCase(), W / 2, 130, { font: fitFont(ctx, (d.info || d.title).toUpperCase(), BODY, 800, 28, W - 700), color: GREEN });
    footer(ctx);
}

// ---------------------------------------------------------------- team cards (images): all teams + one per squad
window.openTeamCard = async function(eventId) {
    const ev = (window.eventsList || []).find(e => e.id === eventId);
    if (!ev) return;
    const hasPlayers = Object.values(ev.teamAssignments || {}).some(a => (a || []).some(p => p && p.uid));
    if (!hasPlayers) { window.showToast && window.showToast('Put players on the teams first.', 'error'); return; }
    const m = modalShell('team-card-modal', '📸 Team cards');
    await loadFonts();
    const d = await dataOf(ev);
    const pitch = await loadImage('img/TeamBuildField.png');
    const cards = [];
    const make = async (key, title, fn) => {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        await fn(c.getContext('2d'));
        cards.push({ key, title, canvas: c });
    };
    await make('teams', 'All teams', async (ctx) => drawFrame(ctx, d, { shownPicks: [], heading: 'THE TEAMS', sub: (d.info || d.title).toUpperCase(), finalTeams: true }));
    for (let i = 0; i < d.teams.length; i++) {
        if (!d.teams[i].players.length) continue;
        await make(`team-${i + 1}`, d.teams[i].name, (ctx) => drawSquad(ctx, d, d.teams[i], i, pitch));
    }
    const files = [];
    for (const c of cards) {
        try { files.push(new File([await toBlob(c.canvas)], `${slug(d.title)}-${c.key}.jpg`, { type: 'image/jpeg' })); } catch (e) { files.push(null); }
    }
    const body = m.querySelector('[data-body]');
    body.innerHTML = '<p class="text-[11px] text-white/60">Send them one by one so each one pops in the chat.</p>';
    if (files.some(f => !f)) body.innerHTML += '<p class="text-xs text-amber-300">Some photos couldn\'t be added. Take a screenshot instead.</p>';
    const bar = document.createElement('div');
    body.appendChild(bar);
    mountShareBar(bar, cards.map((c, i) => ({ title: c.title, file: files[i] })),
        { eventId: ev.id, communityId: ev.communityId || '', caption: `👕 Teams for ${ev.title || 'the game'}${ev.date ? ' · ' + (window.fmtGameDate || String)(ev.date) : ''}` });
    cards.forEach((c, i) => {
        const box = document.createElement('div');
        box.className = 'space-y-2 pt-2';
        c.canvas.className = 'w-full h-auto rounded-2xl border border-white/10 shadow-xl';
        box.appendChild(c.canvas);
        const file = files[i];
        if (file) {
            const row = document.createElement('div');
            row.className = 'flex gap-2';
            const canShare = navigator.canShare && navigator.canShare({ files: [file] });
            row.innerHTML = `${canShare ? `<button data-share class="flex-1 bg-[#25D366] text-slate-950 font-black py-3 rounded-xl text-sm"><i class="fa-brands fa-whatsapp mr-1"></i> Share ${c.title.replace(/[<>&"]/g, '')}</button>` : ''}
                <button data-save class="${canShare ? '' : 'flex-1 '}bg-black/60 border border-white/20 text-white font-bold py-3 px-4 rounded-xl text-sm"><i class="fa-solid fa-download mr-1"></i> Save</button>`;
            row.querySelector('[data-share]')?.addEventListener('click', () => navigator.share({ files: [file] }).catch(() => {}));
            row.querySelector('[data-save]').addEventListener('click', () => {
                const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
                document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            });
            box.appendChild(row);
        }
        body.appendChild(box);
    });
};
