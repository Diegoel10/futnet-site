// js/player-stats.js: Player stats on the profile (yours, and anyone you tap) + a shareable stats card.
//   Numbers come from the server (playerStats), counted from finished games only, the same way as the
//   leaderboard and results page: games, goals, W/D/L, titles (team finished 1st), attendance
//   (late / no-show tags), goals per month, last 5 games, best game. Switch: all games or one community.
import { auth } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { cardKit } from './game-profile/celebration-cards.js';
import { playerPageTabsHtml, mountPlayerPage } from './player-tabs.js';

const call = () => httpsCallable(getFunctions(auth.app, 'us-central1'), 'playerStats');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cache = {};   // uid|community -> stats
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (d) => { const [y, m, dd] = String(d || '').split('-').map(Number); return y ? `${MONTH_NAMES[m - 1]} ${dd}` : ''; };
const placeLabel = (p) => p === 1 ? '🏆 1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : p ? `${p}th` : '—';
const placeColor = (p) => p === 1 ? '#FCD34D' : p === 2 ? '#CBD5E1' : p === 3 ? '#F59E0B' : '#64748B';

async function fetchStats(uid, communityId = '') {
    const key = `${uid}|${communityId}`;
    if (cache[key] && Date.now() - cache[key].at < 60000) return cache[key].data;
    const r = await call()({ uid, communityId });
    cache[key] = { at: Date.now(), data: r.data };
    return r.data;
}

/** Who this is (name, photo, position, nickname) from the directory, or your own profile. */
function personOf(uid, name, avatar) {
    const me = window.currentUser?.uid === uid ? (window.userProfile || {}) : null;
    const d = (window.cachedDirectoryList || window.directoryList || []).find(u => String(u.uid) === String(uid)) || {};
    const src = me || d;
    const full = `${src.firstName || ''} ${src.lastName || ''}`.trim() || src.name || name || 'Player';
    const photo = window.resolvePlayerAvatar ? window.resolvePlayerAvatar({ uid, name: full, avatar: avatar || src.avatar }) : (avatar || src.avatar || '');
    return { uid, name: full, avatar: photo, position: src.position || '', nickname: src.nickname || '' };
}

// ---------- stars ----------
/** 5 stars with halves (Font Awesome), e.g. 3.5 -> ★★★⯪☆ */
export function starsHtml(v, color = '#FCD34D', size = 'text-sm') {
    const out = [];
    for (let i = 1; i <= 5; i++) {
        const icon = v >= i ? 'fa-solid fa-star' : v >= i - 0.5 ? 'fa-solid fa-star-half-stroke' : 'fa-regular fa-star';
        out.push(`<i class="${icon}"></i>`);
    }
    return `<span class="${size} tracking-tight whitespace-nowrap" style="color:${color}">${out.join('')}</span>`;
}

