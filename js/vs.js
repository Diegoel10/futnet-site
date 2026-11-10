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
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, onSnapshot, runTransaction, serverTimestamp, query, orderBy, limit, getDocs, increment, arrayUnion }
    from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { teamLogoHtml as baseLogoHtml, canManage, FORMATS, LEVELS } from './teams.js';
import { attachParkPicker, saveParkIfNew } from './parks.js';
import { liveSource, liveLinkProblem, liveSlotHtml } from './livestream.js';   // same YouTube / Facebook player as games

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsq = (v) => esc(String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const toast = (m, t) => window.showToast && window.showToast(m, t);
const myUid = () => (window.currentUser && window.currentUser.uid) || '';
// My name: the profile, else my card in the players list, else my sign-in name.
const myName = () => {
    const p = window.userProfile || {};
    const fromProfile = window.fullName ? window.fullName(p) : (p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim());
    if (fromProfile) return fromProfile.trim();
    const uid = (window.currentUser && window.currentUser.uid) || '';
    const d = (window.cachedDirectoryList || window.directoryList || []).find(u => String(u.uid) === String(uid));
    const fromCard = d ? (window.fullName ? window.fullName(d) : d.name) : '';
    return String(fromCard || (window.currentUser && window.currentUser.displayName) || 'Player').trim();
};
const C = (name) => collection(db, 'artifacts', appId, name);
const D = (...p) => doc(db, 'artifacts', appId, ...p);
const TS = () => window.__teamsState || { mine: [], all: [] };
/** A team in a match keeps a copy of its logo from when it signed up. Show the team's current logo/colors when we have it
 *  (my own teams update right away; the server also copies a new logo into the matches for everyone else). */
function freshLook(t) {
    if (!t || !t.teamId) return t;
    const f = (TS().mine || []).find(x => x.id === t.teamId) || (TS().all || []).find(x => x.id === t.teamId) || (typeof teamCache !== 'undefined' && teamCache[t.teamId]);
    return f ? { ...t, logo: f.logo || t.logo, colors: f.colors || t.colors, short: f.short || t.short } : t;
}
const teamLogoHtml = (t, size) => baseLogoHtml(freshLook(t), size);
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
        if (V.open) { const fresh = V.list.find(m => m.id === V.open.id); if (fresh) { V.open = fresh; drawPage(); if (V.manage) drawManage(); } }
    }, () => {});
}
let started = '';
setInterval(() => { const u = myUid(); if (u && started !== u) { started = u; start(); } if (!u && started) { started = ''; if (V.unsub) V.unsub(); V.list = []; } }, 1000);

