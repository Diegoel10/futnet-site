// js/vs.js: VS Mode matches (team vs team) and Challenges. Same data as the iPhone and Android apps.
//
//   artifacts/{app}/vsMatches/{id}:
//     title, date 'YYYY-MM-DD', time 'HH:MM', location, format '7v7', level, teamsCount (2-4),
//     organizerId, organizerName, priceCents (per team, 0 = free), payByHours (0 = until kickoff),
//     firstToPay (true), partial (false), rosterLockHours (0 = never),
//     status: 'challenge' | 'open' | 'final' | 'cancelled' | 'declined',
//     challenge: { fromTeamId, toTeamId, status: 'pending'|'accepted'|'declined' } (challenges only),
//     teams: [{ teamId, name, short, logo, colors, state: 'invited'|'pending'|'confirmed', roster: [memberId], joinedAt }],
//     teamIds: [...], payments: [{ teamId, cents, method, byUid, at }],
//     score: { <teamId>: goals }, forfeit: teamId (no-show), createdAt, updatedAt
//   vsMatches/{id}/appeals/{autoId}: { teamId, byUid, byName, note, at }
// The server sends the notifications, drops teams that didn't pay in time, and adds results to the teams' records.
import { db, appId } from './firebase-config.js';
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, onSnapshot, runTransaction, serverTimestamp, query, orderBy, limit }
    from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { teamLogoHtml, canManage, FORMATS, LEVELS } from './teams.js';