function ratingsBox(r) {
    if (!r) return '';
    const a = r.attendance || {}, k = r.skill || {};
    const row = (icon, title, x, sub, color) => `
        <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0" style="background:${color}22;color:${color}">${icon}</div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2"><span class="text-[10px] font-black uppercase tracking-wider text-white/60">${title}</span>
                    ${x.isNew ? '<span class="text-[9px] font-black rounded-full px-2 py-0.5 bg-white/10 text-white/70">NEW</span>' : `<span class="text-xs font-black text-white">${Number(x.score || 0).toFixed(1)}</span>`}</div>
                <div class="text-[10px] text-white/50 truncate">${sub}</div>
            </div>
            ${x.isNew ? '' : starsHtml(x.stars, color)}
        </div>`;
    const aSub = a.isNew ? 'Shows after 3 games'
        : [`${a.onTime || 0} on time`, a.late ? `${a.late} late` : '', a.lateCancels ? `${a.lateCancels} late cancel${a.lateCancels > 1 ? 's' : ''}` : '', a.noShows ? `${a.noShows} no-show${a.noShows > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
    const kSub = k.isNew ? 'Shows after 3 games' : `From ${k.games} games: wins, +/-, goals, titles`;
    return `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-3">
        ${row('<i class="fa-solid fa-clock"></i>', 'Attendance', a, aSub, '#00F296')}
        ${row('<i class="fa-solid fa-futbol"></i>', 'Skill', k, kSub, '#FCD34D')}
    </div>`;
}

// Small skill stars next to names (rosters): any element with data-skill-uid gets filled in.
const ratingCache = {};      // uid -> { skill, attendance }
let ratingQueue = new Set(), ratingTimer = null;
function paintSkill(el) {
    const r = ratingCache[el.dataset.skillUid];
    if (!r) return;
    const k = r.skill || {};
    el.innerHTML = k.isNew ? '<span class="text-[8px] font-black text-white/40">NEW</span>'
        : `<span class="text-[9px] font-black text-[#FCD34D] whitespace-nowrap"><i class="fa-solid fa-star"></i> ${Number(k.stars).toFixed(1)}</span>`;
    el.title = k.isNew ? 'Skill: new player' : `Skill ${k.stars} stars`;
}
function requestRatings(uids) {
    uids.forEach(u => { if (u && !ratingCache[u]) ratingQueue.add(u); });
    if (!ratingQueue.size || ratingTimer) return;
    ratingTimer = setTimeout(async () => {
        const list = [...ratingQueue].slice(0, 80); ratingQueue = new Set(); ratingTimer = null;
        try {
            const r = await httpsCallable(getFunctions(auth.app, 'us-central1'), 'playerRatings')({ uids: list });
            Object.assign(ratingCache, (r.data && r.data.ratings) || {});
            document.querySelectorAll('[data-skill-uid]').forEach(paintSkill);
            document.querySelectorAll('[data-rating-uid]').forEach(paintRating);
        } catch (e) { console.warn('ratings', e); }
    }, 150);
}
/** Skill stars for a few players right now (used by "Lowest-rated captain picks first").
 *  New players (under 3 games) count as 3 stars, the middle. Returns { uid: stars }. */
export async function fetchSkillStars(uids) {
    const need = uids.filter(u => u && !ratingCache[u]);
    if (need.length) {
        try {
            const r = await httpsCallable(getFunctions(auth.app, 'us-central1'), 'playerRatings')({ uids: need });
            Object.assign(ratingCache, (r.data && r.data.ratings) || {});
        } catch (e) { console.warn('ratings', e); }
    }
    return Object.fromEntries(uids.map(u => {
        const k = (ratingCache[u] || {}).skill || {};
        return [u, k.isNew || !(Number(k.stars) > 0) ? 3 : Number(k.stars)];
    }));
}
window.fetchSkillStars = fetchSkillStars;

function paintRating(el) {
    const r = ratingCache[el.dataset.ratingUid];
    if (!r) return;
    const kind = el.dataset.ratingKind === 'attendance' ? 'attendance' : 'skill';
    const x = r[kind] || {};
    el.innerHTML = x.isNew ? '<span class="text-[10px] font-black rounded-full px-2 py-0.5 bg-white/10 text-white/70">NEW</span>'
        : starsHtml(x.stars, kind === 'attendance' ? '#00F296' : '#FCD34D', 'text-xs');
}
function scanSkill(root) {
    if (!root.querySelectorAll) return;
    const els = root.querySelectorAll('[data-skill-uid]');
    const full = root.querySelectorAll('[data-rating-uid]');
    if (!els.length && !full.length) return;
    els.forEach(paintSkill); full.forEach(paintRating);
    requestRatings([...els].map(e => e.dataset.skillUid).concat([...full].map(e => e.dataset.ratingUid)));
}
new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) scanSkill(n.matches?.('[data-skill-uid]') ? n.parentElement || n : n); })))
    .observe(document.documentElement, { childList: true, subtree: true });
/** For lists: `<span data-skill-uid="UID"></span>` gets the skill stars. */
export const skillBadge = (uid) => uid ? `<span data-skill-uid="${esc(uid)}" class="inline-flex"></span>` : '';
window.skillBadge = skillBadge;
/** Full stars for one player (member card): kind = 'attendance' | 'skill'. */
export const ratingStars = (uid, kind) => uid ? `<span data-rating-uid="${esc(uid)}" data-rating-kind="${kind}" class="inline-flex"><span class="text-[10px] text-white/40">…</span></span>` : '';
window.ratingStars = ratingStars;
window.starsHtml = starsHtml;

// ---------- the section ----------
function tile(value, label, color = '#fff') {
    return `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 text-center">
        <div class="text-2xl font-black leading-none" style="color:${color}">${esc(value)}</div>
        <div class="text-[9px] font-black text-white/55 uppercase tracking-wider mt-1.5">${esc(label)}</div></div>`;
}

function statsHtml(s, person, communityId, boxId) {
    const t = s.totals, a = s.attendance;
    const comms = s.communities || [];
    const chip = (id, label) => `<button onclick="playerStatsSwitch('${boxId}','${esc(id)}')"
        class="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-black border ${communityId === id ? 'bg-[#00F296] text-slate-950 border-[#00F296]' : 'bg-black/40 text-white/70 border-white/15'}">${esc(label)}</button>`;
    if (!t.games && !a.joined) {
        return `${comms.length ? `<div class="flex gap-2 overflow-x-auto pb-1">${chip('', 'All games')}${comms.map(c => chip(c.id, c.name)).join('')}</div>` : ''}
            ${s.ratings && s.ratings.attendance && s.ratings.attendance.games ? ratingsBox(s.ratings) : ''}
            <p class="text-xs text-white/55 text-center py-4">No finished games yet. Stats show up after a game ends.</p>`;
    }
    const max = Math.max(1, ...s.months.map(m => m.goals));
    const bars = s.months.map(m => {
        const mo = Number(m.month.slice(5, 7)) - 1;
        const h = m.goals ? Math.max(8, Math.round((m.goals / max) * 100)) : 0;
        return `<div class="flex-1 flex flex-col items-center gap-1" title="${MONTH_NAMES[mo]}: ${m.goals} goals in ${m.games} games">
            <div class="text-[9px] font-black text-[#00F296] h-3">${m.goals || ''}</div>
            <div class="w-full h-16 flex items-end"><div class="w-full rounded-t-md ${m.games ? 'bg-[#00F296]' : 'bg-white/10'}" style="height:${m.games ? Math.max(h, 4) : 3}%"></div></div>
            <div class="text-[9px] text-white/45 font-bold">${MONTHS[mo]}</div></div>`;
    }).join('');
    const total = Math.max(1, t.wins + t.draws + t.losses);
    const seg = (n, color) => n ? `<div style="width:${(n / total) * 100}%;background:${color}"></div>` : '';
    return `
        ${comms.length ? `<div class="flex gap-2 overflow-x-auto pb-1">${chip('', 'All games')}${comms.map(c => chip(c.id, c.name)).join('')}</div>` : ''}
        ${ratingsBox(s.ratings)}
        <div class="grid grid-cols-4 gap-2">
            ${tile(t.games, 'Games')}${tile(t.goals, 'Goals', '#00F296')}${tile(t.champion, 'Titles', '#FCD34D')}${tile(t.goalsPerGame, 'Goals/game')}
        </div>
        <div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2">
            <div class="flex items-center justify-between text-xs">
                <span class="font-black text-white/60 uppercase tracking-wider text-[10px]">Match record</span>
                <span class="font-black"><span class="text-[#00F296]">${t.wins}W</span> · <span class="text-white/70">${t.draws}D</span> · <span class="text-red-400">${t.losses}L</span> <span class="text-white/50 ml-1">${t.winPct}% wins</span></span>
            </div>
            <div class="h-2.5 rounded-full overflow-hidden flex bg-white/10">${seg(t.wins, '#00F296')}${seg(t.draws, '#94A3B8')}${seg(t.losses, '#F87171')}</div>
        </div>
        <div class="bg-black/40 border border-white/10 rounded-2xl p-3 flex items-center justify-between gap-3">
            <div>
                <div class="font-black text-white/60 uppercase tracking-wider text-[10px]">Showed up</div>
                <div class="text-xs font-bold text-white mt-0.5">Showed up ${a.showed} of ${a.joined}${a.late ? ` · ${a.late} late` : ''}${a.noShow ? ` · ${a.noShow} no-show` : ''}</div>
            </div>
            <div class="text-2xl font-black ${a.pct >= 90 ? 'text-[#00F296]' : a.pct >= 70 ? 'text-amber-300' : 'text-red-400'}">${a.pct}%</div>
        </div>
        <div class="bg-black/40 border border-white/10 rounded-2xl p-3">
            <div class="font-black text-white/60 uppercase tracking-wider text-[10px] mb-2">Goals per month</div>
            <div class="flex gap-1">${bars}</div>
        </div>
        ${s.recent.length ? `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2">
            <div class="font-black text-white/60 uppercase tracking-wider text-[10px]">Last ${s.recent.length} games</div>
            ${s.recent.map(r => `<button onclick="playerStatsOpenGame('${esc(r.eventId)}')" class="w-full flex items-center gap-3 text-left">
                <span class="w-14 shrink-0 text-center text-[10px] font-black rounded-full py-1" style="background:${placeColor(r.place)}22;color:${placeColor(r.place)};border:1px solid ${placeColor(r.place)}66">${placeLabel(r.place)}</span>
                <span class="flex-1 min-w-0"><span class="block text-xs font-bold text-white truncate">${esc(r.title)}</span>
                    <span class="block text-[10px] text-white/50">${fmtDay(r.date)} · ${r.w}W ${r.d}D ${r.l}L</span></span>
                <span class="text-xs font-black text-[#00F296] shrink-0">${r.goals ? '⚽'.repeat(Math.min(r.goals, 4)) + (r.goals > 4 ? ` ${r.goals}` : '') : ''}</span>
            </button>`).join('')}
        </div>` : ''}
        ${s.best ? `<button onclick="playerStatsOpenGame('${esc(s.best.eventId)}')" class="w-full bg-[#FCD34D]/10 border border-[#FCD34D]/40 rounded-2xl p-3 flex items-center justify-between text-left">
            <span><span class="block font-black text-[#FCD34D] uppercase tracking-wider text-[10px]">Best game</span>
            <span class="block text-xs font-bold text-white">${esc(s.best.title)} · ${fmtDay(s.best.date)}</span></span>
            <span class="text-lg font-black text-[#FCD34D]">${s.best.goals} ⚽</span></button>` : ''}
        <button onclick="playerStatsCard('${boxId}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-xs shadow flex items-center justify-center gap-2">
            <i class="fa-solid fa-image"></i> ${person.uid === window.currentUser?.uid ? 'Make my stats card' : 'Make stats card'}</button>`;
}

const boxes = {};   // boxId -> { person, communityId, stats }

/** Puts the stats section inside the element with id `boxId`. */
export async function mountPlayerStats(boxId, uid, { name, avatar, communityId = '' } = {}) {
    const el = document.getElementById(boxId);
    if (!el || !uid) return;
    const person = personOf(uid, name, avatar);
    boxes[boxId] = { person, communityId, stats: null };
    // Last numbers seen show right away; the fresh ones replace them when they arrive.
    const key = `futnet_stats_${uid}_${communityId || 'all'}`;
    let shown = false;
    try {
        const old = JSON.parse(localStorage.getItem(key) || 'null');
        if (old && old.totals) {
            boxes[boxId].stats = old; shown = true;
            el.innerHTML = `<div class="space-y-3">${statsHtml(old, person, communityId, boxId)}</div>`;
        }
    } catch (e) { /* no saved copy */ }
    if (!shown) el.innerHTML = `<div class="text-xs text-white/50 text-center py-6"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Loading stats…</div>`;
    try {
        const s = await fetchStats(uid, communityId);
        try { localStorage.setItem(key, JSON.stringify(s)); } catch (e) { /* storage full / private */ }
        if (boxes[boxId]?.person.uid !== uid || (boxes[boxId]?.communityId || '') !== (communityId || '')) return;   // switched meanwhile
        boxes[boxId].stats = s;
        const box = document.getElementById(boxId);
        if (box) box.innerHTML = `<div class="space-y-3">${statsHtml(s, person, communityId, boxId)}</div>`;
    } catch (e) {
        console.warn('player stats', e);
        const box = document.getElementById(boxId);
        if (box && !shown) box.innerHTML = `<p class="text-xs text-white/50 text-center py-4">Couldn't load stats right now.</p>`;
    }
}

