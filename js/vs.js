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
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, onSnapshot, runTransaction, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { teamLogoHtml, canManage, FORMATS, LEVELS } from './teams.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsq = (v) => esc(String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const toast = (m, t) => window.showToast && window.showToast(m, t);
const myUid = () => (window.currentUser && window.currentUser.uid) || '';
const myName = () => { const p = window.userProfile || {}; return (p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Player').trim(); };
const C = (name) => collection(db, 'artifacts', appId, name);
const D = (...p) => doc(db, 'artifacts', appId, ...p);
const TS = () => window.__teamsState || { mine: [], all: [] };
const myCaptainTeams = () => (TS().mine || []).filter(t => canManage(t));
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
    if (!t) return `<div class="rounded-full border-2 border-dashed border-white/35 flex items-center justify-center text-[9px] font-black text-white/50 text-center leading-tight" style="width:${size}px;height:${size}px">Open<br>spot</div>`;
    return `<div class="flex flex-col items-center gap-1 min-w-0" style="width:${size + 30}px">${teamLogoHtml(t, size)}<span class="text-[10px] font-black text-white truncate max-w-full">${esc(t.name)}</span></div>`;
}
export function vsCardHtml(m) {
    const n = m.teamsCount || 2;
    const shown = (m.teams || []).filter(t => t.state !== 'invited' || m.status === 'challenge').slice(0, n);
    const slots = Array.from({ length: n }, (_, i) => shown[i] || null);
    const label = m.status === 'challenge' ? '⚔️ CHALLENGE · waiting for an answer' : m.status === 'final' ? '🏁 FINAL' : m.status === 'cancelled' ? '❌ CANCELLED' : isFull(m) ? '✅ FULL' : `${n - spotsTaken(m)} spot${n - spotsTaken(m) === 1 ? '' : 's'} open`;
    const score = m.status === 'final' && m.score && n === 2 ? `<div class="text-2xl font-black text-white">${esc(m.score[slots[0]?.teamId] ?? 0)} - ${esc(m.score[slots[1]?.teamId] ?? 0)}</div>` : '<div class="text-xl font-black text-[#00F296]">VS</div>';
    return `<div onclick="openVsMatch('${jsq(m.id)}')" class="relative bg-gradient-to-br from-[#1a0b2e]/95 to-[#010A0F]/95 rounded-2xl overflow-hidden shadow-xl border-[1.6px] border-fuchsia-500/60 hover:border-fuchsia-400 transition cursor-pointer p-4 space-y-3">
        <div class="flex items-center justify-between"><span class="text-[10px] font-black tracking-widest text-fuchsia-300">⚔️ VS MODE</span><span class="text-[10px] font-bold text-white/60">${esc(label)}</span></div>
        <div class="flex items-center justify-center gap-3">${n === 2 ? `${slotHtml(slots[0])}${score}${slotHtml(slots[1])}` : slots.map(s => slotHtml(s, 38)).join('<span class="text-xs font-black text-[#00F296]">VS</span>')}</div>
        <div class="text-center text-[11px] text-white/70">${esc(prettyTime(m.time))}${m.location ? ' · ' + esc(m.location) : ''} · ${esc(m.format || '')}${(+m.priceCents || 0) > 0 ? ' · ' + money(m.priceCents) + ' per team' : ' · Free'}</div>
    </div>`;
}
window.vsCardHtml = vsCardHtml;
function wrapEvents() {
    const orig = window.renderEvents;
    if (typeof orig !== 'function' || orig._vs) return;
    const w = function () {
        orig.apply(this, arguments);
        const grid = document.getElementById('events-grid'); if (!grid) return;
        const day = window.selectedDateStr;
        const list = V.list.filter(m => (m.date || '') === day && m.status !== 'declined').sort((a, b) => String(a.time).localeCompare(String(b.time)));
        if (!list.length) return;
        const cards = list.map(vsCardHtml).join('');
        if (grid.querySelector('.fa-calendar-xmark') || grid.querySelector('.fa-spin')) grid.innerHTML = cards;
        else grid.insertAdjacentHTML('afterbegin', cards);
    };
    w._vs = true; window.renderEvents = w;
}
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
        onclick="this.parentNode.querySelectorAll('button').forEach(b=>{b.dataset.on='';b.classList.remove('border-[#00F296]','bg-[#00F296]/10')});this.dataset.on='1';this.classList.add('border-[#00F296]','bg-[#00F296]/10')"
        class="w-full flex items-center gap-3 rounded-xl px-3 py-2 border ${t.id === cur ? 'border-[#00F296] bg-[#00F296]/10' : 'border-white/10 bg-white/5'}">${teamLogoHtml(t, 30)}<span class="text-sm font-black truncate">${esc(t.name)}</span></button>`).join('')}</div>`;
}

