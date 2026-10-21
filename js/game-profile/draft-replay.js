// js/game-profile/draft-replay.js
// 1) "Watch the draft": the captains' picks played back one by one (pick 1, pick 2, ...), drawn on a canvas so it
//    can also be saved / shared as a video (MediaRecorder; mp4 on iPhone/Safari, webm elsewhere).
// 2) "Team card": one image with every team (captain first, gold C), like the celebration cards.
import { cardKit, loadFonts } from './celebration-cards.js';

const { W, H, GREEN, GOLD, BLOCK, BODY, loadImage, background, rr, text, fitFont, avatar, header, footer, toBlob } = cardKit;
const AV_FALLBACK = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';

const STEP = 1.6;        // seconds per pick
const INTRO = 2.2;       // captains shown first
const OUTRO = 3.2;       // final teams held at the end

const listOf = (ta, i) => ((ta || {})[i] ?? (ta || {})[String(i)] ?? []).filter(p => p && p.uid);
const capOf = (ev, i) => String(((ev.teamCaptains || {})[i] ?? (ev.teamCaptains || {})[String(i)]) || '');
const photo = (p, ev) => {
    const d = (window.directoryList || []).find(u => String(u.uid) === String(p.uid));
    const a = (d && (d.avatar || d.photoURL)) || (ev.attendees || []).find(x => String(x.uid) === String(p.uid))?.avatar || p.avatar || '';
    return /^https?:\/\//.test(a) ? a : '';
};

/** Everything the drawings need, from the game. */
async function dataOf(ev) {
    const count = ev.teamsCount || 3;
    const names = window.getTeamNames(ev), colors = window.getTeamColors(ev);
    const ta = ev.teamAssignments || {};
    const picks = ((ev.capsDraft && ev.capsDraft.picks) || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0));
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

// ---------------------------------------------------------------- team card (image)
window.openTeamCard = async function(eventId) {
    const ev = (window.eventsList || []).find(e => e.id === eventId);
    if (!ev) return;
    const hasPlayers = Object.values(ev.teamAssignments || {}).some(a => (a || []).some(p => p && p.uid));
    if (!hasPlayers) { window.showToast && window.showToast('Put players on the teams first.', 'error'); return; }
    const m = modalShell('team-card-modal', '📸 Team card');
    await loadFonts();
    const d = await dataOf(ev);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    drawFrame(canvas.getContext('2d'), d, { shownPicks: [], heading: 'THE TEAMS', sub: (d.info || d.title).toUpperCase(), finalTeams: true });
    canvas.className = 'w-full h-auto rounded-2xl border border-white/10 shadow-xl';
    const body = m.querySelector('[data-body]');
    body.innerHTML = '';
    body.appendChild(canvas);
    let file = null;
    try { file = new File([await toBlob(canvas)], `${slug(d.title)}-teams.jpg`, { type: 'image/jpeg' }); } catch (e) { file = null; }
    const row = document.createElement('div');
    row.className = 'flex gap-2';
    const canShare = file && navigator.canShare && navigator.canShare({ files: [file] });
    row.innerHTML = file
        ? `${canShare ? '<button data-share class="flex-1 bg-[#25D366] text-slate-950 font-black py-3 rounded-xl text-sm"><i class="fa-brands fa-whatsapp mr-1"></i> Share</button>' : ''}
           <button data-save class="${canShare ? '' : 'flex-1 '}bg-black/60 border border-white/20 text-white font-bold py-3 px-4 rounded-xl text-sm"><i class="fa-solid fa-download mr-1"></i> Save</button>`
        : '<p class="text-xs text-amber-300 text-center w-full">Some photos couldn\'t be added. Take a screenshot instead.</p>';
    body.appendChild(row);
    row.querySelector('[data-share]')?.addEventListener('click', () => navigator.share({ files: [file] }).catch(() => {}));
    row.querySelector('[data-save]')?.addEventListener('click', () => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
    if (ev.communityId && window.postToCommunityFeed && file && (window.myCommunityRoles || {})[ev.communityId]) {
        const post = document.createElement('button');
        post.className = 'w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-sm';
        post.innerHTML = '<i class="fa-solid fa-users mr-1"></i> Post to the community feed';
        post.onclick = async () => {
            post.disabled = true; post.textContent = 'Posting…';
            const ok = await window.postToCommunityFeed(ev.communityId, `👕 Teams for ${ev.title || 'the game'}${ev.date ? ' · ' + ev.date : ''}`, [file]);
            post.textContent = ok ? 'Posted to the feed ✓' : "Couldn't post. Try again";
            if (!ok) post.disabled = false;
        };
        body.appendChild(post);
    }
};