window.playerStatsSwitch = (boxId, communityId) => {
    const b = boxes[boxId]; if (!b) return;
    mountPlayerStats(boxId, b.person.uid, { name: b.person.name, avatar: b.person.avatar, communityId });
};

window.playerStatsOpenGame = (eventId) => {
    document.getElementById('player-stats-sheet')?.remove();
    if (window.openEventDetails) window.openEventDetails(eventId);
};

/** Full-screen player page: photo, name, Message / Add friend, then tabs: Player info / Stats / Events / Basic info. */
window.openPlayerStatsSheet = (uid, name, avatar, communityId = '') => {
    if (!uid) return;
    const p = personOf(uid, name, avatar);
    const isMe = uid === window.currentUser?.uid;
    document.getElementById('player-stats-sheet')?.remove();
    const m = document.createElement('div');
    m.id = 'player-stats-sheet';
    m.className = 'fixed inset-0 z-[150] bg-[#01060A]/95 backdrop-blur-sm overflow-y-auto text-white';
    const isFriend = (window.friendsList || []).some(f => String(typeof f === 'string' ? f : f?.uid) === String(uid));
    m.innerHTML = `
        <div class="max-w-md mx-auto p-4 pb-16 space-y-4">
            <div class="flex justify-end"><button onclick="document.getElementById('player-stats-sheet').remove()" aria-label="Close" class="w-9 h-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="flex flex-col items-center text-center gap-1.5">
                <img src="${esc(p.avatar)}" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'" class="w-24 h-24 rounded-full object-cover border-4 border-[#00F296] shadow-[0_0_20px_rgba(0,242,150,0.35)]">
                <div class="text-lg font-black">${esc(p.name)}${window.statusEmoji ? window.statusEmoji(uid) : ''}</div>
                ${(p.nickname || p.position) ? `<div class="text-xs text-white/60">${esc([p.nickname, p.position].filter(Boolean).join(' · '))}</div>` : ''}
            </div>
            ${isMe ? '' : `<div class="flex gap-2">
                ${isFriend ? '' : `<button onclick="sendFriendRequestFromRoster && sendFriendRequestFromRoster('${esc(uid)}')" class="flex-1 bg-black/60 border border-white/20 text-white font-bold py-3 rounded-xl text-xs"><i class="fa-solid fa-user-plus mr-1"></i> Add friend</button>`}
                <button onclick="document.getElementById('player-stats-sheet').remove(); window.openDirectChat && openDirectChat('${esc(uid)}', '${esc(p.name).replace(/'/g, "\\'")}', '')" class="flex-1 bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-xs"><i class="fa-solid fa-comments mr-1"></i> Message</button>
            </div>`}
            ${playerPageTabsHtml()}
        </div>`;
    document.body.appendChild(m);
    // Player info / Stats / Events / Basic info (each can be hidden by the player in Settings > Privacy)
    mountPlayerPage(uid, p.name, p.avatar, communityId);
};
// The Friends list already calls this
window.viewPlayerProfile = (uid, name) => window.openPlayerStatsSheet(uid, name);