// ---------------------------------------------------------------- Create VS Match (the + menu)
window.openCreateVs = function (prefill = {}) {
    if (!myUid()) return;
    const mine = myCaptainTeams();
    const t0 = prefill.teamId || (mine[0] && mine[0].id) || '';
    window._vsPrefill = prefill;
    sheet('vs-create', prefill.rematchOf ? '🔁 Rematch' : '⚔️ Create VS Match', `
        ${mine.length ? `<div class="space-y-2">${LBL('Include your team?')}
            ${seg('vs-include', [['yes', 'Yes, my team plays'], ['no', 'No, I just organize']], prefill.include === false ? 'no' : 'yes')}
            ${mine.length > 1 ? `<div id="vs-team-wrap">${LBL('Which team?')}${teamPicker('vs-team', mine, t0)}</div>` : `<input type="hidden" id="vs-one-team" value="${esc(t0)}">`}</div>`
            : '<p class="text-[11px] text-white/55">You can organize a match for other teams. (Create a team in the Teams tab to play in one.)</p>'}
        <div>${LBL('Name (optional)')}<input id="vs-title" class="${INPUT}" maxlength="50" value="${esc(prefill.title || '')}" placeholder="e.g. Sunday Showdown"></div>
        <div class="flex gap-3">
            <div class="flex-1">${LBL('Date *')}<input id="vs-date" type="date" class="${INPUT}" value="${esc(prefill.date || '')}"></div>
            <div class="flex-1">${LBL('Time *')}<input id="vs-time" type="time" class="${INPUT}" value="${esc(prefill.time || '')}"></div>
        </div>
        <div>${LBL('Where *')}<input id="vs-loc" class="${INPUT}" maxlength="80" value="${esc(prefill.location || '')}" placeholder="Field or park"></div>
        <div>${LBL('Format')}${seg('vs-format', SIZES.map(s => [s, s]), prefill.format || '7v7')}</div>
        <div>${LBL('How many teams?')}${seg('vs-count', [['2', '2 teams'], ['3', '3 teams'], ['4', '4 teams']], String(prefill.teamsCount || 2))}</div>
        <div>${LBL('Level')}${seg('vs-level', LEVELS, prefill.level || 'casual')}</div>
        <div>${LBL('Price per team ($, 0 = free)')}<input id="vs-price" inputmode="decimal" class="${INPUT}" value="${esc(prefill.priceCents ? (prefill.priceCents / 100) : '')}" placeholder="0"></div>
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
// "No, I just organize": hide the team list.
window.__vsSeg = (name) => { if (name === 'vs-include') { const w = document.getElementById('vs-team-wrap'); if (w) w.style.display = segVal('vs-include') === 'no' ? 'none' : ''; } };
window.saveCreateVs = async function () {
    const date = val('vs-date'), time = val('vs-time'), location = val('vs-loc');
    if (!date || !time || !location) { toast('Fill in the date, time and place.', 'error'); return; }
    const include = (document.querySelector('[data-seg="vs-include"]') ? segVal('vs-include') : 'no') === 'yes';
    const teamId = segVal('vs-team') || val('vs-one-team');
    const mine = myCaptainTeams().find(t => t.id === teamId);
    if (include && !mine) { toast('Pick your team.', 'error'); return; }
    const price = Math.round((parseFloat(val('vs-price').replace(',', '.')) || 0) * 100);
    const pre = window._vsPrefill || {};
    const teams = [];
    if (include) teams.push(teamEntry(mine, price > 0 ? 'pending' : 'confirmed'));
    // Rematch: the teams from last time are invited back (they hold their spot until they answer).
    (pre.inviteTeams || []).forEach(t => { if (!teams.some(x => x.teamId === t.teamId)) teams.push({ ...t, state: 'invited', roster: [], joinedAt: Date.now() }); });
    const m = {
        title: val('vs-title'), date, time, location, format: segVal('vs-format') || '7v7', level: segVal('vs-level') || 'casual',
        teamsCount: parseInt(segVal('vs-count'), 10) || 2, priceCents: price,
        firstToPay: !!document.getElementById('vs-first')?.checked, partial: !!document.getElementById('vs-partial')?.checked,
        payByHours: parseInt(segVal('vs-payby'), 10) || 0, rosterLockHours: parseInt(segVal('vs-lock'), 10) || 0,
        organizerId: myUid(), organizerName: myName(), status: 'open', teams, teamIds: teams.map(t => t.teamId), payments: [],
        rematchOf: pre.rematchOf || '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    try {
        const ref = doc(C('vsMatches'));
        await setDoc(ref, settle(m));
        document.getElementById('vs-create')?.remove();
        window.closeCreateActionSheet && window.closeCreateActionSheet();
        toast('VS Match created! ⚔️');
        window.openVsMatch(ref.id, m);
    } catch (e) { console.error(e); toast("Couldn't create the match.", 'error'); }
};

// ---------------------------------------------------------------- Challenge (from another team's page)
export function challengeButtonHtml(t) {
    const mine = myCaptainTeams().filter(x => x.id !== t.id);
    if (!mine.length) return '';
    return `<button onclick="openChallenge('${jsq(t.id)}')" class="w-full py-3 rounded-xl text-sm font-black text-white bg-gradient-to-r from-fuchsia-600 to-purple-600">⚔️ Challenge ${esc(t.name)}</button>`;
}
window.openChallenge = function (teamId) {
    const target = (TS().all || []).find(x => x.id === teamId) || (window.__teamsState && window.__teamsState.open) || null;
    const mine = myCaptainTeams().filter(x => x.id !== teamId);
    if (!target || !mine.length) return;
    sheet('vs-challenge', `⚔️ Challenge ${esc(target.name)}`, `
        <div class="flex items-center justify-center gap-3">${teamLogoHtml(mine[0], 56)}<span class="text-xl font-black text-[#00F296]">VS</span>${teamLogoHtml(target, 56)}</div>
        ${mine.length > 1 ? `<div>${LBL('Your team')}${teamPicker('ch-team', mine, mine[0].id)}</div>` : `<input type="hidden" id="ch-one-team" value="${esc(mine[0].id)}">`}
        <div class="flex gap-3">
            <div class="flex-1">${LBL('Date *')}<input id="ch-date" type="date" class="${INPUT}"></div>
            <div class="flex-1">${LBL('Time *')}<input id="ch-time" type="time" class="${INPUT}"></div>
        </div>
        <div>${LBL('Where *')}<input id="ch-loc" class="${INPUT}" maxlength="80" placeholder="Field or park"></div>
        <div>${LBL('Format')}${seg('ch-format', SIZES.map(s => [s, s]), '7v7')}</div>
        <div>${LBL('Price per team ($, 0 = free)')}<input id="ch-price" inputmode="decimal" class="${INPUT}" placeholder="0"></div>
        <div>${LBL('Message (optional)')}<input id="ch-msg" class="${INPUT}" maxlength="140" placeholder="e.g. Rematch from last week? 😤"></div>
        <button onclick="sendChallenge('${jsq(teamId)}')" class="w-full py-3 rounded-xl text-sm font-black text-white bg-gradient-to-r from-fuchsia-600 to-purple-600">Send challenge</button>`);
};
window.sendChallenge = async function (targetId) {
    const target = (TS().all || []).find(x => x.id === targetId) || (window.__teamsState && window.__teamsState.open);
    const mine = myCaptainTeams().find(t => t.id === (segVal('ch-team') || val('ch-one-team')));
    const date = val('ch-date'), time = val('ch-time'), location = val('ch-loc');
    if (!target || !mine) return;
    if (!date || !time || !location) { toast('Fill in the date, time and place.', 'error'); return; }
    const price = Math.round((parseFloat(val('ch-price').replace(',', '.')) || 0) * 100);
    const teams = [teamEntry(mine, price > 0 ? 'pending' : 'confirmed'), teamEntry(target, 'invited')];
    const m = {
        title: '', date, time, location, format: segVal('ch-format') || '7v7', level: target.level || mine.level || 'casual', teamsCount: 2,
        priceCents: price, firstToPay: false, partial: false, payByHours: price > 0 ? 24 : 0, rosterLockHours: 0,
        organizerId: myUid(), organizerName: myName(), status: 'challenge', message: val('ch-msg'),
        challenge: { fromTeamId: mine.id, toTeamId: target.id, status: 'pending' },
        teams, teamIds: teams.map(t => t.teamId), payments: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    try {
        await setDoc(doc(C('vsMatches')), m);
        document.getElementById('vs-challenge')?.remove();
        toast(`Challenge sent to ${target.name}! Their captains will get a notification.`);
    } catch (e) { console.error(e); toast("Couldn't send the challenge.", 'error'); }
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
            return `<div class="bg-fuchsia-500/10 border border-fuchsia-400/40 rounded-2xl p-3 space-y-2">
                <div class="flex items-center gap-3">${teamLogoHtml(from, 40)}<div class="flex-1 min-w-0">
                    <div class="text-sm font-black truncate">${esc(from.name)} challenged ${esc(to.name)}</div>
                    <div class="text-[11px] text-white/65">${esc(prettyDate(m.date))} · ${esc(prettyTime(m.time))} · ${esc(m.location)} · ${esc(m.format)}${(+m.priceCents || 0) > 0 ? ' · ' + money(m.priceCents) + ' per team' : ''}</div>
                    ${m.message ? `<div class="text-[11px] text-white/80 italic">"${esc(m.message)}"</div>` : ''}</div></div>
                <div class="flex gap-2"><button onclick="answerChallenge('${jsq(m.id)}', false)" class="${DARK} flex-1">Decline</button>
                    <button onclick="openVsMatch('${jsq(m.id)}')" class="${DARK} flex-1">Details</button>
                    <button onclick="answerChallenge('${jsq(m.id)}', true)" class="${BTN} flex-1">Accept</button></div>
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
        toast(yes ? "Challenge accepted! ⚔️ It's on both schedules." : 'Challenge declined.');
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
            score: m.score || null, forfeit: m.forfeit || '', updatedBy: myUid(), updatedAt: serverTimestamp(),
            ...(m._edit || {}) });
    });
}

