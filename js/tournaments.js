// js/tournaments.js: Tournament mode (website).
//   Teams sign up (captains join with their team). When the organizer taps "Start", the format is picked
//   from how many teams are in:
//     2 teams  -> Final
//     3 or 5   -> League (everyone plays everyone), top 2 play the Final
//     4        -> Knockout: Semi-finals, Final
//     6        -> 2 groups of 3, the group winners play the Final
//     7        -> Groups of 4 and 3, the group winners play the Final
//     8        -> Knockout: Quarter-finals, Semi-finals, Final
//   The organizer enters each score (and who scored); the next round fills in by itself.
//   Draw in a knockout game -> pick who won on penalties.
// Firestore: artifacts/{appId}/tournaments/{id}
//   { name, date, time, park, city, location, format, maxTeams, priceCents, communityId, communityName, description, rules,
//     organizerId, organizerName, status: 'signup'|'running'|'final'|'cancelled', plan: 'final'|'league'|'ko4'|'groups'|'ko8',
//     teams: [{ teamId, name, short, logo, colors, paid, joinedAt }], teamIds, matches: [...], championId, createdAt, updatedAt }
//   match = { id, stage: 'league'|'group'|'qf'|'sf'|'final', group, label, a, b, aFrom, bFrom, ga, gb, pens, goals: [{ teamId, name, uid, own }], done }
// This file loads after the page is ready, so it never slows down opening the app.
import { db, appId } from './firebase-config.js';
import { doc, getDoc, setDoc, collection, onSnapshot, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { teamLogoHtml, canManage } from './teams.js';

const C = (name) => collection(db, 'artifacts', appId, name);
const D = (id) => doc(db, 'artifacts', appId, 'tournaments', id);
const myUid = () => (window.currentUser && window.currentUser.uid) || '';
const myName = () => { const p = window.userProfile || {}; return p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || (window.currentUser && window.currentUser.displayName) || 'Organizer'; };
const toast = (m, t) => window.showToast && window.showToast(m, t);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsq = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
const money = (c) => `$${((+c || 0) / 100).toFixed(2).replace(/\.00$/, '')}`;
const ymdToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const prettyDate = (ymd) => { const [y, m, d] = String(ymd || '').split('-').map(Number); return y ? new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : ''; };
const prettyTime = (hm) => { const [h, m] = String(hm || '').split(':').map(Number); return isNaN(h) ? '' : new Date(2000, 0, 1, h, m || 0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const TS = () => window.__teamsState || { mine: [], all: [] };
const myCaptainTeams = () => (TS().mine || []).filter(t => canManage(t) && !t.temp);
const BTN = 'bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black rounded-xl text-xs px-3 py-2 transition disabled:opacity-50';
const DARK = 'bg-black/60 border border-white/15 text-white font-bold rounded-xl text-xs px-3 py-2 transition';
const INPUT = 'w-full bg-black/60 border border-white/15 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#00F296]';
const GOLD = '#FACC15';
const LBL = (t) => `<div class="text-[10px] font-black uppercase tracking-wider text-white/55 mb-1.5">${t}</div>`;
const val = (id) => String(document.getElementById(id)?.value || '').trim();
const TROPHY = (s = 22) => `<span style="font-size:${s}px;line-height:1">🏆</span>`;

const TT = { list: [], unsub: null, open: null, tab: 'info' };
window.__tourneyState = TT;

// ---------------------------------------------------------------- live list (last 60 days and coming up)
function start() {
    if (TT.unsub) TT.unsub();
    TT.unsub = onSnapshot(C('tournaments'), s => {
        const cut = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
        TT.list = s.docs.map(d => ({ ...d.data(), id: d.id })).filter(t => (t.date || '') >= cut && t.status !== 'cancelled');
        try { window.renderEvents && document.getElementById('events-grid') && window.renderEvents(); } catch (e) { /* ignore */ }
        if (TT.open) { const fresh = TT.list.find(t => t.id === TT.open.id); if (fresh) { TT.open = fresh; drawPage(); } }
    }, () => {});
}
let started = '';
setInterval(() => { const u = myUid(); if (u && started !== u) { started = u; start(); } if (!u && started) { started = ''; if (TT.unsub) TT.unsub(); TT.list = []; } }, 1500);

// ---------------------------------------------------------------- the format, from how many teams are in
const STAGE = { league: 'League', group: 'Group', qf: 'Quarter-final', sf: 'Semi-final', final: 'Final' };
export function planFor(n) {
    if (n <= 2) return 'final';
    if (n === 3 || n === 5) return 'league';
    if (n === 4) return 'ko4';
    if (n === 8) return 'ko8';
    return 'groups';   // 6 and 7
}
export const PLAN_TEXT = {
    final: 'One game: the Final.',
    league: 'Everyone plays everyone. The top 2 play the Final.',
    ko4: 'Knockout: 2 semi-finals, then the Final.',
    groups: '2 groups. Each group winner goes to the Final.',
    ko8: 'Knockout: 4 quarter-finals, 2 semi-finals, then the Final.',
};
const shuffle = (a) => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const roundRobin = (ids, stage, group) => {
    const out = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push({ stage, group: group || '', a: ids[i], b: ids[j] });
    // spread them so nobody plays twice in a row when possible
    const res = []; const pool = out.slice(); let last = [];
    while (pool.length) { const k = pool.findIndex(m => !last.includes(m.a) && !last.includes(m.b)); const m = pool.splice(k >= 0 ? k : 0, 1)[0]; res.push(m); last = [m.a, m.b]; }
    return res;
};
/** Builds the matches when the tournament starts. */
export function buildMatches(teamIds) {
    const ids = shuffle(teamIds), n = ids.length, plan = planFor(n);
    let ms = [];
    if (plan === 'final') ms = [{ stage: 'final', a: ids[0], b: ids[1] }];
    else if (plan === 'league') ms = [...roundRobin(ids, 'league'), { stage: 'final', aFrom: 'L1', bFrom: 'L2' }];
    else if (plan === 'ko4') ms = [{ stage: 'sf', key: 'sf1', a: ids[0], b: ids[3] }, { stage: 'sf', key: 'sf2', a: ids[1], b: ids[2] }, { stage: 'final', aFrom: 'W:sf1', bFrom: 'W:sf2' }];
    else if (plan === 'ko8') ms = [0, 1, 2, 3].map(i => ({ stage: 'qf', key: `qf${i + 1}`, a: ids[i], b: ids[7 - i] }))
        .concat([{ stage: 'sf', key: 'sf1', aFrom: 'W:qf1', bFrom: 'W:qf4' }, { stage: 'sf', key: 'sf2', aFrom: 'W:qf2', bFrom: 'W:qf3' }, { stage: 'final', aFrom: 'W:sf1', bFrom: 'W:sf2' }]);
    else {
        const A = ids.slice(0, Math.ceil(n / 2)), B = ids.slice(Math.ceil(n / 2));
        ms = [...roundRobin(A, 'group', 'A'), ...roundRobin(B, 'group', 'B')];
        // play the two groups in turns
        const ga = ms.filter(m => m.group === 'A'), gb = ms.filter(m => m.group === 'B'); ms = [];
        while (ga.length || gb.length) { if (ga.length) ms.push(ga.shift()); if (gb.length) ms.push(gb.shift()); }
        ms.push({ stage: 'final', aFrom: 'A1', bFrom: 'B1' });
    }
    return { plan, matches: ms.map((m, i) => ({ id: `m${i + 1}`, key: m.key || '', stage: m.stage, group: m.group || '', a: m.a || '', b: m.b || '', aFrom: m.aFrom || '', bFrom: m.bFrom || '', ga: null, gb: null, pens: '', goals: [], done: false })) };
}
/** Table for a group / the league: [{ id, p, w, d, l, gf, ga, gd, pts }] best first. */
export function tableOf(t, stage, group = '') {
    const ms = (t.matches || []).filter(m => m.stage === stage && (m.group || '') === group);
    const ids = [...new Set(ms.flatMap(m => [m.a, m.b]).filter(Boolean))];
    const rows = ids.map(id => ({ id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 }));
    const row = (id) => rows.find(r => r.id === id);
    ms.filter(m => m.done).forEach(m => {
        [[m.a, m.ga, m.gb], [m.b, m.gb, m.ga]].forEach(([id, f, g]) => { const r = row(id); if (!r) return; r.p++; r.gf += f; r.ga += g; if (f > g) r.w++; else if (f === g) r.d++; else r.l++; });
    });
    return rows.map(r => ({ ...r, gd: r.gf - r.ga, pts: r.w * 3 + r.d }))
        .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || headToHead(ms, x.id, y.id) || String(nameOf(t, x.id)).localeCompare(String(nameOf(t, y.id))));
}
function headToHead(ms, a, b) {
    const m = ms.find(x => x.done && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
    if (!m) return 0;
    const ga = m.a === a ? m.ga : m.gb, gb = m.a === a ? m.gb : m.ga;
    return gb - ga;   // negative = a ranks higher
}
const winnerOf = (m) => !m || !m.done ? '' : m.ga > m.gb ? m.a : m.gb > m.ga ? m.b : (m.pens || '');
/** Fills in the later rounds once the games they depend on are done. Returns the champion id or ''. */
export function advance(t) {
    const ms = t.matches || [];
    const byKey = (k) => ms.find(m => m.key === k);
    const stageDone = (stage, group = '') => ms.filter(m => m.stage === stage && (m.group || '') === group).every(m => m.done);
    const from = (ref) => {
        if (!ref) return '';
        if (ref.startsWith('W:')) return winnerOf(byKey(ref.slice(2)));
        if (ref === 'L1' || ref === 'L2') return stageDone('league') ? (tableOf(t, 'league')[ref === 'L1' ? 0 : 1] || {}).id || '' : '';
        const g = ref[0], pos = +ref.slice(1) - 1;
        return stageDone('group', g) ? (tableOf(t, 'group', g)[pos] || {}).id || '' : '';
    };
    ms.forEach(m => {
        if (m.done) return;
        if (m.aFrom) m.a = from(m.aFrom);
        if (m.bFrom) m.b = from(m.bFrom);
    });
    const fin = ms.find(m => m.stage === 'final');
    return fin && fin.done ? winnerOf(fin) : '';
}
const nameOf = (t, id) => ((t.teams || []).find(x => x.teamId === id) || {}).name || '';
const teamOf = (t, id) => (t.teams || []).find(x => x.teamId === id) || null;
const fromLabel = (ref) => !ref ? 'TBD' : ref.startsWith('W:') ? `Winner ${ref.slice(2).toUpperCase().replace('QF', 'QF ').replace('SF', 'SF ')}` : ref === 'L1' ? 'League 1st' : ref === 'L2' ? 'League 2nd' : `Group ${ref[0]} winner`;
const matchLabel = (m) => m.stage === 'group' ? `Group ${m.group}` : m.stage === 'qf' ? `Quarter-final ${m.key.slice(2)}` : m.stage === 'sf' ? `Semi-final ${m.key.slice(2)}` : STAGE[m.stage] || '';

// ---------------------------------------------------------------- Games list card
export function tourneyCardHtml(t) {
    const n = (t.teams || []).length, max = +t.maxTeams || 8;
    const champ = t.championId ? teamOf(t, t.championId) : null;
    const status = t.status === 'final' ? (champ ? `🏆 ${esc(champ.name)}` : 'Finished') : t.status === 'running' ? '● Playing' : n >= max ? 'Full' : `${n}/${max} teams`;
    return `<div id="tourney-card-${esc(t.id)}" onclick="openTourney('${jsq(t.id)}')" class="relative bg-[#010A0F]/90 rounded-2xl overflow-hidden shadow-xl border-[1.6px] border-amber-400/70 hover:border-amber-300 transition cursor-pointer p-4 space-y-3">
        <div class="absolute inset-0 pointer-events-none opacity-25" style="background:radial-gradient(circle at 50% 30%, ${GOLD} 0%, transparent 55%)"></div>
        <div class="relative z-10 space-y-3">
            <div class="flex justify-center"><div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 border border-amber-400/70 text-amber-200 text-[10px] font-black">${TROPHY(14)}<span>TOURNAMENT${t.status === 'running' ? ' · LIVE' : ''}</span></div></div>
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5 bg-black/50 px-2.5 py-1 rounded-xl border border-[#00B4AE]/80 text-white text-[10px] font-bold"><i class="fa-solid fa-users text-[10px]"></i><span>${esc(t.format || '7v7')} • up to ${max} teams</span></div>
                <div class="flex items-center gap-1 bg-black/50 px-2.5 py-1 rounded-xl border border-[#00F296]/80 text-white text-[10px] font-bold"><i class="fa-solid fa-circle-dollar-to-slot text-[10px]"></i><span>${+t.priceCents ? money(t.priceCents) + ' per team' : 'Free'}</span></div>
            </div>
            <h3 class="text-base font-bold text-white tracking-tight line-clamp-1">${esc(t.name || 'Tournament')}</h3>
            <div class="flex items-center justify-center gap-1.5 flex-wrap">${(t.teams || []).slice(0, 8).map(x => teamLogoHtml(x, 30)).join('') || '<span class="text-[11px] text-white/50">Be the first team in</span>'}</div>
            <div class="space-y-1.5 text-[11px] font-medium text-white/90">
                <div class="flex items-center gap-2"><i class="fa-solid fa-calendar text-[#00F296] w-3.5"></i><span>${esc((window.fmtGameDate || prettyDate)(t.date || ''))} · ${esc(prettyTime(t.time))}</span></div>
                <div class="flex items-center gap-2"><i class="fa-solid fa-location-dot text-[#00F296] w-3.5"></i><span class="truncate">${esc(t.location || '')}</span></div>
            </div>
            <div class="border-t border-white/10 pt-2.5 flex items-center justify-between gap-2">
                <div class="text-[10px] font-bold text-white/70 truncate">By ${esc(t.organizerName || 'Organizer')}</div>
                <div class="px-2.5 py-1 rounded-xl text-[10px] font-black border ${t.status === 'running' ? 'bg-red-500/20 border-red-500 text-red-200' : 'bg-amber-400/20 border-amber-400 text-amber-100'} shrink-0">${status}</div>
            </div>
        </div>
    </div>`;
}
/** Tournaments go in the Games list on their day, in time order (like VS matches). */
function wrapEvents() {
    const orig = window.renderEvents;
    if (typeof orig !== 'function' || orig._tt) return;
    const w = function () {
        orig.apply(this, arguments);
        const grid = document.getElementById('events-grid'); if (!grid) return;
        const day = window.selectedDateStr;
        const list = TT.list.filter(t => (t.date || '') === day).sort((a, b) => String(a.time).localeCompare(String(b.time)));
        if (!list.length) return;
        if (grid.querySelector('.fa-calendar-xmark') || grid.querySelector('.fa-spin')) { grid.innerHTML = list.map(tourneyCardHtml).join(''); return; }
        list.forEach(t => grid.insertAdjacentHTML('afterbegin', tourneyCardHtml(t)));
    };
    w._tt = true; w._vs = orig._vs; window.renderEvents = w;
}
setTimeout(wrapEvents, 0); setTimeout(wrapEvents, 2000);

// ---------------------------------------------------------------- sheets
function sheet(id, title, body) {
    document.getElementById(id)?.remove();
    const m = document.createElement('div');
    m.id = id;
    m.className = 'fixed inset-0 z-[180] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-md sm:p-4';
    m.innerHTML = `<div class="bg-[#040E13] border border-amber-400/40 rounded-t-3xl sm:rounded-3xl w-full max-w-md overflow-y-auto shadow-2xl text-white" style="max-height:92dvh">
        <div class="flex items-center justify-between px-5 pt-5 pb-2 sticky top-0 bg-[#040E13] z-10">
            <div class="text-base font-black">${title}</div>
            <button onclick="document.getElementById('${id}').remove()" class="w-8 h-8 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-xmark text-xs"></i></button>
        </div>
        <div class="p-5 pt-2 space-y-4">${body}</div></div>`;
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    return m;
}
const seg = (id, opts, cur) => `<div class="flex flex-wrap gap-1.5" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" onclick="ttSeg('${id}', this)" class="px-3 py-2 rounded-xl text-xs font-black border ${String(v) === String(cur) ? 'bg-[#00F296] text-slate-950 border-[#00F296]' : 'bg-black/50 text-white/80 border-white/15'}">${l}</button>`).join('')}</div>`;
window.ttSeg = (id, btn) => { document.querySelectorAll(`#${id} button`).forEach(b => { const on = b === btn; b.className = `px-3 py-2 rounded-xl text-xs font-black border ${on ? 'bg-[#00F296] text-slate-950 border-[#00F296]' : 'bg-black/50 text-white/80 border-white/15'}`; b.dataset.on = on ? '1' : ''; }); };
const segVal = (id) => { const on = document.querySelector(`#${id} button.bg-\\[\\#00F296\\]`); return on ? on.dataset.v : ''; };

// ---------------------------------------------------------------- create / edit
window.openCreateTourney = function (pre = {}) {
    if (!myUid()) return;
    const roles = window.myCommunityRoles || {}, cache = window.communitiesCache || {};
    const comms = Object.keys(roles).filter(id => roles[id] === 'admin' && cache[id]);
    const editing = !!pre.id;
    sheet('tt-create', editing ? '✏️ Edit tournament' : `${TROPHY(22)} Create Tournament`, `
        <p class="text-[11px] text-white/60">Teams sign up with their captain. When you start it, the format is picked from how many teams are in: 4 = knockout, 6 = 2 groups of 3 (group winners play the Final), 8 = quarter-finals.</p>
        <div>${LBL('Name *')}<input id="tt-name" class="${INPUT}" maxlength="50" value="${esc(pre.name || '')}" placeholder="e.g. Margate Winter Cup"></div>
        <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0">${LBL('Date *')}<input id="tt-date" type="date" class="${INPUT}" value="${esc(pre.date || '')}"></div>
            <div class="min-w-0">${LBL('Start time *')}<input id="tt-time" type="time" class="${INPUT}" value="${esc(pre.time || '')}"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0">${LBL('Park *')}<input id="tt-park" class="${INPUT}" value="${esc(pre.park || '')}" placeholder="Firefighters Park"></div>
            <div class="min-w-0">${LBL('City *')}<input id="tt-city" class="${INPUT}" value="${esc(pre.city || '')}" placeholder="Margate, FL"></div>
        </div>
        <div>${LBL('Format')}${seg('tt-format', ['5v5', '6v6', '7v7', '8v8', '9v9', '11v11'].map(s => [s, s]), pre.format || '7v7')}</div>
        <div>${LBL('Max teams')}${seg('tt-max', [['4', '4 teams'], ['6', '6 teams'], ['8', '8 teams']], String(pre.maxTeams || 6))}</div>
        <div>${LBL('Entry fee per team ($, 0 = free)')}<input id="tt-price" inputmode="decimal" class="${INPUT}" value="${esc(pre.priceCents ? pre.priceCents / 100 : '')}" placeholder="0"></div>
        ${comms.length ? `<div>${LBL('🏘️ Post in a community (optional)')}<select id="tt-comm" class="${INPUT}"><option value="">No community</option>${comms.map(id => `<option value="${esc(id)}" ${pre.communityId === id ? 'selected' : ''}>${esc(cache[id].name || 'Community')}</option>`).join('')}</select></div>` : ''}
        <div>${LBL('Description / rules')}<textarea id="tt-desc" rows="3" maxlength="800" class="${INPUT}" placeholder="e.g. 20-minute games, Final is 2x15. Bring light and dark shirts.">${esc(pre.description || '')}</textarea></div>
        <button onclick="saveTourney('${jsq(pre.id || '')}')" class="${BTN} w-full py-3 text-sm">${editing ? 'Save changes' : 'Create tournament'}</button>`);
};
window.saveTourney = async function (editId) {
    const name = val('tt-name'), date = val('tt-date'), time = val('tt-time'), park = val('tt-park'), city = val('tt-city');
    if (!name || !date || !time || !park || !city) { toast('Fill in the name, date, time, park and city.', 'error'); return; }
    const cid = val('tt-comm');
    const fields = { name, date, time, park, city, location: `${park}, ${city}`, format: segVal('tt-format') || '7v7', maxTeams: parseInt(segVal('tt-max'), 10) || 6,
        priceCents: Math.round((parseFloat(val('tt-price').replace(',', '.')) || 0) * 100), description: val('tt-desc'),
        communityId: cid, communityName: cid ? (((window.communitiesCache || {})[cid] || {}).name || '') : '', updatedAt: serverTimestamp() };
    try {
        if (editId) {
            await change(editId, (t) => { if ((t.teams || []).length > fields.maxTeams) throw new Error('TOO_MANY'); Object.assign(t, fields); });
            document.getElementById('tt-create')?.remove(); toast('Tournament updated.');
            return;
        }
        const ref = doc(C('tournaments'));
        const t = { ...fields, organizerId: myUid(), organizerName: myName(), status: 'signup', plan: '', teams: [], teamIds: [], matches: [], championId: '', createdAt: serverTimestamp() };
        await setDoc(ref, t);
        document.getElementById('tt-create')?.remove();
        window.closeCreateActionSheet && window.closeCreateActionSheet();
        toast('Tournament created! 🏆 Share it so teams can sign up.');
        window.openTourney(ref.id, { ...t, id: ref.id });
    } catch (e) { toast(String(e && e.message) === 'TOO_MANY' ? 'More teams already signed up than that.' : "Couldn't save the tournament.", 'error'); }
};
async function change(id, fn) {
    await runTransaction(db, async (tx) => {
        const s = await tx.get(D(id)); if (!s.exists()) throw new Error('GONE');
        const t = s.data();
        t.teams = (t.teams || []).map(x => ({ ...x }));
        t.matches = (t.matches || []).map(m => ({ ...m, goals: [...(m.goals || [])] }));
        if (fn(t) === false) return;
        t.teamIds = t.teams.map(x => x.teamId);
        delete t.createdAt;
        tx.update(D(id), { ...t, updatedBy: myUid(), updatedAt: serverTimestamp() });
    });
}

// ---------------------------------------------------------------- join / leave / paid
window.openJoinTourney = function () {
    const t = TT.open; if (!t) return;
    const mine = myCaptainTeams().filter(x => !(t.teamIds || []).includes(x.id));
    if (!mine.length) { toast(myCaptainTeams().length ? 'Your teams are already in.' : 'You need to be the captain of a team. Make one in the Teams tab.', 'error'); return; }
    sheet('tt-join', `Join ${esc(t.name)}`, `
        ${+t.priceCents ? `<p class="text-xs text-white/70">Entry fee: <b>${money(t.priceCents)}</b> per team. Pay the organizer; they mark you as paid.</p>` : ''}
        <div class="space-y-2">${mine.map(x => `<button onclick="joinTourney('${jsq(x.id)}')" class="w-full flex items-center gap-3 p-3 bg-black/40 hover:bg-black rounded-xl border border-white/10 text-left">${teamLogoHtml(x, 36)}<span class="text-sm font-black">${esc(x.name)}</span></button>`).join('')}</div>`);
};
window.joinTourney = async function (teamId) {
    const t0 = TT.open; if (!t0) return;
    const x = myCaptainTeams().find(y => y.id === teamId); if (!x) return;
    try {
        await change(t0.id, (t) => {
            if (t.status !== 'signup') throw new Error('STARTED');
            if ((t.teams || []).length >= (+t.maxTeams || 8)) throw new Error('FULL');
            if (t.teams.some(y => y.teamId === teamId)) return false;
            t.teams.push({ teamId, name: x.name, short: x.short || '', logo: x.logo || null, colors: x.colors || {}, paid: !(+t.priceCents), joinedBy: myUid(), joinedAt: Date.now() });
        });
        document.getElementById('tt-join')?.remove();
        toast(`${x.name} is in! 🏆`);
    } catch (e) { const k = String(e && e.message); toast(k === 'FULL' ? 'The tournament is full.' : k === 'STARTED' ? 'It already started.' : "Couldn't join.", 'error'); }
};
window.leaveTourney = async function (teamId) {
    const t0 = TT.open; if (!t0) return;
    if (!confirm('Take this team out of the tournament?')) return;
    try { await change(t0.id, (t) => { if (t.status !== 'signup') throw new Error('STARTED'); t.teams = t.teams.filter(y => y.teamId !== teamId); }); toast('Team removed.'); }
    catch (e) { toast(String(e && e.message) === 'STARTED' ? "It already started: teams can't leave now." : "Couldn't change it.", 'error'); }
};
window.toggleTourneyPaid = async function (teamId) {
    const t0 = TT.open; if (!t0) return;
    try { await change(t0.id, (t) => { const y = t.teams.find(z => z.teamId === teamId); if (!y) return false; y.paid = !y.paid; }); }
    catch (e) { toast("Couldn't change it.", 'error'); }
};

// ---------------------------------------------------------------- start, scores, finish
window.startTourney = async function () {
    const t0 = TT.open; if (!t0) return;
    const n = (t0.teams || []).length;
    if (n < 2) { toast('At least 2 teams need to be in.', 'error'); return; }
    const unpaid = (t0.teams || []).filter(x => !x.paid).length;
    if (!confirm(`Start with ${n} teams?\n\n${PLAN_TEXT[planFor(n)]}${unpaid ? `\n\n${unpaid} team${unpaid === 1 ? " hasn't" : "s haven't"} paid yet.` : ''}\n\nTeams can't join or leave after this.`)) return;
    try {
        await change(t0.id, (t) => {
            if (t.status !== 'signup') return false;
            const b = buildMatches(t.teams.map(x => x.teamId));
            t.plan = b.plan; t.matches = b.matches; t.status = 'running';
        });
        TT.tab = 'bracket';
        toast('Tournament started! 🏆 Enter the scores as games finish.');
    } catch (e) { toast("Couldn't start it.", 'error'); }
};
window.openTourneyScore = function (mid) {
    const t = TT.open; if (!t) return;
    const m = (t.matches || []).find(x => x.id === mid); if (!m || !m.a || !m.b) return;
    const A = teamOf(t, m.a) || { name: 'Team' }, B = teamOf(t, m.b) || { name: 'Team' };
    window._ttGoals = (m.goals || []).map(g => ({ ...g }));
    const ko = m.stage !== 'group' && m.stage !== 'league';
    const draw = () => {
        const G = window._ttGoals, ga = G.filter(g => g.teamId === m.a).length, gb = G.filter(g => g.teamId === m.b).length;
        const col = (X, id) => `<div class="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2 text-center">
            <div class="flex flex-col items-center gap-1">${teamLogoHtml(X, 40)}<span class="text-xs font-black truncate max-w-full">${esc(X.name)}</span></div>
            <div class="text-4xl font-black font-mono">${G.filter(g => g.teamId === id).length}</div>
            <button onclick="ttGoalPick('${jsq(id)}')" class="w-full bg-[#00F296]/15 text-[#00F296] border border-[#00F296]/50 font-black py-2 rounded-xl text-xs">+ Goal</button>
            <div class="space-y-1 text-left">${G.map((g, i) => ({ g, i })).filter(x => x.g.teamId === id).map(({ g, i }) => `<div class="flex items-center gap-1.5 text-[11px] text-white/85"><span>⚽</span><span class="flex-1 truncate">${esc(g.name || 'Goal')}${g.own ? ' (OG)' : ''}</span><button onclick="ttRemoveGoal(${i})" class="w-5 h-5 rounded-full bg-white/15 text-[9px]"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}</div>
        </div>`;
        sheet('tt-score', `${esc(matchLabel(m))}: score`, `
            <div class="flex items-start gap-2">${col(A, m.a)}${col(B, m.b)}</div>
            ${ko && ga === gb ? `<div class="bg-amber-400/10 border border-amber-400/40 rounded-2xl p-3 space-y-2"><div class="text-xs font-black text-amber-200">It's a draw. Who won on penalties?</div>
                <div class="grid grid-cols-2 gap-2">${[[m.a, A], [m.b, B]].map(([id, X]) => `<label class="flex items-center gap-2 bg-black/40 rounded-xl p-2 text-xs font-bold cursor-pointer"><input type="radio" name="tt-pens" value="${esc(id)}" ${m.pens === id ? 'checked' : ''} class="accent-[#00F296]">${esc(X.name)}</label>`).join('')}</div></div>` : ''}
            <button onclick="saveTourneyScore('${jsq(mid)}')" class="${BTN} w-full py-3 text-sm">${m.done ? 'Save changes' : 'Save final score'}</button>
            ${m.done ? `<button onclick="clearTourneyScore('${jsq(mid)}')" class="text-[11px] font-bold text-red-400 w-full">Clear this score</button>` : ''}`);
    };
    window._ttDraw = draw;
    draw();
};
window.ttGoalPick = function (teamId) {
    const t = TT.open; if (!t) return;
    const m = (t.matches || []).find(x => x.a && x.b && (x.a === teamId || x.b === teamId) && document.getElementById('tt-score')) || null;
    const otherId = m ? (m.a === teamId ? m.b : m.a) : '';
    const membersOf = (id) => { const full = (TS().all || []).concat(TS().mine || []).find(x => x.id === id); return (full && full.members) || []; };
    const row = (p, own) => `<button onclick="ttAddGoal('${jsq(teamId)}','${jsq(p.name || '')}','${jsq(p.uid || '')}',${own})" class="w-full flex items-center gap-3 p-2.5 bg-black/40 hover:bg-black rounded-xl border border-white/10 text-left text-xs font-bold">${p.number ? esc(p.number) + ' · ' : ''}${esc(p.name || 'Player')}</button>`;
    sheet('tt-goal', `Goal for ${esc(nameOf(t, teamId))}`, `
        <div class="space-y-1.5">${membersOf(teamId).map(p => row(p, false)).join('') || '<p class="text-xs text-white/50">Players show here once the team has a roster.</p>'}</div>
        <button onclick="ttAddGoal('${jsq(teamId)}','','',false)" class="w-full p-2.5 bg-black/40 rounded-xl border border-dashed border-white/25 text-xs font-bold">🤷 Don't recall / someone else</button>
        ${otherId && membersOf(otherId).length ? `<div class="space-y-1.5 pt-2 border-t border-white/10"><div class="text-[10px] font-black uppercase tracking-wider text-amber-300">Own goal by ${esc(nameOf(t, otherId))}</div>${membersOf(otherId).map(p => row(p, true)).join('')}</div>` : ''}`);
    document.getElementById('tt-goal').style.zIndex = '200';
};
window.ttAddGoal = (teamId, name, uid, own) => { document.getElementById('tt-goal')?.remove(); window._ttGoals.push({ teamId, name, uid, own: !!own }); window._ttDraw && window._ttDraw(); };
window.ttRemoveGoal = (i) => { window._ttGoals.splice(i, 1); window._ttDraw && window._ttDraw(); };
window.saveTourneyScore = async function (mid) {
    const t0 = TT.open; if (!t0) return;
    const goals = window._ttGoals || [];
    const pens = document.querySelector('input[name="tt-pens"]:checked')?.value || '';
    let champ = '';
    try {
        await change(t0.id, (t) => {
            const m = t.matches.find(x => x.id === mid); if (!m) return false;
            const ga = goals.filter(g => g.teamId === m.a).length, gb = goals.filter(g => g.teamId === m.b).length;
            const ko = m.stage !== 'group' && m.stage !== 'league';
            if (ko && ga === gb && !pens) throw new Error('PENS');
            Object.assign(m, { ga, gb, goals, pens: ko && ga === gb ? pens : '', done: true });
            // a changed result can change who goes through: clear later rounds that depended on it and weren't played
            t.matches.forEach(x => { if (!x.done && (x.aFrom || x.bFrom)) { if (x.aFrom) x.a = ''; if (x.bFrom) x.b = ''; } });
            champ = advance(t);
            t.championId = champ; t.status = champ ? 'final' : 'running';
        });
        document.getElementById('tt-score')?.remove();
        if (champ) { toast(`🏆 ${nameOf(TT.open, champ) || 'We have a champion'}!`); TT.tab = 'info'; }
        else toast('Score saved. ✅');
    } catch (e) { toast(String(e && e.message) === 'PENS' ? 'Pick who won on penalties.' : "Couldn't save the score.", 'error'); }
};
window.clearTourneyScore = async function (mid) {
    const t0 = TT.open; if (!t0) return;
    if (!confirm('Clear this score?')) return;
    try {
        await change(t0.id, (t) => {
            const m = t.matches.find(x => x.id === mid); if (!m) return false;
            Object.assign(m, { ga: null, gb: null, goals: [], pens: '', done: false });
            t.matches.forEach(x => { if (!x.done && (x.aFrom || x.bFrom)) { if (x.aFrom) x.a = ''; if (x.bFrom) x.b = ''; } });
            t.championId = advance(t); t.status = t.championId ? 'final' : 'running';
        });
        document.getElementById('tt-score')?.remove();
    } catch (e) { toast("Couldn't clear it.", 'error'); }
};
window.cancelTourney = async function () {
    const t0 = TT.open; if (!t0) return;
    if (!confirm('Cancel the tournament? It disappears for everyone.')) return;
    try { await change(t0.id, (t) => { t.status = 'cancelled'; }); window.closeTourney(); toast('Tournament cancelled.'); }
    catch (e) { toast("Couldn't cancel.", 'error'); }
};

// ---------------------------------------------------------------- the tournament page
window.openTourney = function (id, initial) {
    TT.open = TT.list.find(t => t.id === id) || (initial ? { ...initial, id } : null);
    TT.tab = TT.open && TT.open.status !== 'signup' ? 'bracket' : 'info';
    if (!TT.open) getDoc(D(id)).then(s => { if (s.exists()) { TT.open = { ...s.data(), id }; drawPage(); } }).catch(() => {});
    else drawPage();
};
window.closeTourney = () => { TT.open = null; document.getElementById('tt-page')?.remove(); };
window.ttTab = (k) => { TT.tab = k; drawPage(); };
window.shareTourney = async function () {
    const t = TT.open; if (!t) return;
    const text = `🏆 ${t.name} · ${prettyDate(t.date)} ${prettyTime(t.time)} at ${t.location || ''}. ${t.status === 'signup' ? 'Sign your team up on FutNet!' : ''}`;
    try { if (navigator.share) { await navigator.share({ title: t.name, text, url: 'https://futnet.site/' }); return; } } catch (e) { return; }
    try { await navigator.clipboard.writeText(`${text} https://futnet.site/`); toast('Copied! Paste it in WhatsApp.'); } catch (e) { /* ignore */ }
};
function matchRow(t, m, boss) {
    const A = teamOf(t, m.a), B = teamOf(t, m.b);
    const side = (X, ref, right) => X ? `<span class="flex-1 min-w-0 flex items-center ${right ? 'justify-start' : 'justify-end'} gap-1.5 text-xs font-black">${right ? teamLogoHtml(X, 22) : ''}<span class="truncate ${winnerOf(m) && winnerOf(m) !== X.teamId ? 'text-white/45' : ''}">${esc(X.name)}</span>${right ? '' : teamLogoHtml(X, 22)}</span>`
        : `<span class="flex-1 min-w-0 text-[11px] font-bold text-white/40 ${right ? 'text-left' : 'text-right'} truncate">${esc(fromLabel(ref))}</span>`;
    const mid = m.done ? `<span class="shrink-0 bg-[#00F296]/15 text-[#00F296] font-black font-mono text-sm px-2.5 py-1 rounded-lg">${m.ga} - ${m.gb}</span>` : '<span class="shrink-0 text-[11px] font-black text-white/40 px-2">vs</span>';
    const can = boss && t.status !== 'cancelled' && m.a && m.b;
    return `<div ${can ? `onclick="openTourneyScore('${jsq(m.id)}')"` : ''} class="bg-black/40 border ${m.stage === 'final' ? 'border-amber-400/60' : 'border-white/10'} rounded-2xl p-3 space-y-1.5 ${can ? 'cursor-pointer hover:bg-black/60' : ''}">
        <div class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider"><span class="${m.stage === 'final' ? 'text-amber-300' : 'text-[#00F296]'}">${m.stage === 'final' ? '🏆 ' : ''}${esc(matchLabel(m))}</span>${can ? `<span class="text-white/45 normal-case tracking-normal font-bold">${m.done ? 'Edit' : 'Enter score'} ›</span>` : ''}</div>
        <div class="flex items-center gap-2">${side(A, m.aFrom)}${mid}${side(B, m.bFrom, true)}</div>
        ${m.done && m.pens ? `<div class="text-[10px] text-center text-amber-200">${esc(nameOf(t, m.pens))} won on penalties</div>` : ''}
        ${(m.goals || []).filter(g => g.name).length ? `<div class="text-[10px] text-white/55 text-center truncate">⚽ ${(m.goals || []).filter(g => g.name).map(g => esc(g.name.split(' ')[0]) + (g.own ? ' (OG)' : '')).join(', ')}</div>` : ''}
    </div>`;
}
function tableHtml(t, stage, group, title, qualify) {
    const rows = tableOf(t, stage, group);
    return `<div class="bg-[#141821] border border-white/10 rounded-2xl overflow-hidden">
        <div class="px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#00F296] border-b border-white/10">${title}</div>
        <table class="w-full text-xs"><thead><tr class="text-white/45 text-[10px]"><th class="text-left py-1.5 pl-3">Team</th><th class="w-8">P</th><th class="w-8">W</th><th class="w-8">D</th><th class="w-8">L</th><th class="w-9">GD</th><th class="w-10 pr-3 text-[#00F296]">Pts</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr class="border-t border-white/5 ${i < qualify ? 'bg-[#00F296]/5' : ''}"><td class="py-2 pl-3"><div class="flex items-center gap-2 min-w-0"><span class="text-white/45 w-3">${i + 1}</span>${teamLogoHtml(teamOf(t, r.id) || {}, 20)}<span class="font-bold truncate">${esc(nameOf(t, r.id))}</span>${i < qualify ? '<span class="text-[9px] text-[#00F296]">✓</span>' : ''}</div></td>
            <td class="text-center text-white/70">${r.p}</td><td class="text-center text-white/70">${r.w}</td><td class="text-center text-white/70">${r.d}</td><td class="text-center text-white/70">${r.l}</td><td class="text-center text-white/70">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="text-center pr-3 font-black text-[#00F296]">${r.pts}</td></tr>`).join('')}</tbody></table></div>`;
}
function scorersHtml(t) {
    const c = {};
    (t.matches || []).forEach(m => (m.goals || []).filter(g => g.name && !g.own).forEach(g => { const k = (g.uid || g.name.toLowerCase()) + '|' + g.teamId; c[k] = c[k] || { ...g, n: 0 }; c[k].n++; }));
    const list = Object.values(c).sort((a, b) => b.n - a.n).slice(0, 10);
    if (!list.length) return '';
    return `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-1.5"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">⚽ Top scorers</div>
        ${list.map((g, i) => `<div class="flex items-center gap-2 text-xs"><span class="w-4 font-black ${i < 3 ? 'text-amber-300' : 'text-white/45'}">${i + 1}</span>${teamLogoHtml(teamOf(t, g.teamId) || {}, 18)}<span class="flex-1 font-bold truncate">${esc(g.name)}</span><span class="font-black text-[#00F296]">${g.n}</span></div>`).join('')}</div>`;
}
function drawPage() {
    const t = TT.open; if (!t) return;
    let el = document.getElementById('tt-page');
    if (!el) {
        el = document.createElement('div'); el.id = 'tt-page'; el.dataset.close = 'closeTourney';
        el.className = 'fixed inset-0 z-[136] overflow-y-auto text-white';
        el.style.background = 'inherit'; el.style.backgroundColor = '#01060A';
        document.body.appendChild(el);
    }
    const boss = t.organizerId === myUid();
    const n = (t.teams || []).length, max = +t.maxTeams || 8;
    const champ = t.championId ? teamOf(t, t.championId) : null;
    const myIn = (t.teams || []).filter(x => myCaptainTeams().some(y => y.id === x.teamId));
    const tab = TT.tab || 'info';
    const tabBtn = (k, label) => `<button onclick="ttTab('${k}')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === k ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">${label}</button>`;
    const mapsUrl = t.location ? 'https://maps.apple.com/?q=' + encodeURIComponent(t.location) : '';
    const plan = t.plan || planFor(n);
    const champBox = champ ? `<div class="relative overflow-hidden rounded-3xl p-5 text-center border-2 border-amber-300" style="background:radial-gradient(circle at 50% 30%, rgba(250,204,21,.35), rgba(0,0,0,.6));box-shadow:0 0 30px rgba(250,204,21,.35)">
            <div class="text-[11px] font-black tracking-[0.3em] text-amber-200">CHAMPIONS</div>
            <div class="flex flex-col items-center mt-1 mb-3"><span class="text-3xl leading-none -mb-1 relative z-10">👑</span>${teamLogoHtml(champ, 84)}</div>
            <div class="text-2xl font-black">${esc(champ.name)}</div>
            <div class="text-sm text-amber-100 mt-1">🏆 ${esc(t.name)}</div></div>` : '';
    const info = `<div class="space-y-3">
        ${champBox}
        <div class="bg-black/40 border border-white/10 rounded-2xl p-3 text-xs space-y-2">
            <div class="flex items-center gap-2"><i class="fa-solid fa-calendar text-[#00F296] w-4"></i>${esc((window.fmtGameDate || prettyDate)(t.date))} · ${esc(prettyTime(t.time))}</div>
            <div class="flex items-center gap-2"><i class="fa-solid fa-location-dot text-[#00F296] w-4"></i>${esc(t.location || '')}</div>
            <div class="flex items-center gap-2"><i class="fa-solid fa-users text-[#00F296] w-4"></i>${esc(t.format || '')} · up to ${max} teams · ${n} in</div>
            <div class="flex items-center gap-2"><i class="fa-solid fa-circle-dollar-to-slot text-[#00F296] w-4"></i>${+t.priceCents ? `${money(t.priceCents)} per team` : 'Free'}</div>
            ${t.communityId ? `<div class="flex items-center gap-2"><i class="fa-solid fa-people-roof text-[#00F296] w-4"></i>${esc(t.communityName || 'Community')}</div>` : ''}
            <div class="flex items-start gap-2"><i class="fa-solid fa-sitemap text-[#00F296] w-4 mt-0.5"></i><span>${t.status === 'signup' ? `With ${n || 'the'} teams${n >= 2 ? `: ${esc(PLAN_TEXT[planFor(n)])}` : ': the format is picked when it starts (4 = knockout, 6 = 2 groups of 3).'}` : esc(PLAN_TEXT[plan])}</span></div>
        </div>
        ${t.description ? `<div class="bg-black/40 border border-white/10 rounded-2xl p-3"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">Details & rules</div><p class="text-xs text-white/85 whitespace-pre-line">${esc(t.description)}</p></div>` : ''}
        ${t.status === 'signup' && n < max && myCaptainTeams().some(y => !(t.teamIds || []).includes(y.id)) ? `<button onclick="openJoinTourney()" class="${BTN} w-full py-3 text-sm">Join with my team</button>` : ''}
        ${boss ? `<div class="text-[10px] font-black uppercase tracking-wider text-white/55 pt-1">Organizer tools</div>
            <div class="grid grid-cols-2 gap-2">
                ${t.status === 'signup' ? `<button onclick="startTourney()" class="${BTN} py-3">▶ Start tournament</button><button onclick="openCreateTourney(window.__tourneyState.open)" class="${DARK} py-3">✏️ Edit</button>` : ''}
                <button onclick="shareTourney()" class="${DARK} py-3">📤 Share</button>
                ${t.status !== 'final' ? `<button onclick="cancelTourney()" class="${DARK} py-3 text-red-400">❌ Cancel</button>` : ''}
            </div>` : ''}
        <div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-2xl p-3"><div class="text-[9px] font-bold text-white/55 uppercase">Organized by</div><div class="text-sm font-black">${esc(t.organizerName || 'Organizer')}</div></div>
    </div>`;
    const teams = `<div class="space-y-2">${(t.teams || []).map(x => `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 flex items-center gap-3">
            <button onclick="window.openTeam && openTeam('${jsq(x.teamId)}')" class="shrink-0">${teamLogoHtml(x, 40)}</button>
            <div class="flex-1 min-w-0"><div class="text-sm font-black truncate">${esc(x.name)}${t.championId === x.teamId ? ' 🏆' : ''}</div>${+t.priceCents ? `<div class="text-[11px] ${x.paid ? 'text-[#00F296]' : 'text-amber-300'}">${x.paid ? 'Paid' : 'Not paid yet'}</div>` : ''}</div>
            ${boss && +t.priceCents ? `<button onclick="toggleTourneyPaid('${jsq(x.teamId)}')" class="${x.paid ? DARK : BTN}">${x.paid ? 'Undo paid' : '💵 Mark paid'}</button>` : ''}
            ${t.status === 'signup' && (boss || myIn.some(y => y.teamId === x.teamId)) ? `<button onclick="leaveTourney('${jsq(x.teamId)}')" class="text-[11px] font-bold text-red-400 px-1">${boss && !myIn.some(y => y.teamId === x.teamId) ? 'Remove' : 'Leave'}</button>` : ''}
        </div>`).join('') || '<p class="text-xs text-white/45 text-center py-6">No teams yet. Share it so captains can sign up!</p>'}
        ${t.status === 'signup' ? `<p class="text-[11px] text-white/50 text-center">${n} of ${max} teams</p>` : ''}</div>`;
    const ms = t.matches || [];
    const stages = ['qf', 'sf', 'final'];
    const bracket = !ms.length ? '<p class="text-xs text-white/50 text-center py-6">The bracket shows here once the organizer starts the tournament.</p>' : `<div class="space-y-4">
        ${boss && t.status === 'running' ? '<p class="text-[11px] text-white/55">Tap a game to enter its score. The next round fills in by itself.</p>' : ''}
        ${plan === 'league' ? `${tableHtml(t, 'league', '', 'League table', 2)}<div class="space-y-2">${ms.filter(m => m.stage === 'league').map(m => matchRow(t, m, boss)).join('')}</div>` : ''}
        ${plan === 'groups' ? ['A', 'B'].map(g => `${tableHtml(t, 'group', g, `Group ${g}`, 1)}<div class="space-y-2">${ms.filter(m => m.stage === 'group' && m.group === g).map(m => matchRow(t, m, boss)).join('')}</div>`).join('') : ''}
        ${stages.filter(s => ms.some(m => m.stage === s)).map(s => `<div class="space-y-2"><div class="text-[10px] font-black uppercase tracking-wider ${s === 'final' ? 'text-amber-300' : 'text-white/55'}">${s === 'qf' ? 'Quarter-finals' : s === 'sf' ? 'Semi-finals' : 'Final'}</div>${ms.filter(m => m.stage === s).map(m => matchRow(t, m, boss)).join('')}</div>`).join('')}
        ${scorersHtml(t)}
    </div>`;
    el.innerHTML = `<div class="max-w-4xl mx-auto w-full px-4 pt-3 pb-24 space-y-3">
        <div class="bg-[#040E13]/90 backdrop-blur-md border-2 border-emerald-500/30 px-5 py-3.5 rounded-3xl shadow-lg flex items-center justify-between gap-3">
            <button onclick="closeTourney()" aria-label="Back" class="w-9 h-9 bg-black/60 hover:bg-black text-white rounded-full flex items-center justify-center border border-white/20 shrink-0"><i class="fa-solid fa-chevron-left text-xs"></i></button>
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2"><h2 class="text-base font-black tracking-tight truncate">${esc(t.name || 'Tournament')}</h2>
                    <span class="px-2.5 py-0.5 bg-amber-400/20 text-amber-200 font-black text-[9px] rounded-full uppercase tracking-wider border border-amber-400/50 shrink-0">🏆 Cup</span></div>
                <p class="text-xs text-white/60 truncate mt-0.5"><i class="fa-solid fa-location-dot text-[#00F296] mr-1"></i>${esc(t.location || '')}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noopener" aria-label="Navigate" class="w-9 h-9 bg-[#00F296] text-slate-950 rounded-full flex items-center justify-center"><i class="fa-solid fa-location-arrow text-xs"></i></a>` : ''}
                <button onclick="shareTourney()" aria-label="Share" class="w-9 h-9 bg-[#00F296] text-slate-950 rounded-full flex items-center justify-center"><i class="fa-solid fa-share-nodes text-xs"></i></button>
            </div>
        </div>
        <div data-scroll-hint class="bg-black/40 border-2 border-emerald-500/30 p-1.5 rounded-2xl flex items-center space-x-1 overflow-x-auto shadow-md backdrop-blur-md">
            ${tabBtn('info', 'Info')}${tabBtn('teams', `Teams (${n}/${max})`)}${tabBtn('bracket', t.status === 'signup' ? 'Bracket' : '🏆 Bracket')}
        </div>
        <div class="bg-[#040E13]/95 border-2 border-emerald-500/30 rounded-3xl p-4 shadow-2xl">
            ${tab === 'teams' ? teams : tab === 'bracket' ? bracket : info}
        </div>
    </div>`;
}
window.tourneyCardHtml = tourneyCardHtml;
