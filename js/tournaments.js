// js/tournaments.js: Tournament mode (website).
// A tournament goes through these steps (t.status):
//   1. 'signup'  Registration: captains join with their team and pick their players (min/max players per team).
//                The organizer sets min/max teams and a rough timeline ("subject to change").
//   2. 'draw'    Organization: the draw decides who plays who (the format comes from how many teams are in).
//                The organizer can redraw until happy, then confirms.
//   3. 'waiting' The draw is public; game times aren't out yet.
//   4. 'set'     Game times are out (filled from the timeline, every game can be changed).
//   5. 'running' Games are being played; the next round fills in by itself.
//   6. 'final'   Champions!
//   Formats by number of teams: 2 = Final · 3 or 5 = league + Final · 4 = semis + Final ·
//   6 or 7 = 2 groups, winners play the Final · 8 = quarter-finals, semis, Final.
// Everyone in it gets told when the step changes, can use the tournament chat, and gets a reminder the day before
// their game (server: onTourneyWritten, onTourneyChat, tourneyReminders).
// Firestore: artifacts/{appId}/tournaments/{id} (+ /chat/{msgId})
//   { name, park, city, location, format, minTeams, maxTeams, minPlayers, maxPlayers, priceCents, description,
//     days: [{ date, time, until, label }], date, time (first day, for lists), prizes: [{ place, prize }], prizeNote,
//     organizerId, organizerName, status, plan, teams: [{ teamId, name, short, logo, colors, paid, joinedBy, joinedAt,
//     roster: [{ id, name, number, uid, position }] }], teamIds, participantUids, matches, championId, announcements }
//   match = { id, key, stage, group, a, b, aFrom, bFrom, ga, gb, pens, goals: [{ teamId, name, uid, own }], done, date, time, place }
// This file loads after the page is ready, so it never slows down opening the app.
import { db, appId } from './firebase-config.js';
import { doc, getDoc, setDoc, collection, onSnapshot, runTransaction, serverTimestamp, addDoc, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { teamLogoHtml, canManage } from './teams.js';
import { smartText } from './smart-text.js';

const C = (name) => collection(db, 'artifacts', appId, name);
const D = (id) => doc(db, 'artifacts', appId, 'tournaments', id);
const myUid = () => (window.currentUser && window.currentUser.uid) || '';
const myName = () => { const p = window.userProfile || {}; return p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || (window.currentUser && window.currentUser.displayName) || 'Organizer'; };
const myAvatar = () => { const p = window.userProfile || {}; return p.avatar || (window.currentUser && window.currentUser.photoURL) || ''; };
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
const GOLDBTN = 'bg-amber-400 text-slate-950 font-black rounded-xl text-xs px-3 py-2 transition';
const INPUT = 'w-full bg-black/60 border border-white/15 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#00F296]';
const GOLD = '#FACC15';
const LBL = (t) => `<div class="text-[10px] font-black uppercase tracking-wider text-white/55 mb-1.5">${t}</div>`;
const val = (id) => String(document.getElementById(id)?.value || '').trim();
const num = (id, d) => { const n = parseInt(val(id), 10); return isNaN(n) ? d : n; };
const TROPHY = (s = 22) => `<span style="font-size:${s}px;line-height:1">🏆</span>`;
const DEFAULT_AV = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';

const TT = { list: [], unsub: null, open: null, tab: 'info', chatUnsub: null, chat: [] };
window.__tourneyState = TT;

// the 6 steps
export const STEPS = [['signup', 'Registration', '📝'], ['draw', 'Draw', '🎲'], ['waiting', 'Waiting', '⏳'], ['set', 'Times set', '📅'], ['running', 'Playing', '⚽'], ['final', 'Champions', '🏆']];
const stepIndex = (s) => Math.max(0, STEPS.findIndex(x => x[0] === s));
const minTeamsOf = (t) => Math.max(2, +t.minTeams || 2);
const maxTeamsOf = (t) => Math.min(8, Math.max(minTeamsOf(t), +t.maxTeams || 8));
const canScore = (t) => ['set', 'running', 'final'].includes(t.status);
const rosterOf = (x) => (x && x.roster || []).map(r => typeof r === 'string' ? { id: r, name: '' } : r);

// ---------------------------------------------------------------- live list (last 60 days and coming up)
function start() {
    if (TT.unsub) TT.unsub();
    TT.unsub = onSnapshot(C('tournaments'), s => {
        const cut = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
        TT.list = s.docs.map(d => ({ ...d.data(), id: d.id })).filter(t => t.status !== 'cancelled' && (lastDayOf(t) || t.date || '') >= cut);
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

// ---------------------------------------------------------------- planned days + match times
/** The planned days ("subject to change"): [{ date, time, label, park }]. Old tournaments: just their date. */
export const daysOf = (t) => ((t.days || []).filter(d => d && d.date).length ? t.days.filter(d => d && d.date) : [{ date: t.date || '', time: t.time || '', label: '', park: '' }])
    .slice().sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
const lastDayOf = (t) => daysOf(t).slice(-1)[0].date || t.date || '';
const shortDate = (ymd) => { const [y, m, d] = String(ymd || '').split('-').map(Number); return y ? new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; };
const daysText = (t) => daysOf(t).map(d => shortDate(d.date)).join(' & ');
const placeOf = (t, m) => (m && m.place) || t.location || '';
/** When the matches are made: each round goes on the next planned day (the Final on the last one). */
function assignDays(t) {
    const days = daysOf(t);
    const order = ['league', 'group', 'qf', 'sf', 'final'].filter(st => (t.matches || []).some(m => m.stage === st));
    order.forEach((st, i) => {
        const d = st === 'final' ? days[days.length - 1] : days[Math.min(i, days.length - 1)];
        (t.matches || []).filter(m => m.stage === st && !m.date).forEach(m => { m.date = d.date; m.time = d.time || t.time || ''; m.place = d.park ? `${d.park}${t.city ? ', ' + t.city : ''}` : ''; });
    });
}
/** "Sat Dec 12 · 9:00 AM – 12:00 PM" */
const dayLine = (d) => `${prettyDate(d.date)}${d.time ? ' · ' + prettyTime(d.time) : ''}${d.until ? ' – ' + prettyTime(d.until) : ''}`;

/** Gold card for one tournament match in the Games list (no joining: it's for following the score and stats). */
export function tourneyMatchCardHtml(t, m) {
    const A = teamOf(t, m.a), B = teamOf(t, m.b);
    const side = (X, ref) => X ? `<div class="flex flex-col items-center gap-1 min-w-0 w-24">${teamLogoHtml(X, 44)}<span class="text-[11px] font-black truncate max-w-full">${esc(X.name)}</span></div>`
        : `<div class="flex flex-col items-center gap-1 w-24"><div class="w-11 h-11 rounded-2xl border-2 border-dashed border-amber-300/60 flex items-center justify-center text-amber-200 text-lg">?</div><span class="text-[10px] font-bold text-white/55 text-center leading-tight">${esc(fromLabel(ref))}</span></div>`;
    return `<div onclick="openTourney('${jsq(t.id)}', null, 'bracket')" class="relative rounded-2xl overflow-hidden shadow-xl border-[1.6px] border-amber-400 cursor-pointer p-4 space-y-3" style="background:linear-gradient(160deg,rgba(250,204,21,.18),rgba(1,10,15,.95) 55%)">
        <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 border border-amber-400/70 text-amber-200 text-[10px] font-black">${TROPHY(13)}<span>${esc(matchLabel(m).toUpperCase())}</span></div>
            <span class="text-[10px] font-bold text-white/60 truncate">${esc(t.name)}</span>
        </div>
        <div class="flex items-center justify-center gap-3">
            ${side(A, m.aFrom)}
            <div class="text-center shrink-0">${m.done ? `<div class="text-2xl font-black font-mono text-amber-200">${m.ga} - ${m.gb}</div><div class="text-[9px] font-black text-white/50">FINAL${m.pens ? ' (pens)' : ''}</div>` : `<div class="text-lg font-black text-amber-300">VS</div><div class="text-[10px] font-bold text-white/70">${esc(prettyTime(m.time || t.time))}</div>`}</div>
            ${side(B, m.bFrom)}
        </div>
        <div class="flex items-center justify-between text-[10px] font-bold text-white/70 border-t border-white/10 pt-2">
            <span class="truncate"><i class="fa-solid fa-location-dot text-amber-300 mr-1"></i>${esc(placeOf(t, m))}</span>
            <span class="shrink-0 text-amber-200/80">Follow live · stats</span>
        </div>
    </div>`;
}
/** The tournament flyer (Games list). big = a full poster (empty days, planned days); else a slim gold banner on busy days.
 *  Tapping it opens the tournament; "Register your team" goes straight into registering (or making a team first). */
const canRegister = (t) => t.status === 'signup' && (t.teams || []).length < maxTeamsOf(t);
function flyerHtml(t, big) {
    const n = (t.teams || []).length, max = maxTeamsOf(t);
    const step = STEPS[stepIndex(t.status)];
    const cta = canRegister(t)
        ? `<button onclick="event.stopPropagation(); ttRegisterTeam('${jsq(t.id)}')" class="shrink-0 font-black rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 ${big ? 'text-sm px-4 py-3 w-full' : 'text-[11px] px-3 py-2'} shadow-[0_0_14px_rgba(250,204,21,.45)]">📝 Register your team</button>`
        : `<span class="shrink-0 font-black rounded-xl bg-black/60 border border-amber-400/70 text-amber-200 ${big ? 'text-sm px-4 py-3 w-full text-center' : 'text-[11px] px-3 py-2'}">${t.status === 'signup' ? 'Full · View' : `${step[2]} ${step[1]} · View`}</span>`;
    const slots = Array.from({ length: max }, (_, i) => { const x = (t.teams || [])[i]; return x ? `<div title="${esc(x.name)}">${teamLogoHtml(x, big ? 34 : 22)}</div>` : `<div class="${big ? 'w-[34px] h-[34px]' : 'w-[22px] h-[22px]'} rounded-xl border-2 border-dashed border-amber-300/50 flex items-center justify-center text-amber-200/70 ${big ? 'text-sm' : 'text-[10px]'}">?</div>`; }).join('');
    const prize = (t.prizes || [])[0];
    if (!big) return `<div onclick="openTourney('${jsq(t.id)}')" class="col-span-full relative overflow-hidden rounded-2xl border-[1.6px] border-amber-400 cursor-pointer p-3 text-white" style="background:linear-gradient(110deg,rgba(250,204,21,.30),rgba(120,53,15,.35) 45%,rgba(0,0,0,.75))">
        <div class="absolute -right-3 -top-4 text-[64px] opacity-20 rotate-12 pointer-events-none">🏆</div>
        <div class="relative flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-black/50 border border-amber-300/70 flex items-center justify-center text-2xl shrink-0">🏆</div>
            <div class="flex-1 min-w-0">
                <div class="text-[9px] font-black tracking-[0.2em] text-amber-300 truncate">TOURNAMENT · ${esc(daysText(t).toUpperCase())}</div>
                <div class="text-sm font-black truncate">${esc(t.name)}</div>
                <div class="text-[10px] text-white/75 truncate">${esc(t.format || '')} · ${esc(t.park || t.location || '')} · ${n}/${max} teams${prize ? ` · 🥇 ${esc(prize.prize)}` : ''}</div>
            </div>
            ${cta}
        </div>
    </div>`;
    return `<div onclick="openTourney('${jsq(t.id)}')" class="col-span-full relative overflow-hidden rounded-3xl border-2 border-amber-400 cursor-pointer shadow-2xl text-white" style="background:radial-gradient(120% 80% at 50% 0%,rgba(250,204,21,.38),rgba(120,53,15,.30) 40%,rgba(1,6,10,.96) 75%);box-shadow:0 0 28px rgba(250,204,21,.25)">
        <div class="absolute inset-0 pointer-events-none" style="opacity:.06;background:repeating-linear-gradient(135deg,#fff 0 1px,transparent 1px 16px)"></div>
        <div class="relative p-5 space-y-4 text-center">
            <div class="flex items-center justify-center gap-2 text-[10px] font-black tracking-[0.3em] text-amber-200"><span class="h-px w-8 bg-amber-300/60"></span>TOURNAMENT<span class="h-px w-8 bg-amber-300/60"></span></div>
            <div class="text-5xl leading-none drop-shadow-[0_0_18px_rgba(250,204,21,.7)]">🏆</div>
            <div>
                <div class="text-2xl font-black tracking-tight leading-tight">${esc(t.name || 'Tournament')}</div>
                <div class="text-xs text-white/75 mt-1"><i class="fa-solid fa-location-dot text-amber-300 mr-1"></i>${esc(t.location || '')}</div>
            </div>
            <div class="flex flex-wrap justify-center gap-2">${daysOf(t).map(d => `<div class="bg-black/55 border border-amber-400/50 rounded-2xl px-3 py-2 min-w-[118px]">
                <div class="text-[11px] font-black text-amber-200">${esc(prettyDate(d.date))}</div>
                <div class="text-[10px] text-white/80">${esc(prettyTime(d.time))}${d.until ? '–' + esc(prettyTime(d.until)) : ''}</div>
                ${d.label ? `<div class="text-[10px] font-bold text-white mt-0.5">${esc(d.label)}</div>` : ''}</div>`).join('')}</div>
            <div class="grid grid-cols-3 gap-2 text-[10px] font-bold">
                <div class="bg-black/45 rounded-xl py-2"><div class="text-base font-black text-white">${esc(t.format || '')}</div>format</div>
                <div class="bg-black/45 rounded-xl py-2"><div class="text-base font-black text-white">${n}/${max}</div>teams</div>
                <div class="bg-black/45 rounded-xl py-2"><div class="text-base font-black text-white">${+t.priceCents ? money(t.priceCents) : 'Free'}</div>per team</div>
            </div>
            ${prize ? `<div class="text-sm font-black text-amber-200">🥇 ${esc(prize.prize)}${(t.prizes || [])[1] ? ` <span class="text-white/60 font-bold text-xs">· 🥈 ${esc(t.prizes[1].prize)}</span>` : ''}</div>` : ''}
            <div class="flex flex-wrap justify-center gap-1.5">${slots}</div>
            ${t.status === 'signup' ? `<div class="text-[10px] text-white/55">${max - n > 0 ? `${max - n} spot${max - n === 1 ? '' : 's'} left` : 'Full'} · ${+t.minPlayers || 1}–${+t.maxPlayers || 30} players per team · times subject to change</div>` : ''}
            ${cta}
        </div>
    </div>`;
}
// ---------------------------------------------------------------- Games list card
export function tourneyCardHtml(t) {
    const n = (t.teams || []).length, max = maxTeamsOf(t);
    const champ = t.championId ? teamOf(t, t.championId) : null;
    const step = STEPS[stepIndex(t.status)];
    const status = t.status === 'final' ? (champ ? `🏆 ${esc(champ.name)}` : 'Finished') : t.status === 'signup' ? (n >= max ? 'Full' : `${n}/${max} teams`) : `${step[2]} ${step[1]}`;
    return `<div id="tourney-card-${esc(t.id)}" onclick="openTourney('${jsq(t.id)}')" class="relative bg-[#010A0F]/90 rounded-2xl overflow-hidden shadow-xl border-[1.6px] border-amber-400/70 hover:border-amber-300 transition cursor-pointer p-4 space-y-3">
        <div class="absolute inset-0 pointer-events-none opacity-25" style="background:radial-gradient(circle at 50% 30%, ${GOLD} 0%, transparent 55%)"></div>
        <div class="relative z-10 space-y-3">
            <div class="flex justify-center"><div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 border border-amber-400/70 text-amber-200 text-[10px] font-black">${TROPHY(14)}<span>TOURNAMENT${t.status === 'running' ? ' · LIVE' : ''}</span></div></div>
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5 bg-black/50 px-2.5 py-1 rounded-xl border border-[#00B4AE]/80 text-white text-[10px] font-bold"><i class="fa-solid fa-users text-[10px]"></i><span>${esc(t.format || '7v7')} • ${minTeamsOf(t) === max ? max : `${minTeamsOf(t)}–${max}`} teams</span></div>
                <div class="flex items-center gap-1 bg-black/50 px-2.5 py-1 rounded-xl border border-[#00F296]/80 text-white text-[10px] font-bold"><i class="fa-solid fa-circle-dollar-to-slot text-[10px]"></i><span>${+t.priceCents ? money(t.priceCents) + ' per team' : 'Free'}</span></div>
            </div>
            <h3 class="text-base font-bold text-white tracking-tight line-clamp-1">${esc(t.name || 'Tournament')}</h3>
            ${(t.prizes || []).length ? `<div class="text-center text-[11px] font-black text-amber-200">🥇 ${esc(t.prizes[0].prize)}</div>` : ''}
            <div class="flex items-center justify-center gap-1.5 flex-wrap">${(t.teams || []).slice(0, 8).map(x => teamLogoHtml(x, 30)).join('') || '<span class="text-[11px] text-white/50">Be the first team in</span>'}</div>
            <div class="space-y-1.5 text-[11px] font-medium text-white/90">
                ${daysOf(t).map(d => `<div class="flex items-center gap-2"><i class="fa-solid fa-calendar text-[#00F296] w-3.5"></i><span>${esc(dayLine(d))}${d.label ? ` · <span class="text-amber-200">${esc(d.label)}</span>` : ''}</span></div>`).join('')}
                <div class="flex items-center gap-2"><i class="fa-solid fa-location-dot text-[#00F296] w-3.5"></i><span class="truncate">${esc(t.location || '')}</span></div>
            </div>
            <div class="border-t border-white/10 pt-2.5 flex items-center justify-between gap-2">
                <div class="text-[10px] font-bold text-white/70 truncate">By ${esc(t.organizerName || 'Organizer')}</div>
                <div class="px-2.5 py-1 rounded-xl text-[10px] font-black border ${t.status === 'running' ? 'bg-red-500/20 border-red-500 text-red-200' : 'bg-amber-400/20 border-amber-400 text-amber-100'} shrink-0">${status}</div>
            </div>
        </div>
    </div>`;
}
/** Tournaments in the Games list:
 *   - a day with dated matches: a gold card per match
 *   - a planned day before the times are set: the tournament card
 *   - an empty day: "No games today, but check out this tournament"
 *   - other days with games: a small gold flyer on top (next 45 days) */
function wrapEvents() {
    const orig = window.renderEvents;
    if (typeof orig !== 'function' || orig._tt) return;
    const w = function () {
        orig.apply(this, arguments);
        const grid = document.getElementById('events-grid'); if (!grid) return;
        if (grid.querySelector('.fa-spin')) return;
        const day = window.selectedDateStr || ymdToday();
        const live = TT.list.filter(t => t.status !== 'cancelled');
        const items = [], shown = new Set();
        live.forEach(t => {
            const ms = ['set', 'running', 'final'].includes(t.status) ? (t.matches || []).filter(m => m.date === day) : [];
            if (ms.length) { ms.forEach(m => items.push({ k: m.time || t.time || '', html: tourneyMatchCardHtml(t, m) })); shown.add(t.id); }
            else if (['signup', 'draw', 'waiting'].includes(t.status) && daysOf(t).some(d => d.date === day)) { items.push({ k: t.time || '', html: flyerHtml(t, true) }); shown.add(t.id); }
        });
        items.sort((a, b) => String(b.k).localeCompare(String(a.k)));
        const in45 = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
        const promo = live.filter(t => !shown.has(t.id) && t.status !== 'final' && day >= ymdToday() && day <= lastDayOf(t) && (daysOf(t)[0].date || '') <= in45)
            .sort((a, b) => String(daysOf(a)[0].date).localeCompare(String(daysOf(b)[0].date)));
        const empty = !!grid.querySelector('.fa-calendar-xmark');
        if (empty) {
            if (items.length) { grid.innerHTML = items.map(x => x.html).join(''); return; }
            if (promo.length) grid.innerHTML = `<div class="col-span-full text-center py-2"><div class="text-sm font-black text-white">No games today</div><div class="text-xs text-amber-200 font-bold">…but check out this tournament 🏆</div></div>` + flyerHtml(promo[0], true);
            return;
        }
        items.forEach(x => grid.insertAdjacentHTML('afterbegin', x.html));
        if (promo.length) grid.insertAdjacentHTML('afterbegin', flyerHtml(promo[0]));
    };
    w._tt = true; w._vs = orig._vs; window.renderEvents = w;
}
setTimeout(wrapEvents, 0); setTimeout(wrapEvents, 2000);
window.__ttWrap = wrapEvents;

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
window.ttSeg = (id, btn) => { document.querySelectorAll(`#${id} button`).forEach(b => { const on = b === btn; b.className = `px-3 py-2 rounded-xl text-xs font-black border ${on ? 'bg-[#00F296] text-slate-950 border-[#00F296]' : 'bg-black/50 text-white/80 border-white/15'}`; }); };
const segVal = (id) => { const on = document.querySelector(`#${id} button.bg-\\[\\#00F296\\]`); return on ? on.dataset.v : ''; };
const numSel = (id, from, to, cur) => `<select id="${id}" class="${INPUT}">${Array.from({ length: to - from + 1 }, (_, i) => from + i).map(n => `<option value="${n}" ${+cur === n ? 'selected' : ''}>${n}</option>`).join('')}</select>`;

// ---------------------------------------------------------------- create / edit
window.openCreateTourney = function (pre = {}) {
    if (!myUid()) return;
    const roles = window.myCommunityRoles || {}, cache = window.communitiesCache || {};
    const comms = Object.keys(roles).filter(id => roles[id] === 'admin' && cache[id]);
    const editing = !!pre.id;
    const days = (pre.days || []).length ? daysOf(pre) : (pre.date ? [{ date: pre.date, time: pre.time }] : []);
    const per = String(pre.format || '7v7').split('v')[0];
    sheet('tt-create', editing ? '✏️ Edit tournament' : `${TROPHY(22)} Create Tournament`, `
        <p class="text-[11px] text-white/60">Steps: 1) teams register, 2) the draw, 3) waiting, 4) game times are set, 5) games, 6) champions. The format comes from how many teams register: 4 = knockout, 6 = 2 groups of 3, 8 = quarter-finals.</p>
        <div>${LBL('Name *')}<input id="tt-name" class="${INPUT}" maxlength="50" value="${esc(pre.name || '')}" placeholder="e.g. Sabal Pines Winter Cup"></div>
        <div class="space-y-2">
            ${LBL('Timeline * (rough plan, subject to change)')}
            <p class="text-[10px] text-white/50 -mt-1">One line per day. Say what happens, e.g. "Group games" then "Semis & Final (if you advance)". The real game times are set after the draw.</p>
            ${[0, 1, 2, 3].map(i => { const d = days[i] || {}; const show = i < 2 || d.date; return `<div id="tt-day-${i}" class="space-y-2 bg-black/30 border border-white/10 rounded-xl p-2" style="${show ? '' : 'display:none'}">
                <input id="tt-d${i}-date" type="date" class="${INPUT} !py-2" value="${esc(d.date || '')}">
                <div class="grid grid-cols-2 gap-2"><div>${LBL('From')}<input id="tt-d${i}-time" type="time" class="${INPUT} !py-2 !px-2" value="${esc(d.time || '')}"></div><div>${LBL('Until')}<input id="tt-d${i}-until" type="time" class="${INPUT} !py-2 !px-2" value="${esc(d.until || '')}"></div></div>
                <input id="tt-d${i}-label" class="${INPUT} !py-2" maxlength="40" value="${esc(d.label || '')}" placeholder="${['e.g. Group games', 'e.g. Semis & Final (if you advance)', 'e.g. Final', 'What happens this day'][i]}">
            </div>`; }).join('')}
            <button type="button" onclick="const h=[2,3].find(i=>document.getElementById('tt-day-'+i).style.display==='none'); if(h!==undefined) document.getElementById('tt-day-'+h).style.display=''" class="text-[11px] font-bold text-[#00F296]">+ Add another day</button>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0">${LBL('Park *')}<input id="tt-park" class="${INPUT}" value="${esc(pre.park || '')}" placeholder="Sabal Pines Park"></div>
            <div class="min-w-0">${LBL('City *')}<input id="tt-city" class="${INPUT}" value="${esc(pre.city || '')}" placeholder="Coral Springs, FL"></div>
        </div>
        <div>${LBL('Format')}${seg('tt-format', ['5v5', '6v6', '7v7', '8v8', '9v9', '11v11'].map(s => [s, s]), pre.format || '8v8')}</div>
        <div class="grid grid-cols-2 gap-3">
            <div>${LBL('Min teams')}${numSel('tt-minteams', 2, 8, pre.minTeams || 4)}</div>
            <div>${LBL('Max teams')}${numSel('tt-maxteams', 2, 8, pre.maxTeams || 8)}</div>
        </div>
        <p class="text-[10px] text-white/50 -mt-2">Want exactly 4? Put 4 and 4.</p>
        <div class="grid grid-cols-2 gap-3">
            <div>${LBL('Min players per team')}${numSel('tt-minpl', 1, 30, pre.minPlayers || +per || 7)}</div>
            <div>${LBL('Max players per team')}${numSel('tt-maxpl', 1, 30, pre.maxPlayers || (+per || 7) + 5)}</div>
        </div>
        <div>${LBL('Entry fee per team ($, 0 = free)')}<input id="tt-price" inputmode="decimal" class="${INPUT}" value="${esc(pre.priceCents ? pre.priceCents / 100 : '')}" placeholder="0"></div>
        ${comms.length ? `<div>${LBL('🏘️ Post in a community (optional)')}<select id="tt-comm" class="${INPUT}"><option value="">No community</option>${comms.map(id => `<option value="${esc(id)}" ${pre.communityId === id ? 'selected' : ''}>${esc(cache[id].name || 'Community')}</option>`).join('')}</select></div>` : ''}
        <div>${LBL('Description / rules')}<textarea id="tt-desc" rows="3" maxlength="800" class="${INPUT}" placeholder="e.g. 25-minute games. Bring light and dark shirts.">${esc(pre.description || '')}</textarea></div>
        <p class="text-[10px] text-white/50">Prizes are added from the tournament's Admin tab.</p>
        <button onclick="saveTourney('${jsq(pre.id || '')}')" class="${BTN} w-full py-3 text-sm">${editing ? 'Save changes' : 'Create tournament'}</button>`);
};
window.saveTourney = async function (editId) {
    const days = [0, 1, 2, 3].map(i => ({ date: val(`tt-d${i}-date`), time: val(`tt-d${i}-time`), until: val(`tt-d${i}-until`), label: val(`tt-d${i}-label`) })).filter(d => d.date)
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    const name = val('tt-name'), park = val('tt-park'), city = val('tt-city');
    if (!name || !days.length || !days[0].time || !park || !city) { toast('Fill in the name, at least one day with its start time, the park and the city.', 'error'); return; }
    const minTeams = num('tt-minteams', 4), maxTeams = num('tt-maxteams', 8), minPlayers = num('tt-minpl', 7), maxPlayers = num('tt-maxpl', 12);
    if (minTeams > maxTeams) { toast('Min teams can\'t be more than max teams.', 'error'); return; }
    if (minPlayers > maxPlayers) { toast('Min players can\'t be more than max players.', 'error'); return; }
    const cid = val('tt-comm');
    const fields = { name, date: days[0].date, time: days[0].time, days, park, city, location: `${park}, ${city}`, format: segVal('tt-format') || '8v8',
        minTeams, maxTeams, minPlayers, maxPlayers, priceCents: Math.round((parseFloat(val('tt-price').replace(',', '.')) || 0) * 100), description: val('tt-desc'),
        communityId: cid, communityName: cid ? (((window.communitiesCache || {})[cid] || {}).name || '') : '', updatedAt: serverTimestamp() };
    try {
        if (editId) {
            await change(editId, (t) => { if ((t.teams || []).length > fields.maxTeams) throw new Error('TOO_MANY'); Object.assign(t, fields); });
            document.getElementById('tt-create')?.remove(); toast('Tournament updated.');
            return;
        }
        const ref = doc(C('tournaments'));
        const t = { ...fields, organizerId: myUid(), organizerName: myName(), status: 'signup', plan: '', teams: [], teamIds: [], participantUids: [myUid()], matches: [], prizes: [], championId: '', announcements: [], createdAt: serverTimestamp() };
        await setDoc(ref, t);
        document.getElementById('tt-create')?.remove();
        window.closeCreateActionSheet && window.closeCreateActionSheet();
        toast('Tournament created! 🏆 Share it so teams can register.');
        window.openTourney(ref.id, { ...t, id: ref.id });
    } catch (e) { toast(String(e && e.message) === 'TOO_MANY' ? 'More teams already registered than that.' : "Couldn't save the tournament.", 'error'); }
};
async function change(id, fn) {
    await runTransaction(db, async (tx) => {
        const s = await tx.get(D(id)); if (!s.exists()) throw new Error('GONE');
        const t = s.data();
        t.teams = (t.teams || []).map(x => ({ ...x }));
        t.matches = (t.matches || []).map(m => ({ ...m, goals: [...(m.goals || [])] }));
        if (fn(t) === false) return;
        t.teamIds = t.teams.map(x => x.teamId);
        // everyone who should hear about it: organizer, captains, and the players on the rosters
        t.participantUids = [...new Set([t.organizerId, ...t.teams.map(x => x.joinedBy), ...t.teams.flatMap(x => rosterOf(x).map(r => r.uid))].filter(Boolean))];
        delete t.createdAt;
        tx.update(D(id), { ...t, updatedBy: myUid(), updatedAt: serverTimestamp() });
    });
}

// ---------------------------------------------------------------- join with a team + pick the players
const membersOfTeam = (teamId) => { const full = (TS().mine || []).concat(TS().all || []).find(y => y.id === teamId); return (full && full.members) || []; };
const pId = (p) => String(p.id || p.uid || p.name);
window.openJoinTourney = function () {
    const t = TT.open; if (!t) return;
    const mine = myCaptainTeams().filter(x => !(t.teamIds || []).includes(x.id));
    if (!mine.length) { toast(myCaptainTeams().length ? 'Your teams are already in.' : 'You need to be the captain of a team. Make one in the Teams tab.', 'error'); return; }
    sheet('tt-join', `Register for ${esc(t.name)}`, `
        ${+t.priceCents ? `<p class="text-xs text-white/70">Entry fee: <b>${money(t.priceCents)}</b> per team. Pay the organizer; they mark you as paid.</p>` : ''}
        <p class="text-xs text-white/70">Pick your team, then your players (${+t.minPlayers || 1}–${+t.maxPlayers || 30} per team).</p>
        <div class="space-y-2">${mine.map(x => `<button onclick="openTourneyPlayers('${jsq(x.id)}', true)" class="w-full flex items-center gap-3 p-3 bg-black/40 hover:bg-black rounded-xl border border-white/10 text-left">${teamLogoHtml(x, 36)}<span class="flex-1 text-sm font-black">${esc(x.name)}</span><span class="text-[11px] text-white/50">${(x.members || []).length} players ›</span></button>`).join('')}</div>`);
};
/** "Register your team": a captain registers a team; no team yet -> make one first, then come right back. */
window.ttRegisterTeam = async function (id) {
    if (!myUid()) { toast('Sign in first to register your team.', 'error'); window.switchTab && window.switchTab('profile'); return; }
    if (!TT.open || TT.open.id !== id) window.openTourney(id, null, 'info');
    const t = TT.open || TT.list.find(x => x.id === id); if (!t) return;
    if (!canRegister(t)) { toast(t.status === 'signup' ? 'Registration is full.' : 'Registration is closed.', 'error'); return; }
    const free = myCaptainTeams().filter(x => !(t.teamIds || []).includes(x.id));
    if (free.length === 1) return window.openTourneyPlayers(free[0].id, true);
    if (free.length) return window.openJoinTourney();
    if (myCaptainTeams().length) { toast('Your team is already registered. 🏆'); TT.tab = 'teams'; drawPage(); return; }
    const playerOn = (TS().mine || []).filter(x => !x.temp);
    sheet('tt-needteam', '🏆 You need a team first', `
        <p class="text-sm text-white/80">To register for <b>${esc(t.name)}</b>, make your team (name, logo, colors), add your players, then come back here. It takes a minute.</p>
        ${playerOn.length ? `<p class="text-[11px] text-white/60">You're on ${playerOn.map(x => esc(x.name)).join(', ')}, but only a captain can register a team. Ask your captain, or make your own.</p>` : ''}
        <button onclick="ttMakeTeamFor('${jsq(t.id)}')" class="${GOLDBTN} w-full py-3 text-sm">➕ Make my team</button>
        <button onclick="document.getElementById('tt-needteam').remove()" class="${DARK} w-full py-2.5">Not now</button>`);
};
window.ttMakeTeamFor = function (tid) {
    document.getElementById('tt-needteam')?.remove();
    if (typeof window.openCreateTeam !== 'function') { toast('Open the Teams tab to make your team.', 'error'); return; }
    window.__afterTeamCreated = (teamId) => window.ttGoAddPlayers(tid, teamId);
    window.openCreateTeam();
};
/** Go to the team page to add players, with a gold bar to come back and finish registering. */
window.ttGoAddPlayers = function (tid, teamId) {
    const t = TT.list.find(x => x.id === tid) || TT.open || {};
    document.getElementById('tt-players')?.remove();
    window.closeTourney();
    window.openTeam && window.openTeam(teamId);
    document.getElementById('tt-return')?.remove();
    const bar = document.createElement('div');
    bar.id = 'tt-return';
    bar.className = 'fixed left-3 right-3 bottom-4 z-[170] max-w-md mx-auto flex items-center gap-2 rounded-2xl border-2 border-amber-400 p-2.5 shadow-2xl';
    bar.style.background = 'linear-gradient(90deg,rgba(120,53,15,.95),rgba(4,14,19,.97))';
    bar.innerHTML = `<span class="text-2xl">🏆</span><div class="flex-1 min-w-0"><div class="text-[11px] font-black text-amber-200">Add your players, then:</div><div class="text-[10px] text-white/70 truncate">${esc(t.name || 'the tournament')}</div></div>
        <button onclick="ttBackToRegister('${jsq(tid)}','${jsq(teamId)}')" class="${GOLDBTN} shrink-0">Register team ›</button>
        <button onclick="document.getElementById('tt-return').remove()" class="w-7 h-7 rounded-full bg-black/60 text-xs shrink-0"><i class="fa-solid fa-xmark"></i></button>`;
    document.body.appendChild(bar);
};
window.ttBackToRegister = function (tid, teamId) {
    document.getElementById('tt-return')?.remove();
    window.closeTeam && window.closeTeam();
    window.openTourney(tid, null, 'info');
    let tries = 0;
    const go = () => { if (myCaptainTeams().some(x => x.id === teamId)) window.openTourneyPlayers(teamId, true); else if (tries++ < 20) setTimeout(go, 300); else toast("Couldn't find your new team yet. Try again in a moment.", 'error'); };
    go();
};
/** Pick the players for the tournament (when joining, and later to change it). */
window.openTourneyPlayers = function (teamId, joining) {
    const t = TT.open; if (!t) return;
    const members = membersOfTeam(teamId);
    const cur = new Set(rosterOf(teamOf(t, teamId)).map(r => r.id));
    const min = +t.minPlayers || 1, max = +t.maxPlayers || 30;
    const name = joining ? (myCaptainTeams().find(x => x.id === teamId) || {}).name : nameOf(t, teamId);
    document.getElementById('tt-join')?.remove();
    sheet('tt-players', `👥 ${esc(name || 'Team')}: players`, `
        <div class="flex items-center justify-between"><p class="text-xs text-white/70">Pick ${min === max ? min : `${min} to ${max}`} players.</p>
            <button onclick="document.querySelectorAll('[data-pl]').forEach(c => c.checked = true); ttCountPl()" class="text-[11px] font-bold text-[#00F296]">Select all</button></div>
        <div class="space-y-1.5">${members.map(p => `<label class="flex items-center gap-3 p-2.5 bg-black/40 rounded-xl border border-white/10 cursor-pointer">
            <input type="checkbox" class="w-5 h-5 accent-[#00F296]" data-pl="${esc(pId(p))}" onchange="ttCountPl()" ${!cur.size || cur.has(pId(p)) ? 'checked' : ''}>
            <span class="flex-1 min-w-0 text-xs font-bold truncate">${p.number ? esc(p.number) + ' · ' : ''}${esc(p.name || 'Player')}${p.uid ? '' : ' <span class="text-[9px] text-white/40">(no app)</span>'}</span><span class="text-[10px] text-white/45">${esc(p.position || '')}</span></label>`).join('') || '<p class="text-xs text-white/50">This team has no players yet. Add them in the Teams tab first.</p>'}</div>
        <button onclick="ttGoAddPlayers('${jsq(t.id)}','${jsq(teamId)}')" class="w-full text-[11px] font-bold text-[#00F296] py-1">➕ Add more players to the team</button>
        <div id="tt-pl-count" class="text-[11px] text-center text-white/60"></div>
        <button onclick="saveTourneyPlayers('${jsq(teamId)}', ${joining ? 'true' : 'false'})" class="${BTN} w-full py-3 text-sm">${joining ? 'Register my team' : 'Save players'}</button>`);
    window.ttCountPl();
};
window.ttCountPl = () => {
    const t = TT.open; if (!t) return;
    const n = [...document.querySelectorAll('[data-pl]')].filter(c => c.checked).length;
    const min = +t.minPlayers || 1, max = +t.maxPlayers || 30;
    const el = document.getElementById('tt-pl-count');
    if (el) el.innerHTML = `${n} picked${n < min ? ` · <span class="text-amber-300">need at least ${min}</span>` : n > max ? ` · <span class="text-red-300">max ${max}</span>` : ' · <span class="text-[#00F296]">✓</span>'}`;
};
window.saveTourneyPlayers = async function (teamId, joining) {
    const t0 = TT.open; if (!t0) return;
    const members = membersOfTeam(teamId);
    const ids = [...document.querySelectorAll('[data-pl]')].filter(c => c.checked).map(c => c.dataset.pl);
    const min = +t0.minPlayers || 1, max = +t0.maxPlayers || 30;
    if (ids.length < min || ids.length > max) { toast(`Pick ${min === max ? min : `between ${min} and ${max}`} players.`, 'error'); return; }
    const roster = members.filter(p => ids.includes(pId(p))).map(p => ({ id: pId(p), name: p.name || 'Player', number: p.number || '', uid: p.uid || '', position: p.position || '' }));
    const x = myCaptainTeams().find(y => y.id === teamId);
    try {
        await change(t0.id, (t) => {
            const cur = t.teams.find(y => y.teamId === teamId);
            if (joining) {
                if (t.status !== 'signup') throw new Error('STARTED');
                if (t.teams.length >= maxTeamsOf(t)) throw new Error('FULL');
                if (cur) { cur.roster = roster; return; }
                t.teams.push({ teamId, name: x.name, short: x.short || '', logo: x.logo || null, colors: x.colors || {}, paid: !(+t.priceCents), joinedBy: myUid(), joinedByName: myName(), joinedAt: Date.now(), roster });
            } else { if (!cur) return false; cur.roster = roster; }
        });
        document.getElementById('tt-players')?.remove();
        toast(joining ? `${x ? x.name : 'Your team'} is registered! 🏆` : `Players saved (${roster.length}). 👥`);
        TT.tab = 'teams';
    } catch (e) { const k = String(e && e.message); toast(k === 'FULL' ? 'The tournament is full.' : k === 'STARTED' ? 'Registration is closed.' : "Couldn't save.", 'error'); }
};
window.leaveTourney = async function (teamId) {
    const t0 = TT.open; if (!t0) return;
    if (!confirm('Take this team out of the tournament?')) return;
    try { await change(t0.id, (t) => { if (t.status !== 'signup') throw new Error('STARTED'); t.teams = t.teams.filter(y => y.teamId !== teamId); }); toast('Team removed.'); }
    catch (e) { toast(String(e && e.message) === 'STARTED' ? "Registration is closed: teams can't leave now." : "Couldn't change it.", 'error'); }
};
window.toggleTourneyPaid = async function (teamId) {
    const t0 = TT.open; if (!t0) return;
    try { await change(t0.id, (t) => { const y = t.teams.find(z => z.teamId === teamId); if (!y) return false; y.paid = !y.paid; }); }
    catch (e) { toast("Couldn't change it.", 'error'); }
};

// ---------------------------------------------------------------- the steps (organizer)
window.tourneyDraw = async function (redo) {
    const t0 = TT.open; if (!t0) return;
    const n = (t0.teams || []).length;
    if (n < 2) { toast('At least 2 teams need to be registered.', 'error'); return; }
    if (!redo) {
        const short = n < minTeamsOf(t0) ? `\n\nOnly ${n} teams (you wanted at least ${minTeamsOf(t0)}).` : '';
        const unpaid = (t0.teams || []).filter(x => !x.paid).length;
        if (!confirm(`Close registration and do the draw with ${n} teams?\n\n${PLAN_TEXT[planFor(n)]}${short}${unpaid ? `\n\n${unpaid} team${unpaid === 1 ? " hasn't" : "s haven't"} paid yet.` : ''}`)) return;
    }
    try {
        await change(t0.id, (t) => {
            if (!['signup', 'draw'].includes(t.status)) return false;
            const b = buildMatches(t.teams.map(x => x.teamId));
            t.plan = b.plan; t.matches = b.matches; t.status = 'draw';
        });
        TT.tab = 'bracket';
        toast(redo ? 'New draw done. 🎲' : 'Registration closed. Here is the draw 🎲 Redraw or confirm it.');
    } catch (e) { toast("Couldn't do the draw.", 'error'); }
};
window.tourneyReopen = async function () {
    if (!confirm('Reopen registration? The draw is thrown away.')) return;
    try { await change(TT.open.id, (t) => { t.status = 'signup'; t.matches = []; t.plan = ''; }); toast('Registration is open again.'); }
    catch (e) { toast("Couldn't change it.", 'error'); }
};
window.tourneyConfirmDraw = async function () {
    if (!confirm('Confirm the draw? Everyone gets told who they play. Game times come next.')) return;
    try { await change(TT.open.id, (t) => { if (t.status !== 'draw') return false; t.status = 'waiting'; }); toast('Draw confirmed. Everyone was told. ⏳'); }
    catch (e) { toast("Couldn't confirm it.", 'error'); }
};
/** Fill the game times from the timeline, then the organizer checks/changes them and publishes. */
window.openTourneyTimes = function () {
    const t = TT.open; if (!t) return;
    const ms = (t.matches || []).map(m => ({ ...m }));
    const tmp = { ...t, matches: ms };
    assignDays(tmp);
    // games on the same day: spread 30 minutes apart unless already set
    const byDay = {};
    tmp.matches.forEach(m => { if (!m.date) return; (byDay[m.date] = byDay[m.date] || []).push(m); });
    const orig = new Map((t.matches || []).map(m => [m.id, m]));
    Object.values(byDay).forEach(list => list.forEach((m, i) => {
        if ((orig.get(m.id) || {}).time) return;
        const [h, mm] = String(m.time || '09:00').split(':').map(Number); const mins = h * 60 + (mm || 0) + i * 30;
        m.time = `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    }));
    sheet('tt-times', '📅 Game times', `
        <p class="text-[11px] text-white/60">Filled in from your timeline. Change anything, then publish: everyone in the tournament gets told.</p>
        ${tmp.matches.map(m => `<div class="bg-black/40 border border-white/10 rounded-xl p-2.5 space-y-2" data-mt="${esc(m.id)}">
            <div class="text-[11px] font-black ${m.stage === 'final' ? 'text-amber-300' : 'text-[#00F296]'}">${esc(matchLabel(m))}: ${esc(nameOf(t, m.a) || fromLabel(m.aFrom))} vs ${esc(nameOf(t, m.b) || fromLabel(m.bFrom))}</div>
            <div class="grid grid-cols-[1fr_120px] gap-2"><input type="date" class="${INPUT} !py-2" data-k="date" value="${esc(m.date || '')}"><input type="time" class="${INPUT} !py-2 !px-2" data-k="time" value="${esc(m.time || '')}"></div>
            <input class="${INPUT} !py-2" data-k="place" value="${esc(m.place || '')}" placeholder="Field (blank = ${esc(t.park || 'the park')})">
        </div>`).join('')}
        <button onclick="saveTourneyTimes(true)" class="${GOLDBTN} w-full py-3 text-sm">📣 Publish times</button>
        <button onclick="saveTourneyTimes(false)" class="${DARK} w-full py-2.5">Save without telling anyone</button>`);
};
window.saveTourneyTimes = async function (publish) {
    const t0 = TT.open; if (!t0) return;
    const rows = [...document.querySelectorAll('[data-mt]')].map(el => ({ id: el.dataset.mt, date: el.querySelector('[data-k=date]').value, time: el.querySelector('[data-k=time]').value, place: el.querySelector('[data-k=place]').value.trim() }));
    if (publish && rows.some(r => !r.date || !r.time)) { toast('Every game needs a day and a time before publishing.', 'error'); return; }
    try {
        await change(t0.id, (t) => {
            rows.forEach(r => { const m = t.matches.find(x => x.id === r.id); if (m) Object.assign(m, { date: r.date, time: r.time, place: r.place }); });
            if (publish && ['draw', 'waiting'].includes(t.status)) t.status = 'set';
            if (publish) t.timesAt = Date.now();
        });
        document.getElementById('tt-times')?.remove();
        toast(publish ? 'Game times published. 📣' : 'Saved.');
    } catch (e) { toast("Couldn't save the times.", 'error'); }
};
/** Send an update to everyone in the tournament (push notification + shows in Info). */
window.openTourneyAnnounce = function () {
    sheet('tt-ann', '📣 Send an update', `
        <p class="text-[11px] text-white/60">Everyone in the tournament (captains and players) gets a notification.</p>
        <textarea id="tt-ann-text" rows="4" maxlength="400" class="${INPUT}" placeholder="e.g. Semis moved to 10 AM because of rain."></textarea>
        <button onclick="sendTourneyAnnounce()" class="${GOLDBTN} w-full py-3 text-sm">Send</button>`);
};
window.sendTourneyAnnounce = async function () {
    const text = val('tt-ann-text'); if (!text) return;
    try {
        await change(TT.open.id, (t) => { t.announcements = [...(t.announcements || []), { text, at: Date.now(), by: myUid(), byName: myName() }].slice(-20); });
        document.getElementById('tt-ann')?.remove(); toast('Update sent. 📣');
    } catch (e) { toast("Couldn't send it.", 'error'); }
};
window.openTourneyPrizes = function () {
    const t = TT.open; if (!t) return;
    const pz = (t.prizes || []).length ? t.prizes : [{ place: '🥇 1st', prize: '' }, { place: '🥈 2nd', prize: '' }];
    sheet('tt-prizes', '🎁 Prizes', `
        ${[0, 1, 2, 3].map(i => `<div class="grid grid-cols-[90px_1fr] gap-2"><input id="tp-place-${i}" class="${INPUT} !py-2" value="${esc((pz[i] || {}).place || ['🥇 1st', '🥈 2nd', '🥉 3rd', '⭐ MVP'][i])}"><input id="tp-prize-${i}" class="${INPUT} !py-2" value="${esc((pz[i] || {}).prize || '')}" placeholder="${['e.g. $400 + trophy', 'e.g. $100', 'e.g. Medals', 'e.g. New boots'][i]}"></div>`).join('')}
        <div>${LBL('Note (optional)')}<input id="tp-note" class="${INPUT}" value="${esc(t.prizeNote || '')}" placeholder="e.g. Prize money depends on how many teams register"></div>
        <button onclick="saveTourneyPrizes()" class="${GOLDBTN} w-full py-3 text-sm">Save prizes</button>`);
};
window.saveTourneyPrizes = async function () {
    const prizes = [0, 1, 2, 3].map(i => ({ place: val(`tp-place-${i}`), prize: val(`tp-prize-${i}`) })).filter(p => p.prize);
    try { await change(TT.open.id, (t) => { t.prizes = prizes; t.prizeNote = val('tp-note'); }); document.getElementById('tt-prizes')?.remove(); toast('Prizes saved. 🎁'); }
    catch (e) { toast("Couldn't save the prizes.", 'error'); }
};

// ---------------------------------------------------------------- scores
window.openTourneyScore = function (mid) {
    const t = TT.open; if (!t) return;
    if (!canScore(t)) { toast('Publish the game times first (Admin tab).', 'error'); return; }
    const m = (t.matches || []).find(x => x.id === mid); if (!m || !m.a || !m.b) return;
    const A = teamOf(t, m.a) || { name: 'Team' }, B = teamOf(t, m.b) || { name: 'Team' };
    window._ttGoals = (m.goals || []).map(g => ({ ...g }));
    window._ttMatch = mid;
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
    const m = (t.matches || []).find(x => x.id === window._ttMatch) || {};
    const otherId = m.a === teamId ? m.b : m.a;
    // the players registered for the tournament (else the whole team)
    const playersOf = (id) => { const r = rosterOf(teamOf(t, id)).filter(x => x.name); return r.length ? r : membersOfTeam(id); };
    const row = (p, own) => `<button onclick="ttAddGoal('${jsq(teamId)}','${jsq(p.name || '')}','${jsq(p.uid || '')}',${own})" class="w-full flex items-center gap-3 p-2.5 bg-black/40 hover:bg-black rounded-xl border border-white/10 text-left text-xs font-bold">${p.number ? esc(p.number) + ' · ' : ''}${esc(p.name || 'Player')}</button>`;
    sheet('tt-goal', `Goal for ${esc(nameOf(t, teamId))}`, `
        <div class="space-y-1.5">${playersOf(teamId).map(p => row(p, false)).join('') || '<p class="text-xs text-white/50">No players listed.</p>'}</div>
        <button onclick="ttAddGoal('${jsq(teamId)}','','',false)" class="w-full p-2.5 bg-black/40 rounded-xl border border-dashed border-white/25 text-xs font-bold">🤷 Don't recall / someone else</button>
        ${otherId && playersOf(otherId).length ? `<div class="space-y-1.5 pt-2 border-t border-white/10"><div class="text-[10px] font-black uppercase tracking-wider text-amber-300">Own goal by ${esc(nameOf(t, otherId))}</div>${playersOf(otherId).map(p => row(p, true)).join('')}</div>` : ''}`);
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
            t.championId = advance(t); t.status = t.championId ? 'final' : (t.matches.some(x => x.done) ? 'running' : 'set');
        });
        document.getElementById('tt-score')?.remove();
    } catch (e) { toast("Couldn't clear it.", 'error'); }
};
/** One game's day, time and field. */
window.openTourneyWhen = function (mid) {
    const t = TT.open; if (!t) return;
    const m = (t.matches || []).find(x => x.id === mid); if (!m) return;
    sheet('tt-when', `📅 ${esc(matchLabel(m))}`, `
        <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0">${LBL('Day')}<input id="tw-date" type="date" class="${INPUT}" value="${esc(m.date || '')}"></div>
            <div class="min-w-0">${LBL('Time')}<input id="tw-time" type="time" class="${INPUT}" value="${esc(m.time || '')}"></div>
        </div>
        <div>${LBL('Field / place (blank = the tournament park)')}<input id="tw-place" class="${INPUT}" value="${esc(m.place || '')}" placeholder="${esc(t.location || '')}"></div>
        <button onclick="saveTourneyWhen('${jsq(mid)}')" class="${BTN} w-full py-3 text-sm">Save</button>`);
};
window.saveTourneyWhen = async function (mid) {
    const t0 = TT.open; if (!t0) return;
    const date = val('tw-date'), time = val('tw-time'), place = val('tw-place');
    try {
        await change(t0.id, (t) => { const m = t.matches.find(x => x.id === mid); if (!m) return false; Object.assign(m, { date, time, place }); });
        document.getElementById('tt-when')?.remove(); toast('Game time saved. 📅');
    } catch (e) { toast("Couldn't save it.", 'error'); }
};
window.cancelTourney = async function () {
    if (!confirm('Cancel the tournament? It disappears for everyone.')) return;
    try { await change(TT.open.id, (t) => { t.status = 'cancelled'; }); window.closeTourney(); toast('Tournament cancelled.'); }
    catch (e) { toast("Couldn't cancel.", 'error'); }
};