// ---------- the stats card (image) ----------
/** 5 stars drawn on the card; `value` 0-5 in halves. x = center of the first star. */
function drawStars(ctx, x, y, size, step, value, color) {
    const star = (cx, cy, r) => {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
            const rad = i % 2 ? r * 0.45 : r, a = -Math.PI / 2 + (i * Math.PI) / 5;
            ctx[i ? 'lineTo' : 'moveTo'](cx + rad * Math.cos(a), cy + rad * Math.sin(a));
        }
        ctx.closePath();
    };
    for (let i = 0; i < 5; i++) {
        const cx = x + i * step, r = size / 2;
        ctx.save(); star(cx, y, r); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fill(); ctx.restore();
        const fillPart = Math.max(0, Math.min(1, value - i));
        if (fillPart > 0) {
            ctx.save(); ctx.beginPath(); ctx.rect(cx - r, y - r, r * 2 * fillPart, r * 2); ctx.clip();
            star(cx, y, r); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.fill(); ctx.restore();
        }
    }
}

async function drawStatsCard(person, s, scopeName) {
    const K = cardKit;
    const { W, H, GREEN, GOLD, BLOCK, BODY } = K;
    const [bg, logo, photo] = await Promise.all([
        K.loadImage('img/celebration_bg.jpg'),
        K.loadImage('img/celebration_logo.png').then(i => i || K.loadImage('img/FutnetJustLogo.png')),
        K.loadImage(person.avatar),
    ]);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    K.background(ctx, bg, GREEN);
    K.header(ctx, logo, {});
    // Title top-right
    K.brush(ctx, W - 300, 92, 420, 96, GREEN, 7);
    K.text(ctx, 'PLAYER STATS', W - 300, 96, { font: K.fitFont(ctx, 'PLAYER STATS', BLOCK, '', 64, 380), color: '#06140d', shadow: false });

    // Left: photo, name, scope
    const cx = 330;
    K.avatar(ctx, photo, person.name, cx, 400, 175, GREEN, { ringWidth: 10 });
    K.text(ctx, person.name.toUpperCase(), cx, 640, { font: K.fitFont(ctx, person.name.toUpperCase(), BLOCK, '', 84, 560) });
    const sub = [person.nickname && `"${person.nickname}"`, person.position].filter(Boolean).join(' · ');
    if (sub) K.text(ctx, sub, cx, 704, { font: `800 30px ${BODY}`, color: 'rgba(255,255,255,0.8)', maxWidth: 560 });
    K.text(ctx, scopeName.toUpperCase(), cx, 758, { font: `800 26px ${BODY}`, color: GREEN, maxWidth: 560 });
    const r = s.ratings || {};
    const starRow = (label, x, y, color) => {
        K.text(ctx, label, cx - 250, y, { font: `800 24px ${BODY}`, align: 'left', color: 'rgba(255,255,255,0.75)' });
        if (!x || x.isNew) { K.text(ctx, 'NEW', cx + 250, y, { font: `800 24px ${BODY}`, align: 'right', color: 'rgba(255,255,255,0.6)' }); return; }
        drawStars(ctx, cx + 250 - 5 * 44 + 22, y, 40, 44, x.stars, color);
    };
    starRow('ATTENDANCE', r.attendance, 812, GREEN);
    starRow('SKILL', r.skill, 864, GOLD);
    if (s.best) K.text(ctx, `BEST GAME: ${s.best.goals} ⚽ · ${fmtDay(s.best.date).toUpperCase()}`, cx, 916, { font: `800 24px ${BODY}`, color: GOLD, maxWidth: 560 });

    // Right: 2 x 3 big numbers
    const t = s.totals;
    const cells = [[t.games, 'GAMES', '#fff'], [t.goals, 'GOALS', GREEN], [t.champion, 'TITLES', GOLD],
        [`${t.winPct}%`, 'WIN RATE', '#fff'], [t.goalsPerGame, 'GOALS / GAME', '#fff'], [`${s.attendance.pct}%`, 'SHOWED UP', s.attendance.pct >= 90 ? GREEN : '#fff']];
    const gx = 690, gy = 200, cw = 210, ch = 170, gap = 22;
    cells.forEach(([v, label, color], i) => {
        const x = gx + (i % 3) * (cw + gap), y = gy + Math.floor(i / 3) * (ch + gap);
        ctx.save(); K.rr(ctx, x, y, cw, ch, 24);
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = color === '#fff' ? 'rgba(255,255,255,0.25)' : color + '99'; ctx.stroke(); ctx.restore();
        K.text(ctx, String(v), x + cw / 2, y + 72, { font: K.fitFont(ctx, String(v), BLOCK, '', 92, cw - 30), color });
        K.text(ctx, label, x + cw / 2, y + 140, { font: `800 20px ${BODY}`, color: 'rgba(255,255,255,0.7)' });
    });

    // Record bar
    const ry = 600, rx = gx, rw = 3 * cw + 2 * gap;
    K.text(ctx, `${t.wins}W · ${t.draws}D · ${t.losses}L`, rx, ry, { font: `56px ${BLOCK}`, align: 'left' });
    K.text(ctx, 'MATCH RECORD', rx + rw, ry, { font: `800 20px ${BODY}`, align: 'right', color: 'rgba(255,255,255,0.65)' });
    const total = Math.max(1, t.wins + t.draws + t.losses);
    let x = rx;
    ctx.save(); K.rr(ctx, rx, ry + 42, rw, 22, 11); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(rx, ry + 42, rw, 22);
    [[t.wins, GREEN], [t.draws, '#94A3B8'], [t.losses, '#F87171']].forEach(([n, col]) => {
        const w = (n / total) * rw; ctx.fillStyle = col; ctx.fillRect(x, ry + 42, w, 22); x += w;
    });
    ctx.restore();

    // Last games (form)
    const recent = (s.recent || []).slice(0, 5).reverse();   // oldest -> newest, left to right
    if (recent.length) {
        K.text(ctx, 'LAST GAMES', rx, ry + 130, { font: `800 20px ${BODY}`, align: 'left', color: 'rgba(255,255,255,0.65)' });
        const step = rw / 5;
        recent.forEach((r, i) => {
            const fx = rx + step * i + step / 2, fy = ry + 196;
            const col = placeColor(r.place);
            ctx.save(); ctx.beginPath(); ctx.arc(fx, fy, 42, 0, Math.PI * 2);
            ctx.fillStyle = col + '33'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = col; ctx.stroke(); ctx.restore();
            K.text(ctx, r.place === 1 ? '🏆' : (r.place ? `#${r.place}` : '—'), fx, fy + 2, { font: r.place === 1 ? `40px ${BODY}` : `44px ${BLOCK}`, color: col, shadow: false });
            K.text(ctx, r.goals ? `${r.goals} ⚽` : '–', fx, fy + 66, { font: `800 22px ${BODY}`, color: r.goals ? GREEN : 'rgba(255,255,255,0.5)' });
        });
    }
    K.footer(ctx);
    return c;
}