import { attachParkPicker, saveParkIfNew } from './parks.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsq = (v) => esc(String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const toast = (m, t) => window.showToast && window.showToast(m, t);
const myUid = () => (window.currentUser && window.currentUser.uid) || '';
const myName = () => { const p = window.userProfile || {}; return (p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Player').trim(); };
const C = (name) => collection(db, 'artifacts', appId, name);
const D = (...p) => doc(db, 'artifacts', appId, ...p);
const TS = () => window.__teamsState || { mine: [], all: [] };
// Teams I captain that can sign up for matches (a temporary free-agent squad only plays its own match).
const myCaptainTeams = () => (TS().mine || []).filter(t => canManage(t) && !t.temp);
const allMyCaptainTeams = () => (TS().mine || []).filter(t => canManage(t));
const myAvatar = () => { const p = window.userProfile || {}; const a = p.avatar || (window.currentUser && window.currentUser.photoURL) || ''; return /^https?:\/\//i.test(a) && a.length < 400 ? a : ''; };
const perSideOf = (m) => parseInt(String(m.format || '7v7'), 10) || 7;

// ---------------------------------------------------------------- the VS badge (comic burst, used everywhere instead of swords)
export function vsBadge(size = 40) {
    const id = 'vb' + Math.random().toString(36).slice(2, 8);
    const pts = [];
    const n = 13;
    for (let i = 0; i < n * 2; i++) {
        const a = (Math.PI * 2 * i) / (n * 2) - Math.PI / 2;
        const r = i % 2 ? 29 : (i % 4 === 0 ? 46 : 40);
        pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
    }
    const rays = [-75, -35, 10, 52, 98, 140, 185, 228, 270].map((d, i) => {
        const a = d * Math.PI / 180, r1 = 50, r2 = i % 2 ? 58 : 62;
        return `<line x1="${(50 + r1 * Math.cos(a)).toFixed(1)}" y1="${(50 + r1 * Math.sin(a)).toFixed(1)}" x2="${(50 + r2 * Math.cos(a)).toFixed(1)}" y2="${(50 + r2 * Math.sin(a)).toFixed(1)}" stroke="#F8FAFC" stroke-width="3" stroke-linecap="round" opacity=".85"/>`;
    }).join('');
    return `<svg width="${size}" height="${size}" viewBox="-14 -14 128 128" xmlns="http://www.w3.org/2000/svg" class="shrink-0 inline-block align-middle" aria-label="VS">
        <defs><pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.2" fill="#FFB4B4"/></pattern></defs>
        ${rays}
        <polygon points="${pts.join(' ')}" fill="#E8262B" stroke="#140F24" stroke-width="3.5" stroke-linejoin="round"/>
        <polygon points="${pts.join(' ')}" fill="url(#${id})" opacity=".45"/>
        <text x="50" y="61" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-style="italic" font-size="31" fill="#FFFFFF" stroke="#140F24" stroke-width="3.5" paint-order="stroke">VS</text>
    </svg>`;
}
window.vsBadge = vsBadge;
const money = (c) => `$${(Math.round(+c || 0) / 100).toFixed((+c || 0) % 100 ? 2 : 0)}`;
const BTN = 'bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black rounded-xl text-xs px-4 py-2.5 transition';
const DARK = 'bg-black/60 hover:bg-black text-white font-bold rounded-xl text-xs px-4 py-2.5 border border-white/15 transition';
const INPUT = 'w-full bg-black/50 border border-teal-500/60 rounded-xl px-3 py-2.5 text-white text-base sm:text-sm focus:outline-none focus:border-[#00F296]';
const LBL = (t) => `<div class="text-[10px] font-black uppercase tracking-wider text-white/55 mb-1.5">${t}</div>`;
const SIZES = Object.keys(FORMATS);

// ---------------------------------------------------------------- rules (same on the phones)
export const kickoffMs = (m) => {
    const [y, mo, d] = String(m.date || '').split('-').map(Number);
    if (!y) return 0;
    const [h, mi] = String(m.time || '12:00').split(':').map(Number);
    return new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
};
export function paidCents(m, teamId) { return (m.payments || []).filter(p => p.teamId === teamId).reduce((s, p) => s + (+p.cents || 0), 0); }
export function confirmedTeams(m) { return (m.teams || []).filter(t => t.state === 'confirmed'); }
/** Spots taken: confirmed teams, plus (when "first to pay is in" is off) teams that joined and hold a spot. */
export function spotsTaken(m) { return (m.teams || []).filter(t => t.state === 'confirmed' || (m.firstToPay === false && t.state === 'pending')).length; }
export const isFull = (m) => spotsTaken(m) >= (m.teamsCount || 2);
export function payByMs(m) { const k = kickoffMs(m); return k ? k - (+m.payByHours || 0) * 3600000 : 0; }
export function rosterLocked(m, now = Date.now()) { return (+m.rosterLockHours || 0) > 0 && kickoffMs(m) && now > kickoffMs(m) - m.rosterLockHours * 3600000; }
/** Two jersey colors that look alike (so one team should bring its second color). */
export function colorsClash(a, b) {
    const rgb = (h) => { const x = String(h || '#000').replace('#', ''); return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16) || 0); };
    const [p, q] = [rgb(a), rgb(b)];
    return Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2) < 90;
}
/** A team after a payment: confirmed once the whole fee is in (and a spot is free when first-to-pay). */
function settle(m) {
    const price = +m.priceCents || 0;
    let confirmed = confirmedTeams(m).length;
    (m.teams || []).forEach(t => {
        if (t.state !== 'pending') return;
        const paid = price <= 0 || paidCents(m, t.teamId) >= price;
        if (paid && confirmed < (m.teamsCount || 2)) { t.state = 'confirmed'; confirmed++; }
    });
    return m;
}
function teamEntry(t, state) {
    return { teamId: t.id, name: t.name, short: t.short || '', logo: t.logo || null, colors: t.colors || {}, state, roster: [], joinedAt: Date.now() };
}
const prettyDate = (ymd) => { const [y, m, d] = String(ymd || '').split('-').map(Number); return y ? new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : ''; };
const prettyTime = (hm) => { const [h, m] = String(hm || '').split(':').map(Number); return isNaN(h) ? '' : new Date(2000, 0, 1, h, m || 0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const levelLabel = (k) => (LEVELS.find(l => l[0] === k) || [k, ''])[1];

// ---------------------------------------------------------------- live list
const V = { list: [], unsub: null, open: null, openUnsub: null };
window.__vsState = V;
function start() {
    if (V.unsub) V.unsub();
    V.unsub = onSnapshot(C('vsMatches'), s => {
        const cut = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
        V.list = s.docs.map(d => ({ ...d.data(), id: d.id })).filter(m => (m.date || '') >= cut);
        try { window.renderEvents && document.getElementById('events-grid') && window.renderEvents(); } catch (e) { /* ignore */ }
        try { window.refreshTeamsUi && window.refreshTeamsUi(); } catch (e) { /* ignore */ }
        if (V.open) { const fresh = V.list.find(m => m.id === V.open.id); if (fresh) { V.open = fresh; drawPage(); } }
    }, () => {});
}
let started = '';
setInterval(() => { const u = myUid(); if (u && started !== u) { started = u; start(); } if (!u && started) { started = ''; if (V.unsub) V.unsub(); V.list = []; } }, 1000);

// ---------------------------------------------------------------- home screen cards
function slotHtml(t, size = 46) {
    if (!t) return `<div class="flex flex-col items-center gap-1" style="width:${size + 30}px"><div class="rounded-2xl border-2 border-dashed border-white/35 flex items-center justify-center text-[9px] font-black text-white/50 text-center leading-tight" style="width:${size}px;height:${size}px">Open<br>spot</div><span class="text-[10px] font-bold text-white/40">&nbsp;</span></div>`;
    return `<div class="flex flex-col items-center gap-1 min-w-0" style="width:${size + 30}px">${teamLogoHtml(t, size)}<span class="text-[10px] font-black text-white truncate max-w-full">${esc(t.name)}</span></div>`;
}
const DEFAULT_AV = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
const organizerAvatar = (m) => {
    const d = (window.directoryList || window.cachedDirectoryList || []).find(u => String(u.uid) === String(m.organizerId));
    return (d && (d.avatar || d.photoURL)) || (m.organizerId === myUid() ? myAvatar() : '') || m.organizerAvatar || DEFAULT_AV;
};
const ymdToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** The match's name: its title, else "Team A vs Team B". */
export function vsTitleOf(m) {
    const names = (m.teams || []).filter(t => t.state !== 'invited' || m.status === 'challenge').map(t => t.name);
    return m.title || (names.length >= 2 ? `${names[0]} vs ${names[1]}` : names.length ? `${names[0]} vs ?` : 'VS Match');
}
function myStake(m) {
    const ids = new Set((TS().mine || []).map(t => t.id));
    if ((m.teamIds || []).some(id => ids.has(id))) return 'team';
    if ((m.forming || []).some(p => p.uid === myUid())) return 'squad';
    return '';
}
// ---------------------------------------------------------------- home screen card (looks like a normal game card)
export function vsCardHtml(m) {
    const n = m.teamsCount || 2;
    const shown = (m.teams || []).filter(t => t.state !== 'invited' || m.status === 'challenge').slice(0, n);
    const slots = Array.from({ length: n }, (_, i) => shown[i] || null);
    const price = +m.priceCents || 0;
    const over = m.status === 'final' || m.status === 'cancelled' || (m.date && m.date < ymdToday());
    const stake = myStake(m);
    const left = Math.max(0, n - spotsTaken(m));
    const chip = (cls, icon, text) => `<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-black border ${cls}"><i class="fa-solid ${icon}"></i><span>${text}</span></div>`;
    let status;
    if (m.status === 'cancelled') status = chip('bg-red-500/20 border-red-500 text-red-200', 'fa-ban', 'Cancelled');
    else if (m.status === 'final') status = chip('bg-white/10 border-white/30 text-white/80', 'fa-flag-checkered', 'Final');
    else if (over) status = chip('bg-white/10 border-white/30 text-white/80', 'fa-flag-checkered', 'Game ended');
    else if (m.status === 'challenge') status = chip('bg-fuchsia-500/20 border-fuchsia-400 text-fuchsia-100', 'fa-hourglass-half', 'Waiting for answer');
    else status = chip(left ? 'bg-[#00F296]/30 border-[#00F296] text-white' : 'bg-red-500/30 border-red-500 text-red-200', left ? 'fa-shield-halved' : 'fa-user-xmark', left ? `${spotsTaken(m)}/${n} teams` : 'Full');
    const mine = !over && stake ? chip('bg-[#00F296]/20 border-[#00F296] text-[#00F296]', 'fa-check', stake === 'squad' ? 'In the squad' : "You're in") : '';
    const middle = m.status === 'final' && m.score && n === 2
        ? `<div class="text-2xl font-black text-white px-1">${esc(m.score[slots[0]?.teamId] ?? 0)} - ${esc(m.score[slots[1]?.teamId] ?? 0)}</div>` : vsBadge(n === 2 ? 46 : 30);
    return `<div id="vs-card-${esc(m.id)}" data-vs-time="${esc(m.time || '')}" onclick="openVsMatch('${jsq(m.id)}')" class="relative bg-[#010A0F]/90 rounded-2xl overflow-hidden shadow-xl border-[1.6px] border-fuchsia-500/60 hover:border-fuchsia-400 transition cursor-pointer p-4 space-y-3">
        <div class="absolute inset-0 pointer-events-none opacity-25" style="background:radial-gradient(circle at 50% 38%, #E8262B 0%, transparent 55%)"></div>
        <div class="relative z-10 space-y-3">
            <div class="flex justify-center"><div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 border border-fuchsia-400/60 text-fuchsia-200 text-[10px] font-black">${vsBadge(16)}<span>VS MODE${m.status === 'challenge' ? ' · CHALLENGE' : ''}</span></div></div>
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5 bg-black/50 px-2.5 py-1 rounded-xl border border-[#00B4AE]/80 text-white text-[10px] font-bold"><i class="fa-solid fa-users text-[10px]"></i><span>${esc(m.format || '7v7')} • ${n} Teams</span></div>
                <div class="flex items-center gap-1 bg-black/50 px-2.5 py-1 rounded-xl border ${price ? 'border-[#00F296]/80' : 'border-[#00B4AE]/80'} text-white text-[10px] font-bold"><i class="fa-solid ${price ? 'fa-circle-dollar-to-slot' : 'fa-tag'} text-[10px]"></i><span>${price ? money(price) + ' per team' : 'Free'}</span></div>
            </div>
            <h3 class="text-base font-bold text-white tracking-tight line-clamp-1">${esc(vsTitleOf(m))}</h3>
            <div class="flex items-center justify-center gap-2">${n === 2 ? `${slotHtml(slots[0])}${middle}${slotHtml(slots[1])}` : slots.map(s => slotHtml(s, 36)).join(vsBadge(24))}</div>
            <div class="space-y-1.5 text-[11px] font-medium text-white/90">
                <div class="flex items-center gap-2"><i class="fa-solid fa-calendar text-[#00F296] w-3.5"></i><span>${esc((window.fmtGameDate || prettyDate)(m.date || ''))}</span></div>
                <div class="flex items-center gap-2"><i class="fa-solid fa-clock text-[#00F296] w-3.5"></i><span>${esc(prettyTime(m.time))}</span></div>
                <div class="flex items-center gap-2"><i class="fa-solid fa-location-dot text-[#00F296] w-3.5"></i><span class="truncate">${esc(m.location || '')}</span></div>
            </div>
            <div class="border-t border-white/10 pt-2.5 flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                    <img src="${esc(organizerAvatar(m))}" onerror="this.src='${DEFAULT_AV}'" class="w-6 h-6 rounded-full object-cover border border-[#00F296]/60 shrink-0">
                    <div class="min-w-0"><div class="text-[7px] font-bold text-white/60 uppercase leading-none">BY</div><div class="text-[10px] font-bold text-white truncate">${esc(m.organizerName || 'Organizer')}</div></div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">${mine}${status}</div>
            </div>
        </div>
    </div>`;
}
window.vsCardHtml = vsCardHtml;
/** VS matches go in the Games list in time order, between the normal games. */
function wrapEvents() {
    const orig = window.renderEvents;
    if (typeof orig !== 'function' || orig._vs) return;
    const w = function () {
        orig.apply(this, arguments);
        const grid = document.getElementById('events-grid'); if (!grid) return;
        const day = window.selectedDateStr;
        const list = V.list.filter(m => (m.date || '') === day && m.status !== 'declined').sort((a, b) => String(a.time).localeCompare(String(b.time)));
        if (!list.length) return;
        if (grid.querySelector('.fa-calendar-xmark') || grid.querySelector('.fa-spin')) { grid.innerHTML = list.map(vsCardHtml).join(''); return; }
        const timeOf = new Map((window.eventsList || []).map(ev => [String(ev.id), String(ev.time || '')]));
        list.forEach(m => {
            const next = [...grid.querySelectorAll('[id^="event-card-"]')].find(c => timeOf.get(c.id.slice(11)) > String(m.time || ''));
            if (next) next.insertAdjacentHTML('beforebegin', vsCardHtml(m)); else grid.insertAdjacentHTML('beforeend', vsCardHtml(m));
        });
    };
    w._vs = true; window.renderEvents = w;
}
window.__vsWrapEvents = wrapEvents;
setTimeout(wrapEvents, 0); setTimeout(wrapEvents, 1500);

// ---------------------------------------------------------------- shared sheet
function sheet(id, title, body) {
    document.getElementById(id)?.remove();
    const m = document.createElement('div');
    m.id = id;
    m.className = 'fixed inset-0 z-[170] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-md sm:p-4';
    m.innerHTML = `<div class="bg-[#040E13] border border-fuchsia-500/40 rounded-t-3xl sm:rounded-3xl w-full max-w-md overflow-y-auto shadow-2xl text-white" style="max-height:92dvh">
        <div class="flex items-center justify-between px-5 pt-5 pb-2 sticky top-0 bg-[#040E13] z-10">
            <div class="text-base font-black">${title}</div>
            <button onclick="document.getElementById('${id}').remove()" class="w-8 h-8 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-xmark text-xs"></i></button>
        </div>
        <div class="p-5 pt-2 space-y-4">${body}</div></div>`;
    document.body.appendChild(m);
    return m;
}
const val = (id) => String(document.getElementById(id)?.value || '').trim();
const seg = (name, opts, cur) => `<div class="flex flex-wrap gap-1.5" data-seg="${name}">${opts.map(([k, l]) => `<button type="button" data-v="${esc(k)}" onclick="this.parentNode.querySelectorAll('button').forEach(b=>b.dataset.on='');this.dataset.on='1';this.parentNode.querySelectorAll('button').forEach(b=>b.className=b.dataset.on?'px-3 py-2 rounded-xl text-[11px] font-black bg-[#00F296] text-slate-950':'px-3 py-2 rounded-xl text-[11px] font-black bg-white/5 border border-white/10')" data-on="${String(cur) === String(k) ? '1' : ''}" onmouseup="setTimeout(()=>window.__vsSeg&&__vsSeg('${name}'),0)" ontouchend="setTimeout(()=>window.__vsSeg&&__vsSeg('${name}'),0)" class="px-3 py-2 rounded-xl text-[11px] font-black ${String(cur) === String(k) ? 'bg-[#00F296] text-slate-950' : 'bg-white/5 border border-white/10'}">${l}</button>`).join('')}</div>`;
const segVal = (name) => { const b = document.querySelector(`[data-seg="${name}"] [data-on="1"]`); return b ? b.dataset.v : ''; };
const toggle = (id, label, sub, on) => `<label class="flex items-center justify-between gap-3 bg-white/5 rounded-xl px-3 py-2.5 cursor-pointer">
    <span><span class="block text-xs font-bold">${label}</span><span class="block text-[10px] text-white/55">${sub}</span></span>
    <input id="${id}" type="checkbox" ${on ? 'checked' : ''} class="w-5 h-5 accent-[#00F296]"></label>`;
function teamPicker(name, teams, cur) {
    return `<div class="space-y-1.5" data-seg="${name}">${teams.map(t => `<button type="button" data-v="${esc(t.id)}" data-on="${t.id === cur ? '1' : ''}"
        onclick="this.parentNode.querySelectorAll('button').forEach(b=>{b.dataset.on='';b.classList.remove('border-[#00F296]','bg-[#00F296]/10')});this.dataset.on='1';this.classList.add('border-[#00F296]','bg-[#00F296]/10');setTimeout(()=>window.__vsSeg&&__vsSeg('${name}'),0)"
        class="w-full flex items-center gap-3 rounded-xl px-3 py-2 border ${t.id === cur ? 'border-[#00F296] bg-[#00F296]/10' : 'border-white/10 bg-white/5'}">${teamLogoHtml(t, 30)}<span class="text-sm font-black truncate">${esc(t.name)}</span></button>`).join('')}</div>`;
}

// ---------------------------------------------------------------- where: park (suggestions like a normal game), city, state
function whereFields(p, pre) {
    setTimeout(() => attachParkPicker({ input: `${p}-park`, city: `${p}-city`, state: `${p}-state` }), 0);
    return `<div>${LBL('Park / field *')}<div><input id="${p}-park" class="${INPUT}" maxlength="60" value="${esc(pre.park || (pre.location && !pre.park ? pre.location : '') || '')}" placeholder="Start typing a park name"></div></div>
        <div class="flex gap-3">
            <div class="flex-1">${LBL('City *')}<input id="${p}-city" class="${INPUT}" maxlength="40" value="${esc(pre.city || '')}" placeholder="City"></div>
            <div class="w-24">${LBL('State')}<input id="${p}-state" class="${INPUT}" maxlength="20" value="${esc(pre.state || 'FL')}" placeholder="FL"></div>
        </div>`;
}
function readWhere(p) {
    const park = val(`${p}-park`), city = val(`${p}-city`), state = val(`${p}-state`) || 'FL';
    if (!park || !city) return null;
    saveParkIfNew(park, city, state);   // new field? it's suggested next time (same list as normal games)
    return { park, city, state, location: `${park} (${city}, ${state})` };
}

// ---------------------------------------------------------------- Create VS Match (the + menu)
window.openCreateVs = function (prefill = {}) {
    if (!myUid()) return;
    const mine = myCaptainTeams();
    const t0 = prefill.teamId || (mine[0] && mine[0].id) || '';
    window._vsPrefill = prefill;
    const inc = prefill.include === true || (prefill.include !== false && mine.length > 0) ? 'yes' : 'no';
    const teamPart = mine.length > 1 ? `${LBL('Which team?')}${teamPicker('vs-team', mine, t0)}`
        : mine.length === 1 ? `<div class="flex items-center gap-3 rounded-xl px-3 py-2 border border-[#00F296] bg-[#00F296]/10">${teamLogoHtml(mine[0], 30)}<span class="text-sm font-black truncate">${esc(mine[0].name)}</span></div><input type="hidden" id="vs-one-team" value="${esc(t0)}">`
        : `<div class="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2"><p class="text-[11px] text-white/65">You don't have a team yet. Make one in a minute, then come right back here.</p>
            <button type="button" onclick="vsCreateTeamFirst()" class="${BTN} w-full">+ Create a team</button></div>`;
    sheet('vs-create', prefill.rematchOf ? '🔁 Rematch' : `<span class="flex items-center gap-2">${vsBadge(30)} Create VS Match</span>`, `
        <div class="space-y-2">${LBL('Involve a team?')}
            ${seg('vs-include', [['yes', 'Yes, my team plays'], ['no', 'No, I just organize']], inc)}
            <div id="vs-team-wrap" style="${inc === 'no' ? 'display:none' : ''}">${teamPart}</div></div>
        <div>${LBL('Name (optional)')}<input id="vs-title" class="${INPUT}" maxlength="50" value="${esc(prefill.title || '')}" placeholder="e.g. Sunday Showdown"></div>
        <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0">${LBL('Date *')}<input id="vs-date" type="date" class="${INPUT}" value="${esc(prefill.date || '')}"></div>
            <div class="min-w-0">${LBL('Time *')}<input id="vs-time" type="time" class="${INPUT}" value="${esc(prefill.time || '')}"></div>
        </div>
${whereFields('vs', prefill)}
        <div>${LBL('Format')}${seg('vs-format', SIZES.map(s => [s, s]), prefill.format || '7v7')}</div>
        <div>${LBL('How many teams?')}${seg('vs-count', [['2', '2 teams'], ['3', '3 teams'], ['4', '4 teams']], String(prefill.teamsCount || 2))}</div>
        <div>${LBL('Level')}${seg('vs-level', LEVELS, prefill.level || 'casual')}</div>
        <div>${LBL('Price per team ($, 0 = free)')}<input id="vs-price" inputmode="decimal" class="${INPUT}" value="${esc(prefill.priceCents ? (prefill.priceCents / 100) : '')}" placeholder="0"></div>
        ${toggle('vs-squads', '🧩 Free agents can form a squad', "Players without a team can sign up. If enough join for a full team before the spots fill, they play as a temporary squad.", prefill.squadsOn !== false)}
        <details class="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <summary class="text-xs font-black cursor-pointer py-1">Payment & roster settings</summary>
            <div class="space-y-2 pt-2">
                ${toggle('vs-first', 'First to pay is in', 'Spots go to the first teams that pay in full', prefill.firstToPay !== false)}
                ${toggle('vs-partial', 'Take partial payments', 'Players can chip in; the bar fills up', prefill.partial === true)}
                <div>${LBL('Pay by')}${seg('vs-payby', [['0', 'Kickoff'], ['12', '12h before'], ['24', '24h before'], ['48', '48h before']], String(prefill.payByHours ?? 24))}</div>
                <div>${LBL('Lock rosters')}${seg('vs-lock', [['0', 'Never'], ['1', '1h before'], ['2', '2h before'], ['24', '24h before']], String(prefill.rosterLockHours ?? 0))}</div>
            </div>
        </details>
        <button id="vs-save" onclick="saveCreateVs()" class="${BTN} w-full py-3 text-sm">Create match</button>`);
};
// "No, I just organize": hide the team part. Challenge form: re-check the time.
window.__vsSeg = (name) => {
    if (name === 'vs-include') { const w = document.getElementById('vs-team-wrap'); if (w) w.style.display = segVal('vs-include') === 'no' ? 'none' : ''; }
    if (name === 'ch-team' && window.__chOverlap) window.__chOverlap();
};
/** What's typed in the Create VS form (to come back to it after making a team). */
function vsFormNow() {
    return { title: val('vs-title'), date: val('vs-date'), time: val('vs-time'), park: val('vs-park'), city: val('vs-city'), state: val('vs-state'),
        format: segVal('vs-format'), teamsCount: parseInt(segVal('vs-count'), 10) || 2, level: segVal('vs-level'),
        priceCents: Math.round((parseFloat(val('vs-price').replace(',', '.')) || 0) * 100), squadsOn: !!document.getElementById('vs-squads')?.checked };
}
window.vsCreateTeamFirst = function () {
    const pre = { ...(window._vsPrefill || {}), ...vsFormNow(), include: true };
    document.getElementById('vs-create')?.remove();
    window.__afterTeamCreated = (teamId) => {
        let tries = 0;
        const back = () => {
            if (myCaptainTeams().some(t => t.id === teamId) || tries++ > 20) window.openCreateVs({ ...pre, teamId });
            else setTimeout(back, 250);
        };
        setTimeout(back, 150);
    };
    window.openCreateTeam && window.openCreateTeam();
};
window.saveCreateVs = async function () {
    const date = val('vs-date'), time = val('vs-time');
    const where = readWhere('vs');
    if (!date || !time || !where) { toast('Fill in the date, time, park and city.', 'error'); return; }
    const location = where.location;
    const include = segVal('vs-include') === 'yes';
    const teamId = segVal('vs-team') || val('vs-one-team');
    const mine = myCaptainTeams().find(t => t.id === teamId);
    if (include && !mine) { toast(myCaptainTeams().length ? 'Pick your team.' : 'Create your team first, or pick "No, I just organize".', 'error'); return; }
    const price = Math.round((parseFloat(val('vs-price').replace(',', '.')) || 0) * 100);
    const pre = window._vsPrefill || {};
    const teams = [];
    if (include) teams.push(teamEntry(mine, price > 0 ? 'pending' : 'confirmed'));
    // Rematch: the teams from last time are invited back (they hold their spot until they answer).
    (pre.inviteTeams || []).forEach(t => { if (!teams.some(x => x.teamId === t.teamId)) teams.push({ ...t, state: 'invited', roster: [], joinedAt: Date.now() }); });
    const m = {
        title: val('vs-title'), date, time, location, park: where.park, city: where.city, state: where.state, format: segVal('vs-format') || '7v7', level: segVal('vs-level') || 'casual',
        teamsCount: parseInt(segVal('vs-count'), 10) || 2, priceCents: price,
        firstToPay: !!document.getElementById('vs-first')?.checked, partial: !!document.getElementById('vs-partial')?.checked,
        payByHours: parseInt(segVal('vs-payby'), 10) || 0, rosterLockHours: parseInt(segVal('vs-lock'), 10) || 0,
        squadsOn: !!document.getElementById('vs-squads')?.checked, forming: [],
        organizerId: myUid(), organizerName: myName(), organizerAvatar: myAvatar(), status: 'open', teams, teamIds: teams.map(t => t.teamId), payments: [],
        rematchOf: pre.rematchOf || '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    try {
        const ref = doc(C('vsMatches'));
        await setDoc(ref, settle(m));
        document.getElementById('vs-create')?.remove();
        window.closeCreateActionSheet && window.closeCreateActionSheet();
        toast('VS Match created!');
        window.openVsMatch(ref.id, m);
    } catch (e) { console.error(e); toast("Couldn't create the match.", 'error'); }
};

// ---------------------------------------------------------------- busy at that time? (same day, within 2 hours)
const minutesOf = (hm) => { const [h, mi] = String(hm || '').split(':').map(Number); return isNaN(h) ? null : h * 60 + (mi || 0); };
/** Games a team already has around that day/time: its schedule and its VS matches. */
export function busyAt(team, date, time, skipMatchId = '') {
    if (!team || !date) return [];
    const t0 = minutesOf(time);
    const near = (d, hm) => d === date && (t0 == null || minutesOf(hm) == null || Math.abs(minutesOf(hm) - t0) < 120);
    const out = [];
    (team.schedule || []).forEach(g => { if (near(g.date, g.time)) out.push({ what: `vs ${g.opponent || 'another team'}`, time: g.time }); });
    V.list.forEach(m => {
        if (m.id === skipMatchId || !['open', 'challenge'].includes(m.status) || !(m.teamIds || []).includes(team.id)) return;
        if (near(m.date, m.time)) out.push({ what: vsTitleOf(m), time: m.time });
    });
    return out;
}
function busyNote(team, list, mine) {
    if (!list.length) return '';
    const g = list[0];
    return `<div class="bg-amber-400/10 border border-amber-400/40 rounded-xl p-3 text-[11px] text-amber-100 leading-relaxed">⚠️ <b>Heads up:</b> ${mine ? 'your team' : esc(team.name)} already ${mine ? 'has' : 'has'} a game around then (${esc(g.what)}${g.time ? ' · ' + esc(prettyTime(g.time)) : ''}).
        ${mine ? 'Make sure you can make both.' : "You can still send the challenge, but they'll probably say no. Try another time?"}</div>`;
}

// ---------------------------------------------------------------- Challenge (from another team's page)
export function challengeButtonHtml(t) {
    const mine = myCaptainTeams().filter(x => x.id !== t.id);
    if (!mine.length) return '';
    return `<button onclick="openChallenge('${jsq(t.id)}')" class="w-full py-3 rounded-xl text-sm font-black text-white bg-gradient-to-r from-red-600 to-fuchsia-600 flex items-center justify-center gap-2">${vsBadge(26)} Challenge ${esc(t.name)}</button>`;
}
window.openChallenge = function (teamId) {
    const target = (TS().all || []).find(x => x.id === teamId) || (window.__teamsState && window.__teamsState.open) || null;
    const mine = myCaptainTeams().filter(x => x.id !== teamId);
    if (!target || !mine.length) return;
    window.__chOverlap = () => {
        const box = document.getElementById('ch-overlap'); if (!box) return;
        const date = val('ch-date'), time = val('ch-time');
        const me = mine.find(t => t.id === (segVal('ch-team') || val('ch-one-team'))) || mine[0];
        box.innerHTML = busyNote(target, busyAt(target, date, time), false) + busyNote(me, busyAt(me, date, time), true);
    };
    sheet('vs-challenge', `<span class="flex items-center gap-2">${vsBadge(30)} Challenge ${esc(target.name)}</span>`, `
        <div class="flex items-center justify-center gap-3">${teamLogoHtml(mine[0], 56)}${vsBadge(52)}${teamLogoHtml(target, 56)}</div>
        ${mine.length > 1 ? `<div>${LBL('Your team')}${teamPicker('ch-team', mine, mine[0].id)}</div>` : `<input type="hidden" id="ch-one-team" value="${esc(mine[0].id)}">`}
        <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0">${LBL('Date *')}<input id="ch-date" type="date" class="${INPUT}" onchange="__chOverlap()"></div>
            <div class="min-w-0">${LBL('Time *')}<input id="ch-time" type="time" class="${INPUT}" onchange="__chOverlap()"></div>
        </div>
        <div id="ch-overlap" class="space-y-2"></div>
${whereFields('ch', {})}
        <div>${LBL('Format')}${seg('ch-format', SIZES.map(s => [s, s]), '7v7')}</div>
        <div>${LBL('How many teams?')}${seg('ch-count', [['2', '2 teams'], ['3', '3 teams'], ['4', '4 teams']], '2')}
            <p class="text-[10px] text-white/45 mt-1">More than 2: the other spots are open for any team to join.</p></div>
        <div>${LBL('Price per team ($, 0 = free)')}<input id="ch-price" inputmode="decimal" class="${INPUT}" placeholder="0"></div>
        <div>${LBL('Message (optional)')}<input id="ch-msg" class="${INPUT}" maxlength="140" placeholder="e.g. Rematch from last week? 😤"></div>
        <button onclick="sendChallenge('${jsq(teamId)}')" class="w-full py-3 rounded-xl text-sm font-black text-white bg-gradient-to-r from-red-600 to-fuchsia-600">Send challenge</button>`);
};
window.sendChallenge = async function (targetId) {
    const target = (TS().all || []).find(x => x.id === targetId) || (window.__teamsState && window.__teamsState.open);
    const mine = myCaptainTeams().find(t => t.id === (segVal('ch-team') || val('ch-one-team')));
    const date = val('ch-date'), time = val('ch-time');
    const where = readWhere('ch');
    if (!target || !mine) return;
    if (!date || !time || !where) { toast('Fill in the date, time, park and city.', 'error'); return; }
    const location = where.location;
    const price = Math.round((parseFloat(val('ch-price').replace(',', '.')) || 0) * 100);
    const teams = [teamEntry(mine, price > 0 ? 'pending' : 'confirmed'), teamEntry(target, 'invited')];
    const m = {
        title: '', date, time, location, park: where.park, city: where.city, state: where.state, format: segVal('ch-format') || '7v7', level: target.level || mine.level || 'casual',
        teamsCount: parseInt(segVal('ch-count'), 10) || 2,
        priceCents: price, firstToPay: false, partial: false, payByHours: price > 0 ? 24 : 0, rosterLockHours: 0, squadsOn: true, forming: [],
        organizerId: myUid(), organizerName: myName(), organizerAvatar: myAvatar(), status: 'challenge', message: val('ch-msg'),
        challenge: { fromTeamId: mine.id, toTeamId: target.id, status: 'pending' },
        teams, teamIds: teams.map(t => t.teamId), payments: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    try {
        await setDoc(doc(C('vsMatches')), m);
        document.getElementById('vs-challenge')?.remove();
        toast(`Challenge sent to ${target.name}! Their captains will get a notification.`);
    } catch (e) { console.error(e); toast("Couldn't send the challenge.", 'error'); }
};

// ---- "Suggest another time": the challenged captain sends it back with a new day/time
window.openCounterChallenge = function (matchId) {
    const m = V.list.find(x => x.id === matchId) || V.open; if (!m || !m.challenge) return;
    const me = (TS().mine || []).find(t => t.id === m.challenge.toTeamId);
    window.__chOverlap = () => {
        const box = document.getElementById('ch-overlap'); if (!box) return;
        const other = (TS().all || []).find(t => t.id === m.challenge.fromTeamId);
        box.innerHTML = busyNote(me, busyAt(me, val('ct-date'), val('ct-time'), m.id), true) + (other ? busyNote(other, busyAt(other, val('ct-date'), val('ct-time'), m.id), false) : '');
    };
    sheet('vs-counter', 'Suggest another time', `
        <p class="text-[11px] text-white/60">They get a notification and can accept the new time or decline.</p>
        <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0">${LBL('Date *')}<input id="ct-date" type="date" class="${INPUT}" value="${esc(m.date || '')}" onchange="__chOverlap()"></div>
            <div class="min-w-0">${LBL('Time *')}<input id="ct-time" type="time" class="${INPUT}" value="${esc(m.time || '')}" onchange="__chOverlap()"></div>
        </div>
        <div id="ch-overlap" class="space-y-2"></div>
        <div>${LBL('Message (optional)')}<input id="ct-msg" class="${INPUT}" maxlength="140" placeholder="e.g. Can't do Saturday, how about Sunday?"></div>
        <button onclick="sendCounterChallenge('${jsq(matchId)}')" class="${BTN} w-full py-3">Send new time</button>`);
};
window.sendCounterChallenge = async function (matchId) {
    const date = val('ct-date'), time = val('ct-time');
    if (!date || !time) { toast('Pick the date and time.', 'error'); return; }
    try {
        await changeMatch(matchId, (m) => {
            if (!m.challenge || m.challenge.status !== 'pending') return false;
            const team = (TS().mine || []).find(t => t.id === m.challenge.toTeamId);
            if (!team || !canManage(team)) throw new Error('NOT_CAPTAIN');
            const price = +m.priceCents || 0;
            const from = m.teams.find(t => t.teamId === m.challenge.fromTeamId), to = m.teams.find(t => t.teamId === m.challenge.toTeamId);
            if (to) to.state = price > 0 ? 'pending' : 'confirmed';
            if (from) from.state = 'invited';
            m.challenge = { fromTeamId: m.challenge.toTeamId, toTeamId: m.challenge.fromTeamId, status: 'pending', counter: (m.challenge.counter || 0) + 1 };
            m._edit = { date, time, message: val('ct-msg') || m.message || '' };
        });
        document.getElementById('vs-counter')?.remove();
        toast('New time sent! They can accept it or decline.');
    } catch (e) { toast(String(e && e.message) === 'NOT_CAPTAIN' ? "Only that team's captains can answer." : "Couldn't send it.", 'error'); }
};

/** Challenges waiting for one of my teams (shown on the Teams tab and on that team's page). */
export function pendingChallengesFor(teamIds) {
    const set = new Set(teamIds);
    return V.list.filter(m => m.status === 'challenge' && m.challenge && m.challenge.status === 'pending' && set.has(m.challenge.toTeamId));
}
export function challengesHtml(teamIds) {
    const list = pendingChallengesFor(teamIds);
    if (!list.length) return '';
    return `<div class="text-[10px] font-black text-fuchsia-300 uppercase tracking-wider">Challenges (${list.length})</div>
        <div class="space-y-2">${list.map(m => {
            const from = (m.teams || []).find(t => t.teamId === m.challenge.fromTeamId) || {};
            const to = (m.teams || []).find(t => t.teamId === m.challenge.toTeamId) || {};
            const mineTo = (TS().mine || []).find(t => t.id === m.challenge.toTeamId);
            const busy = busyAt(mineTo, m.date, m.time, m.id);
            return `<div class="bg-fuchsia-500/10 border border-fuchsia-400/40 rounded-2xl p-3 space-y-2">
                <div class="flex items-center gap-3">${teamLogoHtml(from, 40)}<div class="flex-1 min-w-0">
                    <div class="text-sm font-black truncate">${m.challenge.counter ? `${esc(from.name)} suggested a new time` : `${esc(from.name)} challenged ${esc(to.name)}`}</div>
                    <div class="text-[11px] text-white/65">${esc(prettyDate(m.date))} · ${esc(prettyTime(m.time))} · ${esc(m.location)} · ${esc(m.format)}${(+m.priceCents || 0) > 0 ? ' · ' + money(m.priceCents) + ' per team' : ''}</div>
                    ${m.message ? `<div class="text-[11px] text-white/80 italic">"${esc(m.message)}"</div>` : ''}</div></div>
                ${busy.length ? `<div class="text-[11px] text-amber-200">⚠️ You already have a game around then (${esc(busy[0].what)}${busy[0].time ? ' · ' + esc(prettyTime(busy[0].time)) : ''}).</div>` : ''}
                <div class="grid grid-cols-3 gap-2"><button onclick="answerChallenge('${jsq(m.id)}', false)" class="${DARK}">Decline</button>
                    <button onclick="openVsMatch('${jsq(m.id)}')" class="${DARK}">Details</button>
                    <button onclick="answerChallenge('${jsq(m.id)}', true)" class="${BTN}">Accept</button></div>
                <button onclick="openCounterChallenge('${jsq(m.id)}')" class="w-full text-[11px] font-black text-[#00F296] py-1"><i class="fa-regular fa-clock mr-1"></i>Suggest another time</button>
            </div>`;
        }).join('')}</div>`;
}
window.vsChallengesHtml = challengesHtml;
window.vsChallengeButtonHtml = challengeButtonHtml;

window.answerChallenge = async function (matchId, yes) {
    try {
        await changeMatch(matchId, (m) => {
            if (!m.challenge || m.challenge.status !== 'pending') return false;
            const to = m.teams.find(t => t.teamId === m.challenge.toTeamId);
            const team = (TS().mine || []).find(t => t.id === m.challenge.toTeamId);
            if (!to || !team || !canManage(team)) throw new Error('NOT_CAPTAIN');
            m.challenge.status = yes ? 'accepted' : 'declined';
            m.challenge.answeredBy = myUid();
            if (yes) { to.state = (+m.priceCents || 0) > 0 ? 'pending' : 'confirmed'; m.status = 'open'; settle(m); }
            else m.status = 'declined';
        });
        toast(yes ? "Challenge accepted! It's on both schedules." : 'Challenge declined.');
    } catch (e) { console.error(e); toast(String(e && e.message) === 'NOT_CAPTAIN' ? "Only that team's captains can answer." : "Couldn't answer the challenge.", 'error'); }
};

// ---------------------------------------------------------------- one transaction per change
async function changeMatch(id, fn) {
    await runTransaction(db, async (tx) => {
        const ref = D('vsMatches', id);
        const s = await tx.get(ref);
        if (!s.exists()) throw new Error('GONE');
        const m = s.data();
        m.teams = (m.teams || []).map(t => ({ ...t, roster: [...(t.roster || [])] }));
        m.payments = [...(m.payments || [])];
        if (fn(m) === false) return;
        m.teamIds = m.teams.map(t => t.teamId);
        tx.update(ref, { teams: m.teams, teamIds: m.teamIds, payments: m.payments, status: m.status, challenge: m.challenge || null,
            score: m.score || null, forfeit: m.forfeit || '', forming: m.forming || [], updatedBy: myUid(), updatedAt: serverTimestamp(),
            ...(m._edit || {}) });
    });
}

// ---------------------------------------------------------------- the match page (laid out like a normal game page)
window.openVsMatch = function (id, initial) {
    if (V.open && V.open.id !== id) stopComments();
    V.open = V.list.find(m => m.id === id) || (initial ? { ...initial, id } : { id, teams: [] });
    if (!V.list.find(m => m.id === id)) getDoc(D('vsMatches', id)).then(s => { if (s.exists() && V.open && V.open.id === id) { V.open = { ...s.data(), id }; drawPage(); } }).catch(() => {});
    V.tab = (initial && initial.tab) || 'info';
    watchComments(id);
    drawPage();
};
window.closeVsMatch = function () { stopComments(); V.open = null; document.getElementById('vs-page')?.remove(); };
window.vsTab = (k) => { V.tab = k; drawPage(); if (k === 'comments') setTimeout(() => { const b = document.getElementById('vs-comments-end'); b && b.scrollIntoView({ block: 'end' }); }, 0); };

// Teams that aren't mine (temporary squads especially): load their roster names once.
const teamCache = {};
function teamFull(teamId) {
    const t = (TS().mine || []).find(x => x.id === teamId) || (TS().all || []).find(x => x.id === teamId) || teamCache[teamId];
    if (!t && !(teamId in teamCache)) {
        teamCache[teamId] = null;
        getDoc(D('teams', teamId)).then(s => { if (s.exists()) { teamCache[teamId] = { ...s.data(), id: teamId }; if (V.open) drawPage(); } }).catch(() => {});
    }
    return t || null;
}

function drawPage() {
    const m = V.open; if (!m) return;
    let el = document.getElementById('vs-page');
    if (!el) { el = document.createElement('div'); el.id = 'vs-page'; el.dataset.close = 'closeVsMatch'; el.className = 'fixed inset-0 z-[135] bg-[#01060A]/95 backdrop-blur-sm overflow-y-auto text-white'; document.body.appendChild(el); }
    const boss = m.organizerId === myUid();
    const n = m.teamsCount || 2;
    const price = +m.priceCents || 0;
    const shown = (m.teams || []);
    const mineCap = allMyCaptainTeams();
    const myEntry = shown.find(t => mineCap.some(x => x.id === t.teamId));
    const canJoin = m.status === 'open' && !myEntry && myCaptainTeams().length && (!isFull(m) || m.firstToPay !== false);
    const live = m.status === 'open' || m.status === 'challenge';
    const conf = confirmedTeams(m);
    const clash = conf.length >= 2 && colorsClash((conf[0].colors || {}).primary, (conf[1].colors || {}).primary);
    if (V.tab === 'admin' && !boss) V.tab = 'info';
    const tab = V.tab || 'info';
    const stateChip = (t) => t.state === 'confirmed' ? '<span class="text-[9px] font-black rounded-full px-2 py-1 bg-[#00F296] text-slate-950">CONFIRMED</span>'
        : t.state === 'invited' ? '<span class="text-[9px] font-black rounded-full px-2 py-1 bg-fuchsia-500/30 text-fuchsia-200">INVITED</span>'
        : `<span class="text-[9px] font-black rounded-full px-2 py-1 bg-amber-400/20 text-amber-300">${isFull(m) && m.firstToPay !== false ? 'SPOTS FULL' : 'PENDING'}</span>`;
    const teamRow = (t) => {
        const paid = paidCents(m, t.teamId);
        const pct = price ? Math.min(100, Math.round(paid * 100 / price)) : 100;
        const iCap = mineCap.some(x => x.id === t.teamId);
        const full = teamFull(t.teamId);
        const roster = (t.roster || []).map(id => ((full && full.members) || []).find(p => p.id === id)).filter(Boolean);
        return `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2">
            <div class="flex items-center gap-3"><button onclick="vsOpenTeam('${jsq(t.teamId)}')" class="shrink-0">${teamLogoHtml(t, 42)}</button>
                <div class="flex-1 min-w-0"><div class="text-sm font-black truncate">${esc(t.name)}${full && full.temp ? ' <span class="text-[9px] font-black rounded-full px-1.5 py-0.5 bg-fuchsia-500/30 text-fuchsia-100 align-middle">SQUAD</span>' : ''}</div>
                ${price ? `<div class="text-[11px] text-white/60">${money(paid)} of ${money(price)} paid</div>` : ''}</div>${stateChip(t)}</div>
            ${price ? `<div class="h-2 rounded-full bg-white/10 overflow-hidden"><div class="h-full ${pct >= 100 ? 'bg-[#00F296]' : 'bg-amber-400'}" style="width:${pct}%"></div></div>` : ''}
            ${roster.length ? `<div class="flex flex-wrap gap-1">${roster.map(p => `<span class="text-[10px] font-bold rounded-full px-2 py-1 bg-white/10">${p.number ? esc(p.number) + ' · ' : ''}${esc(p.name)}</span>`).join('')}</div>` : ''}
            <div class="flex flex-wrap gap-2">
                ${iCap && live && t.state !== 'invited' ? `<button onclick="openVsRoster('${jsq(t.teamId)}')" class="${DARK}" ${rosterLocked(m) ? 'disabled' : ''}>${rosterLocked(m) ? '🔒 Roster locked' : `Pick who's coming (${(t.roster || []).length})`}</button>` : ''}
                ${full && full.temp && (full.memberUids || []).includes(myUid()) ? `<button onclick="vsSquadChat('${jsq(t.teamId)}')" class="${DARK}"><i class="fa-solid fa-comments mr-1"></i>Squad chat</button>` : ''}
                ${boss && live && price && t.state !== 'invited' && paid < price ? `<button onclick="openVsPayment('${jsq(t.teamId)}')" class="${BTN}">💵 Got a payment</button>` : ''}
                ${iCap && live && m.challenge && m.challenge.toTeamId === t.teamId && m.challenge.status === 'pending' ? `<button onclick="answerChallenge('${jsq(m.id)}', true)" class="${BTN}">Accept</button><button onclick="openCounterChallenge('${jsq(m.id)}')" class="${DARK}">Another time</button><button onclick="answerChallenge('${jsq(m.id)}', false)" class="${DARK}">Decline</button>` : ''}
                ${t.state === 'invited' && iCap && !m.challenge ? `<button onclick="answerInvite('${jsq(m.id)}','${jsq(t.teamId)}', true)" class="${BTN}">We're in</button><button onclick="answerInvite('${jsq(m.id)}','${jsq(t.teamId)}', false)" class="${DARK}">Can't make it</button>` : ''}
                ${(iCap || boss) && live && !(m.challenge && m.challenge.fromTeamId === t.teamId && m.challenge.status === 'pending') ? `<button onclick="leaveVs('${jsq(t.teamId)}')" class="text-[11px] font-bold text-red-400 px-2">${boss && !iCap ? 'Remove team' : 'Leave match'}</button>` : ''}
            </div>
        </div>`;
    };
    const slots = Array.from({ length: n }, (_, i) => (shown.filter(t => t.state !== 'invited' || m.status === 'challenge')[i]) || null);
    const scoreMid = m.status === 'final' && m.score && n === 2 && conf.length >= 2
        ? `<div class="text-4xl font-black px-2">${esc(m.score[conf[0].teamId] ?? 0)} - ${esc(m.score[conf[1].teamId] ?? 0)}</div>` : vsBadge(n === 2 ? 70 : 34);
    const statusLine = m.status === 'cancelled' ? '❌ Cancelled' : m.status === 'final' ? `🏁 Final${m.forfeit ? ` · ${esc((shown.find(t => t.teamId === m.forfeit) || {}).name || '')} didn't show` : ''}`
        : m.status === 'challenge' ? 'Challenge · waiting for an answer' : isFull(m) ? '✅ All spots taken' : `${n - spotsTaken(m)} of ${n} spots open`;
    const mapsUrl = m.location ? 'https://maps.apple.com/?q=' + encodeURIComponent(m.location) : '';
    const tabBtn = (k, label) => `<button onclick="vsTab('${k}')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === k ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">${label}</button>`;
    const info = `<div class="space-y-3">
            <div class="bg-black/40 border border-white/10 rounded-2xl p-3 text-xs space-y-2">
                <div class="flex items-center gap-2"><i class="fa-solid fa-calendar text-[#00F296] w-4"></i>${esc((window.fmtGameDate || prettyDate)(m.date))}</div>
                <div class="flex items-center gap-2"><i class="fa-solid fa-clock text-[#00F296] w-4"></i>${esc(prettyTime(m.time))}</div>
                <div class="flex items-center gap-2"><i class="fa-solid fa-location-dot text-[#00F296] w-4"></i><span class="min-w-0">${esc(m.location || '')}</span></div>
                <div class="flex items-center gap-2"><i class="fa-solid fa-users text-[#00F296] w-4"></i>${esc(m.format || '')} · ${n} teams · ${esc(levelLabel(m.level))}</div>
                <div class="flex items-start gap-2"><i class="fa-solid fa-circle-dollar-to-slot text-[#00F296] w-4 mt-0.5"></i><span>${price ? `${money(price)} per team${m.payByHours ? ` · pay by ${esc(new Date(payByMs(m)).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}` : ''}${m.firstToPay !== false ? ' · first to pay is in' : ''}${m.partial ? ' · partial payments OK' : ''}` : 'Free'}</span></div>
                ${m.message ? `<div class="italic text-white/75">"${esc(m.message)}"</div>` : ''}
            </div>
            <div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-2xl p-3">
                <img src="${esc(organizerAvatar(m))}" onerror="this.src='${DEFAULT_AV}'" class="w-10 h-10 rounded-full object-cover border border-[#00F296]/60">
                <div><div class="text-[9px] font-bold text-white/55 uppercase">Organized by</div><div class="text-sm font-black">${esc(m.organizerName || 'Organizer')}</div></div>
            </div>
            ${clash ? `<div class="bg-amber-400/10 border border-amber-400/40 rounded-xl p-3 text-[11px] text-amber-200">👕 Both teams wear similar colors. ${esc(conf[1].name)}, please bring your second color.</div>` : ''}
            ${canJoin ? `<button onclick="openJoinVs()" class="${BTN} w-full py-3 text-sm">Join with my team</button>` : ''}
            ${squadBoxHtml(m)}
        </div>`;
    const teamsTab = `<div class="space-y-2">${shown.map(teamRow).join('') || '<p class="text-xs text-white/45 text-center py-4">No teams yet.</p>'}
            ${(m.forming || []).length ? `<div class="text-[10px] font-black uppercase tracking-wider text-fuchsia-300 pt-2">Free-agent squad forming (${m.forming.length}/${perSideOf(m)})</div>${formingListHtml(m)}` : ''}</div>`;
    const admin = `<div class="space-y-3">
            <p class="text-[11px] text-white/55">You organized this match. Mark payments in the Teams tab ("Got a payment").</p>
            ${live ? `<div class="grid grid-cols-2 gap-2"><button onclick="openVsScore()" class="${BTN}">🏁 Final score</button><button onclick="cancelVs()" class="${DARK} text-red-400">Cancel match</button></div>` : ''}
            ${m.status === 'final' ? `<div class="grid grid-cols-2 gap-2"><button onclick="openVsScore()" class="${DARK}">Fix the score</button><button onclick="rematchVs()" class="${BTN}">🔁 Rematch</button></div>` : ''}
            <div class="text-[10px] font-black uppercase tracking-wider text-white/55">Money</div>
            <div class="bg-black/40 border border-white/10 rounded-2xl p-3 text-xs space-y-1">${shown.filter(t => t.state !== 'invited').map(t => `<div class="flex justify-between gap-2"><span class="truncate">${esc(t.name)}</span><span class="${price && paidCents(m, t.teamId) >= price ? 'text-[#00F296]' : 'text-white/70'} font-bold">${price ? `${money(paidCents(m, t.teamId))} / ${money(price)}` : 'Free'}</span></div>`).join('') || '<span class="text-white/45">No teams yet.</span>'}
                ${price ? `<div class="flex justify-between gap-2 border-t border-white/10 pt-1 font-black"><span>Collected</span><span>${money((m.payments || []).reduce((s, p) => s + (+p.cents || 0), 0))}</span></div>` : ''}</div>
        </div>`;
    el.innerHTML = `<div class="max-w-2xl mx-auto w-full px-4 pt-3 pb-24 space-y-3">
        <div class="bg-[#040E13]/90 backdrop-blur-md border-2 border-fuchsia-500/30 px-4 py-3 rounded-3xl shadow-lg flex items-center justify-between gap-3">
            <button onclick="closeVsMatch()" aria-label="Back" class="w-9 h-9 bg-black/60 hover:bg-black text-white rounded-full flex items-center justify-center border border-white/20 shrink-0"><i class="fa-solid fa-chevron-left text-xs"></i></button>
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2"><h2 class="text-base font-black tracking-tight truncate">${esc(vsTitleOf(m))}</h2>
                    <span class="px-2 py-0.5 bg-fuchsia-500/20 text-fuchsia-200 font-black text-[9px] rounded-full uppercase tracking-wider border border-fuchsia-500/40 shrink-0">VS Mode</span></div>
                <p class="text-xs text-white/60 truncate mt-0.5"><i class="fa-solid fa-location-dot text-[#00F296] mr-1"></i>${esc(m.location || '')}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noopener" aria-label="Navigate" class="w-9 h-9 bg-[#00F296] text-slate-950 rounded-full flex items-center justify-center"><i class="fa-solid fa-location-arrow text-xs"></i></a>` : ''}
                <button onclick="shareVs()" aria-label="Share" class="w-9 h-9 bg-[#00F296] text-slate-950 rounded-full flex items-center justify-center"><i class="fa-solid fa-share-nodes text-xs"></i></button>
            </div>
        </div>
        <div class="relative overflow-hidden bg-[#040E13]/95 border-2 border-fuchsia-500/40 rounded-3xl p-4 shadow-2xl">
            <div class="absolute inset-0 pointer-events-none opacity-30" style="background:radial-gradient(circle at 50% 45%, #E8262B 0%, transparent 60%)"></div>
            <div class="relative flex items-center justify-center gap-2">${n === 2 ? `${slotHtml(slots[0], 72)}${scoreMid}${slotHtml(slots[1], 72)}` : slots.map(x => slotHtml(x, 46)).join(vsBadge(28))}</div>
            <div class="relative text-center text-[11px] font-black text-white/75 mt-2">${statusLine}</div>
        </div>
        <div class="bg-black/40 border-2 border-fuchsia-500/30 p-1.5 rounded-2xl flex items-center gap-1 overflow-x-auto shadow-md">
            ${boss ? tabBtn('admin', '<i class="fa-solid fa-gear mr-1"></i> Admin') : ''}${tabBtn('info', 'Match Info')}${tabBtn('teams', `Teams (${spotsTaken(m)}/${n})`)}${tabBtn('comments', `Comments (${V.comments.length})`)}
        </div>
        <div class="bg-[#040E13]/95 border-2 border-fuchsia-500/30 rounded-3xl p-4 shadow-2xl">
            ${tab === 'admin' ? admin : tab === 'teams' ? teamsTab : tab === 'comments' ? commentsHtml(m) : info}
        </div>
        ${!boss && m.status === 'final' && myEntry ? `<button onclick="appealVs()" class="${DARK} w-full">Appeal the score</button>` : ''}
    </div>`;
}
window.vsOpenTeam = (teamId) => { if (window.openTeam) window.openTeam(teamId); };
window.shareVs = async function () {
    const m = V.open; if (!m) return;
    const text = `${vsTitleOf(m)} · ${prettyDate(m.date)} ${prettyTime(m.time)} at ${m.location || ''} (VS Mode on FutNet)`;
    const url = 'https://futnet.site/';
    try { if (navigator.share) { await navigator.share({ title: vsTitleOf(m), text, url }); return; } } catch (e) { return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Copied! Paste it in WhatsApp or anywhere.'); } catch (e) { /* ignore */ }
};

// ---------------------------------------------------------------- 🧩 free agents form a squad
//   m.squadsOn (organizer's choice), m.forming = [{ uid, name, avatar, position, at }]
//   When it reaches a full team (7 for 7v7) while a spot is open, it becomes a temporary team
//   (teams/{id} with temp: true) that takes a spot like any other team, with its own team chat.
//   If teams fill the spots first, the squad is off (the server tells everyone in it).
function formingListHtml(m) {
    return `<div class="flex flex-wrap gap-1.5">${(m.forming || []).map(p => `<span class="flex items-center gap-1.5 rounded-full bg-white/10 pl-1 pr-2.5 py-1 text-[11px] font-bold">
        <img src="${esc(p.avatar || DEFAULT_AV)}" onerror="this.src='${DEFAULT_AV}'" class="w-5 h-5 rounded-full object-cover">${esc(String(p.name || 'Player'))}${p.position ? ` <span class="text-white/50">${esc(p.position)}</span>` : ''}</span>`).join('')}</div>`;
}
function squadBoxHtml(m) {
    if (!m.squadsOn || m.status !== 'open') return '';
    const need = perSideOf(m);
    const list = m.forming || [];
    const inIt = list.some(p => p.uid === myUid());
    const onTeam = myStake(m) === 'team';
    if (isFull(m) && !inIt) return '';
    const pct = Math.min(100, Math.round(list.length * 100 / need));
    return `<div class="bg-fuchsia-500/10 border border-fuchsia-400/40 rounded-2xl p-3 space-y-2">
        <div class="text-sm font-black">🧩 No team? Join as a free agent</div>
        <p class="text-[11px] text-white/75 leading-relaxed">You only play if <b>${need} free agents</b> sign up <b>before teams take the open spots</b>. When the squad is full, you become a temporary team for this match, with your own group chat to sort out ${(+m.priceCents || 0) > 0 ? `the ${money(m.priceCents)} team fee` : 'the details'}. If teams fill the spots first, the squad is off and nobody pays.</p>
        <div class="flex items-center gap-2"><div class="flex-1 h-2 rounded-full bg-white/10 overflow-hidden"><div class="h-full bg-fuchsia-400" style="width:${pct}%"></div></div><span class="text-[11px] font-black">${list.length}/${need}</span></div>
        ${list.length ? formingListHtml(m) : ''}
        ${!myUid() || onTeam ? '' : inIt ? `<button onclick="leaveVsSquad()" class="${DARK} w-full">Leave the squad</button>`
            : `<button onclick="joinVsSquad()" class="w-full py-3 rounded-xl text-sm font-black text-white bg-gradient-to-r from-fuchsia-600 to-purple-600">Join as a free agent</button>`}
    </div>`;
}
const SQUAD_COLORS = [['#7C3AED', '#FFFFFF'], ['#F97316', '#0B141A'], ['#0EA5E9', '#FFFFFF'], ['#FACC15', '#0B141A'], ['#EC4899', '#FFFFFF'], ['#14B8A6', '#0B141A']];
window.joinVsSquad = async function () {
    const m = V.open; if (!m || !myUid()) return;
    const prof = window.userProfile || {};
    const pos = String(prof.position || prof.preferredPosition || '').slice(0, 12);
    let formed = null;
    try {
        await runTransaction(db, async (tx) => {
            const ref = D('vsMatches', m.id);
            const s = await tx.get(ref);
            if (!s.exists()) throw new Error('GONE');
            const x = s.data();
            if (x.status !== 'open' || !x.squadsOn) throw new Error('CLOSED');
            if (isFull(x)) throw new Error('FULL');
            const forming = [...(x.forming || [])];
            if (forming.some(p => p.uid === myUid())) return;
            forming.push({ uid: myUid(), name: myName(), avatar: myAvatar(), position: pos, at: Date.now() });
            const patch = { forming, updatedBy: myUid(), updatedAt: serverTimestamp() };
            const need = perSideOf(x);
            if (forming.length >= need) {
                // Full squad: it becomes a team for this match.
                const squad = forming.slice(0, need);
                const k = (+x.squadCount || 0) + 1;
                const used = new Set((x.teams || []).map(t => String((t.colors || {}).primary || '').toLowerCase()));
                const [primary, secondary] = SQUAD_COLORS.find(c => !used.has(c[0].toLowerCase())) || SQUAD_COLORS[0];
                const tRef = doc(C('teams'));
                const team = {
                    name: k > 1 ? `Free Agents FC ${k}` : 'Free Agents FC', nameKey: '', short: 'FA', temp: true, forMatchId: m.id, forMatchDate: x.date || '',
                    colors: { primary, secondary }, logo: { type: 'crest', shape: 'shield', style: 'filled', pattern: 'stripes', icon: '🧩', text: 'short', ring: false },
                    level: x.level || 'casual', joinMode: 'invite', city: x.city || '', state: x.state || '', country: '',
                    rosterPrivate: false, lineupPrivate: false, ownerId: squad[0].uid,
                    members: squad.map((p, i) => ({ id: p.uid, uid: p.uid, name: p.name, number: '', position: p.position || '', role: i === 0 ? 'captain' : 'player' })),
                    memberUids: squad.map(p => p.uid), lineups: [], schedule: [], communityIds: [], record: {},
                    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: myUid(),
                };
                tx.set(tRef, team);
                const teams = (x.teams || []).map(t => ({ ...t }));
                const entry = teamEntry({ ...team, id: tRef.id }, (+x.priceCents || 0) > 0 ? 'pending' : 'confirmed');
                entry.roster = squad.map(p => p.uid);
                teams.push(entry);
                const settled = settle({ ...x, teams });
                Object.assign(patch, { forming: forming.slice(need), teams: settled.teams, teamIds: settled.teams.map(t => t.teamId), squadCount: k });
                formed = team.name;
            }
            tx.update(ref, patch);
        });
        toast(formed ? `Squad complete! You're "${formed}". Your squad chat is ready in Chats.` : "You're in the squad! We'll let you know if it fills up.");
    } catch (e) {
        const c = String(e && e.message);
        toast(c === 'FULL' ? 'Sorry, teams took all the spots.' : c === 'CLOSED' ? 'This match is not taking free agents.' : "Couldn't join the squad.", 'error');
    }
};
window.leaveVsSquad = async function () {
    const m = V.open; if (!m) return;
    try { await changeMatch(m.id, (x) => { x.forming = (x.forming || []).filter(p => p.uid !== myUid()); }); toast('You left the squad.'); }
    catch (e) { toast("Couldn't do that.", 'error'); }
};
window.vsSquadChat = function (teamId) {
    window.closeVsMatch();
    setTimeout(() => { if (window.openCommunityChat) window.openCommunityChat('team:' + teamId); }, 120);
};

// ---------------------------------------------------------------- comments (vsMatches/{id}/comments)
V.comments = [];
function watchComments(id) {
    stopComments();
    V.comments = [];
    try {
        V.commentsUnsub = onSnapshot(query(collection(db, 'artifacts', appId, 'vsMatches', id, 'comments'), orderBy('at', 'desc'), limit(100)), s => {
            V.comments = s.docs.map(d => ({ ...d.data(), id: d.id })).reverse();
            if (V.open && V.open.id === id) drawPage();
        }, () => {});
    } catch (e) { /* ignore */ }
}
function stopComments() { if (V.commentsUnsub) { try { V.commentsUnsub(); } catch (e) { /* ignore */ } } V.commentsUnsub = null; }
const msTs = (v) => (v && v.toMillis ? v.toMillis() : (+v || 0));
function commentsHtml(m) {
    const list = V.comments.filter(c => !(window.isBlocked && window.isBlocked(c.byUid)));
    return `<div class="space-y-3">
        <div class="flex justify-end">${window.muteButtonHtml ? window.muteButtonHtml('vs_' + m.id, 'this match') : ''}</div>
        <div class="space-y-2">${list.map(c => `<div class="flex items-start gap-2">
            <img src="${esc(c.avatar || DEFAULT_AV)}" onerror="this.src='${DEFAULT_AV}'" class="w-8 h-8 rounded-full object-cover shrink-0">
            <div class="min-w-0 flex-1 bg-black/40 border border-white/10 rounded-2xl px-3 py-2">
                <div class="flex items-baseline justify-between gap-2"><span class="text-xs font-black truncate">${esc(c.byName || 'Player')}</span><span class="text-[10px] text-white/45 shrink-0">${msTs(c.at) ? esc(new Date(msTs(c.at)).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}</span></div>
                <div class="text-sm text-white/90 whitespace-pre-wrap break-words">${esc(c.text)}</div>
                ${c.byUid === myUid() || m.organizerId === myUid() ? `<button onclick="deleteVsComment('${jsq(c.id)}')" class="text-[10px] text-red-400 font-bold mt-1">Delete</button>` : ''}
            </div></div>`).join('') || '<p class="text-xs text-white/45 text-center py-4">No comments yet. Say something to the teams! 💬</p>'}<div id="vs-comments-end"></div></div>
        ${myUid() ? `<div class="flex gap-2"><input id="vs-comment" class="${INPUT}" maxlength="500" placeholder="Write a comment…" onkeydown="if(event.key==='Enter'){event.preventDefault();sendVsComment()}">
            <button onclick="sendVsComment()" class="${BTN} shrink-0"><i class="fa-solid fa-paper-plane"></i></button></div>` : ''}
    </div>`;
}
window.sendVsComment = async function () {
    const m = V.open; if (!m) return;
    const text = val('vs-comment'); if (!text) return;
    try {
        await addDoc(collection(db, 'artifacts', appId, 'vsMatches', m.id, 'comments'), { text: text.slice(0, 500), byUid: myUid(), byName: myName(), avatar: myAvatar(), at: serverTimestamp() });
        const i = document.getElementById('vs-comment'); if (i) i.value = '';
        setTimeout(() => { const b = document.getElementById('vs-comments-end'); b && b.scrollIntoView({ block: 'end' }); document.getElementById('vs-comment')?.focus(); }, 50);
    } catch (e) { toast("Couldn't post the comment.", 'error'); }
};
window.deleteVsComment = async function (cid) {
    const m = V.open; if (!m || !confirm('Delete this comment?')) return;
    try { const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"); await deleteDoc(doc(db, 'artifacts', appId, 'vsMatches', m.id, 'comments', cid)); }
    catch (e) { toast("Couldn't delete it.", 'error'); }
};

// ---- joining an open match with my team
window.openJoinVs = function () {
    const m = V.open; if (!m) return;
    const mine = myCaptainTeams().filter(t => !(m.teamIds || []).includes(t.id));
    if (!mine.length) return;
    sheet('vs-join', 'Join with my team', `
        ${teamPicker('vj-team', mine, mine[0].id)}
        <p class="text-[11px] text-white/55">${(+m.priceCents || 0) > 0 ? `${money(m.priceCents)} per team. ${m.firstToPay !== false ? 'The first teams to pay in full get the spots.' : 'Your spot is held until the pay-by time.'} Pay the organizer, ${esc(m.organizerName || '')}, and they mark it received.` : "Free match: you're in right away."}</p>
        <button onclick="joinVs()" class="${BTN} w-full py-3">Join</button>`);
};
window.joinVs = async function () {
    const m = V.open; if (!m) return;
    const team = myCaptainTeams().find(t => t.id === segVal('vj-team'));
    if (!team) return;
    try {
        await changeMatch(m.id, (x) => {
            if (x.status !== 'open' || x.teams.some(t => t.teamId === team.id)) return false;
            if (x.firstToPay === false && spotsTaken(x) >= (x.teamsCount || 2)) throw new Error('FULL');
            if ((+x.priceCents || 0) <= 0 && spotsTaken(x) >= (x.teamsCount || 2)) throw new Error('FULL');
            x.teams.push(teamEntry(team, (+x.priceCents || 0) > 0 ? 'pending' : 'confirmed'));
            settle(x);
        });
        document.getElementById('vs-join')?.remove();
        toast(`${team.name} is in! Now pick who's coming.`);
    } catch (e) { toast(String(e && e.message) === 'FULL' ? 'Sorry, the match just filled up.' : "Couldn't join.", 'error'); }
};
window.answerInvite = async function (matchId, teamId, yes) {
    try {
        await changeMatch(matchId, (m) => {
            const t = m.teams.find(x => x.teamId === teamId); if (!t || t.state !== 'invited') return false;
            if (yes) { t.state = (+m.priceCents || 0) > 0 ? 'pending' : 'confirmed'; settle(m); }
            else m.teams = m.teams.filter(x => x.teamId !== teamId);
        });
        toast(yes ? "You're in!" : 'Got it.');
    } catch (e) { toast("Couldn't answer.", 'error'); }
};
window.leaveVs = async function (teamId) {
    const m = V.open; if (!m) return;
    const t = (m.teams || []).find(x => x.teamId === teamId);
    if (!confirm(`Take ${t ? t.name : 'this team'} out of the match?`)) return;
    try {
        await changeMatch(m.id, (x) => { x.teams = x.teams.filter(y => y.teamId !== teamId); settle(x); });
    } catch (e) { toast("Couldn't do that.", 'error'); }
};

// ---- roster: who's coming
window.openVsRoster = function (teamId) {
    const m = V.open; if (!m) return;
    const entry = (m.teams || []).find(t => t.teamId === teamId);
    const team = (TS().mine || []).find(t => t.id === teamId);
    if (!entry || !team) return;
    const on = new Set(entry.roster || []);
    window._vsRoster = on;
    sheet('vs-roster', `Who's coming? (${esc(team.name)})`, `
        <div class="space-y-1.5">${(team.members || []).map(p => `<label class="flex items-center gap-3 bg-white/5 rounded-xl px-3 py-2.5 cursor-pointer">
            <input type="checkbox" ${on.has(p.id) ? 'checked' : ''} onchange="this.checked?_vsRoster.add('${jsq(p.id)}'):_vsRoster.delete('${jsq(p.id)}')" class="w-5 h-5 accent-[#00F296]">
            <span class="w-7 text-center font-black text-[#00F296]">${esc(p.number || '')}</span><span class="flex-1 text-sm font-bold truncate">${esc(p.name)}</span>
            <span class="text-[10px] text-white/50">${esc(p.position || '')}</span></label>`).join('')}</div>
        <button onclick="saveVsRoster('${jsq(teamId)}')" class="${BTN} w-full py-3">Save</button>`);
};
window.saveVsRoster = async function (teamId) {
    const m = V.open; if (!m) return;
    try {
        await changeMatch(m.id, (x) => { if (rosterLocked(x)) throw new Error('LOCKED'); const t = x.teams.find(y => y.teamId === teamId); if (!t) return false; t.roster = [...window._vsRoster]; });
        document.getElementById('vs-roster')?.remove();
    } catch (e) { toast(String(e && e.message) === 'LOCKED' ? 'Rosters are locked now.' : "Couldn't save.", 'error'); }
};

// ---- payments (the organizer marks what they received)
window.openVsPayment = function (teamId) {
    const m = V.open; if (!m) return;
    const t = (m.teams || []).find(x => x.teamId === teamId); if (!t) return;
    const left = Math.max(0, (+m.priceCents || 0) - paidCents(m, teamId));
    sheet('vs-pay', `Payment from ${esc(t.name)}`, `
        <p class="text-[11px] text-white/60">${money(paidCents(m, teamId))} of ${money(m.priceCents)} paid · ${money(left)} left</p>
        ${m.partial ? `<div>${LBL('Amount received ($)')}<input id="vp-amount" inputmode="decimal" class="${INPUT}" value="${(left / 100).toFixed(left % 100 ? 2 : 0)}"></div>` : `<p class="text-xs font-bold">This match takes the full fee at once: ${money(left)}.</p>`}
        <div>${LBL('How did they pay?')}${seg('vp-method', [['cash', 'Cash'], ['venmo', 'Venmo'], ['zelle', 'Zelle'], ['cashapp', 'Cash App'], ['other', 'Other']], 'cash')}</div>
        <button onclick="saveVsPayment('${jsq(teamId)}')" class="${BTN} w-full py-3">Got it: mark received</button>`);
};
window.saveVsPayment = async function (teamId) {
    const m = V.open; if (!m) return;
    const left = Math.max(0, (+m.priceCents || 0) - paidCents(m, teamId));
    const cents = m.partial ? Math.round((parseFloat(val('vp-amount').replace(',', '.')) || 0) * 100) : left;
    if (cents <= 0) { toast('Enter the amount.', 'error'); return; }
    try {
        await changeMatch(m.id, (x) => { x.payments.push({ teamId, cents, method: segVal('vp-method') || 'cash', byUid: myUid(), at: Date.now() }); settle(x); });
        document.getElementById('vs-pay')?.remove();
        toast(`Marked ${money(cents)} received.`);
    } catch (e) { toast("Couldn't save the payment.", 'error'); }
};

// ---- final score, forfeit, appeal, cancel, rematch
window.openVsScore = function () {
    const m = V.open; if (!m) return;
    const conf = confirmedTeams(m);
    if (conf.length < 2) { toast('Both teams need to be confirmed first.', 'error'); return; }
    const [a, b] = conf;
    const sc = m.score || {};
    sheet('vs-score', '🏁 Final score', `
        <div class="flex items-center gap-3">
            <div class="flex-1 text-center space-y-2">${teamLogoHtml(a, 48)}<div class="text-xs font-black truncate">${esc(a.name)}</div><input id="vs-sa" inputmode="numeric" class="${INPUT} text-center text-2xl font-black" maxlength="2" value="${esc(sc[a.teamId] ?? '')}"></div>
            <div class="text-xl font-black">-</div>
            <div class="flex-1 text-center space-y-2">${teamLogoHtml(b, 48)}<div class="text-xs font-black truncate">${esc(b.name)}</div><input id="vs-sb" inputmode="numeric" class="${INPUT} text-center text-2xl font-black" maxlength="2" value="${esc(sc[b.teamId] ?? '')}"></div>
        </div>
        <button onclick="saveVsScore()" class="${BTN} w-full py-3">Save final score</button>
        <div class="text-[10px] font-black uppercase tracking-wider text-white/55 pt-2">A team didn't show up?</div>
        <div class="grid grid-cols-2 gap-2"><button onclick="saveVsForfeit('${jsq(a.teamId)}')" class="${DARK}">${esc(a.short || a.name)} no-show</button><button onclick="saveVsForfeit('${jsq(b.teamId)}')" class="${DARK}">${esc(b.short || b.name)} no-show</button></div>
        <p class="text-[10px] text-white/45">A no-show counts as a 3-0 loss.</p>`);
};
window.saveVsScore = async function () {
    const m = V.open; if (!m) return;
    const [a, b] = confirmedTeams(m);
    const ga = parseInt(val('vs-sa'), 10), gb = parseInt(val('vs-sb'), 10);
    if (isNaN(ga) || isNaN(gb)) { toast('Enter both scores.', 'error'); return; }
    try {
        await changeMatch(m.id, (x) => { x.score = { [a.teamId]: ga, [b.teamId]: gb }; x.forfeit = ''; x.status = 'final'; });
        document.getElementById('vs-score')?.remove(); toast('Final score saved. 🏁');
    } catch (e) { toast("Couldn't save the score.", 'error'); }
};
window.saveVsForfeit = async function (loserId) {
    const m = V.open; if (!m) return;
    const [a, b] = confirmedTeams(m);
    const winner = a.teamId === loserId ? b : a;
    if (!confirm(`Count it as a 3-0 win for ${winner.name}?`)) return;
    try {
        await changeMatch(m.id, (x) => { x.score = { [winner.teamId]: 3, [loserId]: 0 }; x.forfeit = loserId; x.status = 'final'; });
        document.getElementById('vs-score')?.remove(); toast('Saved as a forfeit.');
    } catch (e) { toast("Couldn't save.", 'error'); }
};
window.appealVs = async function () {
    const m = V.open; if (!m) return;
    const mine = (m.teams || []).find(t => myCaptainTeams().some(x => x.id === t.teamId));
    const note = prompt('What happened? Your note goes to the organizer.');
    if (!note || !note.trim()) return;
    try {
        await addDoc(collection(db, 'artifacts', appId, 'vsMatches', m.id, 'appeals'), { teamId: mine ? mine.teamId : '', byUid: myUid(), byName: myName(), note: note.trim().slice(0, 500), at: serverTimestamp() });
        toast('Your appeal was sent to the organizer.');
    } catch (e) { toast("Couldn't send the appeal.", 'error'); }
};
window.cancelVs = async function () {
    const m = V.open; if (!m || !confirm('Cancel this match? Every team gets a notification.')) return;
    try { await changeMatch(m.id, (x) => { x.status = 'cancelled'; }); toast('Match cancelled.'); } catch (e) { toast("Couldn't cancel.", 'error'); }
};
window.rematchVs = function () {
    const m = V.open; if (!m) return;
    const mineIn = (m.teams || []).find(t => myCaptainTeams().some(x => x.id === t.teamId));
    window.openCreateVs({
        rematchOf: m.id, title: m.title, location: m.location, park: m.park, city: m.city, state: m.state, time: m.time, format: m.format, level: m.level, teamsCount: m.teamsCount,
        priceCents: m.priceCents, firstToPay: m.firstToPay, partial: m.partial, payByHours: m.payByHours, rosterLockHours: m.rosterLockHours, squadsOn: m.squadsOn !== false,
        include: !!mineIn, teamId: mineIn ? mineIn.teamId : '',
        inviteTeams: confirmedTeams(m).filter(t => !mineIn || t.teamId !== mineIn.teamId).map(t => ({ teamId: t.teamId, name: t.name, short: t.short, logo: t.logo, colors: t.colors })),
    });
};

// ---------------------------------------------------------------- a team's VS matches (team page > Schedule)
export function teamVsHtml(teamId) {
    const list = V.list.filter(m => (m.teamIds || []).includes(teamId) && m.status !== 'declined').sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    if (!list.length) return '';
    return `<div class="text-[10px] font-black uppercase tracking-wider text-fuchsia-300">VS Matches (${list.length})</div>
        <div class="space-y-2">${list.map(vsCardHtml).join('')}</div>`;
}
window.vsTeamHtml = teamVsHtml;