// ---------------------------------------------------------------- chat
function startChat(id) {
    if (TT.chatUnsub && TT.chatId === id) return;
    if (TT.chatUnsub) TT.chatUnsub();
    TT.chatId = id; TT.chat = [];
    TT.chatUnsub = onSnapshot(query(collection(db, 'artifacts', appId, 'tournaments', id, 'chat'), orderBy('at', 'desc'), limit(100)), s => {
        TT.chat = s.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
        if (TT.open && TT.open.id === id && TT.tab === 'chat') drawPage();
    }, () => {});
}
window.sendTourneyChat = async function () {
    const t = TT.open; if (!t) return;
    const box = document.getElementById('tt-chat-in'); const text = String(box && box.value || '').trim(); if (!text) return;
    box.value = '';
    try { await addDoc(collection(db, 'artifacts', appId, 'tournaments', t.id, 'chat'), { text: text.slice(0, 1000), uid: myUid(), name: myName(), avatar: myAvatar(), at: Date.now() }); }
    catch (e) { toast("Couldn't send.", 'error'); box.value = text; }
};

// ---------------------------------------------------------------- the tournament page
window.openTourney = function (id, initial, tab) {
    TT.open = TT.list.find(t => t.id === id) || (initial ? { ...initial, id } : null);
    TT.tab = tab || (TT.open && ['set', 'running', 'final'].includes(TT.open.status) ? 'bracket' : 'info');
    if (!TT.open) getDoc(D(id)).then(s => { if (s.exists()) { TT.open = { ...s.data(), id }; drawPage(); } }).catch(() => {});
    else drawPage();
};
window.closeTourney = () => { TT.open = null; if (TT.chatUnsub) { TT.chatUnsub(); TT.chatUnsub = null; TT.chatId = ''; } document.getElementById('tt-page')?.remove(); };
window.ttTab = (k) => { TT.tab = k; drawPage(); };
window.shareTourney = async function () {
    const t = TT.open; if (!t) return;
    const text = `🏆 ${t.name} · ${daysText(t)} at ${t.location || ''}. ${t.status === 'signup' ? 'Register your team on FutNet!' : ''}`;
    const url = `https://futnet.site/#tourney=${encodeURIComponent(t.id)}`;
    try { if (navigator.share) { await navigator.share({ title: t.name, text, url }); return; } } catch (e) { return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Copied! Paste it in WhatsApp.'); } catch (e) { /* ignore */ }
};
function stepsHtml(t) {
    const cur = stepIndex(t.status);
    return `<div class="flex items-start justify-between gap-1">${STEPS.map(([k, l, ic], i) => `<div class="flex-1 flex flex-col items-center gap-1 min-w-0">
        <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 ${i < cur ? 'bg-[#00F296]/20 border-[#00F296] ' : i === cur ? 'bg-amber-400 border-amber-300 text-slate-950 shadow-[0_0_12px_rgba(250,204,21,.6)]' : 'bg-black/40 border-white/15 opacity-50'}">${i < cur ? '✓' : ic}</div>
        <div class="text-[9px] font-black text-center leading-tight ${i === cur ? 'text-amber-200' : i < cur ? 'text-[#00F296]' : 'text-white/40'}">${l}</div></div>`).join('')}</div>`;
}
const STEP_NOTE = {
    signup: 'Registration is open. Captains: register your team and pick your players.',
    draw: 'Registration is closed. The organizer is doing the draw.',
    waiting: 'The draw is done (see the Bracket). Waiting for game times.',
    set: 'Game times are out! Check the Bracket for when you play.',
    running: 'Games are being played. Follow the scores in the Bracket.',
    final: 'It\'s over. Congrats to the champions!',
};
function matchRow(t, m, boss) {
    const A = teamOf(t, m.a), B = teamOf(t, m.b);
    const side = (X, ref, right) => X ? `<span class="flex-1 min-w-0 flex items-center ${right ? 'justify-start' : 'justify-end'} gap-1.5 text-xs font-black">${right ? teamLogoHtml(X, 22) : ''}<span class="truncate ${winnerOf(m) && winnerOf(m) !== X.teamId ? 'text-white/45' : ''}">${esc(X.name)}</span>${right ? '' : teamLogoHtml(X, 22)}</span>`
        : `<span class="flex-1 min-w-0 text-[11px] font-bold text-white/40 ${right ? 'text-left' : 'text-right'} truncate">${esc(fromLabel(ref))}</span>`;
    const mid = m.done ? `<span class="shrink-0 bg-[#00F296]/15 text-[#00F296] font-black font-mono text-sm px-2.5 py-1 rounded-lg">${m.ga} - ${m.gb}</span>` : '<span class="shrink-0 text-[11px] font-black text-white/40 px-2">vs</span>';
    const can = boss && canScore(t) && m.a && m.b;
    const timesOut = ['set', 'running', 'final'].includes(t.status);
    return `<div ${can ? `onclick="openTourneyScore('${jsq(m.id)}')"` : ''} class="bg-black/40 border ${m.stage === 'final' ? 'border-amber-400/60' : 'border-white/10'} rounded-2xl p-3 space-y-1.5 ${can ? 'cursor-pointer hover:bg-black/60' : ''}">
        <div class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider"><span class="${m.stage === 'final' ? 'text-amber-300' : 'text-[#00F296]'}">${m.stage === 'final' ? '🏆 ' : ''}${esc(matchLabel(m))}</span>${can ? `<span class="text-white/45 normal-case tracking-normal font-bold">${m.done ? 'Edit' : 'Enter score'} ›</span>` : ''}</div>
        <div class="flex items-center gap-2">${side(A, m.aFrom)}${mid}${side(B, m.bFrom, true)}</div>
        ${timesOut && (m.date || m.time) ? `<div class="flex items-center justify-center gap-2 text-[10px] text-white/60"><span>📅 ${esc(shortDate(m.date))}${m.time ? ' · ' + esc(prettyTime(m.time)) : ''}${m.place ? ' · ' + esc(m.place) : ''}</span>${boss && t.status !== 'final' ? `<button onclick="event.stopPropagation(); openTourneyWhen('${jsq(m.id)}')" class="text-amber-300 font-bold underline">change</button>` : ''}</div>`
        : !timesOut ? '<div class="text-center text-[10px] text-white/40">Time to be announced</div>' : ''}
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
    const n = (t.teams || []).length, max = maxTeamsOf(t), min = minTeamsOf(t);
    const champ = t.championId ? teamOf(t, t.championId) : null;
    const myIn = (t.teams || []).filter(x => myCaptainTeams().some(y => y.id === x.teamId) || x.joinedBy === myUid());
    const iPlay = (t.participantUids || []).includes(myUid());
    let tab = TT.tab || 'info';
    if (tab === 'admin' && !boss) tab = 'info';
    if (tab === 'chat') startChat(t.id);
    const tabBtn = (k, label) => `<button onclick="ttTab('${k}')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === k ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">${label}</button>`;
    const mapsUrl = t.location ? 'https://maps.apple.com/?q=' + encodeURIComponent(t.location) : '';
    const plan = t.plan || planFor(n);
    const lastAnn = (t.announcements || []).slice(-1)[0];
    const champBox = champ ? `<div class="relative overflow-hidden rounded-3xl p-5 text-center border-2 border-amber-300" style="background:radial-gradient(circle at 50% 30%, rgba(250,204,21,.35), rgba(0,0,0,.6));box-shadow:0 0 30px rgba(250,204,21,.35)">
            <div class="text-[11px] font-black tracking-[0.3em] text-amber-200">CHAMPIONS</div>
            <div class="flex flex-col items-center mt-1 mb-3"><span class="text-3xl leading-none -mb-1 relative z-10">👑</span>${teamLogoHtml(champ, 84)}</div>
            <div class="text-2xl font-black">${esc(champ.name)}</div>
            <div class="text-sm text-amber-100 mt-1">🏆 ${esc(t.name)}</div></div>` : '';
    // next game for my team
    const myNext = myIn.map(x => (t.matches || []).find(m => !m.done && (m.a === x.teamId || m.b === x.teamId))).filter(Boolean)[0];
    const info = `<div class="space-y-3">
        ${stepsHtml(t)}
        <div class="text-[12px] text-center text-white/75">${esc(STEP_NOTE[t.status] || '')}</div>
        ${champBox}
        ${lastAnn ? `<div class="bg-amber-400/10 border border-amber-400/40 rounded-2xl p-3"><div class="text-[10px] font-black uppercase tracking-wider text-amber-300">📣 Latest update · ${esc(new Date(lastAnn.at).toLocaleDateString([], { month: 'short', day: 'numeric' }))}</div><div class="text-xs text-white/90 mt-1 whitespace-pre-line">${smartText(lastAnn.text)}</div></div>` : ''}
        ${myNext && ['set', 'running'].includes(t.status) ? `<div class="bg-[#00F296]/10 border border-[#00F296]/40 rounded-2xl p-3 text-xs"><b>Your next game:</b> ${esc(matchLabel(myNext))} vs ${esc(nameOf(t, myNext.a === myIn[0].teamId ? myNext.b : myNext.a) || 'TBD')} · ${esc(shortDate(myNext.date))} ${esc(prettyTime(myNext.time))}${myNext.place ? ' · ' + esc(myNext.place) : ''}</div>` : ''}
        <div class="bg-black/40 border border-white/10 rounded-2xl p-3 text-xs space-y-2">
            <div class="flex items-start gap-2"><i class="fa-solid fa-calendar text-[#00F296] w-4 mt-0.5"></i><div class="space-y-1">${daysOf(t).map(d => `<div><b>${esc(dayLine(d))}</b>${d.label ? `<div class="text-amber-200">${esc(d.label)}</div>` : ''}</div>`).join('')}${['signup', 'draw', 'waiting'].includes(t.status) ? '<div class="text-[10px] text-white/45">Rough plan, subject to change. Exact game times come after the draw.</div>' : ''}</div></div>
            <div class="flex items-center gap-2"><i class="fa-solid fa-location-dot text-[#00F296] w-4"></i>${esc(t.location || '')}</div>
            <div class="flex items-center gap-2"><i class="fa-solid fa-users text-[#00F296] w-4"></i>${esc(t.format || '')} · ${min === max ? max : `${min} to ${max}`} teams · ${n} registered</div>
            <div class="flex items-center gap-2"><i class="fa-solid fa-user-group text-[#00F296] w-4"></i>${+t.minPlayers || 1}–${+t.maxPlayers || 30} players per team</div>
            <div class="flex items-center gap-2"><i class="fa-solid fa-circle-dollar-to-slot text-[#00F296] w-4"></i>${+t.priceCents ? `${money(t.priceCents)} per team` : 'Free'}</div>
            ${t.communityId ? `<div class="flex items-center gap-2"><i class="fa-solid fa-people-roof text-[#00F296] w-4"></i>${esc(t.communityName || 'Community')}</div>` : ''}
            <div class="flex items-start gap-2"><i class="fa-solid fa-sitemap text-[#00F296] w-4 mt-0.5"></i><span>${t.status === 'signup' ? `${n >= 2 ? `With ${n} teams: ${esc(PLAN_TEXT[planFor(n)])}` : 'The format comes from how many teams register (4 = knockout, 6 = 2 groups of 3, 8 = quarter-finals).'}` : esc(PLAN_TEXT[plan])}</span></div>
        </div>
        ${(t.prizes || []).length ? `<button onclick="ttTab('prizes')" class="w-full bg-amber-400/10 border border-amber-400/40 rounded-2xl p-3 text-left text-xs"><b class="text-amber-200">🎁 Prizes:</b> ${t.prizes.map(p => esc(p.place) + ' ' + esc(p.prize)).join(' · ')}</button>` : ''}
        ${t.description ? `<div class="bg-black/40 border border-white/10 rounded-2xl p-3"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">Details & rules</div><p class="text-xs text-white/85 whitespace-pre-line">${esc(t.description)}</p></div>` : ''}
        ${canRegister(t) && !(myCaptainTeams().length && myCaptainTeams().every(y => (t.teamIds || []).includes(y.id))) ? `<button onclick="ttRegisterTeam('${jsq(t.id)}')" class="${GOLDBTN} w-full py-3 text-sm">📝 Register your team</button>` : ''}
        ${t.status === 'signup' && n >= max ? '<p class="text-xs text-center text-amber-300 font-bold">Registration is full.</p>' : ''}
        <div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-2xl p-3"><div class="text-[9px] font-bold text-white/55 uppercase">Organized by</div><div class="text-sm font-black">${esc(t.organizerName || 'Organizer')}</div></div>
    </div>`;
    const teams = `<div class="space-y-2">${(t.teams || []).map(x => { const r = rosterOf(x); const mine = myIn.some(y => y.teamId === x.teamId); return `<div class="bg-black/40 border ${mine ? 'border-[#00F296]/50' : 'border-white/10'} rounded-2xl p-3 space-y-2">
            <div class="flex items-center gap-3">
                <button onclick="window.openTeam && openTeam('${jsq(x.teamId)}')" class="shrink-0">${teamLogoHtml(x, 40)}</button>
                <div class="flex-1 min-w-0"><div class="text-sm font-black truncate">${esc(x.name)}${t.championId === x.teamId ? ' 🏆' : ''}</div>
                    <div class="text-[11px] text-white/55">${r.length} players${x.joinedByName ? ' · captain ' + esc(x.joinedByName) : ''}${+t.priceCents ? ` · <span class="${x.paid ? 'text-[#00F296]' : 'text-amber-300'}">${x.paid ? 'Paid' : 'Not paid yet'}</span>` : ''}</div></div>
                ${boss && +t.priceCents ? `<button onclick="toggleTourneyPaid('${jsq(x.teamId)}')" class="${x.paid ? DARK : BTN} shrink-0">${x.paid ? 'Undo paid' : '💵 Paid'}</button>` : ''}
            </div>
            ${r.length ? `<div class="flex flex-wrap gap-1">${r.map(p => `<span class="text-[10px] font-bold rounded-full px-2 py-1 bg-white/10">${p.number ? esc(p.number) + ' · ' : ''}${esc(p.name || 'Player')}${p.uid && window.badgeHtml ? window.badgeHtml(p.uid) : ''}</span>`).join('')}</div>` : ''}
            ${(mine || boss) && t.status !== 'final' ? `<div class="flex gap-2">${mine ? `<button onclick="openTourneyPlayers('${jsq(x.teamId)}', false)" class="${DARK}">👥 Change players</button>` : ''}
                ${t.status === 'signup' ? `<button onclick="leaveTourney('${jsq(x.teamId)}')" class="text-[11px] font-bold text-red-400 px-2">${mine ? 'Leave' : 'Remove'}</button>` : ''}</div>` : ''}
        </div>`; }).join('') || '<p class="text-xs text-white/45 text-center py-6">No teams yet. Share it so captains can register!</p>'}
        ${t.status === 'signup' ? `<p class="text-[11px] text-white/50 text-center">${n} of ${max} teams${n < min ? ` · needs at least ${min}` : ''}</p>` : ''}</div>`;
    const ms = t.matches || [];
    const bracket = !ms.length ? `<p class="text-xs text-white/50 text-center py-6">The bracket shows here after the draw.${t.status === 'signup' ? ' Registration is still open.' : ''}</p>` : `<div class="space-y-4">
        ${t.status === 'draw' ? `<div class="text-[11px] text-center text-amber-200 font-bold">🎲 Draw preview${boss ? ': redraw or confirm it in Admin.' : ': not final yet.'}</div>` : ''}
        ${boss && canScore(t) && t.status !== 'final' ? '<p class="text-[11px] text-white/55">Tap a game to enter its score. The next round fills in by itself.</p>' : ''}
        ${plan === 'league' ? `${tableHtml(t, 'league', '', 'League table', 2)}<div class="space-y-2">${ms.filter(m => m.stage === 'league').map(m => matchRow(t, m, boss)).join('')}</div>` : ''}
        ${plan === 'groups' ? ['A', 'B'].map(g => `${tableHtml(t, 'group', g, `Group ${g}`, 1)}<div class="space-y-2">${ms.filter(m => m.stage === 'group' && m.group === g).map(m => matchRow(t, m, boss)).join('')}</div>`).join('') : ''}
        ${['qf', 'sf', 'final'].filter(s => ms.some(m => m.stage === s)).map(s => `<div class="space-y-2"><div class="text-[10px] font-black uppercase tracking-wider ${s === 'final' ? 'text-amber-300' : 'text-white/55'}">${s === 'qf' ? 'Quarter-finals' : s === 'sf' ? 'Semi-finals' : 'Final'}</div>${ms.filter(m => m.stage === s).map(m => matchRow(t, m, boss)).join('')}</div>`).join('')}
        ${scorersHtml(t)}
    </div>`;
    const chat = `<div class="space-y-3">
        <div class="space-y-2 max-h-[55vh] overflow-y-auto" id="tt-chat-list">${(TT.chat || []).map(c => `<div class="flex gap-2 ${c.uid === myUid() ? 'flex-row-reverse text-right' : ''}">
            <img src="${esc(c.avatar || DEFAULT_AV)}" onerror="this.src='${DEFAULT_AV}'" class="w-7 h-7 rounded-full object-cover shrink-0">
            <div class="max-w-[78%] ${c.uid === myUid() ? 'bg-[#00F296]/15 border-[#00F296]/30' : 'bg-black/50 border-white/10'} border rounded-2xl px-3 py-2">
                <div class="text-[10px] font-black ${c.uid === t.organizerId ? 'text-amber-300' : 'text-white/60'}">${esc(c.name || 'Player')}${c.uid === t.organizerId ? ' · organizer' : ''}${window.badgeHtml ? window.badgeHtml(c.uid) : ''}</div>
                <div class="text-xs text-white/90 whitespace-pre-wrap break-words text-left">${smartText(c.text)}</div>
                <div class="text-[9px] text-white/35">${esc(new Date(c.at || 0).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</div></div></div>`).join('') || '<p class="text-xs text-white/45 text-center py-6">No messages yet. Say hi to the other teams!</p>'}</div>
        ${myUid() ? `<div class="flex gap-2"><input id="tt-chat-in" class="${INPUT}" maxlength="1000" placeholder="${iPlay || boss ? 'Message everyone in the tournament…' : 'Ask the organizer a question…'}" onkeydown="if(event.key==='Enter')sendTourneyChat()"><button onclick="sendTourneyChat()" class="${BTN} shrink-0"><i class="fa-solid fa-paper-plane"></i></button></div>` : ''}
    </div>`;
    const prizes = `<div class="space-y-2">${(t.prizes || []).map(p => `<div class="flex items-center gap-3 bg-amber-400/10 border border-amber-400/40 rounded-2xl p-3"><div class="text-sm font-black text-amber-200 w-20 shrink-0">${esc(p.place)}</div><div class="text-sm font-bold">${esc(p.prize)}</div></div>`).join('') || '<p class="text-xs text-white/45 text-center py-6">No prizes listed yet.</p>'}
        ${t.prizeNote ? `<p class="text-[11px] text-white/60">${esc(t.prizeNote)}</p>` : ''}
        ${boss ? `<button onclick="openTourneyPrizes()" class="${GOLDBTN} w-full py-3">🎁 Edit prizes</button>` : ''}</div>`;
    const nextStep = {
        signup: `<button onclick="tourneyDraw(false)" class="${GOLDBTN} w-full py-3 text-sm">🎲 Close registration & do the draw</button><p class="text-[11px] text-white/55">${n} of ${max} teams registered${n < min ? ` (you wanted at least ${min})` : ''}. The format: ${n >= 2 ? esc(PLAN_TEXT[planFor(n)]) : 'needs 2+ teams'}</p>`,
        draw: `<button onclick="tourneyConfirmDraw()" class="${GOLDBTN} w-full py-3 text-sm">✅ Confirm the draw (tell everyone)</button><div class="grid grid-cols-2 gap-2"><button onclick="tourneyDraw(true)" class="${DARK} py-2.5">🎲 Redraw</button><button onclick="tourneyReopen()" class="${DARK} py-2.5">↩️ Reopen registration</button></div>`,
        waiting: `<button onclick="openTourneyTimes()" class="${GOLDBTN} w-full py-3 text-sm">📅 Set the game times</button><p class="text-[11px] text-white/55">They're filled in from your timeline; change anything, then publish.</p>`,
        set: `<button onclick="ttTab('bracket')" class="${GOLDBTN} w-full py-3 text-sm">⚽ Enter scores (Bracket)</button><button onclick="openTourneyTimes()" class="${DARK} w-full py-2.5">📅 Change game times</button>`,
        running: `<button onclick="ttTab('bracket')" class="${GOLDBTN} w-full py-3 text-sm">⚽ Enter scores (Bracket)</button><button onclick="openTourneyTimes()" class="${DARK} w-full py-2.5">📅 Change game times</button>`,
        final: '<p class="text-xs text-center text-amber-200 font-bold">🏆 Tournament finished.</p>',
    }[t.status] || '';
    const admin = `<div class="space-y-3">
        ${stepsHtml(t)}
        <div class="bg-amber-400/10 border border-amber-400/40 rounded-2xl p-3 space-y-2"><div class="text-[10px] font-black uppercase tracking-wider text-amber-300">Next step</div>${nextStep}</div>
        <div class="grid grid-cols-2 gap-2">
            <button onclick="openTourneyAnnounce()" class="${DARK} py-3">📣 Send update</button>
            <button onclick="openTourneyPrizes()" class="${DARK} py-3">🎁 Prizes</button>
            ${['signup', 'draw', 'waiting'].includes(t.status) ? `<button onclick="openCreateTourney(window.__tourneyState.open)" class="${DARK} py-3">✏️ Edit details</button>` : ''}
            <button onclick="shareTourney()" class="${DARK} py-3">📤 Share</button>
            ${t.status !== 'final' ? `<button onclick="cancelTourney()" class="${DARK} py-3 text-red-400">❌ Cancel</button>` : ''}
        </div>
        ${+t.priceCents ? `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 text-xs"><b>Payments:</b> ${(t.teams || []).filter(x => x.paid).length} of ${n} paid · ${money((t.teams || []).filter(x => x.paid).length * t.priceCents)} collected. Mark payments in the Teams tab.</div>` : ''}
        ${(t.announcements || []).length ? `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-1.5"><div class="text-[10px] font-black uppercase tracking-wider text-white/55">Updates sent</div>${t.announcements.slice().reverse().map(a => `<div class="text-[11px] text-white/75"><span class="text-white/45">${esc(new Date(a.at).toLocaleDateString([], { month: 'short', day: 'numeric' }))}:</span> ${esc(a.text)}</div>`).join('')}</div>` : ''}
    </div>`;
    const showPrizes = (t.prizes || []).length || boss;
    el.innerHTML = `<div class="max-w-4xl mx-auto w-full px-4 pt-3 pb-24 space-y-3">
        <div class="bg-[#040E13]/90 backdrop-blur-md border-2 border-emerald-500/30 px-5 py-3.5 rounded-3xl shadow-lg flex items-center justify-between gap-3">
            <button onclick="closeTourney()" aria-label="Back" class="w-9 h-9 bg-black/60 hover:bg-black text-white rounded-full flex items-center justify-center border border-white/20 shrink-0"><i class="fa-solid fa-chevron-left text-xs"></i></button>
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2"><h2 class="text-base font-black tracking-tight truncate">${esc(t.name || 'Tournament')}</h2>
                    <span class="px-2.5 py-0.5 bg-amber-400/20 text-amber-200 font-black text-[9px] rounded-full uppercase tracking-wider border border-amber-400/50 shrink-0">${esc(STEPS[stepIndex(t.status)][2] + ' ' + STEPS[stepIndex(t.status)][1])}</span></div>
                <p class="text-xs text-white/60 truncate mt-0.5"><i class="fa-solid fa-location-dot text-[#00F296] mr-1"></i>${esc(t.location || '')}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noopener" aria-label="Navigate" class="w-9 h-9 bg-[#00F296] text-slate-950 rounded-full flex items-center justify-center"><i class="fa-solid fa-location-arrow text-xs"></i></a>` : ''}
                <button onclick="shareTourney()" aria-label="Share" class="w-9 h-9 bg-[#00F296] text-slate-950 rounded-full flex items-center justify-center"><i class="fa-solid fa-share-nodes text-xs"></i></button>
            </div>
        </div>
        <div data-scroll-hint class="bg-black/40 border-2 border-emerald-500/30 p-1.5 rounded-2xl flex items-center space-x-1 overflow-x-auto shadow-md backdrop-blur-md">
            ${boss ? tabBtn('admin', '⚙️ Admin') : ''}${tabBtn('info', 'Info')}${tabBtn('teams', `Teams (${n}/${max})`)}${tabBtn('bracket', '🏆 Bracket')}${tabBtn('chat', '💬 Chat')}${showPrizes ? tabBtn('prizes', '🎁 Prizes') : ''}
        </div>
        <div class="bg-[#040E13]/95 border-2 border-emerald-500/30 rounded-3xl p-4 shadow-2xl">
            ${tab === 'admin' ? admin : tab === 'teams' ? teams : tab === 'bracket' ? bracket : tab === 'chat' ? chat : tab === 'prizes' ? prizes : info}
        </div>
    </div>`;
    if (tab === 'chat') { const l = document.getElementById('tt-chat-list'); if (l) l.scrollTop = l.scrollHeight; }
}
window.tourneyCardHtml = tourneyCardHtml;
window.tourneyMatchCardHtml = tourneyMatchCardHtml;

// Links: futnet.site/#tourney=ID (&tab=chat) open the tournament (notifications and shared links).
(function openFromLink() {
    const h = window.location.hash + '&' + window.location.search;
    const m = h.match(/[#&?]tourney=([^&/]+)/); if (!m) return;
    const id = decodeURIComponent(m[1]);
    const tab = (h.match(/[#&?]tab=(info|teams|bracket|chat|prizes|admin)\b/) || [])[1];
    let tries = 0;
    const go = () => { if (myUid() || tries++ > 20) window.openTourney(id, null, tab); else setTimeout(go, 500); };
    go();
})();