async function openStatsCard(person, stats, communityId) {
    const scopeName = communityId ? ((stats.communities || []).find(c => c.id === communityId)?.name || 'Community') : 'All games';
    let m = document.getElementById('stats-card-modal');
    if (!m) { m = document.createElement('div'); m.id = 'stats-card-modal'; document.body.appendChild(m); }
    m.className = 'fixed inset-0 z-[190] bg-[#040E13] text-white overflow-y-auto';
    m.innerHTML = `<div class="h-full flex items-center justify-center text-sm text-white/70"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Making your card…</div>`;
    let canvas = null, file = null, tainted = false;
    try {
        canvas = await drawStatsCard(person, stats, scopeName);
        const blob = await cardKit.toBlob(canvas);
        const slug = person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';
        file = new File([blob], `${slug}-stats.jpg`, { type: 'image/jpeg' });
    } catch (e) { console.error(e); tainted = !!canvas; }
    const canShare = file && navigator.canShare && navigator.canShare({ files: [file] });
    const canPost = file && communityId && window.postToCommunityFeed && (window.myCommunityRoles || {})[communityId];
    m.innerHTML = `
        <div class="max-w-2xl mx-auto p-4 pb-16 space-y-4">
            <div class="flex items-center justify-between">
                <div class="text-base font-black">Stats card 📊</div>
                <button onclick="document.getElementById('stats-card-modal').remove()" aria-label="Close" class="w-9 h-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-xmark text-sm"></i></button>
            </div>
            ${tainted ? `<div class="text-xs bg-amber-500/10 border border-amber-400/40 rounded-xl p-3">The photo couldn't be added to the image. Take a screenshot instead.</div>` : ''}
            ${canvas ? '' : '<p class="text-sm text-white/60">Couldn\'t make the card right now.</p>'}
            <div id="stats-card-img"></div>
            <div class="flex gap-2">
                ${canShare ? `<button id="sc-share" class="flex-1 bg-[#25D366] text-slate-950 font-black py-3 rounded-xl text-sm"><i class="fa-brands fa-whatsapp mr-1"></i> Share</button>` : ''}
                ${file ? `<button id="sc-save" class="${canShare ? '' : 'flex-1 '}bg-black/60 border border-white/20 text-white font-bold py-3 px-4 rounded-xl text-sm"><i class="fa-solid fa-download mr-1"></i> Save</button>` : ''}
            </div>
            ${canPost ? `<button id="sc-post" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-sm"><i class="fa-solid fa-users mr-1"></i> Post to ${esc(scopeName)} feed</button>` : ''}
        </div>`;
    if (canvas) { canvas.className = 'w-full h-auto rounded-2xl border border-white/10 shadow-xl'; m.querySelector('#stats-card-img').appendChild(canvas); }
    m.querySelector('#sc-share')?.addEventListener('click', async () => { try { await navigator.share({ files: [file] }); } catch (e) { /* cancelled */ } });
    m.querySelector('#sc-save')?.addEventListener('click', () => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
    m.querySelector('#sc-post')?.addEventListener('click', async (e) => {
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Posting…';
        const ok = await window.postToCommunityFeed(communityId, `📊 ${person.name}'s stats`, [file]);
        b.textContent = ok ? 'Posted to the feed ✓' : 'Couldn\'t post. Try again';
        if (!ok) b.disabled = false;
    });
}

window.playerStatsCard = (boxId) => {
    const b = boxes[boxId];
    if (b && b.stats) openStatsCard(b.person, b.stats, b.communityId);
};

window.mountPlayerStats = mountPlayerStats;