// ---------------------------------------------------------------- the match page
window.openVsMatch = function (id, initial) {
    V.open = V.list.find(m => m.id === id) || (initial ? { ...initial, id } : { id, teams: [] });
    if (!V.list.find(m => m.id === id)) getDoc(D('vsMatches', id)).then(s => { if (s.exists() && V.open && V.open.id === id) { V.open = { ...s.data(), id }; drawPage(); } }).catch(() => {});
    drawPage();
};
window.closeVsMatch = function () { V.open = null; document.getElementById('vs-page')?.remove(); };
function drawPage() {
    const m = V.open; if (!m) return;
    let el = document.getElementById('vs-page');
    if (!el) { el = document.createElement('div'); el.id = 'vs-page'; el.dataset.close = 'closeVsMatch'; el.className = 'fixed inset-0 z-[135] bg-[#05010A]/95 backdrop-blur-sm overflow-y-auto text-white'; document.body.appendChild(el); }
    const boss = m.organizerId === myUid();
    const n = m.teamsCount || 2;
    const price = +m.priceCents || 0;
    const shown = (m.teams || []);
    const mineCap = myCaptainTeams();
    const myEntry = shown.find(t => mineCap.some(x => x.id === t.teamId));
    const canJoin = m.status === 'open' && !myEntry && mineCap.length && (!isFull(m) || m.firstToPay !== false);
    const live = m.status === 'open' || m.status === 'challenge';
    const conf = confirmedTeams(m);
    const clash = conf.length >= 2 && colorsClash((conf[0].colors || {}).primary, (conf[1].colors || {}).primary);
    const stateChip = (t) => t.state === 'confirmed' ? '<span class="text-[9px] font-black rounded-full px-2 py-1 bg-[#00F296] text-slate-950">CONFIRMED</span>'
        : t.state === 'invited' ? '<span class="text-[9px] font-black rounded-full px-2 py-1 bg-fuchsia-500/30 text-fuchsia-200">INVITED</span>'
        : `<span class="text-[9px] font-black rounded-full px-2 py-1 bg-amber-400/20 text-amber-300">${isFull(m) && m.firstToPay !== false ? 'SPOTS FULL' : 'PENDING'}</span>`;
    const teamRow = (t) => {
        const paid = paidCents(m, t.teamId);
        const pct = price ? Math.min(100, Math.round(paid * 100 / price)) : 100;
        const iCap = mineCap.some(x => x.id === t.teamId);
        const full = (TS().mine || []).find(x => x.id === t.teamId) || (TS().all || []).find(x => x.id === t.teamId);
        const roster = (t.roster || []).map(id => ((full && full.members) || []).find(p => p.id === id)).filter(Boolean);
        return `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2">
            <div class="flex items-center gap-3">${teamLogoHtml(t, 42)}
                <div class="flex-1 min-w-0"><div class="text-sm font-black truncate">${esc(t.name)}</div>
                ${price ? `<div class="text-[11px] text-white/60">${money(paid)} of ${money(price)} paid</div>` : ''}</div>${stateChip(t)}</div>
            ${price ? `<div class="h-2 rounded-full bg-white/10 overflow-hidden"><div class="h-full ${pct >= 100 ? 'bg-[#00F296]' : 'bg-amber-400'}" style="width:${pct}%"></div></div>` : ''}
            ${roster.length ? `<div class="flex flex-wrap gap-1">${roster.map(p => `<span class="text-[10px] font-bold rounded-full px-2 py-1 bg-white/10">${p.number ? esc(p.number) + ' · ' : ''}${esc(p.name)}</span>`).join('')}</div>` : ''}
            <div class="flex flex-wrap gap-2">
                ${iCap && live && t.state !== 'invited' ? `<button onclick="openVsRoster('${jsq(t.teamId)}')" class="${DARK}" ${rosterLocked(m) ? 'disabled' : ''}>${rosterLocked(m) ? '🔒 Roster locked' : `Pick who's coming (${(t.roster || []).length})`}</button>` : ''}
                ${boss && live && price && t.state !== 'invited' && paid < price ? `<button onclick="openVsPayment('${jsq(t.teamId)}')" class="${BTN}">💵 Got a payment</button>` : ''}
                ${iCap && live && m.challenge && m.challenge.toTeamId === t.teamId && m.challenge.status === 'pending' ? `<button onclick="answerChallenge('${jsq(m.id)}', true)" class="${BTN}">Accept challenge</button><button onclick="answerChallenge('${jsq(m.id)}', false)" class="${DARK}">Decline</button>` : ''}
                ${t.state === 'invited' && iCap && !m.challenge ? `<button onclick="answerInvite('${jsq(m.id)}','${jsq(t.teamId)}', true)" class="${BTN}">We're in</button><button onclick="answerInvite('${jsq(m.id)}','${jsq(t.teamId)}', false)" class="${DARK}">Can't make it</button>` : ''}
                ${(iCap || boss) && live && !(m.challenge && m.challenge.fromTeamId === t.teamId) ? `<button onclick="leaveVs('${jsq(t.teamId)}')" class="text-[11px] font-bold text-red-400 px-2">${boss && !iCap ? 'Remove team' : 'Leave match'}</button>` : ''}
            </div>
        </div>`;
    };
    const scoreLine = m.status === 'final' && m.score && n === 2 && shown.length >= 2
        ? `<div class="text-4xl font-black text-center">${esc(m.score[conf[0]?.teamId] ?? 0)} - ${esc(m.score[conf[1]?.teamId] ?? 0)}</div>${m.forfeit ? `<div class="text-center text-[11px] text-amber-300">Forfeit: ${esc((shown.find(t => t.teamId === m.forfeit) || {}).name || '')} didn't show</div>` : ''}` : '';
    const slots = Array.from({ length: n }, (_, i) => (shown.filter(t => t.state !== 'invited' || m.status === 'challenge')[i]) || null);
    el.innerHTML = `<div class="max-w-md mx-auto p-4 pb-24 space-y-4">
        <div class="flex items-center justify-between">
            <button onclick="closeVsMatch()" class="w-9 h-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-arrow-left"></i></button>
            <span class="text-[10px] font-black tracking-widest text-fuchsia-300">⚔️ VS MODE${m.status === 'challenge' ? ' · CHALLENGE' : ''}</span>
            <span class="w-9"></span>
        </div>
        ${m.title ? `<div class="text-center text-lg font-black">${esc(m.title)}</div>` : ''}
        <div class="flex items-center justify-center gap-3">${n === 2 ? `${slotHtml(slots[0], 72)}<span class="text-2xl font-black text-[#00F296]">VS</span>${slotHtml(slots[1], 72)}` : slots.map(s => slotHtml(s, 48)).join('')}</div>
        ${scoreLine}
        <div class="bg-black/40 border border-white/10 rounded-2xl p-3 text-xs space-y-1.5">
            <div><i class="fa-regular fa-calendar text-[#00F296] w-5"></i>${esc(prettyDate(m.date))} · ${esc(prettyTime(m.time))}</div>
            <div><i class="fa-solid fa-location-dot text-[#00F296] w-5"></i>${esc(m.location || '')}</div>
            <div><i class="fa-solid fa-futbol text-[#00F296] w-5"></i>${esc(m.format || '')} · ${n} teams · ${esc(levelLabel(m.level))}</div>
            <div><i class="fa-solid fa-dollar-sign text-[#00F296] w-5"></i>${price ? `${money(price)} per team${m.payByHours ? ` · pay by ${esc(new Date(payByMs(m)).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}` : ''}${m.firstToPay !== false ? ' · first to pay is in' : ''}${m.partial ? ' · partial payments OK' : ''}` : 'Free'}</div>
            <div><i class="fa-solid fa-user-tie text-[#00F296] w-5"></i>Organized by ${esc(m.organizerName || 'Organizer')}</div>
            ${m.message ? `<div class="italic text-white/75">"${esc(m.message)}"</div>` : ''}
        </div>
        ${clash ? `<div class="bg-amber-400/10 border border-amber-400/40 rounded-xl p-3 text-[11px] text-amber-200">👕 Both teams wear similar colors. ${esc(conf[1].name)}, please bring your second color.</div>` : ''}
        ${canJoin ? `<button onclick="openJoinVs()" class="${BTN} w-full py-3 text-sm">Join with my team</button>` : ''}
        <div class="text-[10px] font-black uppercase tracking-wider text-white/55">Teams (${spotsTaken(m)}/${n} spots)</div>
        <div class="space-y-2">${shown.map(teamRow).join('') || '<p class="text-xs text-white/45 text-center py-4">No teams yet.</p>'}</div>
        ${boss && live ? `<div class="grid grid-cols-2 gap-2">
            <button onclick="openVsScore()" class="${BTN}">🏁 Final score</button>
            <button onclick="cancelVs()" class="${DARK} text-red-400">Cancel match</button></div>` : ''}
        ${boss && m.status === 'final' ? `<div class="grid grid-cols-2 gap-2"><button onclick="openVsScore()" class="${DARK}">Fix the score</button><button onclick="rematchVs()" class="${BTN}">🔁 Rematch</button></div>` : ''}
        ${!boss && m.status === 'final' && myEntry ? `<button onclick="appealVs()" class="${DARK} w-full">Appeal the score</button>` : ''}
    </div>`;
}

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
        toast(yes ? "You're in! ⚔️" : 'Got it.');
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
        rematchOf: m.id, title: m.title, location: m.location, time: m.time, format: m.format, level: m.level, teamsCount: m.teamsCount,
        priceCents: m.priceCents, firstToPay: m.firstToPay, partial: m.partial, payByHours: m.payByHours, rosterLockHours: m.rosterLockHours,
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