// ---------------------------------------------------------------- home screen cards
function slotHtml(t, size = 46, plus = false, click = false) {
    if (t && click) return `<button onclick="openVsTeamCard('${jsq(t.teamId)}')" class="flex flex-col items-center gap-1 min-w-0 active:scale-95 transition" style="width:${size + 30}px">${teamLogoHtml(t, size)}<span class="text-[10px] font-black text-white truncate max-w-full underline decoration-white/30 underline-offset-2">${esc(t.name)}</span></button>`;
    if (!t && plus) return `<button onclick="openVsSpot()" class="flex flex-col items-center gap-1" style="width:${size + 30}px"><div class="rounded-2xl border-2 border-dashed border-[#00F296]/70 bg-[#00F296]/10 flex items-center justify-center text-[#00F296]" style="width:${size}px;height:${size}px"><i class="fa-solid fa-plus" style="font-size:${Math.round(size / 3)}px"></i><span class="sr-only">+</span></div><span class="text-[10px] font-black text-[#00F296]">Take this spot</span></button>`;
    if (!t) return `<div class="flex flex-col items-center gap-1" style="width:${size + 30}px"><div class="rounded-2xl border-2 border-dashed border-white/35 flex items-center justify-center text-[9px] font-black text-white/50 text-center leading-tight" style="width:${size}px;height:${size}px">Open<br>spot</div><span class="text-[10px] font-bold text-white/40">&nbsp;</span></div>`;
    return `<div class="flex flex-col items-center gap-1 min-w-0" style="width:${size + 30}px">${teamLogoHtml(t, size)}<span class="text-[10px] font-black text-white truncate max-w-full">${esc(t.name)}</span></div>`;
}
const DEFAULT_AV = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
/** The organizer's current photo: my own profile photo, the players list, what was saved, else initials. */
/** Anyone's current photo: my own profile, then the players list, then the game rosters, then what was saved. */
function avatarOf(uid, saved, name) {
    const real = (a) => !!a && !String(a).includes('person-circle.svg') && !String(a).includes('api.dicebear.com');
    if (uid && uid === myUid()) { const p = window.userProfile || {}; const a = p.avatar || p.photoURL || (window.currentUser && window.currentUser.photoURL); if (real(a)) return a; }
    const d = uid ? [...(window.directoryList || []), ...(window.cachedDirectoryList || [])].find(u => String(u.uid || u.id) === String(uid)) : null;
    if (d && real(d.avatar || d.photoURL)) return d.avatar || d.photoURL;
    if (real(saved)) return saved;
    const r = window.resolvePlayerAvatar ? window.resolvePlayerAvatar({ uid, name, avatar: saved }) : '';
    return r || DEFAULT_AV;
}
const organizerAvatar = (m) => avatarOf(m.organizerId, m.organizerAvatar, m.organizerName);
const ymdToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** The match's name: its title, else "Team A vs Team B". */
export function vsTitleOf(m) {
    const names = (m.teams || []).filter(t => t.state !== 'invited' || m.status === 'challenge').map(t => t.name);
    return m.title || (names.length >= 2 ? `${names[0]} vs ${names[1]}` : names.length ? `${names[0]} vs ?` : 'VS Match');
}
function myStake(m) {
    const ids = new Set((TS().mine || []).map(t => t.id));
    if ((m.teamIds || []).some(id => ids.has(id))) return 'team';
    if ((m.forming || []).some(p => p.uid === myUid()) || (m.squads || []).some(q => (q.members || []).some(p => p.uid === myUid()))) return 'squad';
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
    const isLiveNow = m.live && liveRunning(m.live) && m.status === 'open';
    const middle = m.status === 'final' && m.score && n === 2
        ? `<div class="text-2xl font-black text-white px-1">${esc(m.score[slots[0]?.teamId] ?? 0)} - ${esc(m.score[slots[1]?.teamId] ?? 0)}</div>`
        : isLiveNow && n === 2 ? `<div class="flex flex-col items-center"><div class="text-2xl font-black text-white px-1">${liveGoals(m, slots[0]?.teamId)} - ${liveGoals(m, slots[1]?.teamId)}</div><div class="text-[10px] font-black text-red-400">● LIVE <span data-vs-clock="${esc(m.id)}" class="font-mono">${clockText(liveSecs(m.live))}</span></div></div>`
        : vsBadge(n === 2 ? 46 : 30);
    return `<div id="vs-card-${esc(m.id)}" data-vs-time="${esc(m.time || '')}" onclick="openVsMatch('${jsq(m.id)}')" class="relative bg-[#010A0F]/90 rounded-2xl overflow-hidden shadow-xl border-[1.6px] border-fuchsia-500/60 hover:border-fuchsia-400 transition cursor-pointer p-4 space-y-3">
        <div class="absolute inset-0 pointer-events-none opacity-25" style="background:radial-gradient(circle at 50% 38%, #E8262B 0%, transparent 55%)"></div>
        <div class="relative z-10 space-y-3">
            <div class="flex justify-center gap-2"><div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 border border-fuchsia-400/60 text-fuchsia-200 text-[10px] font-black">${vsBadge(16)}<span>VS MODE${m.status === 'challenge' ? ' · CHALLENGE' : ''}</span></div>${m.livestream && m.livestream.status === 'live' ? '<div class="flex items-center px-2.5 py-1 rounded-lg bg-red-600 text-white text-[10px] font-black">● LIVE</div>' : ''}</div>
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5 bg-black/50 px-2.5 py-1 rounded-xl border border-[#00B4AE]/80 text-white text-[10px] font-bold"><i class="fa-solid fa-users text-[10px]"></i><span>${esc(m.format || '7v7')} • ${n} Teams</span></div>
                <div class="flex items-center gap-1 bg-black/50 px-2.5 py-1 rounded-xl border ${price ? 'border-[#00F296]/80' : 'border-[#00B4AE]/80'} text-white text-[10px] font-bold"><i class="fa-solid ${price ? 'fa-circle-dollar-to-slot' : 'fa-tag'} text-[10px]"></i><span>${price ? money(price) + ' per team' : 'Free'}</span></div>
            </div>
            <h3 class="text-base font-bold text-white tracking-tight line-clamp-1">${esc(vsTitleOf(m))}</h3>
            ${vsStormOn(m) ? `<div class="flex justify-center gap-1.5"><span class="px-2 py-0.5 rounded-full border text-[10px] font-black bg-amber-500/15 text-amber-200 border-amber-400/60">⛈️ Storm watch</span><span class="px-2 py-0.5 rounded-full border text-[10px] font-black ${VS_STORM[vsStormState(m)].cls}">${VS_STORM[vsStormState(m)].emoji} ${VS_STORM[vsStormState(m)].label}</span></div>` : ''}
            <div class="flex items-center justify-center gap-2">${n === 2 ? `${slotHtml(slots[0])}${middle}${slotHtml(slots[1])}` : slots.map(s => slotHtml(s, 36)).join(vsBadge(24))}</div>
            ${isLiveNow && n > 2 ? (() => { const [a, b] = livePair(m); return a && b ? `<div class="text-center text-[11px] font-black"><span class="text-red-400">● LIVE</span> ${esc(a.name)} ${liveGoals(m, a.teamId)} - ${liveGoals(m, b.teamId)} ${esc(b.name)} · <span data-vs-clock="${esc(m.id)}" class="font-mono">${clockText(liveSecs(m.live))}</span></div>` : ''; })() : ''}
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
        const list = V.list.filter(m => (m.date || '') === day && m.status !== 'declined' && m.status !== 'cancelled').sort((a, b) => String(a.time).localeCompare(String(b.time)));
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
    const editing = !!prefill.editId;
    sheet('vs-create', editing ? '✏️ Edit match' : prefill.rematchOf ? '🔁 Rematch' : `<span class="flex items-center gap-2">${vsBadge(30)} ${prefill.copied ? 'Copy of the match' : 'Create VS Match'}</span>`, `
        ${editing ? '<p class="text-[11px] text-white/55">Teams, payments and the score stay as they are.</p>' : `<div class="space-y-2">${LBL('Involve a team?')}
            ${seg('vs-include', [['yes', 'Yes, my team plays'], ['no', 'No, I just organize']], inc)}
            <div id="vs-team-wrap" style="${inc === 'no' ? 'display:none' : ''}">${teamPart}</div></div>`}
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
        <details class="rounded-xl border border-white/10 bg-white/5 px-3 py-2" ${prefill.description || prefill.rules || prefill.refundNote ? 'open' : ''}>
            <summary class="text-xs font-black cursor-pointer py-1">📝 Description, rules & refund policy</summary>
            <div class="space-y-2 pt-2">
                <div>${LBL('Description')}<textarea id="vs-desc" rows="2" maxlength="600" class="${INPUT}" placeholder="e.g. Friendly 7v7, bring light and dark shirts">${esc(prefill.description || '')}</textarea></div>
                <div>${LBL('Rules')}<textarea id="vs-rules" rows="2" maxlength="600" class="${INPUT}" placeholder="e.g. No slide tackles, two 25-minute halves, the ref's call is final">${esc(prefill.rules || '')}</textarea></div>
                <div>${LBL('Refund policy')}<textarea id="vs-refund" rows="2" maxlength="400" class="${INPUT}" placeholder="e.g. Full refund if a team cancels 48 hours before. No refunds after that.">${esc(prefill.refundNote || '')}</textarea></div>
            </div>
        </details>
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
        <button id="vs-save" onclick="saveCreateVs()" class="${BTN} w-full py-3 text-sm">${editing ? 'Save changes' : 'Create match'}</button>`);
    if (prefill.copied) setTimeout(() => document.getElementById('vs-date')?.focus(), 50);
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
        priceCents: Math.round((parseFloat(val('vs-price').replace(',', '.')) || 0) * 100), squadsOn: !!document.getElementById('vs-squads')?.checked,
        description: val('vs-desc'), rules: val('vs-rules'), refundNote: val('vs-refund') };
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
    const pre0 = window._vsPrefill || {};
    if (pre0.editId) {
        const price0 = Math.round((parseFloat(val('vs-price').replace(',', '.')) || 0) * 100);
        const fields = { title: val('vs-title'), date, time, location, park: where.park, city: where.city, state: where.state,
            format: segVal('vs-format') || '7v7', level: segVal('vs-level') || 'casual', teamsCount: parseInt(segVal('vs-count'), 10) || 2, priceCents: price0,
            firstToPay: !!document.getElementById('vs-first')?.checked, partial: !!document.getElementById('vs-partial')?.checked,
            payByHours: parseInt(segVal('vs-payby'), 10) || 0, rosterLockHours: parseInt(segVal('vs-lock'), 10) || 0, squadsOn: !!document.getElementById('vs-squads')?.checked,
            description: val('vs-desc'), rules: val('vs-rules'), refundNote: val('vs-refund') };
        try {
            await changeMatch(pre0.editId, (x) => { if (fields.teamsCount < spotsTaken(x)) throw new Error('TOO_FEW'); Object.assign(x, fields); x._edit = fields; settle(x); });
            document.getElementById('vs-create')?.remove();
            toast('Match updated. Everyone sees the change.');
        } catch (e) { toast(String(e && e.message) === 'TOO_FEW' ? 'More teams are already in than that. Remove a team first.' : "Couldn't save the changes.", 'error'); }
        return;
    }
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
        description: val('vs-desc'), rules: val('vs-rules'), refundNote: val('vs-refund'),
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
    recordVsView(id);
    watchComments(id);
    drawPage();
};
// ---------------------------------------------------------------- 👀 who has seen the match (organizer's Analytics)
//   vsMatches/{id}/views/{uid} = { uid, name, avatar, count (+1 per visit), days: ['YYYY-MM-DD'], firstAt, lastAt }
//   One visit per person per 30 minutes. The organizer's own visits aren't counted.
function recordVsView(id) {
    const u = window.currentUser; if (!u || !u.uid || !id) return;
    const m = V.list.find(x => x.id === id) || V.open;
    if (m && m.organizerId === u.uid) return;
    try { const k = 'futnet_vsview_' + id; const last = +localStorage.getItem(k) || 0; if (Date.now() - last < 30 * 60000) return; localStorage.setItem(k, String(Date.now())); } catch (e) { /* ignore */ }
    setDoc(D('vsMatches', id, 'views', u.uid), { uid: u.uid, name: myName(), avatar: myAvatar(), count: increment(1), days: arrayUnion(ymdToday()), lastAt: serverTimestamp() }, { merge: true }).catch(() => {});
}
window.openVsViews = async function () {
    const m = V.open; if (!m) return;
    sheet('vs-views', '📈 Analytics: who has seen it', '<p class="text-xs text-white/50 text-center py-6"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Loading…</p>');
    let list = [];
    try { list = (await getDocs(collection(db, 'artifacts', appId, 'vsMatches', m.id, 'views'))).docs.map(d => d.data()); } catch (e) { /* ignore */ }
    const ms = (v) => (v && v.toMillis ? v.toMillis() : (+v || 0));
    list.sort((a, b) => ms(b.lastAt) - ms(a.lastAt));
    const inIds = new Set();
    (m.teams || []).forEach(t => { const full = teamFull(t.teamId); ((full && full.memberUids) || []).forEach(u => inIds.add(String(u))); });
    squadsOf(m).forEach(q => q.members.forEach(p => inIds.add(String(p.uid))));
    const total = list.reduce((s, v) => s + (+v.count || 0), 0);
    const notIn = list.filter(v => !inIds.has(String(v.uid))).length;
    const html = `<div class="space-y-3">
        <div class="grid grid-cols-3 gap-2 text-center">
            <div class="bg-black/40 border border-white/10 rounded-xl p-2"><div class="text-xl font-black text-[#00F296]">${list.length}</div><div class="text-[10px] text-white/55">people</div></div>
            <div class="bg-black/40 border border-white/10 rounded-xl p-2"><div class="text-xl font-black">${total}</div><div class="text-[10px] text-white/55">visits</div></div>
            <div class="bg-black/40 border border-white/10 rounded-xl p-2"><div class="text-xl font-black text-amber-300">${notIn}</div><div class="text-[10px] text-white/55">looked, not in</div></div>
        </div>
        <p class="text-[10px] text-white/45">Counts everyone who opened this match (once per 30 minutes). Your own visits don't count.</p>
        <div class="space-y-1.5">${list.map(v => `<button onclick="document.getElementById('vs-views')?.remove(); openPlayerStatsSheet && openPlayerStatsSheet('${jsq(v.uid)}','${jsq(personName(v.uid, v.name))}','')" class="w-full flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-left">
            <img src="${esc(personAvatar(v.uid, v.avatar, personName(v.uid, v.name)))}" onerror="this.src='${DEFAULT_AV}'" class="w-8 h-8 rounded-full object-cover">
            <span class="flex-1 min-w-0"><span class="block text-xs font-black truncate">${esc(personName(v.uid, v.name))} ${inIds.has(String(v.uid)) ? '<span class="text-[9px] text-[#00F296]">IN THE MATCH</span>' : ''}</span>
                <span class="block text-[10px] text-white/50">${ms(v.lastAt) ? 'Last seen ' + esc(new Date(ms(v.lastAt)).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}</span></span>
            <span class="text-xs font-black text-white/80">${+v.count || 1}×</span></button>`).join('') || '<p class="text-xs text-white/50 text-center py-4">Nobody has opened it yet. Share the match to get it seen!</p>'}</div>
    </div>`;
    const el = document.getElementById('vs-views'); if (!el) return;
    sheet('vs-views', '📈 Analytics: who has seen it', html);
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
    const myTeamIn = myTeamEntry(m), mySq = mySquad(m);
    if (V.tab === 'team' && !myTeamIn && !mySq) V.tab = 'info';
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
                ${canKit(m, t.teamId) && t.state !== 'invited' ? `<button onclick="openVsKits()" class="${DARK}">${shirt(kitOf(m, t.teamId), 'text-sm mr-1')}Shirt color</button>` : ''}
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
    const liveNow = m.live && m.status === 'open' && conf.length >= 2;
    const scoreMid = m.status === 'final' && m.score && n === 2 && conf.length >= 2
        ? `<div class="text-4xl font-black px-2">${esc(m.score[conf[0].teamId] ?? 0)} - ${esc(m.score[conf[1].teamId] ?? 0)}</div>`
        : liveNow && n === 2 ? `<div class="flex flex-col items-center px-1"><div class="text-4xl font-black">${liveGoals(m, slots[0]?.teamId)} - ${liveGoals(m, slots[1]?.teamId)}</div><div class="text-[11px] font-black ${liveRunning(m.live) ? 'text-red-400' : 'text-amber-300'}">${liveRunning(m.live) ? '● LIVE' : 'PAUSED'} <span data-vs-clock="${esc(m.id)}" class="font-mono">${clockText(liveSecs(m.live))}</span></div></div>`
        : vsBadge(n === 2 ? 70 : 34);
    const canTakeSpot = m.status === 'open' && !isFull(m) && !(m.date && m.date < ymdToday()) && !!myUid();
    const lp = liveNow ? livePair(m) : [];
    const statusLine = liveNow && n > 2 ? `<span class="${liveRunning(m.live) ? 'text-red-400' : 'text-amber-300'}">${liveRunning(m.live) ? '● LIVE' : 'PAUSED'}</span> ${esc(lp[0].name)} ${liveGoals(m, lp[0].teamId)} - ${liveGoals(m, lp[1].teamId)} ${esc(lp[1].name)} · <span data-vs-clock="${esc(m.id)}" class="font-mono">${clockText(liveSecs(m.live))}</span>`
        : m.status === 'cancelled' ? '❌ Cancelled' : m.status === 'final' ? `🏁 Final${m.forfeit ? ` · ${esc((shown.find(t => t.teamId === m.forfeit) || {}).name || '')} didn't show` : ''}`
        : m.status === 'challenge' ? 'Challenge · waiting for an answer' : isFull(m) ? '✅ All spots taken' : `${n - spotsTaken(m)} of ${n} spots open`;
    const mapsUrl = m.location ? 'https://maps.apple.com/?q=' + encodeURIComponent(m.location) : '';
    const tabBtn = (k, label) => `<button onclick="vsTab('${k}')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === k ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">${label}</button>`;
    const info = `<div class="space-y-3">
            ${outcomeBoxHtml(m)}
            ${vsStormCardHtml(m)}
            <div class="bg-black/40 border border-white/10 rounded-2xl p-3 text-xs space-y-2">
                <div class="flex items-center gap-2"><i class="fa-solid fa-calendar text-[#00F296] w-4"></i>${esc((window.fmtGameDate || prettyDate)(m.date))}</div>
                <div class="flex items-center gap-2"><i class="fa-solid fa-clock text-[#00F296] w-4"></i>${esc(prettyTime(m.time))}</div>
                <div class="flex items-center gap-2"><i class="fa-solid fa-location-dot text-[#00F296] w-4"></i><span class="min-w-0">${esc(m.location || '')}</span></div>
                <div class="flex items-center gap-2"><i class="fa-solid fa-users text-[#00F296] w-4"></i>${esc(m.format || '')} · ${n} teams · ${esc(levelLabel(m.level))}</div>
                <div class="flex items-start gap-2"><i class="fa-solid fa-circle-dollar-to-slot text-[#00F296] w-4 mt-0.5"></i><span>${price ? `${money(price)} per team${m.payByHours ? ` · pay by ${esc(new Date(payByMs(m)).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}` : ''}${m.firstToPay !== false ? ' · first to pay is in' : ''}${m.partial ? ' · partial payments OK' : ''}` : 'Free'}</span></div>
                ${m.message ? `<div class="italic text-white/75">"${esc(m.message)}"</div>` : ''}
            </div>
            ${[['fa-file-lines', 'Match details', m.description], ['fa-list-check', 'Rules', m.rules], ['fa-rotate-left', 'Refund policy', m.refundNote]].filter(x => String(x[2] || '').trim()).map(([icon, title, text]) => `
            <div class="bg-black/40 border border-white/10 rounded-2xl p-3"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1"><i class="fa-solid ${icon} mr-1"></i>${title}</div>
                <p class="text-xs text-white/85 whitespace-pre-line leading-relaxed">${esc(text)}</p></div>`).join('')}
            <div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-2xl p-3">
                <img src="${esc(organizerAvatar(m))}" onerror="this.src='${DEFAULT_AV}'" class="w-10 h-10 rounded-full object-cover border border-[#00F296]/60">
                <div><div class="text-[9px] font-bold text-white/55 uppercase">Organized by</div><div class="text-sm font-black">${esc(m.organizerName || 'Organizer')}</div></div>
            </div>
            ${clash ? `<div class="bg-amber-400/10 border border-amber-400/40 rounded-xl p-3 text-[11px] text-amber-200">👕 Both teams wear similar colors. ${esc(conf[1].name)}, please bring your second color.</div>` : ''}
            ${m.livestream && m.livestream.status === 'live' && tab !== 'live' ? `<button onclick="vsTab('live')" class="w-full bg-red-600 text-white rounded-2xl px-4 py-3 flex items-center gap-3"><span class="bg-white text-red-600 text-[10px] font-black px-2 py-0.5 rounded-full">● LIVE</span><span class="flex-1 text-left text-sm font-black">This match is live now</span><span class="text-xs font-black">Watch ›</span></button>` : ''}
            ${m.live && conf.length >= 2 ? liveScoreHtml(m) : ''}
            ${canJoin ? `<button onclick="openJoinVs()" class="${BTN} w-full py-3 text-sm">Join with my team</button>` : ''}
            ${squadBoxHtml(m)}
        </div>`;
    const teamsTab = `<div class="space-y-2">${shown.map(teamRow).join('') || '<p class="text-xs text-white/45 text-center py-4">No teams yet.</p>'}
            ${squadsOf(m).map(q => `<div class="text-[10px] font-black uppercase tracking-wider text-fuchsia-300 pt-2">🧩 ${esc(q.name)} forming (${q.members.length}/${perSideOf(m)})</div>${membersHtml(q.members, q.captainUid)}`).join('')}</div>`;
    const tool = (onclick, icon, label, cls = DARK) => `<button onclick="${onclick}" class="${cls} !px-2 flex flex-col items-center justify-center gap-1 py-3 min-h-[72px]"><span class="text-lg leading-none">${icon}</span><span class="text-center leading-tight">${label}</span></button>`;
    const played = m.results || [];
    const admin = `<div class="space-y-3">
            ${m.live ? liveScoreHtml(m) : ''}
            <div class="text-[10px] font-black uppercase tracking-wider text-white/55">Organizer tools</div>
            <div class="grid grid-cols-3 gap-2">
                ${live || m.status === 'final' ? tool('openVsManage()', '⏱️', 'Match management', m.live ? BTN + ' !px-2' : DARK) : ''}
                ${tool('openVsNotify()', '📣', 'Notify players')}
                ${tool('openVsViews()', '📈', 'Analytics')}
                ${live ? tool('openVsStorm()', '⛈️', 'Storm watch', vsStormOn(m) ? DARK + ' !border-amber-400/70 !text-amber-200' : DARK) : ''}
                ${live ? tool('editVs()', '✏️', 'Edit') : ''}
                ${live ? tool('openVsKits()', '👕', 'Shirt colors') : ''}
                ${tool('copyVs()', '📋', 'Copy')}
                ${live ? tool('openAddTeamManually()', '➕', 'Add team') : ''}
                ${m.livestream && m.livestream.status === 'live' ? tool("vsTab('live')", '🔴', 'Watch live') : live ? tool('openVsLivestream()', '🔴', 'Go live') : ''}
                ${live && (m.teamsCount || 2) <= 2 ? tool('openVsScore()', '🏁', 'End match', 'bg-amber-400 text-slate-950 font-black rounded-xl text-xs px-2 transition') : ''}
                ${live && (m.teamsCount || 2) > 2 && (m.results || []).length ? tool('vsEndEvent()', '🏁', 'End event', 'bg-amber-400 text-slate-950 font-black rounded-xl text-xs px-2 transition') : ''}
                ${live ? tool('cancelVs()', '❌', 'Cancel', DARK + ' text-red-400') : ''}
                ${m.status === 'final' ? ((m.teamsCount || 2) <= 2 ? tool('openVsScore()', '✏️', 'Fix score') : '') + tool('rematchVs()', '🔁', 'Rematch', BTN) : ''}
                ${vsOutcome(m) ? tool('openVsResultCards()', '📸', 'Result cards') : ''}
            </div>
            ${live && conf.length < 2 ? `<p class="text-[11px] text-amber-200">Match management opens once ${2 - conf.length === 2 ? 'two teams are' : 'one more team is'} <b>confirmed</b>: a team is confirmed when it joins a free match, or when you mark its payment ("Got a payment").</p>` : ''}
            <p class="text-[11px] text-white/55">Mark payments in the Teams tab ("Got a payment").</p>
            ${playedGamesAdminHtml(m)}
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
            <div class="relative flex items-center justify-center gap-2">${n === 2 ? `${slotHtml(slots[0], 72, canTakeSpot, true)}${scoreMid}${slotHtml(slots[1], 72, canTakeSpot, true)}` : slots.map(x => slotHtml(x, 46, canTakeSpot, true)).join(vsBadge(28))}</div>
            <div class="relative text-center text-[11px] font-black text-white/75 mt-2">${statusLine}</div>
        </div>
        <div class="bg-black/40 border-2 border-fuchsia-500/30 p-1.5 rounded-2xl flex items-center gap-1 overflow-x-auto shadow-md">
            ${boss ? tabBtn('admin', '<i class="fa-solid fa-gear mr-1"></i> Admin') : ''}${m.livestream && lsKey(m.livestream) ? `<button onclick="vsTab('live')" class="flex-1 py-2 px-3 rounded-xl text-xs font-black whitespace-nowrap ${tab === 'live' ? 'bg-red-600 text-white' : 'text-red-300'}">${m.livestream.status === 'live' ? '🔴 Live' : '▶ Replay'}</button>` : ''}${myTeamIn || mySq ? tabBtn('team', myTeamIn ? '🛡️ My Team' : '🧩 My Squad') : ''}${tabBtn('info', 'Match Info')}${tabBtn('teams', `Teams (${spotsTaken(m)}/${n})`)}${tabBtn('stats', 'Stats')}${tabBtn('comments', `Comments (${V.comments.length})`)}
        </div>
        <div class="bg-[#040E13]/95 border-2 border-fuchsia-500/30 rounded-3xl p-4 shadow-2xl">
            ${tab === 'admin' ? admin : tab === 'team' ? myTeamTabHtml(m) : tab === 'live' ? liveTabHtml(m, boss) : tab === 'stats' ? statsHtml(m) : tab === 'teams' ? teamsTab : tab === 'comments' ? commentsHtml(m) : info}
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

// ---------------------------------------------------------------- 🧩 free agents form squads
//   m.squadsOn (organizer's choice)
//   m.squads = [{ id, name, captainUid ('' = the captain left, someone has to take charge), joinMode: 'open'|'ask',
//                 members: [{ uid, name, avatar, position, at }], requests: [same, waiting for the captain], at }]
//   Anyone can start a squad (they're its captain and choose: anyone can join, or ask first). Several can
//   fill at once, so you pick who you play with. The first squad to reach a full team (7 for 7v7) while a
//   spot is open, AND that has a captain (for the payment), becomes a temporary team (teams/{id}, temp: true)
//   that takes the spot like any other team, with its own team chat.
//   If teams fill the spots first, the squads are off (the server tells everyone in them).
//   (Older matches kept one list in m.forming: it shows as a squad called "Free agents".)
export function squadsOf(m) {
    const list = (m.squads || []).map(q => ({ joinMode: 'open', requests: [], ...q, members: [...(q.members || [])], requests: [...(q.requests || [])] }));
    if ((m.forming || []).length) list.unshift({ id: 'legacy', name: 'Free agents', captainUid: m.forming[0].uid, joinMode: 'open', members: [...m.forming], requests: [], at: 0 });
    return list;
}
const mySquad = (m) => squadsOf(m).find(q => q.members.some(p => p.uid === myUid())) || null;
const myRequestSquad = (m) => squadsOf(m).find(q => q.requests.some(p => p.uid === myUid())) || null;
/** A player's current name and photo (from the live players list; what was saved is the fallback). */
function personName(uid, saved) {
    const d = [...(window.cachedDirectoryList || []), ...(window.directoryList || [])].find(u => String(u.uid) === String(uid));
    let n = (d && window.fullName && window.fullName(d)) || (d && d.name) || '';
    if (n === 'Player') n = (d && d.name) || '';
    return n || (uid === myUid() ? myName() : '') || saved || 'Player';
}
function personAvatar(uid, saved, name) { return avatarOf(uid, saved, name); }
function membersHtml(list, captainUid) {
    return `<div class="flex flex-wrap gap-1.5">${list.map(p => { const nm = personName(p.uid, p.name); return `<span class="flex items-center gap-1.5 rounded-full bg-white/10 pl-1 pr-2.5 py-1 text-[11px] font-bold">
        <img src="${esc(personAvatar(p.uid, p.avatar, nm))}" onerror="this.src='${DEFAULT_AV}'" class="w-6 h-6 rounded-full object-cover">${esc(nm)}${p.uid === captainUid ? ' <span class="text-[9px] font-black text-amber-300">CAPTAIN</span>' : ''}${p.position ? ` <span class="text-white/50">${esc(p.position)}</span>` : ''}</span>`; }).join('')}</div>`;
}
const squadOpen = (m) => m.squadsOn !== false && m.status === 'open' && !isFull(m) && !(m.date && m.date < ymdToday());
function squadRowHtml(m, q) {
    const need = perSideOf(m), mine = mySquad(m), onTeam = myStake(m) === 'team';
        const pct = Math.min(100, Math.round(q.members.length * 100 / need));
        const inThis = q.members.some(p => p.uid === myUid());
        const iCap = q.captainUid === myUid();
        const asked = q.requests.some(p => p.uid === myUid());
        const noCap = !q.captainUid;
        let action = '';
        if (myUid() && !onTeam) {
            if (inThis) action = `<button onclick="leaveVsSquad('${jsq(q.id)}')" class="${DARK} w-full">${iCap && q.members.length > 1 ? 'Leave (someone else takes charge)' : 'Leave this squad'}</button>`;
            else if (asked) action = `<button onclick="cancelSquadRequest('${jsq(q.id)}')" class="${DARK} w-full">Request sent · Cancel</button>`;
            else if (squadOpen(m)) action = `<button onclick="joinVsSquad('${jsq(q.id)}')" class="w-full py-2 rounded-xl text-xs font-black text-white bg-gradient-to-r from-fuchsia-600 to-purple-600">${q.joinMode === 'ask' ? 'Ask to join' : mine ? 'Switch to this squad' : 'Join this squad'}</button>`;
        }
        return `<div class="bg-black/40 border ${inThis ? 'border-[#00F296]/60' : 'border-white/10'} rounded-xl p-2.5 space-y-2">
            <div class="flex items-center justify-between gap-2"><div class="text-xs font-black truncate">🧩 ${esc(q.name)}</div>
                <span class="flex items-center gap-1.5 shrink-0"><span class="text-[9px] font-black rounded-full px-1.5 py-0.5 ${q.joinMode === 'ask' ? 'bg-amber-400/20 text-amber-200' : 'bg-white/10 text-white/70'}">${q.joinMode === 'ask' ? 'ASK TO JOIN' : 'OPEN'}</span><span class="text-[11px] font-black">${q.members.length}/${need}</span></span></div>
            <div class="h-1.5 rounded-full bg-white/10 overflow-hidden"><div class="h-full bg-fuchsia-400" style="width:${pct}%"></div></div>
            ${membersHtml(q.members, q.captainUid)}
            ${noCap ? `<div class="bg-amber-400/10 border border-amber-400/40 rounded-xl p-2.5 text-[11px] text-amber-100 space-y-2">⚠️ <b>The captain left.</b> A squad needs a captain to handle the payment before it can take a spot.
                ${inThis ? `<button onclick="takeSquadCharge('${jsq(q.id)}')" class="${BTN} w-full">I'll take charge</button>` : ''}</div>` : ''}
            ${iCap && q.requests.length ? `<div class="space-y-1.5"><div class="text-[10px] font-black uppercase tracking-wider text-amber-300">Want to join (${q.requests.length})</div>
                ${q.requests.map(p => { const nm = personName(p.uid, p.name); return `<div class="flex items-center gap-2 bg-white/5 rounded-xl px-2 py-1.5">
                    <img src="${esc(personAvatar(p.uid, p.avatar, nm))}" onerror="this.src='${DEFAULT_AV}'" class="w-7 h-7 rounded-full object-cover">
                    <span class="flex-1 min-w-0 text-xs font-bold truncate">${esc(nm)}${p.position ? ` <span class="text-white/50">${esc(p.position)}</span>` : ''}</span>
                    <button onclick="answerSquadRequest('${jsq(q.id)}','${jsq(p.uid)}', false)" class="${DARK} !px-2.5 !py-1.5">No</button>
                    <button onclick="answerSquadRequest('${jsq(q.id)}','${jsq(p.uid)}', true)" class="${BTN} !px-2.5 !py-1.5">Yes</button></div>`; }).join('')}</div>` : ''}
            ${iCap ? `<label class="flex items-center justify-between gap-2 text-[11px] text-white/75 cursor-pointer"><span>Players must ask me first</span>
                <input type="checkbox" ${q.joinMode === 'ask' ? 'checked' : ''} onchange="setSquadJoinMode('${jsq(q.id)}', this.checked)" class="w-4 h-4 accent-[#00F296]"></label>` : ''}
            ${inThis && V.tab !== 'team' ? `<button onclick="vsOpenSquadChat('${jsq(q.id)}')" class="${DARK} w-full"><i class="fa-solid fa-comments mr-1"></i>Squad chat${q.chatTeamId ? '' : ' (starts it)'}</button>` : ''}
            ${action}
        </div>`;
}
function squadBoxHtml(m) {
    const list = squadsOf(m);
    const mine = mySquad(m);
    if (!(m.squadsOn !== false && m.status === 'open') || (isFull(m) && !mine)) return '';
    const need = perSideOf(m);
    const onTeam = myStake(m) === 'team';
    const waitingIn = myRequestSquad(m);
    const rows = list.map(q => squadRowHtml(m, q)).join('');
    return `<div class="bg-fuchsia-500/10 border border-fuchsia-400/40 rounded-2xl p-3 space-y-2">
        <div class="text-sm font-black">🧩 No team? Play as a free agent</div>
        <p class="text-[11px] text-white/75 leading-relaxed">Start a squad (you're its captain) or join one. A squad only plays if it gets <b>${need} players before teams take the open spots</b>. When it's full, it becomes a temporary team for this match with its own group chat. The captain handles ${(+m.priceCents || 0) > 0 ? `the ${money(m.priceCents)} team fee` : 'the details'}. If teams fill the spots first, the squad is off and nobody pays.</p>
        ${waitingIn && !mine ? `<p class="text-[11px] text-amber-200">You asked to join ${esc(waitingIn.name)}. Waiting for the captain.</p>` : ''}
        ${rows}
        ${myUid() && !onTeam && squadOpen(m) ? `<button onclick="openStartSquad()" class="${DARK} w-full"><i class="fa-solid fa-plus mr-1"></i>Start a new squad</button>` : ''}
    </div>`;
}
// ---------------------------------------------------------------- 🛡️ My Team tab (the team I'm on, for THIS match)
/** The match entry of a team I'm a member of (captain or player), temp squads included. */
function myTeamEntry(m) {
    const ids = new Set((TS().mine || []).map(t => t.id));
    return (m.teams || []).find(t => ids.has(t.teamId) || ((teamFull(t.teamId) || {}).memberUids || []).includes(myUid())) || null;
}
const comingOf = (entry, p) => (entry.roster || []).includes(p.id) ? 'in' : (entry.out || []).includes(p.id) ? 'out' : '';
function myTeamTabHtml(m) {
    const entry = myTeamEntry(m);
    const live = m.status === 'open' || m.status === 'challenge';
    const need = perSideOf(m), price = +m.priceCents || 0;
    const H = (t) => `<div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">${t}</div>`;
    if (!entry) {
        const q = mySquad(m); if (!q) return '';
        const left = Math.max(0, need - q.members.length);
        return `<div class="space-y-3">
            <div class="bg-fuchsia-500/10 border border-fuchsia-400/40 rounded-2xl p-3 space-y-1">
                <div class="text-sm font-black">🧩 ${esc(q.name)} <span class="text-[9px] font-black rounded-full px-1.5 py-0.5 bg-fuchsia-500/30 text-fuchsia-100 align-middle">TEMP SQUAD</span></div>
                <p class="text-[11px] text-white/75">${left ? `You need <b>${left} more player${left === 1 ? '' : 's'}</b> before teams take the open spots.` : 'Your squad is full!'} Tap "Squad chat" to talk with your squad now. When it's full it becomes a temporary team for this match (same chat).</p>
            </div>
            <button onclick="vsOpenSquadChat('${jsq(q.id)}')" class="${BTN} w-full"><i class="fa-solid fa-comments mr-1"></i>Squad chat</button>
            ${squadRowHtml(m, q)}
            <button onclick="shareVs()" class="${DARK} w-full"><i class="fa-solid fa-share-nodes mr-1"></i>Invite friends to the squad</button>
        </div>`;
    }
    const team = teamFull(entry.teamId) || { members: [] };
    const iCap = canManage(team);
    const locked = rosterLocked(m);
    const canEdit = live && !locked && entry.state !== 'invited';
    const members = team.members || [];
    const meM = members.find(p => p.uid === myUid());
    const coming = members.filter(p => comingOf(entry, p) === 'in').length;
    const paid = paidCents(m, entry.teamId);
    const chip = (st) => st === 'in' ? '<span class="text-[9px] font-black rounded-full px-2 py-0.5 bg-[#00F296] text-slate-950">COMING</span>'
        : st === 'out' ? '<span class="text-[9px] font-black rounded-full px-2 py-0.5 bg-red-500/25 text-red-300">OUT</span>'
        : '<span class="text-[9px] font-black rounded-full px-2 py-0.5 bg-white/10 text-white/55">NO ANSWER</span>';
    const mySt = meM ? comingOf(entry, meM) : '';
    return `<div class="space-y-3">
        <div class="bg-black/40 border border-white/10 rounded-2xl p-3 flex items-center gap-3">
            <button onclick="vsOpenTeam('${jsq(entry.teamId)}')" class="shrink-0">${teamLogoHtml(entry, 46)}</button>
            <div class="flex-1 min-w-0"><div class="text-sm font-black truncate">${esc(entry.name)}${team.temp ? ' <span class="text-[9px] font-black rounded-full px-1.5 py-0.5 bg-fuchsia-500/30 text-fuchsia-100 align-middle">TEMP SQUAD</span>' : ''}</div>
                <div class="text-[11px] text-white/60">${iCap ? "You're the captain" : "You're a player"} · ${entry.state === 'confirmed' ? '✅ Confirmed for this match' : entry.state === 'invited' ? 'Invited (the captain answers in Teams)' : '⏳ Not confirmed yet'}</div></div>
        </div>
        ${team.temp ? '<p class="text-[11px] text-fuchsia-200">This is a temporary team, just for this match.</p>' : ''}
        ${meM && live ? `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2">${H('Are you coming?')}
            <div class="flex gap-2">
                <button onclick="vsSetComing('${jsq(entry.teamId)}','${jsq(meM.id)}', true)" ${canEdit ? '' : 'disabled'} class="flex-1 py-2.5 rounded-xl text-xs font-black ${mySt === 'in' ? 'bg-[#00F296] text-slate-950' : 'bg-white/10 text-white'}">✅ I'm in</button>
                <button onclick="vsSetComing('${jsq(entry.teamId)}','${jsq(meM.id)}', false)" ${canEdit ? '' : 'disabled'} class="flex-1 py-2.5 rounded-xl text-xs font-black ${mySt === 'out' ? 'bg-red-500 text-white' : 'bg-white/10 text-white'}">❌ Can't make it</button>
            </div>${locked ? '<p class="text-[11px] text-amber-200">🔒 The roster is locked now (close to kickoff).</p>' : ''}</div>` : ''}
        <div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2">
            <div class="flex items-center justify-between">${H("Who's coming")}<span class="text-xs font-black ${coming >= need ? 'text-[#00F296]' : 'text-amber-300'}">${coming}/${need}</span></div>
            ${coming < need ? `<p class="text-[11px] text-amber-200">You need ${need - coming} more to play ${esc(m.format || '')}.</p>` : ''}
            ${members.map(p => { const st = comingOf(entry, p); const nm = p.uid ? personName(p.uid, p.name) : p.name;
                return `<div class="flex items-center gap-2 bg-white/5 rounded-xl px-2 py-1.5">
                <img src="${esc(p.uid ? personAvatar(p.uid, p.avatar, nm) : DEFAULT_AV)}" onerror="this.src='${DEFAULT_AV}'" class="w-7 h-7 rounded-full object-cover">
                <span class="w-6 text-center text-xs font-black text-[#00F296]">${esc(p.number || '')}</span>
                <span class="flex-1 min-w-0 text-xs font-bold truncate">${esc(nm)}${p.role === 'captain' ? ' <span class="text-[9px] text-amber-300">(C)</span>' : ''}${p.position ? ` <span class="text-white/45">${esc(p.position)}</span>` : ''}</span>
                ${iCap && canEdit ? `<button onclick="vsSetComing('${jsq(entry.teamId)}','${jsq(p.id)}', ${st !== 'in'})" class="text-[10px] font-black rounded-lg px-2 py-1 ${st === 'in' ? 'bg-[#00F296] text-slate-950' : st === 'out' ? 'bg-red-500/25 text-red-300' : 'bg-white/10 text-white/60'}">${st === 'in' ? 'COMING ✓' : st === 'out' ? 'OUT' : 'Mark in'}</button>` : chip(st)}
            </div>`; }).join('') || '<p class="text-xs text-white/50">No players on the team yet.</p>'}
            ${iCap && canEdit ? '<p class="text-[10px] text-white/45">Tap a player to switch them between coming and out.</p>' : ''}
        </div>
        ${price ? `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-1">${H('Money')}
            <div class="flex justify-between text-xs"><span>Team fee</span><b>${money(price)}</b></div>
            <div class="flex justify-between text-xs"><span>Paid so far</span><b class="${paid >= price ? 'text-[#00F296]' : 'text-amber-300'}">${money(paid)}</b></div>
            ${coming ? `<div class="flex justify-between text-xs"><span>Split between ${coming} coming</span><b>${money(Math.ceil(price / coming))} each</b></div>` : ''}
            <p class="text-[10px] text-white/45">${iCap ? 'Pay the organizer. They mark it as paid.' : 'Pay your captain. The captain pays the organizer.'}</p></div>` : ''}
        <div class="grid grid-cols-2 gap-2">
            <button onclick="vsSquadChat('${jsq(entry.teamId)}')" class="${BTN}"><i class="fa-solid fa-comments mr-1"></i>Team chat</button>
            ${iCap && live ? `<button onclick="vsRemindTeam('${jsq(entry.teamId)}')" class="${DARK}">📣 Remind the team</button>` : `<button onclick="vsOpenTeam('${jsq(entry.teamId)}')" class="${DARK}">👥 Team page</button>`}
            ${iCap && live ? `<button onclick="vsOpenTeam('${jsq(entry.teamId)}')" class="${DARK}">👥 Team page</button>
            <button onclick="leaveVs('${jsq(entry.teamId)}')" class="${DARK} !text-red-400">Leave match</button>` : ''}
        </div>
    </div>`;
}
/** Coming (true) or out (false) for this match. Players set themselves; the captain can set anyone. */
window.vsSetComing = async function (teamId, memberId, yes) {
    const m = V.open; if (!m) return;
    try {
        await changeMatch(m.id, (x) => {
            if (rosterLocked(x)) throw new Error('LOCKED');
            const t = x.teams.find(y => y.teamId === teamId); if (!t) return false;
            t.roster = (t.roster || []).filter(id => id !== memberId); t.out = (t.out || []).filter(id => id !== memberId);
            (yes ? t.roster : t.out).push(memberId);
        });
    } catch (e) { toast(String(e && e.message) === 'LOCKED' ? 'Rosters are locked now.' : "Couldn't save.", 'error'); }
};
/** Captain: a message in the team chat (everyone gets the push) asking who's coming. */
window.vsRemindTeam = async function (teamId) {
    const m = V.open; if (!m) return;
    const when = `${(window.fmtGameDate || prettyDate)(m.date)} ${prettyTime(m.time)}`.trim();
    const text = `⚽ ${vsTitleOf(m)} · ${when}${m.location ? ' · ' + m.location : ''}\nAre you coming? Open the match, go to the "My Team" tab and tap "I'm in" or "Can't make it".`;
    const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    try {
        await setDoc(doc(collection(db, 'artifacts', appId, 'teams', teamId, 'messages'), id), { id, senderUid: myUid(), sender: myName(), avatar: myAvatar(), text, vsMatchId: m.id, createdAt: serverTimestamp() });
        toast('Sent to the team chat! 📣');
    } catch (e) { toast("Couldn't send it.", 'error'); }
};

const SQUAD_COLORS = [['#7C3AED', '#FFFFFF'], ['#F97316', '#0B141A'], ['#0EA5E9', '#FFFFFF'], ['#FACC15', '#0B141A'], ['#EC4899', '#FFFFFF'], ['#14B8A6', '#0B141A']];
function meAsMember() {
    const prof = window.userProfile || {};
    return { uid: myUid(), name: myName(), avatar: myAvatar(), position: String(prof.position || prof.preferredPosition || '').slice(0, 12), at: Date.now() };
}
const withoutMe = (q) => ({ ...q, members: q.members.filter(p => p.uid !== myUid()), requests: q.requests.filter(p => p.uid !== myUid()), captainUid: q.captainUid === myUid() ? '' : q.captainUid });
/** One transaction: change the squads, and if one is full (with a captain) while a spot is open, it becomes a team. */
async function changeSquads(matchId, fn) {
    let formed = null;
    await runTransaction(db, async (tx) => {
        const ref = D('vsMatches', matchId);
        const s = await tx.get(ref);
        if (!s.exists()) throw new Error('GONE');
        const x = s.data();
        let squads = squadsOf(x);
        squads = fn(squads, x);
        if (!squads) return;
        squads = squads.filter(q => q.members.length);
        // The captain left: nobody is captain until someone takes charge (the server tells the squad).
        squads.forEach(q => { if (q.captainUid && !q.members.some(p => p.uid === q.captainUid)) q.captainUid = ''; });
        const patch = { forming: [], updatedBy: myUid(), updatedAt: serverTimestamp() };
        const need = perSideOf(x);
        const full = squads.find(q => q.members.length >= need && q.captainUid);
        if (full && !isFull(x)) {
            const capFirst = [full.members.find(p => p.uid === full.captainUid), ...full.members.filter(p => p.uid !== full.captainUid)].filter(Boolean);
            const players = capFirst.slice(0, need);
            const k = (+x.squadCount || 0) + 1;
            const used = new Set((x.teams || []).map(t => String((t.colors || {}).primary || '').toLowerCase()));
            const [primary, secondary] = SQUAD_COLORS.find(c => !used.has(c[0].toLowerCase())) || SQUAD_COLORS[0];
            const tRef = full.chatTeamId ? D('teams', full.chatTeamId) : doc(C('teams'));   // keeps the squad chat that was already started
            const name = full.name && full.name !== 'Free agents' ? full.name : (k > 1 ? `Free Agents FC ${k}` : 'Free Agents FC');
            const team = {
                name, nameKey: '', short: 'FA', temp: true, forMatchId: matchId, forMatchDate: x.date || '',
                colors: { primary, secondary }, logo: { type: 'crest', shape: 'shield', style: 'filled', pattern: 'stripes', icon: '🧩', text: 'short', ring: false },
                level: x.level || 'casual', joinMode: 'invite', city: x.city || '', state: x.state || '', country: '',
                rosterPrivate: false, lineupPrivate: false, ownerId: full.captainUid,
                members: players.map(p => ({ id: p.uid, uid: p.uid, name: p.name, number: '', position: p.position || '', role: p.uid === full.captainUid ? 'captain' : 'player' })),
                memberUids: players.map(p => p.uid), lineups: [], schedule: [], communityIds: [], record: {},
                createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: myUid(),
            };
            tx.set(tRef, team);
            const teams = (x.teams || []).map(t => ({ ...t }));
            const entry = teamEntry({ ...team, id: tRef.id }, (+x.priceCents || 0) > 0 ? 'pending' : 'confirmed');
            entry.roster = players.map(p => p.uid);
            teams.push(entry);
            const settled = settle({ ...x, teams });
            const placed = new Set(players.map(p => p.uid));
            squads = squads.map(q => q.id === full.id ? null : q).filter(Boolean);
            // Anyone past a full team waits in a new squad of their own (no captain yet).
            const extra = full.members.filter(p => !placed.has(p.uid));
            if (extra.length) squads.push({ id: 'sq_' + Date.now().toString(36), name: `${full.name} 2`, captainUid: '', joinMode: full.joinMode, members: extra, requests: [], at: Date.now() });
            Object.assign(patch, { teams: settled.teams, teamIds: settled.teams.map(t => t.teamId), squadCount: k });
            formed = name;
        }
        patch.squads = squads.map(q => (q.id === 'legacy' ? { ...q, id: 'sq_legacy' } : q));
        tx.update(ref, patch);
    });
    return formed;
}
const squadErr = (e) => { const c = String(e && e.message); toast(c === 'FULL' ? 'Sorry, teams took all the spots.' : c === 'CLOSED' ? 'This match is not taking free agents.' : c === 'NOT_CAPTAIN' ? 'Only the squad captain can do that.' : c === 'TAKEN' ? 'Someone already took charge.' : "Couldn't do that.", 'error'); };
const checkOpen = (x) => { if (x.status !== 'open' || x.squadsOn === false) throw new Error('CLOSED'); if (isFull(x)) throw new Error('FULL'); };
window.openStartSquad = function () {
    const m = V.open; if (!m) return;
    const first = String(myName()).split(' ')[0] || 'My';
    document.getElementById('vs-spot')?.remove();
    sheet('vs-squad-new', '🧩 Start a free-agent squad', `
        <p class="text-[11px] text-white/65 leading-relaxed">You'll be the <b>captain</b>: you handle the payment and decide who's in. When your squad reaches <b>${perSideOf(m)} players</b> before teams take the spots, it plays this match as a team, with its own group chat.</p>
        <div>${LBL('Squad name')}<input id="sq-name" class="${INPUT}" maxlength="30" value="${esc(first)}'s Squad"></div>
        <div>${LBL('Who can join?')}${seg('sq-mode', [['open', 'Anyone can join'], ['ask', 'They ask, I approve']], 'open')}</div>
        <button onclick="startVsSquad()" class="w-full py-3 rounded-xl text-sm font-black text-white bg-gradient-to-r from-fuchsia-600 to-purple-600">Start squad</button>`);
};
window.startVsSquad = async function () {
    const m = V.open; if (!m || !myUid()) return;
    const name = (val('sq-name') || `${String(myName()).split(' ')[0]}'s Squad`).slice(0, 30);
    const joinMode = segVal('sq-mode') === 'ask' ? 'ask' : 'open';
    try {
        const formed = await changeSquads(m.id, (squads, x) => {
            checkOpen(x);
            const out = squads.map(withoutMe);
            out.push({ id: 'sq_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, captainUid: myUid(), joinMode, members: [meAsMember()], requests: [], at: Date.now() });
            return out;
        });
        document.getElementById('vs-squad-new')?.remove();
        toast(formed ? `Squad complete! You're "${formed}".` : `"${name}" started. You're the captain: share the match so free agents join you.`);
    } catch (e) { squadErr(e); }
};
window.joinVsSquad = async function (squadId) {
    const m = V.open; if (!m || !myUid()) return;
    let asked = false;
    try {
        const formed = await changeSquads(m.id, (squads, x) => {
            checkOpen(x);
            const q0 = squads.find(q => q.id === squadId);
            if (!q0) throw new Error('GONE');
            asked = q0.joinMode === 'ask' && q0.captainUid !== myUid();
            if (asked) return squads.map(q => q.id === squadId ? { ...q, requests: [...q.requests.filter(p => p.uid !== myUid()), meAsMember()] } : { ...q, requests: q.requests.filter(p => p.uid !== myUid()) });
            return squads.map(q => { const r = withoutMe(q); return q.id === squadId ? { ...r, members: [...r.members, meAsMember()] } : r; });
        });
        document.getElementById('vs-spot')?.remove();
        toast(asked ? 'Request sent! The captain will let you know.' : formed ? `Squad complete! You're "${formed}". Your squad chat is ready in Chats.` : "You're in the squad! We'll let you know if it fills up.");
    } catch (e) { squadErr(e); }
};
window.cancelSquadRequest = async function (squadId) {
    const m = V.open; if (!m) return;
    try { await changeSquads(m.id, (squads) => squads.map(q => q.id === squadId ? { ...q, requests: q.requests.filter(p => p.uid !== myUid()) } : q)); } catch (e) { squadErr(e); }
};
window.answerSquadRequest = async function (squadId, uid, yes) {
    const m = V.open; if (!m) return;
    try {
        const formed = await changeSquads(m.id, (squads, x) => {
            const q0 = squads.find(q => q.id === squadId);
            if (!q0 || q0.captainUid !== myUid()) throw new Error('NOT_CAPTAIN');
            const p = q0.requests.find(r => r.uid === uid); if (!p) return false;
            if (yes) checkOpen(x);
            return squads.map(q => {
                if (q.id === squadId) return { ...q, requests: q.requests.filter(r => r.uid !== uid), members: yes ? [...q.members.filter(r => r.uid !== uid), { ...p, at: Date.now() }] : q.members };
                // Accepted here: out of any other squad.
                return yes ? { ...q, members: q.members.filter(r => r.uid !== uid), requests: q.requests.filter(r => r.uid !== uid) } : q;
            });
        });
        if (formed) toast(`Squad complete! "${formed}" takes the spot.`);
    } catch (e) { squadErr(e); }
};
window.setSquadJoinMode = async function (squadId, ask) {
    const m = V.open; if (!m) return;
    try {
        await changeSquads(m.id, (squads) => squads.map(q => {
            if (q.id !== squadId) return q;
            if (q.captainUid !== myUid()) throw new Error('NOT_CAPTAIN');
            // Back to "anyone can join": everyone who asked is in.
            return ask ? { ...q, joinMode: 'ask' } : { ...q, joinMode: 'open', members: [...q.members, ...q.requests], requests: [] };
        }));
    } catch (e) { squadErr(e); }
};
window.takeSquadCharge = async function (squadId) {
    const m = V.open; if (!m) return;
    try {
        const formed = await changeSquads(m.id, (squads) => squads.map(q => {
            if (q.id !== squadId) return q;
            if (q.captainUid) throw new Error('TAKEN');
            if (!q.members.some(p => p.uid === myUid())) throw new Error('NOT_CAPTAIN');
            return { ...q, captainUid: myUid() };
        }));
        toast(formed ? `You're the captain, and "${formed}" just took the spot!` : "You're the captain now. You handle the payment and who joins.");
    } catch (e) { squadErr(e); }
};
window.leaveVsSquad = async function (squadId) {
    const m = V.open; if (!m) return;
    const q0 = squadsOf(m).find(q => q.id === squadId);
    if (q0 && q0.captainUid === myUid() && q0.members.length > 1 && !confirm('You are the captain. If you leave, the others are asked who takes charge. Leave?')) return;
    try { await changeSquads(m.id, (squads) => squads.map(q => q.id === squadId ? withoutMe(q) : q)); toast('You left the squad.'); }
    catch (e) { squadErr(e); return; }
    if (q0 && q0.chatTeamId) leaveSquadChat(q0.chatTeamId);
};
/** Out of a forming squad's chat too (only while it's still just a chat). */
async function leaveSquadChat(chatId) {
    try {
        await runTransaction(db, async (tx) => {
            const r = D('teams', chatId); const s = await tx.get(r);
            if (!s.exists() || !s.data().chatOnly) return;
            const members = (s.data().members || []).filter(p => p.uid !== myUid());
            tx.update(r, { members, memberUids: members.map(p => p.uid), updatedBy: myUid(), updatedAt: serverTimestamp() });
        });
    } catch (e) { /* ignore */ }
}
/** 💬 A forming squad's chat: made the first time someone taps it (a temporary team doc, chatOnly, so it lives in Chats).
 *  When the squad fills up, the real temp team takes over the same doc, so the chat history stays. */
window.vsOpenSquadChat = async function (squadId) {
    const m = V.open; if (!m || !myUid()) return;
    let chatId = '', q = null;
    try {
        await changeSquads(m.id, (squads) => {
            const s = squads.find(x => x.id === squadId);
            if (!s || !s.members.some(p => p.uid === myUid())) throw new Error('NOT_IN');
            if (!s.chatTeamId) s.chatTeamId = doc(C('teams')).id;
            chatId = s.chatTeamId; q = { ...s, members: [...s.members] };
            return squads;
        });
    } catch (e) { toast(String(e && e.message) === 'NOT_IN' ? "You're not in this squad anymore." : "Couldn't open the chat.", 'error'); return; }
    // Now the chat's members = whoever is in the squad right now (heals people who left or joined).
    const mine = (TS().mine || []).find(t => t.id === chatId);
    if (mine && !mine.chatOnly) { window.vsSquadChat(chatId); return; }   // the squad already became a real temp team
    const members = q.members.map(p => ({ id: p.uid, uid: p.uid, name: p.name, number: '', position: p.position || '', role: p.uid === q.captainUid ? 'captain' : 'player' }));
    if (!members.some(p => p.uid === myUid())) members.push({ id: myUid(), uid: myUid(), name: myName(), number: '', position: '', role: 'player' });
    try {
        await setDoc(D('teams', chatId), {
            name: q.name || 'Squad', nameKey: '', short: 'FA', temp: true, chatOnly: true, forMatchId: m.id, forMatchDate: m.date || '', forSquadId: squadId,
            colors: { primary: '#7C3AED', secondary: '#FFFFFF' }, logo: { type: 'crest', shape: 'shield', style: 'filled', pattern: 'stripes', icon: '🧩', text: 'short', ring: false },
            joinMode: 'invite', ownerId: q.captainUid || myUid(), members, memberUids: members.map(p => p.uid),
            updatedAt: serverTimestamp(), updatedBy: myUid(), ...(mine ? {} : { createdAt: serverTimestamp() }),
        }, { merge: true });
    } catch (e) { console.warn('squad chat', e); }
    // Wait until the chat shows up in my list, then open it.
    const t0 = Date.now();
    const go = () => { if ((TS().mine || []).some(t => t.id === chatId) || Date.now() - t0 > 4000) window.vsSquadChat(chatId); else setTimeout(go, 250); };
    go();
};
window.vsSquadChat = function (teamId) {
    window.closeVsMatch();
    setTimeout(() => { if (window.openCommunityChat) window.openCommunityChat('team:' + teamId); }, 120);
};

// ---------------------------------------------------------------- the "+" on an open spot
window.openVsSpot = function () {
    const m = V.open; if (!m || m.status !== 'open' || isFull(m)) return;
    const boss = m.organizerId === myUid();
    const mine = myCaptainTeams().filter(t => !(m.teamIds || []).includes(t.id));
    const onTeam = myStake(m) === 'team';
    const squads = squadsOf(m);
    const opt = (onclick, icon, title, sub, cls = 'bg-white/5 border-white/10') => `<button onclick="${onclick}" class="w-full text-left flex items-center gap-3 rounded-2xl border ${cls} p-3">
        <span class="w-10 h-10 rounded-xl bg-black/50 flex items-center justify-center text-lg shrink-0">${icon}</span>
        <span class="min-w-0"><span class="block text-sm font-black">${title}</span><span class="block text-[11px] text-white/60">${sub}</span></span></button>`;
    sheet('vs-spot', 'Take this open spot', `
        ${mine.length ? mine.map(t => opt(`document.getElementById('vs-spot').remove();vsJoinWith('${jsq(t.id)}')`, teamLogoHtml(t, 32), `Add ${esc(t.name)}`, 'Your team takes the spot')).join('')
            : (!onTeam ? opt(`document.getElementById('vs-spot').remove();vsCreateTeamForSpot()`, '🛡️', 'Add a team', "Create your team, then it takes the spot") : '')}
        ${m.squadsOn !== false && !onTeam ? opt('openStartSquad()', '🧩', 'Start a free-agent squad', "No team? You're the captain: you pick who joins and handle the payment", 'bg-fuchsia-500/10 border-fuchsia-400/40') : ''}
        ${m.squadsOn !== false && !onTeam && squads.length ? `<div class="text-[10px] font-black uppercase tracking-wider text-white/55 pt-1">Or join a squad</div>
            ${squads.map(q => opt(`joinVsSquad('${jsq(q.id)}')`, '🧩', esc(q.name), `${q.members.length}/${perSideOf(m)} players · ${q.captainUid ? 'captain ' + esc(personName(q.captainUid, (q.members[0] || {}).name)) : 'no captain right now'}${q.joinMode === 'ask' ? ' · ask to join' : ''}`)).join('')}` : ''}
        ${boss ? opt(`document.getElementById('vs-spot').remove();openAddTeamManually()`, '➕', 'Add a team yourself', 'Any FutNet team, or type the name of a team not on FutNet') : ''}`);
};
window.vsJoinWith = async function (teamId) {
    const m = V.open; if (!m) return;
    const team = myCaptainTeams().find(t => t.id === teamId); if (!team) return;
    try {
        await changeMatch(m.id, (x) => {
            if (x.status !== 'open' || x.teams.some(t => t.teamId === team.id)) return false;
            if (isFull(x) && (x.firstToPay === false || (+x.priceCents || 0) <= 0)) throw new Error('FULL');
            x.teams.push(teamEntry(team, (+x.priceCents || 0) > 0 ? 'pending' : 'confirmed'));
            settle(x);
        });
        toast(`${team.name} is in! Now pick who's coming.`);
    } catch (e) { toast(String(e && e.message) === 'FULL' ? 'Sorry, the match just filled up.' : "Couldn't join.", 'error'); }
};
window.vsCreateTeamForSpot = function () {
    const id = V.open && V.open.id;
    window.__afterTeamCreated = (teamId) => {
        let tries = 0;
        const back = () => {
            if (myCaptainTeams().some(t => t.id === teamId) || tries++ > 20) { window.openVsMatch(id); setTimeout(() => window.vsJoinWith(teamId), 300); }
            else setTimeout(back, 250);
        };
        setTimeout(back, 150);
    };
    window.openCreateTeam && window.openCreateTeam();
};

// ---------------------------------------------------------------- organizer tools: add a team, edit, copy
window.openAddTeamManually = async function () {
    const m = V.open; if (!m) return;
    if (!(TS().all || []).length) {
        try { const { getDocs } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"); const s = await getDocs(C('teams')); (window.__teamsState || {}).all = s.docs.map(d => ({ ...d.data(), id: d.id })).filter(t => !t.temp); } catch (e) { /* ignore */ }
    }
    window._vsAddPick = '';
    sheet('vs-add', '➕ Add a team', `
        <input id="va-q" class="${INPUT}" placeholder="Search FutNet teams, or type a team name" oninput="vsAddSearch(this.value)" autocomplete="off">
        <div id="va-list" class="space-y-1.5 max-h-72 overflow-y-auto"></div>
        <p class="text-[10px] text-white/45">A FutNet team's captains get a notification. A team that's not on FutNet is added by name only.</p>`);
    window.vsAddSearch('');
    setTimeout(() => document.getElementById('va-q')?.focus(), 50);
};
window.vsAddSearch = function (q) {
    const m = V.open; const box = document.getElementById('va-list'); if (!m || !box) return;
    const k = String(q || '').trim().toLowerCase();
    const list = (TS().all || []).filter(t => !t.temp && !(m.teamIds || []).includes(t.id) && (!k || `${t.name} ${t.city || ''}`.toLowerCase().includes(k))).slice(0, 25);
    box.innerHTML = list.map(t => `<button onclick="vsAddTeam('${jsq(t.id)}')" class="w-full flex items-center gap-3 rounded-xl px-3 py-2 border border-white/10 bg-white/5 text-left">${teamLogoHtml(t, 30)}
            <span class="min-w-0"><span class="block text-sm font-black truncate">${esc(t.name)}</span><span class="block text-[10px] text-white/50">${esc(t.city || '')}${t.city ? ' · ' : ''}${(t.members || []).length} players</span></span></button>`).join('')
        + (k ? `<button onclick="vsAddTeam('', document.getElementById('va-q').value)" class="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 border border-dashed border-[#00F296]/60 text-left"><span class="text-lg">✍️</span><span class="text-sm font-black">Add "${esc(q.trim())}" (not on FutNet)</span></button>` : '');
};
window.vsAddTeam = async function (teamId, typed) {
    const m = V.open; if (!m) return;
    let entry;
    if (teamId) {
        const t = (TS().all || []).find(x => x.id === teamId); if (!t) return;
        entry = teamEntry(t, 'confirmed');
    } else {
        const name = String(typed || '').trim().slice(0, 40); if (!name) return;
        const [primary, secondary] = SQUAD_COLORS[(m.teams || []).length % SQUAD_COLORS.length];
        entry = { teamId: 'x_' + Date.now().toString(36), name, short: name.replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase() || 'TM',
            logo: { type: 'crest', shape: 'shield', style: 'filled', pattern: 'plain', icon: '', text: 'short' }, colors: { primary, secondary }, roster: [], joinedAt: Date.now(), offApp: true };
    }
    // Free match: in right away. Paid: it still needs its payment marked (the organizer added it).
    entry.state = (+m.priceCents || 0) > 0 ? 'pending' : 'confirmed';
    entry.addedBy = myUid();
    try {
        await changeMatch(m.id, (x) => {
            if (x.teams.some(t => t.teamId === entry.teamId)) return false;
            if (spotsTaken(x) >= (x.teamsCount || 2) && entry.state === 'confirmed') throw new Error('FULL');
            x.teams.push(entry); settle(x);
        });
        document.getElementById('vs-add')?.remove();
        toast(`${entry.name} added.`);
    } catch (e) { toast(String(e && e.message) === 'FULL' ? 'All spots are taken. Remove a team first or add more teams in Edit.' : "Couldn't add the team.", 'error'); }
};
window.editVs = function () {
    const m = V.open; if (!m) return;
    window.openCreateVs({ ...m, editId: m.id });
};
window.copyVs = function () {
    const m = V.open; if (!m) return;
    const mineIn = (m.teams || []).find(t => myCaptainTeams().some(x => x.id === t.teamId));
    window.openCreateVs({ title: m.title, park: m.park, city: m.city, state: m.state, location: m.location, time: m.time, format: m.format, level: m.level, teamsCount: m.teamsCount,
        priceCents: m.priceCents, firstToPay: m.firstToPay, partial: m.partial, payByHours: m.payByHours, rosterLockHours: m.rosterLockHours, squadsOn: m.squadsOn !== false,
        description: m.description || '', rules: m.rules || '', refundNote: m.refundNote || '',
        include: !!mineIn, teamId: mineIn ? mineIn.teamId : '', copied: true });
};

// ---------------------------------------------------------------- 🔴 livestream + ⏱️ match management (same as normal games)
//   m.livestream = { url, provider: 'youtube'|'facebook', videoId (YouTube), embedUrl (Facebook), status: 'live'|'ended', startedAt, startedByName }
//   m.live = the game being played now (like a normal game's liveMatchActive):
//            { a, b (team ids), mode: 'timer'|'stopwatch', durationSeconds, elapsedSeconds, isRunning, lastUpdatedTimestamp,
//              alarmEnabled, startedAt, goals: [{ teamId, name, own (own goal by the other team), minute, at }] }
//   m.results = games already played: [{ a, b, ga, gb, goals, at }]. With 2 teams, saving the game is the final score.
const lsKey = (ls) => (ls && (ls.videoId || ls.embedUrl)) || '';
const lsSource = (u) => liveSource(u);
window.openVsLivestream = function () {
    const m = V.open; if (!m) return;
    sheet('vs-ls', '🔴 Livestream this match', `
        <ol class="text-[11px] text-white/70 space-y-1 list-decimal pl-4">
            <li>Start the live on <b>YouTube</b> or <b>Facebook</b> (camera like XbotGo, or the app). On Facebook, set it to <b>Public</b>.</li>
            <li>Open the live video and tap <b>Share → Copy link</b>.</li>
            <li>Paste it here.</li></ol>
        <input id="vls-url" type="url" inputmode="url" class="${INPUT}" placeholder="YouTube or Facebook live link">
        <button onclick="startVsLivestream()" class="w-full bg-red-600 text-white font-black py-3 rounded-xl text-sm">Go live</button>`);
};
window.startVsLivestream = async function () {
    const url = val('vls-url'); const src = lsSource(url);
    if (!src) { toast(liveLinkProblem(url), 'error'); return; }
    try {
        await changeMatch(V.open.id, (x) => { x._edit = { livestream: { url, ...src, status: 'live', startedAt: Date.now(), startedBy: myUid(), startedByName: myName() } }; });
        document.getElementById('vs-ls')?.remove(); V.tab = 'live'; toast("You're live! 🔴 Everyone in the match was notified."); drawPage();
    } catch (e) { toast("Couldn't start the livestream.", 'error'); }
};
window.endVsLivestream = async function () {
    if (!confirm('End the livestream? The video stays on the match as a replay.')) return;
    try { await changeMatch(V.open.id, (x) => { if (!x.livestream) return false; x._edit = { livestream: { ...x.livestream, status: 'ended', endedAt: Date.now() } }; }); } catch (e) { /* ignore */ }
};
window.removeVsLivestream = async function () {
    if (!confirm('Remove the video from this match?')) return;
    try { await changeMatch(V.open.id, (x) => { x._edit = { livestream: null }; }); V.tab = 'info'; } catch (e) { /* ignore */ }
};
function liveTabHtml(m, boss) {
    const ls = m.livestream;
    if (!ls || !lsKey(ls)) return '<p class="text-xs text-white/50 text-center py-8">No livestream on this match.</p>';
    const on = ls.status === 'live';
    setTimeout(() => { if (window.mountLivePlayer) window.mountLivePlayer(); }, 0);
    return `<div class="space-y-3">
        <div class="flex items-center gap-2">${on ? '<span class="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">● LIVE</span>' : '<span class="bg-white/10 text-white/80 text-[10px] font-black px-2 py-0.5 rounded-full">▶ REPLAY</span>'}
            <span class="flex-1 text-xs text-white/60 truncate">${on ? `Streaming now · ${esc(ls.startedByName || '')}` : 'The livestream has ended. Watch the replay.'}</span>
            <a href="${esc(ls.url || `https://youtu.be/${ls.videoId}`)}" target="_blank" rel="noopener" class="text-[10px] font-black text-white/70 underline shrink-0">Open in ${ls.provider === 'facebook' ? 'Facebook' : 'YouTube'}</a></div>
        ${liveSlotHtml(ls)}
        ${liveScoreHtml(m)}
        ${boss ? `<div class="flex gap-2">${on ? `<button onclick="endVsLivestream()" class="flex-1 bg-red-600 text-white font-black text-xs py-2.5 rounded-xl">End livestream</button>`
            : `<button onclick="openVsLivestream()" class="flex-1 bg-red-600 text-white font-black text-xs py-2.5 rounded-xl">Start a new livestream</button><button onclick="removeVsLivestream()" class="${DARK}">Remove video</button>`}</div>` : ''}
    </div>`;
}
/** Seconds on the clock now (counts down for a timer, up for a stopwatch). */
export function liveSecs(L, now = Date.now()) {
    if (!L) return 0;
    if (!L.mode) return Math.floor(((+L.baseMs || 0) + (L.running && L.since ? now - L.since : 0)) / 1000);   // older format
    const base = L.elapsedSeconds != null ? +L.elapsedSeconds : (L.mode === 'timer' ? (+L.durationSeconds || 600) : 0);
    if (!L.isRunning) return base;
    const diff = Math.floor((now - (+L.lastUpdatedTimestamp || now)) / 1000);
    return L.mode === 'stopwatch' ? base + diff : Math.max(0, base - diff);
}
const liveRunning = (L) => !!(L && (L.isRunning != null ? L.isRunning : L.running));
const clockText = (secs) => { const s = Math.max(0, Math.floor(secs)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const liveGoals = (m, teamId) => ((m.live && m.live.goals) || []).filter(g => g.teamId === teamId).length;
/** The two teams on the field: the ones picked (3-4 team matches), else the first two confirmed. */
function livePair(m) {
    const conf = confirmedTeams(m);
    const L = m.live || {};
    const a = conf.find(t => t.teamId === L.a), b = conf.find(t => t.teamId === L.b);
    return a && b ? [a, b] : [conf[0], conf[1]];
}
const goalName = (g) => g.own ? `${g.name || 'Player'} (own goal)` : (g.name || 'Goal');
/** Live score card (everyone sees it on the match page). */
function liveScoreHtml(m) {
    const conf = confirmedTeams(m);
    if (conf.length < 2 || !m.live) return '';
    const [a, b] = livePair(m);
    const L = m.live, run = liveRunning(L);
    const list = (t) => (L.goals || []).filter(g => g.teamId === t.teamId).map(g => `<div>⚽ ${esc(goalName(g))}${g.minute ? ` <span class="text-white/40">${esc(g.minute)}'</span>` : ''}</div>`).join('');
    return `<div class="bg-black/50 border border-white/10 rounded-2xl p-3 space-y-2">
        <div class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider"><span class="${run ? 'text-red-400' : 'text-amber-300'}">${run ? '● Live' : 'Paused'}</span><span data-vs-clock="${esc(m.id)}" class="text-[#00F296] text-sm font-mono">${clockText(liveSecs(L))}</span></div>
        <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0 flex flex-col items-center gap-1">${teamLogoHtml(a, 40)}<span class="text-[11px] font-black truncate max-w-full">${esc(a.name)}</span></div>
            <div class="text-3xl font-black font-mono shrink-0">${liveGoals(m, a.teamId)} <span class="text-white/40">-</span> ${liveGoals(m, b.teamId)}</div>
            <div class="flex-1 min-w-0 flex flex-col items-center gap-1">${teamLogoHtml(b, 40)}<span class="text-[11px] font-black truncate max-w-full">${esc(b.name)}</span></div>
        </div>
        <div class="grid grid-cols-2 gap-2 text-[11px] text-white/70"><div>${list(a)}</div><div class="text-right">${list(b)}</div></div>
    </div>`;
}

// ---- the full-screen "Manage Live Match" (organizer), same look as a normal game's
async function saveLive(fn) {
    const m = V.open; if (!m) return false;
    try {
        await changeMatch(m.id, (x) => { const L = x.live ? { ...x.live, goals: [...(x.live.goals || [])] } : null; const r = fn(L, x); if (r === false) return false; x._edit = { ...(x._edit || {}), live: r === null ? null : (r || L) }; });
        return true;
    } catch (e) { toast(String(e && e.message) === 'SAME' ? 'Pick two different teams.' : "Couldn't save. Check your connection.", 'error'); return false; }
}
window.openVsManage = async function () {
    const m = V.open; if (!m) return;
    const conf = confirmedTeams(m);
    if (conf.length < 2 && !(m.results || []).length) { toast('Two teams need to be confirmed first. Mark their payment in Teams ("Got a payment"), or add a team.', 'error'); return; }
    // Opens the hub (games played + Edit). A new game only starts when you tap "Start Match".
    V.manage = true;
    drawManage();
};
window.vsStartLive = async function () {
    const m = V.open; if (!m) return;
    const conf = confirmedTeams(m);
    if (conf.length < 2) { toast('Two teams need to be confirmed first.', 'error'); return; }
    if (m.status === 'final') { toast('This match is over. Fix games with "Edit Game" below.', 'error'); return; }
    if (!m.live || !m.live.mode) {
        await saveLive((L) => ({ a: conf[0].teamId, b: conf[1].teamId, mode: 'timer', durationSeconds: 600, elapsedSeconds: 600, isRunning: false,
            lastUpdatedTimestamp: Date.now(), alarmEnabled: true, goals: (L && L.goals) || [] }));
    }
    drawManage();
};
/** Match management when no game is being played: Start Match (or the final results) + the games played with Edit / Delete. */
function drawManageHub(m, el) {
    const results = m.results || [];
    const multi = (m.teamsCount || 2) > 2;
    const top = m.status === 'final'
        ? `<button onclick="openVsResultCards()" class="w-full bg-amber-400 text-slate-950 font-black py-4 rounded-2xl text-base flex items-center justify-center gap-2"><i class="fa-solid fa-trophy"></i> View final results</button>`
        : `<button onclick="vsStartLive()" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-4 rounded-2xl text-base flex items-center justify-center gap-2"><i class="fa-solid fa-play"></i> Start ${results.length ? 'Next ' : ''}Match</button>
           ${multi && results.length ? `<button onclick="vsEndEvent()" class="w-full bg-amber-400/15 border border-amber-400/60 text-amber-300 font-black py-3 rounded-2xl text-sm flex items-center justify-center gap-2">🏁 End event (show final results)</button>` : ''}`;
    el.innerHTML = `<div class="flex-1 flex flex-col min-h-0 bg-[#060d12] rounded-t-[32px] border-t border-white/10 overflow-hidden" style="margin-top:max(12px, env(safe-area-inset-top))">
      <div class="flex-1 overflow-y-auto"><div class="max-w-2xl mx-auto w-full px-5 pt-6 pb-10 space-y-5">
        <div class="flex items-center gap-3">
            <button onclick="closeVsManage()" class="bg-black/60 border border-white/15 text-white font-bold px-4 py-2 rounded-xl text-sm"><i class="fa-solid fa-chevron-left mr-1"></i> Back</button>
            <h3 class="text-xl font-black">⏱️ Match management</h3>
        </div>
        ${m.status !== 'final' ? `<button onclick="openVsKits()" class="w-full bg-black/50 border border-white/15 rounded-2xl p-3 flex items-center gap-3 text-left">
            <span class="flex items-center gap-1.5">${confirmedTeams(m).map(t => shirt(kitOf(m, t.teamId), 'text-2xl')).join('')}</span>
            <span class="flex-1 min-w-0"><span class="block text-sm font-black">Shirt colors</span><span class="block text-[11px] text-white/55">Pick before the match so nobody wears the same color.</span></span>
            <i class="fa-solid fa-chevron-right text-white/40"></i></button>` : ''}
        ${top}
        ${results.length ? playedGamesAdminHtml(m) : `<div class="text-[11px] font-black uppercase tracking-wider text-white/50">Matches played</div><p class="text-sm text-white/50 text-center py-6">No match results recorded yet.</p>`}
      </div></div></div>`;
}
window.closeVsManage = function () { V.manage = false; document.getElementById('vs-manage')?.remove(); };
function drawManage() {
    const m = V.open;
    if (!V.manage || !m) { document.getElementById('vs-manage')?.remove(); return; }
    let el = document.getElementById('vs-manage');
    if (!el) { el = document.createElement('div'); el.id = 'vs-manage'; el.dataset.close = 'closeVsManage'; el.className = 'fixed inset-0 z-[160] flex flex-col bg-black/85 backdrop-blur-sm text-white'; document.body.appendChild(el); }
    if (!m.live) { drawManageHub(m, el); return; }
    const L = m.live, conf = confirmedTeams(m);
    const [A, B] = livePair(m);
    const run = liveRunning(L), mode = L.mode || 'timer', secs = liveSecs(L);
    const goalsA = (L.goals || []).filter(g => g.teamId === A.teamId), goalsB = (L.goals || []).filter(g => g.teamId === B.teamId);
    const untouched = !goalsA.length && !goalsB.length && (mode === 'stopwatch' ? secs === 0 : secs === (+L.durationSeconds || 600));
    const status = run ? ['LIVE', '#00F296', 'rgba(0,242,150,0.12)'] : untouched ? ['READY', '#9ca3af', 'rgba(255,255,255,0.06)'] : ['PAUSED', '#f59e0b', 'rgba(245,158,11,0.12)'];
    const startLabel = run ? '<i class="fa-solid fa-pause"></i> Pause' : (untouched ? '<i class="fa-solid fa-play"></i> Start' : '<i class="fa-solid fa-play"></i> Resume');
    const col = (t) => kitText(kitOf(m, t.teamId));
    const durations = [5, 10, 15, 20, 25, 30, 45];
    const curMins = Math.round((+L.durationSeconds || 600) / 60);
    if (!durations.includes(curMins)) durations.push(curMins);
    const goalList = (goals) => goals.length ? `<div class="space-y-1.5 pt-1 text-left">${goals.map(g => `
        <div class="flex items-center gap-2 text-sm text-white/90"><span class="text-base leading-none">⚽</span><span class="flex-1 truncate">${esc(goalName(g))}${g.minute ? ` <span class="text-white/40 text-xs">${esc(g.minute)}'</span>` : ''}</span>
            <button onclick="vsRemoveGoal(${(L.goals || []).indexOf(g)})" class="w-6 h-6 rounded-full bg-white/15 hover:bg-white/25 text-white/80 text-[11px] flex items-center justify-center shrink-0" title="Remove goal"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}</div>` : '';
    const teamSelect = (id, cur, other) => `<select id="${id}" onchange="vsPickTeams()" class="w-full appearance-none bg-[#0b151b] border-2 border-white/20 rounded-2xl px-4 py-3 text-white text-sm font-bold focus:outline-none">
        ${conf.map(t => `<option value="${esc(t.teamId)}" ${t.teamId === cur ? 'selected' : ''} ${t.teamId === other ? 'disabled' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
    const scoreCard = (t, goals) => { const c = col(t); return `
        <div class="rounded-3xl p-4 space-y-3 text-center self-start" style="border:2px solid ${c}99;background:#081117">
            <div class="flex flex-col items-center gap-1.5">${teamLogoHtml(t, 44)}<span class="font-bold text-white truncate max-w-full text-sm flex items-center gap-1.5">${shirt(kitOf(m, t.teamId), 'text-sm')}${esc(t.name)}</span></div>
            <div class="text-7xl font-black leading-none py-1" style="color:${c}">${goals.length}</div>
            <button onclick="vsGoalPicker('${jsq(t.teamId)}')" class="w-full font-black py-3 rounded-2xl text-base" style="background-color:${c}26;color:${c};border:1.5px solid ${c}66">+ Goal</button>
            ${goalList(goals)}
        </div>`; };
    el.innerHTML = `<div class="flex-1 flex flex-col min-h-0 bg-[#060d12] rounded-t-[32px] border-t border-white/10 overflow-hidden" style="margin-top:max(12px, env(safe-area-inset-top))">
      <div class="flex-1 overflow-y-auto"><div class="max-w-2xl mx-auto w-full px-5 pt-7 pb-8 space-y-6">
        <div class="space-y-2">
            <div class="flex items-start justify-between gap-2">
                <h3 class="text-[26px] sm:text-4xl font-black text-white leading-tight whitespace-nowrap">Manage <span class="text-[#6ee7a0]">Live Match</span></h3>
                <span class="mt-1.5 shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black tracking-widest" style="color:${status[1]};background:${status[2]};border:1.5px solid ${status[1]}88">
                    <span class="w-2 h-2 rounded-full ${run ? 'animate-pulse' : ''}" style="background:${status[1]}"></span>${status[0]}</span>
            </div>
            <p class="text-sm text-white/55 leading-snug">The clock keeps running even if you close this screen. Everyone sees the score live.</p>
        </div>
        <div class="rounded-3xl p-4 sm:p-5 space-y-4 border-2 border-[#1f4a44]" style="background:#081117">
            <div class="grid grid-cols-2 gap-1 p-1 rounded-full bg-black/60 border border-[#1f4a44]">
                <button onclick="vsLiveMode('stopwatch')" class="py-2.5 rounded-full text-sm font-bold ${mode === 'stopwatch' ? 'bg-[#6ee7a0] text-slate-950' : 'text-white'}"><i class="fa-solid fa-stopwatch mr-1.5"></i>Stopwatch (Up)</button>
                <button onclick="vsLiveMode('timer')" class="py-2.5 rounded-full text-sm font-bold ${mode === 'timer' ? 'bg-[#6ee7a0] text-slate-950' : 'text-white'}"><i class="fa-solid fa-hourglass-half mr-1.5"></i>Timer (Down)</button>
            </div>
            ${mode === 'timer' ? `<div class="space-y-4 px-1">
                <div class="flex items-center justify-between"><span class="text-sm font-bold text-white/70">Duration:</span>
                    <select onchange="vsLiveDuration(this.value)" ${run ? 'disabled' : ''} class="bg-transparent text-[#3b9bff] text-xl font-medium text-right focus:outline-none disabled:opacity-50">
                        ${durations.sort((x, y) => x - y).map(n => `<option value="${n}" ${n === curMins ? 'selected' : ''} style="color:#000">${n} min</option>`).join('')}</select></div>
                <label class="flex items-center justify-between gap-3 cursor-pointer"><span class="text-sm font-bold text-white/85">Alarm at 00:00 (game ends automatically)</span>
                    <input type="checkbox" class="w-6 h-6 accent-[#6ee7a0]" ${L.alarmEnabled !== false ? 'checked' : ''} onchange="vsLiveAlarm(this.checked)"></label>
            </div>` : ''}
            <div class="flex items-center justify-between gap-2">
                <div data-vs-clock="${esc(m.id)}" class="text-[44px] min-[400px]:text-[52px] sm:text-7xl font-black text-[#6ee7a0] font-mono leading-none tabular-nums min-w-0">${clockText(secs)}</div>
                <div class="flex items-center gap-2 shrink-0">
                    <button onclick="vsLiveToggle()" class="bg-[#6ee7a0] text-slate-950 font-black px-5 py-3 rounded-full text-base flex items-center gap-2 whitespace-nowrap">${startLabel}</button>
                    <button onclick="vsLiveReset()" title="Reset clock" class="w-12 h-12 shrink-0 rounded-full bg-black/60 border-2 border-[#1f4a44] text-white flex items-center justify-center"><i class="fa-solid fa-rotate-left text-lg"></i></button>
                </div>
            </div>
        </div>
        ${conf.length > 2 ? `<div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5"><label class="block text-xs font-black text-white/60 tracking-wider">TEAM 1</label>${teamSelect('vs-la', A.teamId, B.teamId)}</div>
            <div class="space-y-1.5"><label class="block text-xs font-black text-white/60 tracking-wider">TEAM 2</label>${teamSelect('vs-lb', B.teamId, A.teamId)}</div></div>` : ''}
        <div class="grid grid-cols-2 gap-3 items-start">${scoreCard(A, goalsA)}${scoreCard(B, goalsB)}</div>
        <div class="space-y-3 pt-1">
            <button onclick="vsLiveSave()" class="w-full bg-gradient-to-r from-[#6ee7a0] to-[#4fbfa8] text-slate-950 font-black py-4 rounded-3xl text-lg flex items-center justify-center gap-3"><i class="fa-solid fa-flag-checkered"></i> Save &amp; End ${conf.length > 2 ? 'Game' : 'Match'}</button>
            <button onclick="vsLiveDelete()" class="w-full text-red-400 font-bold py-2 text-base">Delete live game</button>
            <button onclick="closeVsManage()" class="w-full text-white/60 font-bold py-2 text-base">Close (the game keeps going)</button>
        </div>
      </div></div></div>`;
}
window.vsLiveToggle = () => saveLive((L) => {
    const now = Date.now();
    if (liveRunning(L)) return { ...L, isRunning: false, elapsedSeconds: liveSecs(L, now), lastUpdatedTimestamp: now };
    return { ...L, isRunning: true, elapsedSeconds: liveSecs(L, now), lastUpdatedTimestamp: now, startedAt: L.startedAt || now };
});
window.vsLiveReset = () => { if (!confirm('Reset the clock?')) return; saveLive((L) => ({ ...L, isRunning: false, elapsedSeconds: L.mode === 'stopwatch' ? 0 : (+L.durationSeconds || 600), lastUpdatedTimestamp: Date.now() })); };
window.vsLiveMode = (mode) => saveLive((L) => ({ ...L, mode, isRunning: false, elapsedSeconds: mode === 'stopwatch' ? 0 : (+L.durationSeconds || 600), lastUpdatedTimestamp: Date.now() }));
window.vsLiveDuration = (mins) => saveLive((L) => { const d = (parseInt(mins, 10) || 10) * 60; return { ...L, durationSeconds: d, elapsedSeconds: d, isRunning: false, lastUpdatedTimestamp: Date.now() }; });
window.vsLiveAlarm = (on) => saveLive((L) => ({ ...L, alarmEnabled: !!on }));
window.vsPickTeams = () => {
    const a = val('vs-la'), b = val('vs-lb');
    if (a === b) { toast('Pick two different teams.', 'error'); return; }
    saveLive((L) => ({ ...L, a, b }));
};
window.vsGoalPicker = function (teamId) {
    const m = V.open; if (!m || !m.live) return;
    const [A, B] = livePair(m);
    const other = teamId === A.teamId ? B : A;
    const playersOf = (t) => { const full = teamFull(t.teamId); const roster = (t.roster || []).map(id => ((full && full.members) || []).find(p => p.id === id)).filter(Boolean); return roster.length ? roster : ((full && full.members) || []); };
    const entry = (m.teams || []).find(t => t.teamId === teamId) || {};
    const row = (p, own) => { const nm = p.uid ? personName(p.uid, p.name) : p.name; return `<button onclick="vsGoal('${jsq(teamId)}','${jsq(nm)}',${own ? 'true' : 'false'},'${jsq(p.uid || '')}')" class="w-full flex items-center gap-3 p-3 bg-black/40 hover:bg-black rounded-xl border border-white/10 text-left">
        <img src="${esc(personAvatar(p.uid || '', p.avatar, nm))}" onerror="this.src='${DEFAULT_AV}'" class="w-7 h-7 rounded-full object-cover"><span class="text-xs font-bold">${p.number ? esc(p.number) + ' · ' : ''}${esc(nm)}</span></button>`; };
    const mine = playersOf(entry), theirs = playersOf(other);
    sheet('vs-goal', `Goal for ${esc(entry.name || 'team')}`, `
        <div class="space-y-2">${mine.map(p => row(p, false)).join('') || '<p class="text-xs text-white/55">No players listed for this team.</p>'}</div>
        <button onclick="vsGoal('${jsq(teamId)}','',false,'')" class="w-full flex items-center gap-3 p-3 bg-black/40 rounded-xl border border-dashed border-white/25 text-left"><span class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center">🤷</span><span class="text-xs font-bold">Don't recall / someone else</span></button>
        ${theirs.length ? `<div class="space-y-2 pt-2 border-t border-white/10"><div class="text-[10px] font-black uppercase tracking-wider text-amber-300">Own goal by ${esc(other.name)}</div>${theirs.map(p => row(p, true)).join('')}</div>` : ''}`);
    document.getElementById('vs-goal').style.zIndex = '200';
};
window.vsGoal = async function (teamId, name, own, uid) {
    document.getElementById('vs-goal')?.remove();
    await saveLive((L) => {
        if (!L) return false;
        const minute = L.startedAt ? Math.max(1, Math.ceil((L.mode === 'stopwatch' ? liveSecs(L) : ((+L.durationSeconds || 600) - liveSecs(L))) / 60)) : 0;
        return { ...L, goals: [...(L.goals || []), { teamId, name: name || '', own: !!own, uid: uid || '', minute, at: Date.now() }] };
    });
};
window.vsRemoveGoal = async function (i) {
    const m = V.open; const g = m && m.live && (m.live.goals || [])[i]; if (!g) return;
    if (!confirm(`Remove the goal by ${goalName(g)}?`)) return;
    await saveLive((L) => { const at = (L.goals || []).findIndex(x => x.at === g.at && x.teamId === g.teamId); if (at < 0) return false; L.goals.splice(at, 1); return L; });
};
window.vsLiveDelete = async function () {
    if (!confirm('Delete this live game? The goals are thrown away.')) return;
    if (await saveLive(() => null)) { drawManage(); toast('Live game deleted.'); }
};
async function endLiveGame(matchId, silent) {
    let final = false;
    await changeMatch(matchId, (x) => {
        const L = x.live; if (!L) return false;
        const conf = confirmedTeams(x);
        const a = L.a && conf.some(t => t.teamId === L.a) ? L.a : (conf[0] && conf[0].teamId);
        const b = L.b && conf.some(t => t.teamId === L.b) ? L.b : (conf[1] && conf[1].teamId);
        if (!a || !b) return false;
        const goals = L.goals || [];
        const ga = goals.filter(g => g.teamId === a).length, gb = goals.filter(g => g.teamId === b).length;
        const results = [...(x.results || []), { a, b, ga, gb, goals, at: Date.now(), seconds: L.mode === 'stopwatch' ? liveSecs(L) : (+L.durationSeconds || 600) - liveSecs(L) }];
        // 2 teams: that's the final score. 3-4 teams: the game is saved and the next one can start.
        if (conf.length <= 2) { x.score = { [a]: ga, [b]: gb }; x.forfeit = ''; x.status = 'final'; final = true; }
        x._edit = { live: null, results };
    });
    if (!silent) toast(final ? 'Final score saved. 🏁' : 'Game saved. Start the next one when ready.');
    return final;
}
window.vsLiveSave = async function () {
    const m = V.open; if (!m || !m.live) return;
    const two = confirmedTeams(m).length <= 2;
    if (!confirm(two ? 'Save and end the match? This is the final score.' : 'Save this game and end it?')) return;
    try { await endLiveGame(m.id); if (two) { window.closeVsManage(); V.tab = 'info'; drawPage(); autoCards(m.id); } } catch (e) { toast("Couldn't save the game.", 'error'); }   // 3-4 teams: back to the hub for the next game
};
function playEndAlarm() {
    try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.5; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 1.2); } catch (e) { /* ignore */ }
}
// The clock ticks on screen without saving every second; at 00:00 the organizer's device ends the game (alarm on) or stops the clock.
const ending = new Set();
setInterval(() => {
    document.querySelectorAll('[data-vs-clock]').forEach(el => {
        const m = V.list.find(x => x.id === el.dataset.vsClock) || (V.open && V.open.id === el.dataset.vsClock ? V.open : null);
        if (m && m.live) el.textContent = clockText(liveSecs(m.live));
    });
    V.list.filter(m => m.organizerId === myUid() && m.live && m.live.mode === 'timer' && m.live.isRunning && liveSecs(m.live) <= 0 && !ending.has(m.id)).forEach(m => {
        ending.add(m.id);
        if (m.live.alarmEnabled !== false) {
            playEndAlarm(); toast("⏰ Time's up! Game ended.");
            endLiveGame(m.id, true).catch(() => {}).finally(() => { ending.delete(m.id); if (V.open && V.open.id === m.id) window.closeVsManage(); });
        } else {
            changeMatch(m.id, (x) => { if (!x.live) return false; x._edit = { live: { ...x.live, isRunning: false, elapsedSeconds: 0, lastUpdatedTimestamp: Date.now() } }; }).catch(() => {}).finally(() => ending.delete(m.id));
        }
    });
}, 1000);

// ---------------------------------------------------------------- ✏️ games played: edit / delete (organizer), like a normal game's "Previous matches"
// Each saved game in m.results can be fixed: the teams (3-4 team matches), the goals (add / remove / own goal).
// With 2 teams, the last game is the final score, so fixing it fixes the score (and the teams' records follow on the server).
const playersOfTeam = (t) => { const full = teamFull(t.teamId); const roster = (t.roster || []).map(id => ((full && full.members) || []).find(p => p.id === id)).filter(Boolean); return roster.length ? roster : ((full && full.members) || []); };
/** The "Games played" list with Edit / Delete, newest first (Admin tab + Match management). */
function playedGamesAdminHtml(m) {
    const results = m.results || [];
    if (!results.length) return '';
    const teamOf = (id) => (m.teams || []).find(t => t.teamId === id) || { name: 'Team' };
    const scorers = (r, id, right) => (r.goals || []).filter(g => g.teamId === id).map(g => `<div class="flex items-center gap-1.5 ${right ? 'justify-end' : ''} text-[11px] text-white/80 truncate">⚽ <span class="truncate">${esc(goalName(g))}</span></div>`).join('');
    return `<div class="space-y-2">
        <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">Games played</div>
        ${results.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => `<div class="space-y-1.5">
            <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">Game ${i + 1}</div>
            <div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2.5">
                <div class="flex items-center gap-2">
                    <span class="flex-1 min-w-0 flex items-center gap-1.5 text-xs font-black">${shirt(kitOf(m, r.a), 'text-sm')}<span class="truncate">${esc(teamOf(r.a).name)}</span></span>
                    <span class="shrink-0 bg-[#00F296]/15 text-[#00F296] font-black font-mono text-base px-3 py-1 rounded-xl">${esc(r.ga)} - ${esc(r.gb)}</span>
                    <span class="flex-1 min-w-0 flex items-center justify-end gap-1.5 text-xs font-black"><span class="truncate">${esc(teamOf(r.b).name)}</span>${shirt(kitOf(m, r.b), 'text-sm')}</span>
                </div>
                ${(r.goals || []).length ? `<div class="grid grid-cols-2 gap-2 border-t border-white/10 pt-2"><div class="min-w-0 space-y-0.5">${scorers(r, r.a)}</div><div class="min-w-0 space-y-0.5">${scorers(r, r.b, true)}</div></div>` : ''}
                <div class="grid grid-cols-2 gap-2 border-t border-white/10 pt-2.5">
                    <button onclick="vsEditGame(${i})" class="bg-[#00B4AE]/15 hover:bg-[#00B4AE]/25 text-[#00F296] font-bold py-2 rounded-xl text-xs border border-[#00B4AE]/50 flex items-center justify-center gap-1.5"><i class="fa-solid fa-pen text-[10px]"></i> Edit Game</button>
                    <button onclick="vsDeleteGame(${i})" class="bg-red-500/20 hover:bg-red-500/30 text-red-300 font-bold py-2 rounded-xl text-xs border border-red-500/40 flex items-center justify-center gap-1.5"><i class="fa-solid fa-trash text-[10px]"></i> Delete Game</button>
                </div>
            </div></div>`).join('')}
    </div>`;
}
/** Is game i the one that sets the final score (2-team match, last game)? */
const setsFinal = (m, i) => confirmedTeams(m).length <= 2 && i === (m.results || []).length - 1;

window.vsEditGame = function (i) {
    const m = V.open; const r = m && (m.results || [])[i]; if (!r) return;
    window._vsEdit = { i, at: r.at, a: r.a, b: r.b, goals: (r.goals || []).map(g => ({ ...g })) };
    drawEditGame();
};
function drawEditGame() {
    const m = V.open, E = window._vsEdit; if (!m || !E) return;
    const conf = confirmedTeams(m);
    const teamOf = (id) => (m.teams || []).find(t => t.teamId === id) || { teamId: id, name: 'Team' };
    const A = teamOf(E.a), B = teamOf(E.b);
    const goalsOf = (id) => E.goals.map((g, gi) => ({ g, gi })).filter(x => x.g.teamId === id);
    const select = (side, cur, other) => `<select onchange="vsEditTeam('${side}', this.value)" class="w-full bg-black/60 border border-white/20 rounded-xl px-2 py-2 text-white text-xs font-bold focus:outline-none">
        ${conf.map(t => `<option value="${esc(t.teamId)}" ${t.teamId === cur ? 'selected' : ''} ${t.teamId === other ? 'disabled' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
    const col = (t, side) => { const list = goalsOf(t.teamId); return `<div class="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2 text-center">
        <div class="flex flex-col items-center gap-1">${teamLogoHtml(t, 36)}${conf.length > 2 ? select(side, t.teamId, side === 'a' ? E.b : E.a) : `<span class="text-xs font-black truncate max-w-full">${esc(t.name)}</span>`}</div>
        <div class="text-4xl font-black font-mono">${list.length}</div>
        <button onclick="vsEditGoalPicker('${jsq(t.teamId)}')" class="w-full bg-[#00F296]/15 text-[#00F296] border border-[#00F296]/50 font-black py-2 rounded-xl text-xs">+ Goal</button>
        <div class="space-y-1 text-left">${list.map(({ g, gi }) => `<div class="flex items-center gap-1.5 text-[11px] text-white/85"><span>⚽</span><span class="flex-1 truncate">${esc(goalName(g))}</span>
            <button onclick="vsEditRemoveGoal(${gi})" title="Remove goal" class="w-5 h-5 rounded-full bg-white/15 text-white/80 text-[9px] flex items-center justify-center shrink-0"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}</div>
    </div>`; };
    sheet('vs-edit-game', `✏️ Edit Game ${E.i + 1}`, `
        <div class="flex items-start gap-2">${col(A, 'a')}${col(B, 'b')}</div>
        ${setsFinal(m, E.i) && m.status === 'final' ? '<p class="text-[11px] text-amber-200">This game is the final score of the match, so saving also fixes the final score and both teams\' records.</p>' : ''}
        <button onclick="vsSaveEditGame()" class="${BTN} w-full py-3 text-sm">Save changes</button>`);
}
window.vsEditTeam = function (side, teamId) {
    const E = window._vsEdit; if (!E) return;
    const old = side === 'a' ? E.a : E.b, other = side === 'a' ? E.b : E.a;
    if (teamId === other) { toast('Pick two different teams.', 'error'); drawEditGame(); return; }
    E.goals.forEach(g => { if (g.teamId === old) g.teamId = teamId; });   // the goals move with the team
    if (side === 'a') E.a = teamId; else E.b = teamId;
    drawEditGame();
};
window.vsEditGoalPicker = function (teamId) {
    const m = V.open, E = window._vsEdit; if (!m || !E) return;
    const teamOf = (id) => (m.teams || []).find(t => t.teamId === id) || { teamId: id, name: 'Team' };
    const entry = teamOf(teamId), other = teamOf(teamId === E.a ? E.b : E.a);
    const row = (p, own) => { const nm = p.uid ? personName(p.uid, p.name) : p.name; return `<button onclick="vsEditAddGoal('${jsq(teamId)}','${jsq(nm)}',${own ? 'true' : 'false'},'${jsq(p.uid || '')}')" class="w-full flex items-center gap-3 p-3 bg-black/40 hover:bg-black rounded-xl border border-white/10 text-left">
        <img src="${esc(personAvatar(p.uid || '', p.avatar, nm))}" onerror="this.src='${DEFAULT_AV}'" class="w-7 h-7 rounded-full object-cover"><span class="text-xs font-bold">${p.number ? esc(p.number) + ' · ' : ''}${esc(nm)}</span></button>`; };
    const mine = playersOfTeam(entry), theirs = playersOfTeam(other);
    sheet('vs-edit-goal', `Goal for ${esc(entry.name || 'team')}`, `
        <div class="space-y-2">${mine.map(p => row(p, false)).join('') || '<p class="text-xs text-white/55">No players listed for this team.</p>'}</div>
        <button onclick="vsEditAddGoal('${jsq(teamId)}','',false,'')" class="w-full flex items-center gap-3 p-3 bg-black/40 rounded-xl border border-dashed border-white/25 text-left"><span class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center">🤷</span><span class="text-xs font-bold">Don't recall / someone else</span></button>
        ${theirs.length ? `<div class="space-y-2 pt-2 border-t border-white/10"><div class="text-[10px] font-black uppercase tracking-wider text-amber-300">Own goal by ${esc(other.name)}</div>${theirs.map(p => row(p, true)).join('')}</div>` : ''}`);
    document.getElementById('vs-edit-goal').style.zIndex = '200';
};
window.vsEditAddGoal = function (teamId, name, own, uid) {
    document.getElementById('vs-edit-goal')?.remove();
    const E = window._vsEdit; if (!E) return;
    E.goals.push({ teamId, name: name || '', own: !!own, uid: uid || '', minute: 0, at: Date.now() });
    drawEditGame();
};
window.vsEditRemoveGoal = function (gi) {
    const E = window._vsEdit; if (!E || !E.goals[gi]) return;
    E.goals.splice(gi, 1);
    drawEditGame();
};
/** Finds the game again inside the saved match (by when it was saved, in case the list changed meanwhile). */
const gameIndex = (x, at, i) => { const list = x.results || []; const k = list.findIndex(r => r.at === at); return k >= 0 ? k : (list[i] && list[i].at === at ? i : -1); };
window.vsSaveEditGame = async function () {
    const m = V.open, E = window._vsEdit; if (!m || !E) return;
    if (E.a === E.b) { toast('Pick two different teams.', 'error'); return; }
    try {
        await changeMatch(m.id, (x) => {
            const k = gameIndex(x, E.at, E.i); if (k < 0) throw new Error('GONE_GAME');
            const goals = E.goals.filter(g => g.teamId === E.a || g.teamId === E.b);
            const ga = goals.filter(g => g.teamId === E.a).length, gb = goals.filter(g => g.teamId === E.b).length;
            const results = (x.results || []).slice();
            results[k] = { ...results[k], a: E.a, b: E.b, ga, gb, goals, editedAt: Date.now(), editedBy: myUid() };
            if (x.status === 'final' && setsFinal(x, k)) { x.score = { [E.a]: ga, [E.b]: gb }; x.forfeit = ''; }
            x._edit = { results };
        });
        document.getElementById('vs-edit-game')?.remove(); window._vsEdit = null;
        toast('Game updated. ✅');
    } catch (e) { toast(String(e && e.message) === 'GONE_GAME' ? 'That game was already deleted.' : "Couldn't save the game. Check your connection.", 'error'); }
};
window.vsDeleteGame = async function (i) {
    const m = V.open; const r = m && (m.results || [])[i]; if (!r) return;
    const final = m.status === 'final' && setsFinal(m, i);
    if (!confirm(final ? `Delete Game ${i + 1}? It's the final score, so the match goes back to "not played yet" and the teams' records are undone.` : `Delete Game ${i + 1}? Its goals are removed from the stats.`)) return;
    try {
        await changeMatch(m.id, (x) => {
            const k = gameIndex(x, r.at, i); if (k < 0) return false;
            const results = (x.results || []).filter((_, j) => j !== k);
            if (x.status === 'final' && setsFinal(x, k)) {
                const prev = results[results.length - 1];
                if (prev) x.score = { [prev.a]: prev.ga, [prev.b]: prev.gb };       // an earlier game becomes the final score
                else { x.score = null; x.forfeit = ''; x.status = 'open'; }        // nothing left: back to not played
            }
            x._edit = { results };
        });
        toast('Game deleted.');
    } catch (e) { toast("Couldn't delete the game.", 'error'); }
};

// ---------------------------------------------------------------- 🏆 result: who won, who lost (match page box + share cards)
/** { draw, multi, forfeit, winner, loser, pair } or null when there's no result yet.
 *  2 teams: the final score.  3-4 teams: the table from the games played (top = winner, bottom = loser). */
function vsOutcome(m) {
    const teamOf = (id) => (m.teams || []).find(t => t.teamId === id) || { teamId: id, name: 'Team' };
    const goalsBy = {};
    (m.results || []).forEach(r => (r.goals || []).filter(g => g.name && !g.own).forEach(g => { const k = g.teamId + '|' + (g.uid || g.name); goalsBy[k] = goalsBy[k] || { teamId: g.teamId, name: g.name, n: 0 }; goalsBy[k].n++; }));
    const players = (t) => playersOfTeam(t).slice(0, 14).map(p => { const nm = p.uid ? personName(p.uid, p.name) : p.name; return { name: nm, avatar: personAvatar(p.uid || '', p.avatar, nm), captain: p.role === 'captain' }; });
    const side = (id, extra) => { const t = freshLook(teamOf(id)); return { ...t, ...extra, scorers: Object.values(goalsBy).filter(s => s.teamId === id).sort((a, b) => b.n - a.n), players: players(t) }; };
    const n = m.teamsCount || 2;
    if (n <= 2 || confirmedTeams(m).length <= 2) {
        if (m.status !== 'final' || !m.score) return null;
        const ids = Object.keys(m.score); if (ids.length !== 2) return null;
        const [a, b] = ids, ga = +m.score[a] || 0, gb = +m.score[b] || 0;
        if (ga === gb) return { draw: true, pair: [side(a, { gf: ga, ga: gb }), side(b, { gf: gb, ga: ga })] };
        const [w, l] = ga > gb ? [a, b] : [b, a];
        return { winner: side(w, { gf: Math.max(ga, gb), ga: Math.min(ga, gb) }), loser: side(l, { gf: Math.min(ga, gb), ga: Math.max(ga, gb) }), forfeit: !!m.forfeit };
    }
    const results = m.results || []; if (!results.length) return null;
    const tb = {};
    results.forEach(r => [[r.a, r.ga, r.gb], [r.b, r.gb, r.ga]].forEach(([id, f, g]) => { const t = tb[id] = tb[id] || { id, w: 0, d: 0, l: 0, gf: 0, ga: 0 }; t.gf += f; t.ga += g; if (f > g) t.w++; else if (f === g) t.d++; else t.l++; }));
    const rows = Object.values(tb).map(t => ({ ...t, pts: t.w * 3 + t.d })).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    if (rows.length < 2) return null;
    const top = rows[0], bot = rows[rows.length - 1];
    if (top.pts === bot.pts && top.gf - top.ga === bot.gf - bot.ga) return { draw: true, multi: true, pair: [side(top.id, top), side(bot.id, bot)] };
    return { multi: true, winner: side(top.id, top), loser: side(bot.id, bot) };
}
/** Winner / loser box on the match page: the winner glows gold, the loser is greyed out and stamped. */
function outcomeBoxHtml(m) {
    const o = vsOutcome(m); if (!o) return '';
    const done = m.status === 'final' || (m.date && m.date < ymdToday());
    if (o.multi && !done) return '';   // 3-4 teams: wait until the match is over
    const btn = `<button onclick="openVsResultCards()" class="w-full bg-gradient-to-r from-amber-400 to-[#00F296] text-slate-950 font-black py-3 rounded-2xl text-sm">📸 Result cards</button>`;
    if (o.draw) return `<div class="bg-black/50 border border-white/20 rounded-2xl p-3 space-y-3"><div class="text-center text-sm font-black">🤝 Draw · ${esc(o.pair[0].name)} ${o.pair[0].gf} - ${o.pair[1].gf} ${esc(o.pair[1].name)}</div>${btn}</div>`;
    const W = o.winner, L = o.loser;
    return `<div class="space-y-2">
        <div class="relative overflow-hidden rounded-2xl p-3 flex items-center gap-3 border-2 border-amber-300" style="background:linear-gradient(135deg,rgba(252,211,77,.28),rgba(0,0,0,.55));box-shadow:0 0 24px rgba(252,211,77,.35)">
            <div class="relative shrink-0">${teamLogoHtml(W, 52)}<span class="absolute -top-3 -right-2 text-xl">👑</span></div>
            <div class="flex-1 min-w-0"><div class="text-[10px] font-black tracking-widest text-amber-300">🏆 WINNER</div><div class="text-base font-black truncate">${esc(W.name)}</div>
                <div class="text-[11px] text-white/75">${o.multi ? `${W.w}W ${W.d}D ${W.l}L · ${W.pts} pts` : `Won ${W.gf} - ${W.ga}`}</div></div>
            <span class="text-3xl">🎉</span>
        </div>
        <div class="relative overflow-hidden rounded-2xl p-3 flex items-center gap-3 border-2 border-red-900/80 bg-black/70">
            <div class="relative shrink-0" style="filter:grayscale(1) brightness(.7)">${teamLogoHtml(L, 44)}</div>
            <span class="absolute left-9 top-1/2 -translate-y-1/2 -rotate-12 text-red-500 font-black text-2xl border-2 border-red-500 rounded-md px-1 leading-none">L</span>
            <div class="flex-1 min-w-0"><div class="text-[10px] font-black tracking-widest text-red-400">💀 ${o.forfeit ? 'NO-SHOW' : 'LOSER'}</div><div class="text-base font-black truncate text-white/55 line-through decoration-red-500 decoration-2">${esc(L.name)}</div>
                <div class="text-[11px] text-white/45">${o.multi ? `${L.w}W ${L.d}D ${L.l}L · last place` : `Lost ${L.gf} - ${L.ga}`}</div></div>
            <span class="text-2xl">🤡</span>
        </div>
        ${btn}
    </div>`;
}
/** Right after a match ends: wait for the saved result to arrive, then pop the result cards up on their own. */
function autoCards(id) {
    let n = 0;
    const t = setInterval(() => {
        const m = V.open;
        if (!m || m.id !== id || ++n > 30) { clearInterval(t); return; }
        if (m.status === 'final' && vsOutcome(m)) { clearInterval(t); window.openVsResultCards(); }
    }, 200);
}
/** 3-4 teams: no single final score, so the organizer ends the event; the table decides the winner and loser. */
window.vsEndEvent = async function () {
    const m = V.open; if (!m) return;
    if (m.live) { toast('Save or delete the game being played first.', 'error'); return; }
    if (!(m.results || []).length) { toast('Play at least one game first.', 'error'); return; }
    if (!confirm('End the event? The table decides the winner and loser, and the result cards are made.')) return;
    try {
        await changeMatch(m.id, (x) => { x.status = 'final'; x.score = {}; x.forfeit = ''; x._edit = { live: null }; });
        window.closeVsManage(); V.tab = 'info'; drawPage();
        toast('Event ended. 🏁'); autoCards(m.id);
    } catch (e) { toast("Couldn't end the event.", 'error'); }
};
window.openVsResultCards = async function () {
    const m = V.open; if (!m) return;
    const o = vsOutcome(m); if (!o) { toast('No result yet.', 'error'); return; }
    try {
        const { openVsCards } = await import('./vs-cards.js');
        // Top scorers + own goals (for the Top Scorers card)
        const teamOf = (id) => (m.teams || []).find(t => t.teamId === id) || { teamId: id, name: 'Team' };
        const kits = kitsOf(m);
        const photo = (g) => { if (g.uid) return personAvatar(g.uid, '', g.name); const p = (m.teams || []).flatMap(t => playersOfTeam(t)).find(x => (x.name || '').toLowerCase() === String(g.name || '').toLowerCase()); return personAvatar((p && p.uid) || '', p && p.avatar, g.name); };
        const all = (m.results || []).flatMap(r => r.goals || []).filter(g => g.name);
        const count = (list, key) => { const c = {}; list.forEach(g => { const k = key(g); c[k] = c[k] || { name: g.name, avatar: photo(g), team: teamOf(g.teamId).name, kit: kits[g.teamId] || '#9ca3af', n: 0 }; c[k].n++; }); return Object.values(c).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)); };
        const scorers = count(all.filter(g => !g.own), g => (g.uid || g.name.toLowerCase()) + '|' + g.teamId);
        // an own goal is saved under the team that got the goal (the "gift")
        const ownGoals = count(all.filter(g => g.own), g => g.uid || g.name.toLowerCase());
        await openVsCards({ ...o, scorers, ownGoals, info: { title: vsTitleOf(m), date: (window.fmtGameDate || prettyDate)(m.date || ''), location: m.location || '', format: m.format || '' } });
    } catch (e) { console.error(e); toast("Couldn't make the cards.", 'error'); }
};

// ---------------------------------------------------------------- 👕 shirt colors (picked before the match, like a normal game's team colors)
//   m.teams[i].kit = '#hex'. No pick yet: the team's own color, else a free color. Two teams never show the same color.
const KIT_COLORS = [['Blue', '#3b82f6'], ['Red', '#ef4444'], ['Yellow', '#eab308'], ['Green', '#22c55e'], ['Purple', '#a855f7'], ['Pink', '#ec4899'], ['Orange', '#f97316'], ['White', '#ffffff'], ['Black', '#000000']];
function kitsOf(m) {
    const out = {}, used = new Set();
    const teams = (m.teams || []).filter(t => t.state !== 'invited');
    teams.forEach(t => { const k = /^#[0-9a-f]{6}$/i.test(t.kit || '') ? t.kit.toLowerCase() : ''; if (k && !used.has(k)) { out[t.teamId] = k; used.add(k); } });
    teams.forEach(t => {
        if (out[t.teamId]) return;
        const own = (freshLook(t).colors || {}).primary;
        const k = own && /^#[0-9a-f]{6}$/i.test(own) && !used.has(own.toLowerCase()) ? own.toLowerCase() : (KIT_COLORS.map(c => c[1]).find(c => !used.has(c)) || '#9ca3af');
        out[t.teamId] = k; used.add(k);
    });
    return out;
}
const kitOf = (m, teamId) => kitsOf(m)[teamId] || '#9ca3af';
const kitText = (hex) => (String(hex).toLowerCase() === '#000000' ? '#9ca3af' : hex);   // black text on black is invisible
const shirt = (hex, cls = 'text-base') => `<i class="fa-solid fa-shirt ${cls} shrink-0" style="${String(hex).toLowerCase() === '#000000' ? 'color:#000;-webkit-text-stroke:1px #9ca3af' : `color:${hex}`}"></i>`;
const canKit = (m, teamId) => (m.status === 'open' || m.status === 'challenge') && (m.organizerId === myUid() || myCaptainTeams().some(x => x.id === teamId));
window.openVsKits = function () {
    const m = V.open; if (!m) return;
    const kits = kitsOf(m);
    const teams = (m.teams || []).filter(t => t.state !== 'invited');
    sheet('vs-kits', '👕 Shirt colors', `
        <p class="text-[11px] text-white/60">Pick what each team wears so nobody shows up in the same color. Captains can pick their own team's.</p>
        ${teams.map(t => { const mineOk = canKit(m, t.teamId); return `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2">
            <div class="flex items-center gap-2">${teamLogoHtml(t, 28)}<span class="flex-1 min-w-0 text-sm font-black truncate">${esc(t.name)}</span>${shirt(kits[t.teamId], 'text-2xl')}</div>
            ${mineOk ? `<div class="flex flex-wrap gap-2">${KIT_COLORS.map(([name, hex]) => { const takenBy = teams.find(o => o.teamId !== t.teamId && kits[o.teamId] === hex); const on = kits[t.teamId] === hex; return `<button ${takenBy ? 'disabled' : ''} onclick="vsSetKit('${jsq(t.teamId)}','${hex}')" title="${name}${takenBy ? ' (taken by ' + esc(takenBy.name) + ')' : ''}"
                class="w-9 h-9 rounded-full flex items-center justify-center ${on ? 'ring-2 ring-white ring-offset-2 ring-offset-black' : ''} ${takenBy ? 'opacity-25 cursor-not-allowed' : ''}" style="background:${hex};border:1px solid rgba(255,255,255,.35)">${on ? `<i class="fa-solid fa-check text-xs" style="color:${hex === '#ffffff' || hex === '#eab308' ? '#000' : '#fff'}"></i>` : ''}</button>`; }).join('')}</div>` : '<p class="text-[11px] text-white/45">Only this team\'s captain or the organizer can change it.</p>'}
        </div>`; }).join('')}`);
};
window.vsSetKit = async function (teamId, hex) {
    const m = V.open; if (!m) return;
    try {
        await changeMatch(m.id, (x) => {
            const kits = kitsOf(x);
            if (Object.entries(kits).some(([id, k]) => id !== teamId && k === hex)) throw new Error('TAKEN');
            const t = x.teams.find(e => e.teamId === teamId); if (!t) return false;
            t.kit = hex;
        });
        const t = (V.open.teams || []).find(e => e.teamId === teamId); if (t) t.kit = hex;
        window.openVsKits();
        toast('Shirt color saved. 👕');
    } catch (e) { toast(String(e && e.message) === 'TAKEN' ? 'Another team already has that color.' : "Couldn't save the color.", 'error'); }
};

// ---------------------------------------------------------------- 📊 stats tab (laid out like a normal game's Game Stats: Matches / Leaderboard / Top Scorers)
window.vsStatsSub = function (k) { V.statsSub = k; drawPage(); };
window.vsToggleTableTeam = function (id) { V.openTableTeam = V.openTableTeam === id ? '' : id; drawPage(); };
function statsHtml(m) {
    const sub = V.statsSub || 'matches';
    const results = (m.results || []).slice();
    const teamOf = (id) => (m.teams || []).find(t => t.teamId === id) || { teamId: id, name: 'Team' };
    const people = (id) => playersOfTeam(teamOf(id));
    const photoFor = (g) => {
        if (g.uid) return personAvatar(g.uid, '', g.name);
        const p = [...people(g.teamId), ...(m.teams || []).flatMap(t => people(t.teamId))].find(x => (x.name || '').toLowerCase() === String(g.name || '').toLowerCase());
        return personAvatar((p && p.uid) || '', p && p.avatar, g.name || 'Player');
    };
    const chip = (g, side) => `<div class="flex items-center gap-1.5 bg-black/40 px-2.5 py-1 rounded-full border border-white/10 min-w-0">
        <i class="fa-solid fa-futbol ${side ? 'text-red-400' : 'text-[#00F296]'} text-[9px]"></i>
        ${g.name ? `<img src="${esc(photoFor(g))}" onerror="this.src='${DEFAULT_AV}'" class="w-5 h-5 rounded-full object-cover">` : ''}
        <span class="text-white font-bold text-[10px] truncate flex-1">${esc(goalName(g))}</span>
        <span class="shrink-0">${teamLogoHtml(teamOf(g.teamId), 16)}</span></div>`;
    const tabBtn = (k, label) => `<button onclick="vsStatsSub('${k}')" class="flex-1 py-2 rounded-xl text-xs font-black transition ${sub === k ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">${label}</button>`;
    const side = (id, right) => `<span class="flex-1 min-w-0 flex items-center ${right ? 'justify-start' : 'justify-end'} gap-1.5 text-xs font-black">${right ? teamLogoHtml(teamOf(id), 24) : ''}<span class="truncate">${esc(teamOf(id).name)}</span>${right ? '' : teamLogoHtml(teamOf(id), 24)}</span>`;
    const matchCard = (label, a, b, goals, badge, ga, gb) => `<div class="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-3 shadow-md">
        <div class="flex items-center justify-between text-xs font-bold uppercase"><span class="text-[#00F296] font-black">${label}</span>${badge}</div>
        <div class="bg-black/80 rounded-2xl py-3 px-3 flex items-center gap-2 border border-white/10">${side(a)}<span class="text-xl font-black text-[#00F296] px-2 font-mono shrink-0">${ga ?? goals.filter(g => g.teamId === a).length} - ${gb ?? goals.filter(g => g.teamId === b).length}</span>${side(b, true)}</div>
        <div class="grid grid-cols-2 gap-2 pt-1 border-t border-white/10">
            <div class="space-y-1 min-w-0">${goals.filter(g => g.teamId === a).map(g => chip(g, 0)).join('') || '<span class="text-[10px] text-white/40 italic">No goals</span>'}</div>
            <div class="space-y-1 min-w-0">${goals.filter(g => g.teamId === b).map(g => chip(g, 1)).join('') || '<span class="text-[10px] text-white/40 italic">No goals</span>'}</div>
        </div></div>`;
    let body = '';
    if (sub === 'matches') {
        const lp = m.live ? livePair(m) : [];
        body = `<div class="space-y-3">
            ${m.live && lp.length === 2 ? matchCard(`🔴 Live · Match ${results.length + 1}`, lp[0].teamId, lp[1].teamId, m.live.goals || [], '<span class="text-[10px] text-[#00F296] font-bold animate-pulse">In progress</span>') : ''}
            ${!results.length && !m.live ? '<p class="text-xs text-white/40 italic text-center py-8">No match results recorded yet.</p>' : ''}
            ${results.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => matchCard(`Match ${i + 1}`, r.a, r.b, r.goals || [], '<span class="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">Finished</span>', r.ga, r.gb)).join('')}
        </div>`;
    } else if (sub === 'leaderboard') {
        const table = {};
        (m.teams || []).filter(t => t.state !== 'invited').forEach(t => { table[t.teamId] = { id: t.teamId, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, live: false }; });
        const add = (a, b, ga, gb, live) => [[a, ga, gb], [b, gb, ga]].forEach(([id, f, g]) => {
            const t = table[id] = table[id] || { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
            t.p++; t.gf += f; t.ga += g; if (live) t.live = true;
            if (f > g) t.w++; else if (f === g) t.d++; else t.l++;
        });
        results.forEach(r => add(r.a, r.b, r.ga, r.gb));
        if (m.live) { const [A, B] = livePair(m); const G = m.live.goals || []; if (A && B) add(A.teamId, B.teamId, G.filter(g => g.teamId === A.teamId).length, G.filter(g => g.teamId === B.teamId).length, true); }
        const rows = Object.values(table).map(t => ({ ...t, pts: t.w * 3 + t.d, gd: t.gf - t.ga })).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
        body = `<div class="bg-[#141821] border border-white/10 rounded-2xl overflow-hidden shadow-xl"><table class="w-full text-left border-collapse text-sm">
            <thead><tr class="border-b border-white/10 text-white/50 font-bold text-xs"><th class="py-3 pl-4 pr-2">Club</th><th class="py-3 px-1.5 text-center w-9">MP</th><th class="py-3 px-1.5 text-center w-9">W</th><th class="py-3 px-1.5 text-center w-9">D</th><th class="py-3 px-1.5 text-center w-9">L</th><th class="py-3 px-1.5 text-center w-10">GD</th><th class="py-3 pl-1.5 pr-4 text-center w-11 text-[#00F296]">Pts</th></tr></thead>
            <tbody>${rows.map((t, i) => { const open = V.openTableTeam === t.id; const ps = people(t.id); return `
                <tr class="hover:bg-white/5 cursor-pointer ${open ? '' : 'border-b border-white/5'}" onclick="vsToggleTableTeam('${jsq(t.id)}')" title="Show players">
                    <td class="py-3 pl-4 pr-2"><div class="flex items-center gap-2.5 min-w-0"><span class="text-white/50 font-semibold w-4 text-right shrink-0">${i + 1}</span><span class="shrink-0">${teamLogoHtml(teamOf(t.id), 24)}</span><span class="font-bold truncate">${esc(teamOf(t.id).name)}</span>${t.live ? '<span class="w-2 h-2 rounded-full bg-[#00F296] inline-block animate-ping shrink-0" title="Playing live now"></span>' : ''}<i class="fa-solid fa-chevron-${open ? 'up' : 'down'} text-[9px] text-white/30 shrink-0"></i></div></td>
                    <td class="py-3 px-1.5 text-center text-white/80">${t.p}</td><td class="py-3 px-1.5 text-center text-white/80">${t.w}</td><td class="py-3 px-1.5 text-center text-white/80">${t.d}</td><td class="py-3 px-1.5 text-center text-white/80">${t.l}</td>
                    <td class="py-3 px-1.5 text-center text-white/80">${t.gd >= 0 ? '+' + t.gd : t.gd}</td><td class="py-3 pl-1.5 pr-4 text-center font-black text-[#00F296]">${t.pts}</td></tr>
                ${open ? `<tr class="border-b border-white/5"><td colspan="7"><div class="flex flex-wrap gap-1.5 pb-3 pl-[46px] pr-4">${ps.length ? ps.map(p => { const nm = p.uid ? personName(p.uid, p.name) : p.name; return `<div class="flex items-center gap-1.5 bg-black/60 border border-white/10 px-2 py-1 rounded-full"><img src="${esc(personAvatar(p.uid || '', p.avatar, nm))}" onerror="this.src='${DEFAULT_AV}'" class="w-5 h-5 rounded-full object-cover"><span class="text-[10px] font-bold">${esc(String(nm || '').split(' ')[0])}</span></div>`; }).join('') : '<span class="text-[10px] text-white/40 italic">No players listed</span>'}</div></td></tr>` : ''}`; }).join('')}</tbody></table></div>`;
    } else {
        const all = [...results.flatMap(r => r.goals || []), ...(m.live ? m.live.goals || [] : [])];
        const sc = {};
        all.filter(g => g.name && !g.own).forEach(g => { const k = (g.uid || g.name.toLowerCase()) + '|' + g.teamId; sc[k] = sc[k] || { g, n: 0 }; sc[k].n++; });
        const top = Object.values(sc).sort((a, b) => b.n - a.n || String(a.g.name).localeCompare(String(b.g.name)));
        const own = {};
        all.filter(g => g.own && g.name).forEach(g => { const k = g.uid || g.name.toLowerCase(); own[k] = own[k] || { g, n: 0 }; own[k].n++; });
        body = `<div class="bg-black/40 border border-emerald-500/30 rounded-2xl overflow-hidden shadow-xl"><table class="w-full text-left border-collapse text-xs">
            <thead><tr class="bg-black/60 border-b border-white/10 text-white/70 uppercase font-black text-[10px]"><th class="p-3">Player</th><th class="p-3 text-right">Goals</th></tr></thead>
            <tbody class="divide-y divide-white/10">${top.length ? top.map(({ g, n }, i) => `<tr class="hover:bg-white/5"><td class="p-3 font-bold"><div class="flex items-center gap-2.5 min-w-0"><span class="${i < 3 ? 'text-[#FACC15]' : 'text-white/40'} font-black">#${i + 1}</span>
                <img src="${esc(photoFor(g))}" onerror="this.src='${DEFAULT_AV}'" class="w-8 h-8 rounded-full object-cover border border-white/20">
                <span class="min-w-0"><span class="block truncate">${esc(g.name)}</span><span class="flex items-center gap-1 text-[10px] text-white/50 font-normal">${teamLogoHtml(teamOf(g.teamId), 14)}${esc(teamOf(g.teamId).name)}</span></span></div></td>
                <td class="p-3 text-right font-black text-[#00F296] whitespace-nowrap">⚽ ${n}</td></tr>`).join('') : '<tr><td colspan="2" class="p-6 text-center text-white/40 italic">No goalscorers recorded yet.</td></tr>'}</tbody></table></div>
            ${Object.keys(own).length ? `<div class="bg-red-500/10 border border-red-500/30 rounded-2xl p-3 space-y-2"><div class="text-[10px] font-black uppercase tracking-wider text-red-300">🙈 Own goals (oops)</div>
                ${Object.values(own).map(({ g, n }) => `<div class="flex items-center gap-2 text-xs"><img src="${esc(photoFor({ ...g, teamId: '' }))}" onerror="this.src='${DEFAULT_AV}'" class="w-6 h-6 rounded-full object-cover grayscale"><span class="flex-1 font-bold truncate">${esc(g.name)}</span><span class="font-black text-red-300">${n}</span></div>`).join('')}</div>` : ''}`;
    }
    return `<div class="space-y-4 py-1">
        <div class="bg-black/40 border border-emerald-500/30 p-1 rounded-2xl flex items-center gap-1">${tabBtn('matches', 'Matches')}${tabBtn('leaderboard', 'Leaderboard')}${tabBtn('top-scorers', 'Top Scorers')}</div>
        ${body}
        ${vsOutcome(m) && (m.status === 'final' || (m.date && m.date < ymdToday())) ? `<button onclick="openVsResultCards()" class="w-full bg-gradient-to-r from-amber-400 to-[#00F296] text-slate-950 font-black py-3 rounded-2xl text-sm">📸 Result cards</button>` : ''}
    </div>`;
}

// ---------------------------------------------------------------- 📣 notify players (a push to everyone in the match)
// ---- ⛈️ Storm watch (same idea as regular games): a status on the match + a note; everyone in it is notified.
//   gameStatus = { stormWatch, state: 'on' | 'likely' | 'unlikely', note, by, byName, at }
const VS_STORM = {
    on: { emoji: '✅', label: 'Game on', cls: 'bg-emerald-500/15 text-[#00F296] border-emerald-400/60' },
    likely: { emoji: '🟡', label: 'Game likely', cls: 'bg-amber-500/15 text-amber-300 border-amber-400/60' },
    unlikely: { emoji: '🔴', label: 'Game not likely', cls: 'bg-red-500/15 text-red-300 border-red-400/60' },
};
const vsStormOn = (m) => !!(m && m.gameStatus && m.gameStatus.stormWatch === true) && (m.status === 'open' || m.status === 'challenge');
const vsStormState = (m) => (VS_STORM[m && m.gameStatus && m.gameStatus.state] ? m.gameStatus.state : 'on');
function vsStormCardHtml(m) {
    if (!vsStormOn(m)) return '';
    const s = VS_STORM[vsStormState(m)], note = String(m.gameStatus.note || '').trim();
    return `<div class="bg-[#1A1405]/95 border-2 border-amber-400/60 rounded-2xl p-3 space-y-2">
        <div class="flex items-center gap-3"><div class="text-3xl leading-none">⛈️</div>
            <div class="flex-1 min-w-0"><div class="text-[10px] font-black uppercase tracking-wider text-amber-300">Storm watch</div><div class="text-xs text-white/80">The organizer is watching the weather.</div></div>
            <span class="shrink-0 px-3 py-1.5 rounded-full border-2 text-xs font-black ${s.cls}">${s.emoji} ${s.label}</span></div>
        ${note ? `<p class="text-xs text-white/90">${esc(note)}</p>` : ''}</div>`;
}
window.openVsStorm = function () {
    const m = V.open; if (!m) return;
    const on = vsStormOn(m), st = vsStormState(m);
    sheet('vs-storm', '⛈️ Storm watch', `
        <p class="text-[11px] text-white/65">Shows a weather box on the match and tells everyone in it (teams, squads, you) what's going on.</p>
        <div class="space-y-2">${Object.entries(VS_STORM).map(([k, s]) => `<label class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 cursor-pointer">
            <input type="radio" name="vs-storm-state" value="${k}" ${st === k ? 'checked' : ''} class="w-4 h-4 accent-[#00F296]"><span class="text-xs font-bold">${s.emoji} ${s.label}</span></label>`).join('')}</div>
        <input id="vs-storm-note" maxlength="160" value="${esc((m.gameStatus && m.gameStatus.note) || '')}" placeholder="Note for players (optional), e.g. We'll decide at 6:30" class="${INPUT}">
        <button onclick="saveVsStorm(true)" class="${BTN} w-full py-3">${on ? 'Save and notify' : 'Turn on and notify'}</button>
        ${on ? `<button onclick="saveVsStorm(false)" class="${DARK} w-full">Turn Storm watch off</button>
        <button onclick="document.getElementById('vs-storm')?.remove(); cancelVs()" class="${DARK} w-full !text-red-400">⛈️ Cancel the match (storm)</button>` : ''}`);
};
window.saveVsStorm = async function (turnOn) {
    const m = V.open; if (!m) return;
    const state = (document.querySelector('input[name="vs-storm-state"]:checked') || {}).value || 'on';
    const note = (document.getElementById('vs-storm-note')?.value || '').trim().slice(0, 160);
    const gs = { stormWatch: !!turnOn, state, note, by: myUid(), byName: myName(), at: Date.now() };
    try {
        await updateDoc(D('vsMatches', m.id), { gameStatus: gs, updatedBy: myUid(), updatedAt: serverTimestamp() });
        const s = VS_STORM[state];
        const text = turnOn ? `⛈️ Storm watch: ${s.emoji} ${s.label}${note ? `. ${note}` : ''}` : '☀️ Storm watch is off. The match is on as planned.';
        await addDoc(collection(db, 'artifacts', appId, 'vsMatches', m.id, 'comments'), { text, byUid: myUid(), byName: myName(), avatar: myAvatar(), announce: true, at: serverTimestamp() });
        document.getElementById('vs-storm')?.remove();
        toast(turnOn ? `Saved: ${s.label}. Everyone was notified.` : 'Storm watch off. Everyone was notified.');
    } catch (e) { toast("Couldn't save.", 'error'); }
};

window.openVsNotify = function () {
    const m = V.open; if (!m) return;
    sheet('vs-notify', '📣 Notify players', `
        <p class="text-[11px] text-white/60">Everyone in this match gets a notification: the players of every team, the free-agent squads, and you. It's also posted in Comments.</p>
        <textarea id="vn-text" rows="4" maxlength="300" class="${INPUT}" placeholder="e.g. Field 3 tonight, bring dark shirts!"></textarea>
        <div class="flex flex-wrap gap-1.5">${["Game is on! ⚽", "Running 10 min late", "Field changed, check the location", "Rain: game cancelled ☔", "Please pay before kickoff 💵"].map(t => `<button onclick="document.getElementById('vn-text').value=this.textContent" class="rounded-full px-3 py-1.5 text-[11px] font-bold bg-white/10 border border-white/10">${esc(t)}</button>`).join('')}</div>
        <button onclick="sendVsNotify()" class="${BTN} w-full py-3"><i class="fa-solid fa-paper-plane mr-1"></i> Send to everyone</button>`);
    setTimeout(() => document.getElementById('vn-text')?.focus(), 50);
};
window.sendVsNotify = async function () {
    const m = V.open; if (!m) return;
    const text = val('vn-text'); if (!text) { toast('Write the message first.', 'error'); return; }
    try {
        await addDoc(collection(db, 'artifacts', appId, 'vsMatches', m.id, 'comments'), { text: text.slice(0, 300), byUid: myUid(), byName: myName(), avatar: myAvatar(), announce: true, at: serverTimestamp() });
        document.getElementById('vs-notify')?.remove();
        toast('Sent! Everyone in the match gets the notification. 📣');
    } catch (e) { toast("Couldn't send it.", 'error'); }
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
            <img src="${esc(personAvatar(c.byUid, c.avatar, c.byName))}" onerror="this.src='${DEFAULT_AV}'" class="w-8 h-8 rounded-full object-cover shrink-0">
            <div class="min-w-0 flex-1 ${c.announce ? 'bg-amber-400/10 border-amber-400/40' : 'bg-black/40 border-white/10'} border rounded-2xl px-3 py-2">
                <div class="flex items-baseline justify-between gap-2"><span class="text-xs font-black truncate">${c.announce ? '📣 ' : ''}${esc(c.byName || 'Player')}${c.announce ? ' <span class="text-[9px] font-black text-amber-300">ORGANIZER</span>' : ''}</span><span class="text-[10px] text-white/45 shrink-0">${msTs(c.at) ? esc(new Date(msTs(c.at)).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}</span></div>
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
// ---- tap a team at the top: its card for this match (everyone sees the basics; the organizer manages it)
window.openVsTeamCard = function (teamId) {
    const m = V.open; if (!m) return;
    const t = (m.teams || []).find(x => x.teamId === teamId); if (!t) return;
    const boss = m.organizerId === myUid();
    const live = m.status === 'open' || m.status === 'challenge';
    const full = teamFull(teamId) || {};
    const price = +m.priceCents || 0, paid = paidCents(m, teamId), left = Math.max(0, price - paid);
    const members = full.members || [];
    const cap = members.find(p => p.role === 'captain') || members.find(p => p.uid && p.uid === full.ownerId);
    const coming = members.filter(p => (t.roster || []).includes(p.id));
    const r = full.record || {};
    const games = (+r.w || 0) + (+r.d || 0) + (+r.l || 0);
    const pays = (m.payments || []).filter(p => p.teamId === teamId);
    const pct = price ? Math.min(100, Math.round(paid * 100 / price)) : 100;
    const H = (x) => `<div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">${x}</div>`;
    const chip = (p) => { const nm = p.uid ? personName(p.uid, p.name) : p.name;
        return `<span class="flex items-center gap-1.5 rounded-full bg-white/10 pl-1 pr-2.5 py-1 text-[11px] font-bold"><img src="${esc(p.uid ? personAvatar(p.uid, p.avatar, nm) : DEFAULT_AV)}" onerror="this.src='${DEFAULT_AV}'" class="w-6 h-6 rounded-full object-cover">${p.number ? esc(p.number) + ' · ' : ''}${esc(nm)}</span>`; };
    const methodName = { cash: 'Cash', venmo: 'Venmo', zelle: 'Zelle', cashapp: 'Cash App', other: 'Other' };
    sheet('vs-teamcard', esc(t.name), `
        <div class="flex items-center gap-3">${teamLogoHtml(t, 56)}
            <div class="flex-1 min-w-0 space-y-1">
                <div class="flex flex-wrap items-center gap-1.5">${t.state === 'confirmed' ? '<span class="text-[9px] font-black rounded-full px-2 py-1 bg-[#00F296] text-slate-950">CONFIRMED</span>' : t.state === 'invited' ? '<span class="text-[9px] font-black rounded-full px-2 py-1 bg-fuchsia-500/30 text-fuchsia-200">INVITED</span>' : '<span class="text-[9px] font-black rounded-full px-2 py-1 bg-amber-400/20 text-amber-300">PENDING</span>'}
                ${full.temp ? '<span class="text-[9px] font-black rounded-full px-2 py-1 bg-fuchsia-500/30 text-fuchsia-100">TEMP SQUAD</span>' : ''}${t.offApp ? '<span class="text-[9px] font-black rounded-full px-2 py-1 bg-white/10 text-white/70">NOT ON FUTNET</span>' : ''}</div>
                ${cap ? `<div class="text-[11px] text-white/70">Captain: <b class="text-white">${esc(cap.uid ? personName(cap.uid, cap.name) : cap.name)}</b></div>` : ''}
                ${[full.city, full.level ? levelLabel(full.level) : '', members.length ? `${members.length} player${members.length === 1 ? '' : 's'}` : ''].filter(Boolean).length ? `<div class="text-[11px] text-white/55">${[full.city, full.level ? levelLabel(full.level) : '', members.length ? `${members.length} player${members.length === 1 ? '' : 's'}` : ''].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
            </div></div>
        ${games ? `<div class="grid grid-cols-4 gap-1.5 text-center">${[['W', r.w], ['D', r.d], ['L', r.l], ['Goals', `${+r.gf || 0}-${+r.ga || 0}`]].map(([k, v]) => `<div class="bg-black/40 rounded-xl py-2"><div class="text-sm font-black">${esc(v || 0)}</div><div class="text-[9px] text-white/50 font-bold">${k}</div></div>`).join('')}</div>` : ''}
        <div class="space-y-1.5">${H(`Coming to this match (${coming.length})`)}
            ${coming.length ? `<div class="flex flex-wrap gap-1.5">${coming.map(chip).join('')}</div>` : '<p class="text-[11px] text-white/50">The captain hasn\'t picked who\'s coming yet.</p>'}</div>
        ${price ? `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2">${H('Payment')}
            <div class="flex justify-between text-xs"><span>${money(paid)} of ${money(price)} paid</span><b class="${left ? 'text-amber-300' : 'text-[#00F296]'}">${left ? money(left) + ' left' : 'Paid in full ✅'}</b></div>
            <div class="h-2 rounded-full bg-white/10 overflow-hidden"><div class="h-full ${pct >= 100 ? 'bg-[#00F296]' : 'bg-amber-400'}" style="width:${pct}%"></div></div>
            ${boss && pays.length ? `<div class="space-y-1">${pays.map((p, i) => `<div class="flex items-center gap-2 text-[11px] bg-white/5 rounded-lg px-2 py-1.5"><span class="flex-1">${money(p.cents)} · ${esc(methodName[p.method] || p.method || '')}${p.at ? ' · ' + esc(new Date(p.at).toLocaleDateString([], { month: 'short', day: 'numeric' })) : ''}</span>
                ${live ? `<button onclick="vsUndoPayment('${jsq(teamId)}', ${+p.at || 0}, ${i})" class="text-[10px] font-black text-red-300 px-1">Undo</button>` : ''}</div>`).join('')}</div>` : ''}
        </div>` : ''}
        ${boss && live && t.state !== 'invited' ? `<div class="space-y-2">${H('Organizer')}
            ${price && left ? `<button onclick="vsPayInFull('${jsq(teamId)}')" class="${BTN} w-full py-3">✅ They paid it all (${money(left)})</button>
            <button onclick="document.getElementById('vs-teamcard')?.remove(); openVsPayment('${jsq(teamId)}')" class="${DARK} w-full">💵 Got part of it / pick how they paid</button>` : ''}
            ${t.state === 'pending' && !price ? `<p class="text-[11px] text-amber-200">Waiting for an open spot (the match is full).</p>` : ''}
            <button onclick="document.getElementById('vs-teamcard')?.remove(); leaveVs('${jsq(teamId)}')" class="${DARK} w-full !text-red-400">Remove team from the match</button></div>` : ''}
        ${!t.offApp && !teamId.startsWith('x_') ? `<button onclick="document.getElementById('vs-teamcard')?.remove(); vsOpenTeam('${jsq(teamId)}')" class="${DARK} w-full">👥 See the full team page</button>` : ''}`);
};
/** Organizer: the team paid the rest in one go. */
window.vsPayInFull = async function (teamId) {
    const m = V.open; if (!m) return;
    try {
        let got = 0;
        await changeMatch(m.id, (x) => {
            const left = Math.max(0, (+x.priceCents || 0) - paidCents(x, teamId)); if (!left) return false;
            x.payments.push({ teamId, cents: left, method: 'cash', byUid: myUid(), at: Date.now() }); got = left; settle(x);
        });
        document.getElementById('vs-teamcard')?.remove();
        if (got) toast(`Marked ${money(got)} received. Paid in full ✅`);
    } catch (e) { toast("Couldn't save the payment.", 'error'); }
};
/** Organizer: take back a payment marked by mistake (the team goes back to pending if it's no longer paid up). */
window.vsUndoPayment = async function (teamId, at, idx) {
    const m = V.open; if (!m) return;
    if (!confirm('Take back this payment?')) return;
    try {
        await changeMatch(m.id, (x) => {
            const mine = x.payments.map((p, i) => [p, i]).filter(([p]) => p.teamId === teamId);
            const hit = mine.find(([p]) => at && +p.at === at) || mine[idx]; if (!hit) return false;
            x.payments.splice(hit[1], 1);
            const t = x.teams.find(y => y.teamId === teamId);
            if (t && t.state === 'confirmed' && (+x.priceCents || 0) > 0 && paidCents(x, teamId) < +x.priceCents) t.state = 'pending';
            settle(x);
        });
        document.getElementById('vs-teamcard')?.remove();
        toast('Payment taken back.');
    } catch (e) { toast("Couldn't do that.", 'error'); }
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
        document.getElementById('vs-score')?.remove(); toast('Final score saved. 🏁'); autoCards(m.id);
    } catch (e) { toast("Couldn't save the score.", 'error'); }
};
window.saveVsForfeit = async function (loserId) {
    const m = V.open; if (!m) return;
    const [a, b] = confirmedTeams(m);
    const winner = a.teamId === loserId ? b : a;
    if (!confirm(`Count it as a 3-0 win for ${winner.name}?`)) return;
    try {
        await changeMatch(m.id, (x) => { x.score = { [winner.teamId]: 3, [loserId]: 0 }; x.forfeit = loserId; x.status = 'final'; });
        document.getElementById('vs-score')?.remove(); toast('Saved as a forfeit.'); autoCards(m.id);
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
    try {
        await changeMatch(m.id, (x) => { x.status = 'cancelled'; x._edit = { live: null }; });
        toast('Match cancelled.');
        window.closeVsManage(); window.closeVsMatch && window.closeVsMatch();       // it's off the Games list now
        if (typeof window.renderEvents === 'function') window.renderEvents();
    } catch (e) { toast("Couldn't cancel.", 'error'); }
};
window.rematchVs = function () {
    const m = V.open; if (!m) return;
    const mineIn = (m.teams || []).find(t => myCaptainTeams().some(x => x.id === t.teamId));
    window.openCreateVs({
        rematchOf: m.id, title: m.title, location: m.location, park: m.park, city: m.city, state: m.state, time: m.time, format: m.format, level: m.level, teamsCount: m.teamsCount,
        priceCents: m.priceCents, firstToPay: m.firstToPay, partial: m.partial, payByHours: m.payByHours, rosterLockHours: m.rosterLockHours, squadsOn: m.squadsOn !== false,
        description: m.description || '', rules: m.rules || '', refundNote: m.refundNote || '',
        include: !!mineIn, teamId: mineIn ? mineIn.teamId : '',
        inviteTeams: confirmedTeams(m).filter(t => !mineIn || t.teamId !== mineIn.teamId).map(t => ({ teamId: t.teamId, name: t.name, short: t.short, logo: t.logo, colors: t.colors })),
    });
};

// ---------------------------------------------------------------- a team's VS matches (team page > Schedule)
export function teamVsHtml(teamId) {
    const list = V.list.filter(m => (m.teamIds || []).includes(teamId) && m.status !== 'declined' && m.status !== 'cancelled').sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    if (!list.length) return '';
    return `<div class="text-[10px] font-black uppercase tracking-wider text-fuchsia-300">VS Matches (${list.length})</div>
        <div class="space-y-2">${list.map(vsCardHtml).join('')}</div>`;
}
window.vsTeamHtml = teamVsHtml;

// ---------------------------------------------------------------- a player's VS matches (Profile > Games: Upcoming / Previous)
/** VS matches someone organizes or plays in (their team is in the match). Returns [{ date, time, html }] to mix with normal games. */
window.vsGamesFor = function (uid, which, { beforeOpen = '' } = {}) {
    if (!uid) return [];
    const today = ymdToday();
    const teamsOf = uid === myUid() ? (TS().mine || []) : [...(TS().all || []), ...Object.values(teamCache)].filter(t => t && (t.memberUids || []).includes(uid));
    const ids = new Set(teamsOf.map(t => t.id || t.teamId));
    return V.list.filter(m => m.status !== 'cancelled' && m.status !== 'declined' && (m.organizerId === uid || (m.teamIds || []).some(id => ids.has(id))))
        .filter(m => { const over = m.status === 'final' || (m.date || '') < today; return which === 'upcoming' ? !over : over; })
        .map(m => {
            const conf = confirmedTeams(m), mine = conf.find(t => ids.has(t.teamId));
            const score = m.status === 'final' && m.score && conf.length === 2 ? `${m.score[conf[0].teamId] ?? 0} - ${m.score[conf[1].teamId] ?? 0}` : '';
            return { date: m.date || '', time: m.time || '', html: `
            <div onclick="${beforeOpen}openVsMatch('${jsq(m.id)}')" class="bg-black/50 border border-[#E8262B]/40 hover:border-[#E8262B] rounded-xl p-3 cursor-pointer transition flex items-center justify-between gap-2">
                <div class="min-w-0 flex items-center gap-2.5">
                    ${mine ? `<span class="shrink-0">${teamLogoHtml(mine, 30)}</span>` : ''}
                    <div class="min-w-0">
                        <div class="flex items-center gap-2"><span class="text-[9px] px-1.5 py-0.5 rounded font-black bg-[#E8262B] text-white shrink-0">VS</span><span class="text-xs font-black text-white truncate">${esc(vsTitleOf(m))}</span></div>
                        <p class="text-[10px] text-white/60 mt-0.5"><i class="fa-solid fa-calendar text-[#00F296]"></i> ${esc(prettyDate(m.date) || 'TBD')} • ${esc(prettyTime(m.time) || '')}${score ? ` • <b class="text-white">${esc(score)}</b>` : ''}</p>
                    </div>
                </div>
                <span class="text-[10px] font-bold text-white/70 shrink-0">View ›</span>
            </div>` };
        });
};
