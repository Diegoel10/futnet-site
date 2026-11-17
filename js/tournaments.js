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
//     days: [{ date, time, until, label }], date, time (first day, for lists), prizes: [{ place, prize, auto? }], prizeNote,
//     prizeCash (true/false) + prizeCents ($ for the champion), trophy (true/false) + trophyPhoto (optional picture),
//       set when creating / editing; they also fill in the 🥇 1st prize line (auto: true) unless the organizer wrote their own.
//     organizerId, organizerName, status, plan, teams: [{ teamId, name, short, logo, colors, paid, joinedBy, joinedAt,
//     roster: [{ id, name, number, uid, position }] }], teamIds, participantUids, matches, championId, announcements }
//   match = { id, key, stage, group, a, b, aFrom, bFrom, ga, gb, pens, goals: [{ teamId, name, uid, own }], done, date, time, place }
//   Each match with a time shows in the Games list as its own gold event (everyone sees it). Tapping it opens the
//   match page: the two teams + players, the result and goals, and comments (chat messages with matchId).
//   From the tournament's Day 2 on, its days show a "Resumed" banner (registration closed, stats, comments).
// This file loads after the page is ready, so it never slows down opening the app.
import { db, appId } from './firebase-config.js';
import { doc, getDoc, setDoc, collection, onSnapshot, runTransaction, serverTimestamp, addDoc, query, orderBy, limit, where } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { teamLogoHtml, canManage } from './teams.js';
import { smartText } from './smart-text.js';
import { attachParkPicker, saveParkIfNew } from './parks.js';
import { watchLive, liveStatsHtml } from './live-stats.js';   // 📊 who watched (same as games)
import { liveSource, liveLinkProblem, liveSlotHtml, liveButtonsHtml, liveEndedHtml, withReplay, registerLiveChat, liveVisPickerHtml, liveVisValue, liveCanWatch, liveLockedHtml, liveVisBossHtml } from './livestream.js';   // same player as games / VS

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
        if (MP.tid && document.getElementById('tt-match')) { drawMatchPage(true); window.liveFullRefresh && window.liveFullRefresh(); }
    }, () => {});
}
let started = '';
setInterval(() => { const u = myUid(); if (u && started !== u) { started = u; start(); } if (!u && started) { started = ''; if (TT.unsub) TT.unsub(); TT.list = []; } }, 1500);

// ---------------------------------------------------------------- the format, from how many teams are in
const STAGE = { league: 'League', group: 'Group', qf: 'Quarter-final', sf: 'Semi-final', final: 'Final' };
export function planFor(n, fmt = 'auto') {
    if (n <= 2) return 'final';
    // the organizer's pick (when it works with this many teams)
    if (fmt === 'league') return 'league';
    if (fmt === 'knockout' && (n === 4 || n === 8)) return n === 4 ? 'ko4' : 'ko8';
    if (fmt === 'groups' && n >= 6) return 'groups';
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
/** The organizer picked a format that doesn't work with n teams: what we do instead (or ''). */
export function planNote(n, fmt) {
    if (n <= 2 || !fmt || fmt === 'auto' || fmt === 'league') return '';
    if (fmt === 'knockout' && n !== 4 && n !== 8) return `Knockout needs 4 or 8 teams. With ${n} teams: ${PLAN_TEXT[planFor(n)]}`;
    if (fmt === 'groups' && n < 6) return `Groups need 6+ teams. With ${n} teams: ${PLAN_TEXT[planFor(n)]}`;
    return '';
}
export const FMT_TEXT = { auto: '✨ Best for the number of teams', knockout: '⚔️ Knockout', groups: '👥 Groups, then a Final', league: '🔁 League (everyone plays everyone)' };

// ---------------------------------------------------------------- ⏱️ format & timing (asked when the tournament is created)
//   t.rules = { fmt, halves, len (minutes per half or per game), half (halftime), gap (break between games), late (minutes a team can be late),
//               forfeit ('3-0'), fields (games at once), fieldNames [], rest (min rest between a team's games), check (check-in before the 1st game),
//               lunch ('12:00' or ''), lunchLen, koTie ('pens' | 'et' | 'golden'), kicks (3 | 5), longer (extra minutes for semis / final), awards }
export const RULE_DEF = { fmt: 'auto', halves: false, len: 25, half: 5, gap: 5, late: 10, forfeit: '3-0', fields: 1, fieldNames: [], rest: 0, check: 15, lunch: '', lunchLen: 30, koTie: 'pens', kicks: 5, longer: 0, awards: 15 };
export const rulesOf = (t) => ({ ...RULE_DEF, ...((t && t.rules) || {}) });
/** How long one game takes (minutes), halftime included. */
export const gameMins = (r, m) => (r.halves ? r.len * 2 + r.half : r.len) + (m && ['sf', 'final'].includes(m.stage) ? (+r.longer || 0) : 0);
const toMin = (hm) => { if (!hm || !String(hm).includes(':')) return null; const [h, mm] = String(hm).split(':').map(Number); return isNaN(h) ? null : h * 60 + (mm || 0); };
const toHM = (x) => `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(Math.round(x) % 60).padStart(2, '0')}`;
export const fieldName = (r, i) => ((r.fieldNames || [])[i] || '').trim() || ((+r.fields || 1) > 1 ? `Field ${i + 1}` : '');
/**
 * Gives every game a day, a time and a field: each round on its planned day (assignDays), then the games of a day
 * fill the fields one after another, with the break between games, a team's rest, the lunch break, and a later round
 * waiting for the games it depends on. keep = keep times already set. Returns { days: [{ date, start, end, until, n }] }.
 */
export function scheduleMatches(t, keep = false) {
    const r = rulesOf(t);
    const had = new Set((t.matches || []).filter(m => m.date && m.time).map(m => m.id));   // times set before (kept when keep = true)
    assignDays(t);
    const byDay = {};
    (t.matches || []).forEach(m => { if (m.date) (byDay[m.date] = byDay[m.date] || []).push(m); });
    const out = [];
    Object.keys(byDay).sort().forEach(date => {
        const list = byDay[date], day = daysOf(t).find(d => d.date === date) || {};
        const start = toMin(day.time || t.time) ?? 9 * 60;
        const nf = Math.max(1, Math.min(4, +r.fields || 1));
        const free = Array(nf).fill(start), teamFree = {};
        const lunchA = toMin(r.lunch), lunchB = lunchA === null ? null : lunchA + (+r.lunchLen || 0);
        let lastEnd = start, roundEnd = {}, end = start;
        const ORDER = ['league', 'group', 'qf', 'sf', 'final'];
        list.forEach(m => {
            const dur = gameMins(r, m);
            if (keep && had.has(m.id) && toMin(m.time) !== null) { const s0 = toMin(m.time); end = Math.max(end, s0 + dur); roundEnd[m.stage] = Math.max(roundEnd[m.stage] || 0, s0 + dur); return; }
            // a later round waits for every game of the rounds before it (that day)
            let earliest = Math.max(0, ...ORDER.slice(0, ORDER.indexOf(m.stage)).map(st => (roundEnd[st] || 0) + (+r.gap || 0)));
            [m.a, m.b].filter(Boolean).forEach(id => { if (teamFree[id] !== undefined) earliest = Math.max(earliest, teamFree[id] + Math.max(+r.gap || 0, +r.rest || 0)); });
            let f = 0; for (let i = 1; i < nf; i++) if (free[i] < free[f]) f = i;
            let s0 = Math.max(free[f], earliest);
            if (lunchA !== null && s0 < lunchB && s0 + dur > lunchA) s0 = lunchB;
            const e0 = s0 + dur;
            m.time = toHM(s0); m.field = fieldName(r, f);
            free[f] = e0 + (+r.gap || 0);
            [m.a, m.b].filter(Boolean).forEach(id => { teamFree[id] = e0; });
            roundEnd[m.stage] = Math.max(roundEnd[m.stage] || 0, e0);
            lastEnd = Math.max(lastEnd, e0); end = Math.max(end, e0);
        });
        const hasFinal = list.some(m => m.stage === 'final');
        out.push({ date, start, end: end + (hasFinal ? (+r.awards || 0) : 0), until: toMin(day.until), n: list.length, awards: hasFinal && +r.awards ? end : null });
    });
    return { days: out };
}
/** The proposed schedule with n teams (made-up "Team 1…"), for the create screen and the Info tab. */
export function previewSchedule(t, n) {
    const ids = Array.from({ length: n }, (_, i) => `T${i + 1}`);
    const r = rulesOf(t), b = buildMatches(ids, r.fmt, true);
    const tmp = { ...t, matches: b.matches, teams: ids.map((id, i) => ({ teamId: id, name: `Team ${i + 1}` })) };
    const sum = scheduleMatches(tmp);
    return { plan: b.plan, matches: tmp.matches, teams: tmp.teams, ...sum };
}
const minsText = (x) => x >= 60 ? `${Math.floor(x / 60)}h${x % 60 ? ' ' + (x % 60) + 'm' : ''}` : `${x} min`;
/** "📅 With 4 teams: 3 games…" + the games by day (short). */
export function previewHtml(t, n, title) {
    if (n < 2) return '';
    const p = previewSchedule(t, n), r = rulesOf(t), note = planNote(n, r.fmt);
    const tm = (id) => (p.teams.find(x => x.teamId === id) || {}).name;
    const row = (m) => `<div class="flex items-center gap-2 text-[11px]"><span class="w-16 shrink-0 font-black text-amber-200">${esc(prettyTime(m.time))}</span><span class="flex-1 min-w-0 truncate">${esc(matchLabel(m))}: ${esc(tm(m.a) || fromLabel(m.aFrom))} vs ${esc(tm(m.b) || fromLabel(m.bFrom))}</span>${m.field ? `<span class="shrink-0 text-[10px] text-white/50">${esc(m.field)}</span>` : ''}</div>`;
    return `<div class="bg-black/40 border border-amber-400/40 rounded-2xl p-3 space-y-2">
        <div class="text-[11px] font-black uppercase tracking-wider text-amber-300">${title || `📅 Planned schedule with ${n} teams`}</div>
        <div class="text-[11px] text-white/80">${esc(PLAN_TEXT[p.plan])} ${p.matches.length} game${p.matches.length === 1 ? '' : 's'}, ${minsText(gameMins(r))} each${r.halves ? ` (2 × ${r.len} + ${r.half} halftime)` : ''}.</div>
        ${note ? `<div class="text-[11px] text-amber-200">⚠️ ${esc(note)}</div>` : ''}
        ${p.days.map(d => `<div class="space-y-1 pt-1 border-t border-white/10">
            <div class="text-[10px] font-black text-white/60">${esc(prettyDate(d.date) || 'Day')}${+r.check ? ` · check-in ${esc(prettyTime(toHM(d.start - r.check)))}` : ''}</div>
            ${p.matches.filter(m => m.date === d.date).map(row).join('')}
            ${d.awards ? `<div class="flex items-center gap-2 text-[11px]"><span class="w-16 shrink-0 font-black text-amber-200">${esc(prettyTime(toHM(d.awards)))}</span><span>🏆 Awards</span></div>` : ''}
            <div class="text-[10px] ${d.until !== null && d.end > d.until ? 'text-red-400 font-bold' : 'text-white/50'}">Done around ${esc(prettyTime(toHM(d.end)))}${d.until !== null && d.end > d.until ? ` · past your end time (${esc(prettyTime(toHM(d.until)))}). Add a field, shorten games or add a day.` : ''}</div></div>`).join('')}
        <div class="text-[10px] text-white/45">If more teams sign up, the format and times change at the draw. You can edit any game after.</div>
    </div>`;
}
/** The rules everyone sees (Info tab). */
export function rulesHtml(t) {
    if (!t.rules) return '';
    const r = rulesOf(t), names = (r.fieldNames || []).filter(Boolean);
    const tie = r.koTie === 'et' ? 'extra time, then penalties' : r.koTie === 'golden' ? 'golden goal' : 'straight to penalties';
    const li = (ic, txt) => `<div class="flex items-start gap-2"><span class="w-4 shrink-0">${ic}</span><span>${txt}</span></div>`;
    return `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 text-xs space-y-1.5"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">⏱️ Format & timing</div>
        ${li('🏆', esc(FMT_TEXT[r.fmt] || FMT_TEXT.auto))}
        ${li('⏱️', r.halves ? `2 halves of ${r.len} min, ${r.half} min halftime` : `One ${r.len}-minute game`)}${+r.longer ? li('➕', `Semi-finals and Final: ${r.longer} min longer`) : ''}
        ${li('☕', `${r.gap} min between games${+r.rest ? ` · at least ${r.rest} min rest for a team` : ''}`)}
        ${li('🏟️', `${r.fields} game${r.fields > 1 ? 's' : ''} at once${names.length ? ': ' + names.map(esc).join(', ') : ''}`)}
        ${+r.check ? li('📋', `Check in ${r.check} min before your first game`) : ''}
        ${li('⏰', `${+r.late ? `Up to ${r.late} min late allowed.` : 'Be on time.'} After that it's a forfeit (${esc(r.forfeit)})`)}
        ${li('🎯', `Knockout draws: ${tie}${r.koTie !== 'golden' ? ` (${r.kicks} kicks)` : ''}`)}
        ${r.lunch ? li('🍔', `Lunch break at ${esc(prettyTime(r.lunch))} (${r.lunchLen} min)`) : ''}
    </div>`;
}
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
export function buildMatches(teamIds, fmt = 'auto', noShuffle = false) {
    const ids = noShuffle ? teamIds.slice() : shuffle(teamIds), n = ids.length, plan = planFor(n, fmt);
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
const placeOf = (t, m) => ((m && m.place) || t.location || '') + (m && m.field ? ` · ${m.field}` : '');
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
    return `<div onclick="openTourneyMatch('${jsq(t.id)}', '${jsq(m.id)}')" class="relative rounded-2xl overflow-hidden shadow-xl border-[1.6px] border-amber-400 cursor-pointer p-4 space-y-3" style="background:linear-gradient(160deg,rgba(250,204,21,.18),rgba(1,10,15,.95) 55%)">
        <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 border border-amber-400/70 text-amber-200 text-[10px] font-black">${TROPHY(13)}<span>${esc(matchLabel(m).toUpperCase())}</span></div>
            ${(m.livestream && m.livestream.status === 'live') || matchIsLive(m) ? `<span class="shrink-0 bg-red-600 text-white text-[10px] font-black px-2 py-1 rounded-lg">● LIVE${m.livestream && m.livestream.status === 'live' ? ' 🎥' : ''}</span>` : ''}
            <span class="text-[10px] font-bold text-white/60 truncate">${esc(t.name)}</span>
        </div>
        <div class="flex items-center justify-center gap-3">
            ${side(A, m.aFrom)}
            <div class="text-center shrink-0">${m.done ? `<div class="text-2xl font-black font-mono text-amber-200">${m.ga} - ${m.gb}</div><div class="text-[9px] font-black text-white/50">FINAL${m.pens ? ' (pens)' : ''}</div>` : matchIsLive(m) ? `<div class="text-2xl font-black font-mono text-white">${liveGoals(m, m.a)} - ${liveGoals(m, m.b)}</div><div class="text-[9px] font-black text-red-400">● PLAYING NOW</div>` : `<div class="text-lg font-black text-amber-300">VS</div><div class="text-[10px] font-bold text-white/70">${esc(prettyTime(m.time || t.time))}</div>`}</div>
            ${side(B, m.bFrom)}
        </div>
        <div class="flex items-center justify-between text-[10px] font-bold text-white/70 border-t border-white/10 pt-2">
            <span class="truncate"><i class="fa-solid fa-location-dot text-amber-300 mr-1"></i>${esc(placeOf(t, m))}</span>
            <span class="shrink-0 text-amber-200/80">${m.done ? 'Result · rosters · comments' : 'Rosters · comments'}</span>
        </div>
    </div>`;
}
/** The tournament flyer (Games list). big = a full poster (empty days, planned days); else a slim gold banner on busy days.
 *  Tapping it opens the tournament; "Register your team" goes straight into registering (or making a team first). */
// Registration closes by itself: at t.regClose ("YYYY-MM-DD HH:MM", the organizer picks it), or else the day the
// tournament starts (also checked on the server: tourneyGuard).
export const regCloseOf = (t) => t.regClose || ((daysOf(t)[0] || {}).date ? `${daysOf(t)[0].date} 00:00` : '');
const nowKey = () => { const d = new Date(); return `${ymdToday()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const regOver = (t) => { const c = regCloseOf(t); return !!c && nowKey() >= c; };
const regCloseText = (t) => { const c = t.regClose; if (!c) return 'the day it starts'; const [d, hm] = c.split(' '); return `${new Date(d + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}${hm ? ', ' + prettyTime(hm) : ''}`; };
const canRegister = (t) => t.status === 'signup' && (t.teams || []).length < maxTeamsOf(t) && !regOver(t);
function flyerHtml(t, big) {
    const n = (t.teams || []).length, max = maxTeamsOf(t);
    const step = STEPS[stepIndex(t.status)];
    const cta = canRegister(t)
        ? `<button onclick="event.stopPropagation(); ttRegisterTeam('${jsq(t.id)}')" class="shrink-0 font-black rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 ${big ? 'text-sm px-4 py-3 w-full' : 'text-[11px] px-3 py-2'} shadow-[0_0_14px_rgba(250,204,21,.45)]">📝 Register your team</button>`
        : `<span class="shrink-0 font-black rounded-xl bg-black/60 border border-amber-400/70 text-amber-200 ${big ? 'text-sm px-4 py-3 w-full text-center' : 'text-[11px] px-3 py-2'}">${t.status === 'signup' ? (regOver(t) ? 'Registration closed · View' : 'Full · View') : `${step[2]} ${step[1]} · View`}</span>`;
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
            ${t.status === 'signup' && !regOver(t) ? `<div class="text-[10px] text-white/55">${max - n > 0 ? `${max - n} spot${max - n === 1 ? '' : 's'} left` : 'Full'} · ${+t.minPlayers || 1}–${+t.maxPlayers || 30} players per team${t.requirePay ? ' · must pay to be confirmed' : ''}${t.regClose ? ` · registration closes ${esc(regCloseText(t))}` : ''} · times subject to change</div>` : ''}
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
        const items = [], tops = [], shown = new Set();
        live.forEach(t => {
            const ms = ['set', 'running', 'final'].includes(t.status) ? (t.matches || []).filter(m => m.date === day) : [];
            const dayIdx = daysOf(t).findIndex(d => d.date === day);
            const isLater = dayIdx >= 1 || (dayIdx < 0 && ms.length && day > (daysOf(t)[0].date || ''));
            // Day 1: the tournament banner; Day 2 on: "Resumed" (registration closed, stats, comments). Then the day's matches.
            const top = (ms.length || dayIdx >= 0) ? (isLater ? resumedHtml(t, day) : flyerHtml(t, !ms.length)) : '';
            if (ms.length) { ms.forEach(m => items.push({ k: m.time || t.time || '', html: tourneyMatchCardHtml(t, m) })); }
            if (top) tops.push(top);   // drawn above the day's matches
            if (top || ms.length) shown.add(t.id);
        });
        items.sort((a, b) => String(b.k).localeCompare(String(a.k)));
        const in45 = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
        const promo = live.filter(t => !shown.has(t.id) && t.status !== 'final' && day >= ymdToday() && day <= lastDayOf(t) && (daysOf(t)[0].date || '') <= in45)
            .sort((a, b) => String(daysOf(a)[0].date).localeCompare(String(daysOf(b)[0].date)));
        const empty = !!grid.querySelector('.fa-calendar-xmark');
        if (empty) {
            if (items.length || tops.length) { grid.innerHTML = tops.join('') + items.map(x => x.html).join(''); return; }
            if (promo.length) grid.innerHTML = `<div class="col-span-full text-center py-2"><div class="text-sm font-black text-white">No games today</div><div class="text-xs text-amber-200 font-bold">…but check out this tournament 🏆</div></div>` + flyerHtml(promo[0], true);
            return;
        }
        items.forEach(x => grid.insertAdjacentHTML('afterbegin', x.html));
        tops.slice().reverse().forEach(h => grid.insertAdjacentHTML('afterbegin', h));
        if (promo.length) grid.insertAdjacentHTML('afterbegin', flyerHtml(promo[0]));
    };
    w._tt = true; w._vs = orig._vs; window.renderEvents = w;
}
setTimeout(wrapEvents, 0); setTimeout(wrapEvents, 2000);
window.__ttWrap = wrapEvents;

/** Day 2 on: "🏆 Name · Day 2 · Resumed" (no registering), how it's going, and quick links to the stats and comments. */
function resumedHtml(t, day) {
    const days = daysOf(t), n = Math.max(1, days.findIndex(d => d.date === day) + 1) || days.length;
    const ms = (t.matches || []), done = ms.filter(m => m.done), goals = done.reduce((a, m) => a + (+m.ga || 0) + (+m.gb || 0), 0);
    const sc = {};
    ms.forEach(m => (m.goals || []).forEach(g => { if (!g.own && g.name) { const k = g.uid || g.name; sc[k] = sc[k] || { name: g.name, n: 0 }; sc[k].n++; } }));
    const top = Object.values(sc).sort((a, b) => b.n - a.n)[0];
    const champ = t.championId ? teamOf(t, t.championId) : null;
    return `<div class="col-span-full relative rounded-2xl overflow-hidden border-[1.6px] border-amber-400 shadow-xl p-3.5 space-y-2.5" style="background:linear-gradient(120deg,rgba(250,204,21,.22),rgba(1,10,15,.94) 60%)">
        <div class="flex items-center gap-2.5 cursor-pointer" onclick="openTourney('${jsq(t.id)}', null, 'bracket')">
            <div class="shrink-0">${TROPHY(28)}</div>
            <div class="flex-1 min-w-0"><div class="text-sm font-black text-white truncate">${esc(t.name)}</div>
                <div class="text-[10px] font-bold text-white/65 truncate">${esc(t.park || t.location || '')} · registration closed</div></div>
            <span class="shrink-0 text-[10px] font-black px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950">DAY ${n} · ${t.status === 'final' ? 'DONE' : 'RESUMED'}</span>
        </div>
        <div class="text-[11px] text-amber-100/90 font-bold">${champ ? `🏆 Champions: ${esc(champ.name)} · ` : ''}${done.length}/${ms.length} games played · ⚽ ${goals} goal${goals === 1 ? '' : 's'}${top ? ` · 👟 ${esc(top.name)} (${top.n})` : ''}</div>
        <div class="grid grid-cols-2 gap-2">
            <button onclick="openTourney('${jsq(t.id)}', null, 'bracket')" class="py-2 rounded-xl bg-black/60 border border-amber-400/60 text-amber-200 text-[11px] font-black">📊 Stats & bracket</button>
            <button onclick="openTourney('${jsq(t.id)}', null, 'chat')" class="py-2 rounded-xl bg-black/60 border border-white/15 text-white text-[11px] font-black">💬 Comments</button>
        </div></div>`;
}

// ---------------------------------------------------------------- 🏟️ one match: teams + players, result, comments (everyone)
const MP = { tid: '', mid: '', unsub: null, msgs: [] };
/** The tournament being worked on: the open game page's (on top) or the open tournament page's. */
function cur() {
    if (TT.over) return TT.over;
    if (MP.tid && document.getElementById('tt-match')) return TT.list.find(x => x.id === MP.tid) || (TT.open && TT.open.id === MP.tid ? TT.open : null) || TT.open;
    return TT.open;
}
window.openTourneyMatch = function (tid, mid) {
    const t = TT.list.find(x => x.id === tid) || (TT.open && TT.open.id === tid ? TT.open : null);
    if (!t) { window.openTourney(tid, null, 'bracket'); return; }
    if (MP.unsub) MP.unsub();
    MP.tid = tid; MP.mid = mid; MP.msgs = [];
    // comments on this match: the tournament chat, only the messages for this match (no index needed: sorted here)
    MP.unsub = onSnapshot(query(collection(db, 'artifacts', appId, 'tournaments', tid, 'chat'), where('matchId', '==', mid)), s => {
        MP.msgs = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (+a.at || 0) - (+b.at || 0));
        drawMatchPage(true);
        window.liveFullRefresh && window.liveFullRefresh();
    }, () => {});
    const m = document.createElement('div');
    m.id = 'tt-match';
    m.className = 'fixed inset-0 z-[175] bg-[#040E13] text-white overflow-y-auto';
    document.getElementById('tt-match')?.remove();
    document.body.appendChild(m);
    drawMatchPage();
};
window.closeTourneyMatch = () => { if (window.liveIsFull && window.liveIsFull()) window.liveFullClose(); if (MP.unsub) MP.unsub(); MP.unsub = null; MP.tid = ''; document.getElementById('tt-match')?.remove(); };
function drawMatchPage(keepInput) {
    const el = document.getElementById('tt-match'); if (!el) return;
    const t = TT.list.find(x => x.id === MP.tid) || TT.open; if (!t) return;
    const m = (t.matches || []).find(x => x.id === MP.mid); if (!m) return;
    const typed = keepInput ? (document.getElementById('tm-in') || {}).value || '' : '';
    const A = teamOf(t, m.a), B = teamOf(t, m.b), boss = t.organizerId === myUid();
    const side = (X, ref) => X ? `<div class="flex flex-col items-center gap-1.5 min-w-0 flex-1">${teamLogoHtml(X, 60)}<span class="text-sm font-black text-center leading-tight">${esc(X.name)}</span></div>`
        : `<div class="flex flex-col items-center gap-1.5 flex-1"><div class="w-[60px] h-[60px] rounded-2xl border-2 border-dashed border-amber-300/60 flex items-center justify-center text-amber-200 text-2xl">?</div><span class="text-[11px] font-bold text-white/55 text-center">${esc(fromLabel(ref))}</span></div>`;
    const goalsOf = (id) => (m.goals || []).filter(g => g.teamId === id).map(g => `<div>⚽ ${esc(g.name || 'Goal')}${g.own ? ' <span class="text-white/45">(own goal)</span>' : ''}</div>`).join('');
    const roster = (X) => !X ? '<p class="text-[11px] text-white/45">Not decided yet.</p>' : ((X.roster || []).length
        ? (X.roster || []).map(p => `<div class="flex items-center gap-2 py-1"><span class="w-6 text-right text-[11px] font-black text-amber-300 font-mono">${esc(p.number ?? '')}</span><span class="text-xs font-bold truncate">${esc(p.name || 'Player')}</span>${p.position ? `<span class="text-[9px] text-white/45 font-bold">${esc(p.position)}</span>` : ''}</div>`).join('')
        : '<p class="text-[11px] text-white/45">No players listed yet.</p>');
    const when = [m.date ? new Date(m.date + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '', prettyTime(m.time)].filter(Boolean).join(' · ');
    const live = matchLiveHtml(t, m, boss);
    el.innerHTML = `<div class="max-w-xl mx-auto p-4 pb-28 space-y-4">
        <div class="flex items-center gap-3">
            <button onclick="closeTourneyMatch()" class="w-10 h-10 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-arrow-left"></i></button>
            <div class="flex-1 min-w-0"><div class="text-[10px] font-black uppercase tracking-wider text-amber-300 flex items-center gap-1">${TROPHY(12)} ${esc(matchLabel(m))}</div>
                <div class="text-sm font-black truncate">${esc(t.name)}</div></div>
            <button onclick="closeTourneyMatch(); openTourney('${jsq(t.id)}', null, 'bracket')" class="text-[11px] font-black px-3 py-2 rounded-xl bg-black/60 border border-amber-400/60 text-amber-200">📊 Tournament</button>
        </div>
        ${live}
        <div class="rounded-3xl border-[1.6px] border-amber-400 p-4 space-y-3" style="background:linear-gradient(160deg,rgba(250,204,21,.18),rgba(1,10,15,.95) 55%)">
            <div class="flex items-center gap-3">${side(A, m.aFrom)}
                <div class="text-center shrink-0">${m.done ? `<div class="text-4xl font-black font-mono text-amber-200">${m.ga} - ${m.gb}</div><div class="text-[10px] font-black text-white/55">FINAL${m.pens ? ` · pens: ${esc(nameOf(t, m.pens))}` : ''}</div>`
                    : m.clock ? `<div class="text-4xl font-black font-mono text-white">${liveGoals(m, m.a)} - ${liveGoals(m, m.b)}</div>${clockHtml(t, m)}`
                    : `<div class="text-2xl font-black text-amber-300">VS</div><div class="text-[11px] font-bold text-white/70">${esc(prettyTime(m.time || t.time))}</div>`}</div>
                ${side(B, m.bFrom)}</div>
            ${(m.goals || []).length ? `<div class="grid grid-cols-2 gap-3 text-[11px] font-bold text-white/85 border-t border-white/10 pt-2"><div>${goalsOf(m.a)}</div><div class="text-right">${goalsOf(m.b)}</div></div>` : ''}
            <div class="text-[11px] font-bold text-white/65 text-center"><i class="fa-solid fa-location-dot text-amber-300 mr-1"></i>${esc(placeOf(t, m))}${when ? ` · ${esc(when)}` : ''}</div>
        </div>
        ${boss && m.a && m.b ? matchAdminHtml(t, m) : ''}
        <div class="grid grid-cols-2 gap-3">
            ${[A, B].map((X, i) => `<div class="bg-black/45 border border-white/10 rounded-2xl p-3"><div class="text-[10px] font-black uppercase tracking-wider text-amber-300 mb-1 truncate">${esc(X ? X.name : (i ? fromLabel(m.bFrom) : fromLabel(m.aFrom)))}</div>${roster(X)}</div>`).join('')}
        </div>
        <div class="bg-black/45 border border-white/10 rounded-2xl p-3 space-y-3">
            <div class="text-[10px] font-black uppercase tracking-wider text-amber-300">💬 Comments</div>
            ${window.liveIsFull && window.liveIsFull() ? '<p class="text-center text-xs text-white/50 py-4">💬 The chat is open in full screen.</p>' : matchCommentsHtml()}
        </div></div>`;
    const inp = document.getElementById('tm-in'); if (inp && typed) inp.value = typed;
}
// ---------------------------------------------------------------- ⏱️ live clock + organizer tools on a tournament game (like VS)
//   m.clock = { period: 1 | 2, acc: ms played before runAt, runAt: ms (0 = stopped), ht: halftime, ft: full time }
const liveGoals = (m, id) => (m.goals || []).filter(g => g.teamId === id).length;
const clockMs = (c) => (c ? (+c.acc || 0) + (c.runAt ? Date.now() - c.runAt : 0) : 0);
const mmss = (ms) => { const s0 = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s0 / 60)).padStart(2, '0')}:${String(s0 % 60).padStart(2, '0')}`; };
export const matchIsLive = (m) => !!(m && m.clock && !m.done && !m.clock.ft);
function clockHtml(t, m) {
    const c = m.clock, r = rulesOf(t);
    const label = c.ft ? 'FULL TIME' : c.ht ? 'HALFTIME' : !c.runAt ? 'PAUSED' : r.halves ? (c.period === 2 ? '2ND HALF' : '1ST HALF') : 'LIVE';
    return `<div class="text-lg font-black font-mono ${c.runAt ? 'text-[#00F296]' : 'text-white/60'}" data-ttclock data-acc="${+c.acc || 0}" data-run="${+c.runAt || 0}">${mmss(clockMs(c))}</div>
        <div class="text-[10px] font-black ${c.runAt ? 'text-red-400' : 'text-white/55'}">${c.runAt ? '● ' : ''}${label}</div>`;
}
setInterval(() => document.querySelectorAll('[data-ttclock]').forEach(el => { const run = +el.dataset.run; if (run) el.textContent = mmss(+el.dataset.acc + Date.now() - run); }), 1000);
function matchAdminHtml(t, m) {
    const r = rulesOf(t), c = m.clock, A = teamOf(t, m.a), B = teamOf(t, m.b);
    const tile = (ic, label, on, style = '') => `<button onclick="${on}" class="min-h-[64px] rounded-xl ${style || 'bg-black/60 border border-white/15 text-white'} flex flex-col items-center justify-center gap-1 px-1 py-2"><span class="text-lg leading-none">${ic}</span><span class="text-[11px] font-black leading-tight text-center">${label}</span></button>`;
    const btn = (label, act, cls = DARK) => `<button onclick="ttClock('${act}')" class="${cls} flex-1 py-2.5">${label}</button>`;
    let clock = '';
    if (!m.done && t.status !== 'cancelled') {
        if (!c) clock = `<button onclick="ttClock('start')" class="${GOLDBTN} w-full py-3 text-sm">▶️ Kick off (start the clock)</button>`;
        else if (!c.ft) {
            const goal = (X, id) => `<button onclick="ttLiveGoal('${jsq(id)}')" class="flex-1 bg-[#00F296]/15 text-[#00F296] border border-[#00F296]/50 font-black py-2.5 rounded-xl text-xs truncate px-2">⚽ Goal ${esc(X ? X.name : '')}</button>`;
            clock = `<div class="flex gap-2">${goal(A, m.a)}${goal(B, m.b)}</div>
                <div class="flex gap-2">${c.ht ? btn('▶️ Start 2nd half', 'second', GOLDBTN) : c.runAt ? btn('⏸ Pause', 'pause') + (r.halves && c.period !== 2 ? btn('🔔 Halftime', 'ht') : btn('🏁 Full time', 'ft', GOLDBTN))
                    : btn('▶️ Resume', 'resume', GOLDBTN) + (r.halves && c.period !== 2 ? btn('🔔 Halftime', 'ht') : btn('🏁 Full time', 'ft'))}</div>
                ${(m.goals || []).length ? `<button onclick="ttLiveUndo()" class="text-[11px] font-bold text-white/60 w-full">↩️ Undo last goal</button>` : ''}`;
        }
    }
    const ls = m.livestream;
    return `<div class="bg-black/45 border border-amber-400/40 rounded-2xl p-3 space-y-3">
        <div class="text-[10px] font-black uppercase tracking-wider text-amber-300">⚙️ Organizer tools</div>
        ${clock}
        <div class="grid grid-cols-3 gap-2">
            ${tile('✏️', m.done ? 'Fix score' : c ? 'Final score' : 'Enter score', `openTourneyScore('${jsq(m.id)}')`, m.done ? '' : c && c.ft ? 'bg-amber-400 text-slate-950' : '')}
            ${tile('📅', 'Time & field', `openTourneyWhen('${jsq(m.id)}')`)}
            ${A ? tile('👥', `${esc(A.name)} players`, `openTourneyPlayers('${jsq(m.a)}', false)`) : ''}
            ${B ? tile('👥', `${esc(B.name)} players`, `openTourneyPlayers('${jsq(m.b)}', false)`) : ''}
            ${tile('⚔️', 'Game day card', 'ttPregameCard()')}
            ${m.done ? tile('📸', 'Result cards', 'ttResultCards()') : ''}
            ${!ls || !lsKeyOf(ls) ? (!m.done ? tile('🔴', 'Go live', 'openMatchLivestream()', 'bg-red-600 text-white') : '') : ''}
            ${c && !m.done ? tile('🔄', 'Reset clock', "ttClock('reset')") : ''}
        </div>
        <p class="text-[10px] text-white/45">${r.halves ? `${r.len} min halves` : `${r.len} min game`}${+r.late ? ` · ${r.late} min late allowed, then ${esc(r.forfeit)}` : ''}. 👥 players: change the roster or add fill-ins / subs.</p>
    </div>`;
}
window.ttClock = async function (act) {
    if (act === 'reset' && !confirm('Reset the clock? The goals stay.')) return;
    const tid = MP.tid, mid = MP.mid, now = Date.now();
    try {
        await change(tid, (t) => {
            const m = t.matches.find(x => x.id === mid); if (!m) return false;
            const c = { ...(m.clock || {}) }, stop = () => { if (c.runAt) { c.acc = (+c.acc || 0) + now - c.runAt; c.runAt = 0; } };
            if (act === 'start') { m.clock = { period: 1, acc: 0, runAt: now }; if (t.status === 'set') t.status = 'running'; return; }
            if (act === 'reset') { delete m.clock; return; }
            if (act === 'pause') stop();
            else if (act === 'resume') c.runAt = now;
            else if (act === 'ht') { stop(); c.ht = true; }
            else if (act === 'second') { c.ht = false; c.period = 2; c.acc = rulesOf(t).len * 60000; c.runAt = now; }
            else if (act === 'ft') { stop(); c.ft = true; }
            m.clock = c;
        });
        if (act === 'ft') setTimeout(() => window.openTourneyScore(mid), 300);   // confirm the final score
    } catch (e) { toast("Couldn't change the clock.", 'error'); }
};
/** ⚽ Goal while the game is on: pick the scorer, it's saved right away (the game isn't finished yet). */
window.ttLiveGoal = function (teamId) {
    const t = cur(); const m = t && (t.matches || []).find(x => x.id === MP.mid); if (!m) return;
    window._ttMatch = m.id; window._ttGoals = (m.goals || []).map(g => ({ ...g }));
    window._ttDraw = async () => {
        const goals = window._ttGoals.slice();
        try { await change(t.id, (x) => { const y = x.matches.find(z => z.id === m.id); if (!y || y.done) return false; y.goals = goals; }); toast('⚽ Goal!'); }
        catch (e) { toast("Couldn't save the goal.", 'error'); }
    };
    window.ttGoalPick(teamId);
};
window.ttLiveUndo = async function () {
    const tid = MP.tid, mid = MP.mid;
    try { await change(tid, (t) => { const m = t.matches.find(x => x.id === mid); if (!m || m.done || !(m.goals || []).length) return false; m.goals = m.goals.slice(0, -1); }); }
    catch (e) { toast("Couldn't undo it.", 'error'); }
};
// ⚔️ / 📸 share cards (same images as VS)
const ttSpice = (t) => (t.cardSpice === 'spicy' || t.cardSpice === 'friendly') ? t.cardSpice : 'friendly';
function ttCardOpts(t, caption) {
    return { spice: ttSpice(t), canSpice: isTTBoss(t), onSpice: async (v) => { await change(t.id, (x) => { x.cardSpice = v; }); t.cardSpice = v; },
        share: { eventId: 'tt_' + t.id, communityId: t.communityId || '', caption, postComments: (files, cap) => postMatchFiles(t.id, MP.mid, files, cap) } };
}
async function postMatchFiles(tid, mid, files, caption) {
    const { uploadMedia, showUploadProgress, hideUploadProgress } = await import('./wa-chat.js');
    try {
        for (let k = 0; k < files.length; k++) {
            const label = `Sending image ${k + 1} of ${files.length}…`;
            showUploadProgress(label, 0);
            const media = await uploadMedia(files[k], `comments/tt_${tid}`, (p) => showUploadProgress(label, p));
            await addDoc(collection(db, 'artifacts', appId, 'tournaments', tid, 'chat'), { text: (k === 0 && caption ? caption : '📷 Photo').slice(0, 1000), media, uid: myUid(), name: myName(), avatar: myAvatar(), at: Date.now(), matchId: mid || '' });
        }
    } finally { hideUploadProgress(); }
}
const cardInfo = (t, m) => ({ title: `${t.name} · ${matchLabel(m)}`, date: m.date ? prettyDate(m.date) : '', time: m.time ? prettyTime(m.time) : '', location: placeOf(t, m), format: t.format || '' });
const cardPlayers = (X) => rosterOf(X).filter(p => p.name).slice(0, 15).map(p => ({ name: p.name, avatar: p.avatar || (p.uid && window.personAvatar ? window.personAvatar(p.uid, '', p.name) : ''), captain: !!(X.joinedBy && p.uid === X.joinedBy) }));
window.ttPregameCard = async function () {
    const t = cur(); const m = t && (t.matches || []).find(x => x.id === MP.mid); if (!m) return;
    const A = teamOf(t, m.a), B = teamOf(t, m.b); if (!A || !B) { toast('Both teams have to be decided first.', 'error'); return; }
    try {
        const { openVsCards } = await import('./vs-cards.js');
        const side = (X) => ({ team: X, name: X.name, color: (X.colors || {}).primary || '', sub: '', players: cardPlayers(X) });
        const go = (d) => openVsCards(d);
        await go({ pregame: { teams: [side(A), side(B)] }, info: cardInfo(t, m), title: '⚔️ Game day card', subtitle: 'Hype the game: share it before kickoff.', reopen: go,
            ...ttCardOpts(t, `⚔️ ${A.name} vs ${B.name} · ${matchLabel(m)}`) });
    } catch (e) { console.error(e); toast("Couldn't make the card.", 'error'); }
};
window.ttResultCards = async function () {
    const t = cur(); const m = t && (t.matches || []).find(x => x.id === MP.mid); if (!m || !m.done) return;
    try {
        const { openVsCards } = await import('./vs-cards.js');
        const scorersOf = (id) => { const c = {}; (m.goals || []).filter(g => g.teamId === id && g.name && !g.own).forEach(g => { c[g.name] = c[g.name] || { teamId: id, name: g.name, n: 0 }; c[g.name].n++; }); return Object.values(c).sort((a, b) => b.n - a.n); };
        const side = (id, gf, ga) => { const X = teamOf(t, id) || { teamId: id, name: 'Team' }; return { ...X, gf, ga, scorers: scorersOf(id), players: cardPlayers(X) }; };
        const w = winnerOf(m);
        const o = !w ? { draw: true, pair: [side(m.a, m.ga, m.gb), side(m.b, m.gb, m.ga)] }
            : { winner: side(w, w === m.a ? m.ga : m.gb, w === m.a ? m.gb : m.ga), loser: side(w === m.a ? m.b : m.a, w === m.a ? m.gb : m.ga, w === m.a ? m.ga : m.gb) };
        const kit = (id) => ((teamOf(t, id) || {}).colors || {}).primary || '#9ca3af';
        const scorers = []; [m.a, m.b].forEach(id => scorersOf(id).forEach(s0 => scorers.push({ name: s0.name, avatar: '', team: nameOf(t, id), kit: kit(id), n: s0.n })));
        const go = (d) => openVsCards(d);
        await go({ ...o, scorers: scorers.sort((a, b) => b.n - a.n), ownGoals: [], info: cardInfo(t, m), reopen: go,
            ...ttCardOpts(t, `🏆 ${t.name} · ${matchLabel(m)}: ${nameOf(t, m.a)} ${m.ga} - ${m.gb} ${nameOf(t, m.b)}`) });
    } catch (e) { console.error(e); toast("Couldn't make the cards.", 'error'); }
};
function matchCommentsHtml() {
    return `<div class="space-y-2" id="tm-list">${MP.msgs.map(c => `<div class="flex gap-2 ${c.uid === myUid() ? 'flex-row-reverse text-right' : ''}">
                <img src="${esc(c.avatar || DEFAULT_AV)}" class="w-7 h-7 rounded-full object-cover bg-white/10 shrink-0" alt="" onerror="this.onerror=null;this.src='${DEFAULT_AV}'">
                <div class="max-w-[80%] rounded-2xl px-3 py-2 ${c.uid === myUid() ? 'bg-amber-400/20' : 'bg-white/10'}"><div class="text-[10px] font-black text-white/60">${esc(c.name || 'Player')}</div>${c.media && c.media.url ? `<img src="${esc(c.media.url)}" onclick="window.open('${esc(jsq(c.media.url))}','_blank')" class="mt-1 rounded-xl max-h-60 cursor-pointer" alt="">` : ''}<div class="text-xs whitespace-pre-wrap break-words">${esc(c.media && c.media.url && /^📷/.test(c.text || '') ? '' : c.text || '')}</div></div></div>`).join('') || '<p class="text-[11px] text-white/45 text-center py-2">No comments yet. Say something! ⚽</p>'}</div>
            ${myUid() ? `<div class="flex gap-2"><input id="tm-in" class="${INPUT}" maxlength="1000" placeholder="Comment on this match…" onkeydown="if(event.key==='Enter')sendMatchComment()"><button onclick="sendMatchComment()" class="${BTN} shrink-0"><i class="fa-solid fa-paper-plane"></i></button></div>` : ''}`;
}
registerLiveChat('tt', { chat: () => `<div class="p-2 space-y-3">${matchCommentsHtml()}</div>`, inputId: 'tm-in', redraw: () => drawMatchPage(true) });

// ---------------------------------------------------------------- 🔴 livestream a match (same as games and VS)
//   m.livestream = { url, provider: 'xbotgo'|'youtube'|'facebook', videoId, embedUrl, status: 'live'|'ended', startedAt, startedBy, startedByName }
//   Only the organizer starts / ends it. Everyone in the tournament gets "🔴 LIVE now" (server).
const lsKeyOf = (ls) => (ls && (ls.videoId || ls.embedUrl)) || '';
function matchLiveHtml(t, m, boss) {
    const ls = m.livestream;
    if (!ls || !lsKeyOf(ls)) {
        return '';   // 🔴 "Go live" is in the organizer tools
    }
    const on = ls.status === 'live';
    const xbEnded = ls.provider === 'xbotgo' && !on;
    const canWatch = liveCanWatch(ls, boss);
    if (!xbEnded && canWatch) setTimeout(() => { if (window.mountLivePlayer) window.mountLivePlayer(); }, 0);
    // 📊 viewers: counted like a game's (stored under eventsList/tt_<tournament>_<match>/liveViews)
    const statsEv = { id: `tt_${t.id}_${m.id}`, livestream: ls, comments: MP.msgs.map(c => ({ uid: c.uid, createdAt: +c.at || 0 })) };
    if (canWatch) setTimeout(() => watchLive(statsEv), 0);
    return `<div class="space-y-3">
        <div class="flex items-center gap-2">${on ? '<span class="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">● LIVE</span>' : '<span class="bg-white/10 text-white/80 text-[10px] font-black px-2 py-0.5 rounded-full">▶ REPLAY</span>'}
            <span class="flex-1 text-xs text-white/60 truncate">${on ? `Streaming now · ${esc(ls.startedByName || '')}` : 'The livestream has ended. Watch the replay.'}</span>
            <a href="${esc(ls.url || `https://youtu.be/${ls.videoId}`)}" target="_blank" rel="noopener" class="text-[10px] font-black text-white/70 underline shrink-0">Open in ${ls.provider === 'facebook' ? 'Facebook' : ls.provider === 'xbotgo' ? 'XbotGo' : 'YouTube'}</a></div>
        ${boss ? liveVisBossHtml(ls, 'tt', false, 'setMatchLiveVis') : ''}
        ${!canWatch ? liveLockedHtml(ls, 'tt') : xbEnded ? liveEndedHtml(boss, 'addMatchReplay()') : liveSlotHtml(ls) + liveButtonsHtml(ls, 'tt')}
        ${boss ? `<div class="flex gap-2">${on ? '<button onclick="endMatchLivestream()" class="flex-1 bg-red-600 text-white font-black text-xs py-2.5 rounded-xl">End livestream</button>'
            : '<button onclick="openMatchLivestream()" class="flex-1 bg-red-600 text-white font-black text-xs py-2.5 rounded-xl">Start a new livestream</button><button onclick="removeMatchLivestream()" class="flex-1 bg-black/60 border border-white/15 text-white font-black text-xs py-2.5 rounded-xl">Remove video</button>'}</div>` : ''}
        ${boss ? liveStatsHtml(statsEv) : ''}
    </div>`;
}
/** Change this match's livestream (organizer). fn(old) returns the new one (null = remove). */
async function setMatchLive(fn) {
    const tid = MP.tid, mid = MP.mid;
    await change(tid, (t) => {
        const m = t.matches.find(x => x.id === mid); if (!m) return false;
        const next = fn(m.livestream || null);
        if (next === undefined) return false;
        if (next) m.livestream = next; else delete m.livestream;
    });
}
window.openMatchLivestream = function () {
    sheet('tt-ls', '🔴 Livestream this match', `
        <ol class="text-[11px] text-white/70 space-y-1 list-decimal pl-4">
            <li><b>XbotGo:</b> start the live in the XbotGo app and copy its watch link (cloud.xbotgo.net/live?userId=…). We remember it for next time.</li>
            <li><b>YouTube / Facebook:</b> open the live video, tap <b>Share → Copy link</b>. On Facebook, set it to <b>Public</b>.</li>
            <li>Paste it here.</li></ol>
        <input id="tls-url" type="url" inputmode="url" class="${INPUT}" placeholder="XbotGo, YouTube or Facebook live link" value="${esc(window.liveLastLink ? window.liveLastLink() : '')}">
        ${liveVisPickerHtml('tls-vis', 'tt', false)}
        <button onclick="startMatchLivestream()" class="w-full bg-red-600 text-white font-black py-3 rounded-xl text-sm">Go live</button>`);
};
window.startMatchLivestream = async function () {
    const url = String(document.getElementById('tls-url')?.value || '').trim(); const src = liveSource(url);
    if (!src) { toast(liveLinkProblem(url), 'error'); return; }
    window.liveRememberLink && window.liveRememberLink(url, src);
    try {
        const vis = liveVisValue('tls-vis');
        await setMatchLive(() => ({ url, ...src, status: 'live', startedAt: Date.now(), startedBy: myUid(), startedByName: myName(), visibility: vis }));
        document.getElementById('tt-ls')?.remove(); toast("You're live! 🔴 Everyone in the tournament was notified.");
    } catch (e) { toast("Couldn't start the livestream.", 'error'); }
};
window.endMatchLivestream = async function () {
    if (!confirm("End the livestream?\n\nYouTube / Facebook: the video stays on the match as a replay.\nXbotGo: add the recording's YouTube link afterwards (🎬 Add the replay video).")) return;
    try { await setMatchLive((old) => (old ? { ...old, status: 'ended', endedAt: Date.now() } : undefined)); } catch (e) { toast("Couldn't end it.", 'error'); }
};
window.removeMatchLivestream = async function () {
    if (!confirm('Remove the video from this match?')) return;
    try { await setMatchLive(() => null); } catch (e) { toast("Couldn't remove it.", 'error'); }
};
window.setMatchLiveVis = async function (v) {
    try { await setMatchLive((old) => (old ? { ...old, visibility: v } : undefined)); toast('Saved.'); } catch (e) { toast("Couldn't save it.", 'error'); }
};
window.addMatchReplay = function () {
    window.openAddReplay('', async (url) => {
        try { await setMatchLive((old) => withReplay(old, url) || undefined); return true; }
        catch (e) { toast("Couldn't save it.", 'error'); return false; }
    });
};
window.sendMatchComment = async function () {
    const box = document.getElementById('tm-in'); const text = String(box && box.value || '').trim(); if (!text || !MP.tid) return;
    box.value = '';
    try { await addDoc(collection(db, 'artifacts', appId, 'tournaments', MP.tid, 'chat'), { text: text.slice(0, 1000), uid: myUid(), name: myName(), avatar: myAvatar(), at: Date.now(), matchId: MP.mid }); }
    catch (e) { box.value = text; toast("Couldn't send it.", 'error'); }
};

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

// ---------------------------------------------------------------- create / edit (2 pages)
// Page 1: the basics (name, start date + time, park, format, teams, players, fee, "must pay to be confirmed").
// Page 2: the proposed schedule, subject to change: Day 1, then a big "+ Add Day 2" button, and so on (up to 6 days).
const F = { pre: {}, step: 1, basics: {}, days: [] };
window.openCreateTourney = function (pre = {}) {
    if (!myUid()) return;
    F.pre = pre || {};
    F.step = 1;
    F.basics = {};
    F.dayOpen = -1;
    // 🥈 2nd, 🥉 3rd… prizes (the 1st one is the champion box: cash / trophy)
    F.extraPrizes = (pre.prizes || []).filter(p => !p.auto && !/1st/.test(p.place || '')).map(p => ({ place: p.place || '', prize: p.prize || '' }));
    F.trophyFile = null; F.trophyPreview = ''; F.trophyCleared = false;
    F.days = (pre.days || []).length ? daysOf(pre).map(d => ({ ...d })) : [];
    F.rules = { ...rulesOf(pre), fieldNames: [...(rulesOf(pre).fieldNames || [])] };
    drawCreate();
};
function drawCreate() {
    const pre = F.pre, b = F.basics, editing = !!pre.id;
    const v = (k, d = '') => b[k] !== undefined ? b[k] : (pre[k] !== undefined ? pre[k] : d);
    const title = editing ? '✏️ Edit tournament' : `${TROPHY(22)} Create Tournament`;
    const dots = `<div class="flex items-center justify-center gap-2 text-[10px] font-black">
        <span class="px-2.5 py-1 rounded-full ${F.step === 1 ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-white/60'}">1 · Basics</span>
        <span class="text-white/30">›</span>
        <span class="px-2.5 py-1 rounded-full ${F.step === 2 ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-white/60'}">2 · Format</span>
        <span class="text-white/30">›</span>
        <span class="px-2.5 py-1 rounded-full ${F.step === 3 ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-white/60'}">3 · Days</span></div>`;
    if (F.step === 1) {
        const roles = window.myCommunityRoles || {}, cache = window.communitiesCache || {};
        const comms = Object.keys(roles).filter(id => roles[id] === 'admin' && cache[id]);
        const per = String(v('format', '8v8')).split('v')[0];
        const payOn = v('requirePay', false) === true;
        sheet('tt-create', title, `${dots}
            <div>${LBL('Name *')}<input id="tt-name" class="${INPUT}" maxlength="50" value="${esc(v('name'))}" placeholder="e.g. Sabal Pines Winter Cup"></div>
            <div class="grid grid-cols-[1fr_120px] gap-3">
                <div class="min-w-0">${LBL('Starting date *')}<input id="tt-start-date" type="date" class="${INPUT}" value="${esc(v('date'))}"></div>
                <div class="min-w-0">${LBL('Starting time *')}<input id="tt-start-time" type="time" class="${INPUT} !px-2" value="${esc(v('time'))}"></div>
            </div>
            <div>${LBL('Park / field *')}<div><input id="tt-park" class="${INPUT}" maxlength="60" value="${esc(v('park'))}" placeholder="Start typing a park name"></div></div>
            <div class="grid grid-cols-[1fr_96px] gap-3">
                <div class="min-w-0">${LBL('City *')}<input id="tt-city" class="${INPUT}" maxlength="40" value="${esc(v('city'))}" placeholder="Coral Springs"></div>
                <div class="min-w-0">${LBL('State')}<input id="tt-state" class="${INPUT}" maxlength="20" value="${esc(v('state', 'FL'))}" placeholder="FL"></div>
            </div>
            <div>${LBL('Format')}${seg('tt-format', ['5v5', '6v6', '7v7', '8v8', '9v9', '11v11'].map(x => [x, x]), v('format', '8v8'))}</div>
            <div class="grid grid-cols-2 gap-3">
                <div>${LBL('Min teams')}${numSel('tt-minteams', 2, 8, v('minTeams', 4))}</div>
                <div>${LBL('Max teams')}${numSel('tt-maxteams', 2, 8, v('maxTeams', 8))}</div>
            </div>
            <p class="text-[10px] text-white/50 -mt-2">Want exactly 4? Put 4 and 4. You pick the format on the next page.</p>
            <div class="grid grid-cols-2 gap-3">
                <div>${LBL('Min players per team')}${numSel('tt-minpl', 1, 30, v('minPlayers', +per || 7))}</div>
                <div>${LBL('Max players per team')}${numSel('tt-maxpl', 1, 30, v('maxPlayers', (+per || 7) + 5))}</div>
            </div>
            <div>${LBL('Entry fee per team ($, 0 = free)')}<input id="tt-price" inputmode="decimal" class="${INPUT}" value="${esc(b.price !== undefined ? b.price : (pre.priceCents ? pre.priceCents / 100 : ''))}" placeholder="0" oninput="ttCostShow()"></div>
            ${costBoxHtml()}
            <label class="flex items-center gap-3 bg-black/40 border ${payOn ? 'border-amber-400/70' : 'border-white/10'} rounded-2xl p-3 cursor-pointer">
                <div class="flex-1"><div class="text-sm font-black">💵 Must pay to be confirmed</div><div class="text-[11px] text-white/55">Teams show as "Pending payment" until you mark them paid. Only paid teams go into the draw.</div></div>
                <input id="tt-reqpay" type="checkbox" class="w-6 h-6 accent-amber-400" ${payOn ? 'checked' : ''}>
            </label>
            ${prizeFormHtml(v)}
            ${regCloseFormHtml(v)}
            ${comms.length ? `<div>${LBL('🏘️ Post in a community (optional)')}<select id="tt-comm" class="${INPUT}"><option value="">No community</option>${comms.map(id => `<option value="${esc(id)}" ${v('communityId') === id ? 'selected' : ''}>${esc(cache[id].name || 'Community')}</option>`).join('')}</select></div>` : ''}
            <div>${LBL('Description / rules')}<textarea id="tt-desc" rows="3" maxlength="800" class="${INPUT}" placeholder="e.g. 25-minute games. Bring light and dark shirts.">${esc(v('description'))}</textarea></div>
            <button onclick="ttCreateNext()" class="${GOLDBTN} w-full py-3.5 text-sm">Next: format & timing ›</button>`);
        // same park list as games and VS: suggestions while typing, fills the city / state (parks.js)
        setTimeout(() => attachParkPicker({ input: 'tt-park', city: 'tt-city', state: 'tt-state' }), 0);
        return;
    }
    if (F.step === 2) { drawFormatStep(title, dots); return; }
    // page 3: the proposed days
    if (!F.days.length) F.days = [{ date: b.date, time: b.time, until: '', label: '' }];
    const dayCard = (d, i) => `<div class="relative bg-black/45 border-2 ${i === 0 ? 'border-amber-400/70' : 'border-white/15'} rounded-3xl p-4 space-y-3">
        <div class="flex items-center justify-between"><div class="text-base font-black text-amber-200">Day ${i + 1}</div>
            ${i > 0 ? `<button onclick="ttDayRemove(${i})" class="text-[11px] font-bold text-red-400">Remove</button>` : ''}</div>
        <div>${LBL('Date')}<input type="date" class="${INPUT}" value="${esc(d.date || '')}" oninput="ttDaySet(${i},'date',this.value)"></div>
        <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0">${LBL('Starts')}<input type="time" class="${INPUT} !px-2" value="${esc(d.time || '')}" oninput="ttDaySet(${i},'time',this.value)"></div>
            <div class="min-w-0">${LBL('Ends')}<input type="time" class="${INPUT} !px-2" value="${esc(d.until || '')}" oninput="ttDaySet(${i},'until',this.value)"></div>
        </div>
        <div>${LBL('What happens (pick all that apply)')}
            <details class="rounded-xl bg-black/50 border border-white/15" ${F.dayOpen === i ? 'open' : ''}>
                <summary class="cursor-pointer px-3 py-2.5 text-sm font-bold flex items-center justify-between gap-2"><span class="truncate ${dayTypesOf(d).length ? 'text-amber-200' : 'text-white/50'}">${dayTypesOf(d).length ? esc(dayLabelOf(dayTypesOf(d), dayTypesOf(d).includes('other') ? d.other : '') || '✏️ Other') : 'Pick what happens…'}</span><i class="fa-solid fa-chevron-down text-[10px] text-white/50"></i></summary>
                <div class="px-2 pb-2 space-y-0.5">${DAY_TYPES.map(([k, l]) => { const on = dayTypesOf(d).includes(k); return `<label class="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer ${on ? 'bg-amber-400/15' : ''}"><input type="checkbox" ${on ? 'checked' : ''} onchange="ttDayType(${i},'${k}')" class="w-5 h-5 accent-amber-400"><span class="text-sm font-bold">${l}</span></label>`; }).join('')}</div>
            </details>
            ${dayTypesOf(d).includes('other') ? `<input class="${INPUT} mt-2" maxlength="40" value="${esc(d.other || '')}" oninput="ttDaySet(${i},'other',this.value)" placeholder="Type what happens">` : ''}</div>
    </div>`;
    sheet('tt-create', title, `${dots}
        <div class="text-center"><div class="text-lg font-black">📅 Proposed schedule</div><div class="text-[11px] text-white/55">Subject to change. The exact game times are set after the draw.</div></div>
        ${F.days.map(dayCard).join('')}
        ${F.days.length < 6 ? `<button onclick="ttDayAdd()" class="w-full py-5 rounded-3xl border-2 border-dashed border-amber-400 bg-amber-400/10 hover:bg-amber-400/20 text-amber-200 text-lg font-black">＋ Add Day ${F.days.length + 1}</button>` : ''}
        <div id="tt-preview3">${previewHtml(previewT(), F.basics.minTeams || 4, `📅 Your schedule with ${F.basics.minTeams || 4} teams (your minimum)`)}</div>
        <div class="grid grid-cols-[96px_1fr] gap-2 pt-1">
            <button onclick="ttCreateBack()" class="${DARK} py-3">‹ Back</button>
            <button onclick="saveTourney('${jsq(pre.id || '')}')" class="${GOLDBTN} py-3 text-sm">${editing ? 'Save changes' : 'Create tournament'}</button>
        </div>`);
}
// ---------------------------------------------------------------- 💰 Check expenses (optional, only for the organizer)
//   Shows up once there's an entry fee: type the costs and see the money in (min / max teams), the money out,
//   what's left, and the fee you'd need to break even. Kept on this device only (nobody else sees it).
const COST_LINES = [['field', '🏟️ Field rental'], ['refs', '🧑‍⚖️ Referees'], ['water', '💧 Water / ice / Gatorade'], ['equipment', '⚽ Equipment (balls, cones, nets, bibs)'],
    ['wear', '📉 Equipment wear & tear (depreciation)'], ['prizes', '💵 Prize money'], ['trophies', '🏆 Trophies / medals'], ['bonus', '🎁 Staff / helpers bonus'],
    ['firstaid', '🩹 First aid / insurance'], ['food', '🍔 Food / BBQ'], ['music', '🎵 Music / DJ / tent'], ['photos', '📸 Photographer / video'],
    ['marketing', '📣 Flyers / ads'], ['other', '✏️ Other']];
const costKey = () => 'futnet_ttcost_' + (F.pre.id || 'new');
function costRead() { try { return JSON.parse(localStorage.getItem(costKey()) || '{}') || {}; } catch (e) { return {}; } }
function costSave(c) { try { localStorage.setItem(costKey(), JSON.stringify(c)); } catch (e) { /* private mode */ } }
const dollarsIn = (x) => Math.max(0, parseFloat(String(x || '').replace(/[$,]/g, '')) || 0);
function costBoxHtml() {
    const c = costRead();
    return `<details id="tt-cost-box" class="bg-black/40 border border-emerald-400/30 rounded-2xl px-3 py-2" style="display:${dollarsIn(val('tt-price') || F.basics.price || (F.pre.priceCents ? F.pre.priceCents / 100 : 0)) > 0 ? '' : 'none'}" ${c._open ? 'open' : ''} ontoggle="ttCostOpen(this.open)">
        <summary class="text-xs font-black cursor-pointer py-1.5 text-emerald-300">💰 Check expenses (optional)</summary>
        <div class="space-y-2 pt-2">
            <p class="text-[10px] text-white/55">Only you see this (it stays on this device). Put what each thing costs for the whole tournament.</p>
            ${COST_LINES.map(([k, l]) => `<div class="grid gap-2 items-center" style="grid-template-columns:1fr 96px"><span class="text-[12px] font-bold text-white/85">${l}</span>
                <input inputmode="decimal" data-cost="${k}" value="${esc(c[k] || '')}" placeholder="$0" oninput="ttCostCalc()" class="bg-black/60 border border-white/15 rounded-lg px-2 py-1.5 text-sm text-right text-white"></div>`).join('')}
            <div class="grid gap-2 items-center" style="grid-template-columns:1fr 96px"><span class="text-[12px] font-bold text-white/85">💳 Payment app fees (%)</span>
                <input inputmode="decimal" data-cost="feePct" value="${esc(c.feePct || '')}" placeholder="0%" oninput="ttCostCalc()" class="bg-black/60 border border-white/15 rounded-lg px-2 py-1.5 text-sm text-right text-white"></div>
            <div id="tt-cost-sum" class="rounded-xl bg-black/50 border border-white/10 p-3 text-[12px] space-y-1"></div>
        </div></details>`;
}
window.ttCostOpen = (open) => { const c = costRead(); c._open = open; costSave(c); if (open) window.ttCostCalc(); };
window.ttCostShow = () => {
    const box = document.getElementById('tt-cost-box'); if (!box) return;
    box.style.display = dollarsIn(val('tt-price')) > 0 ? '' : 'none';
    if (box.open) window.ttCostCalc();
};
window.ttCostCalc = function () {
    const c = costRead();
    document.querySelectorAll('[data-cost]').forEach(i => { c[i.dataset.cost] = i.value; });
    costSave(c);
    const fee = dollarsIn(val('tt-price'));
    // the prize line follows the cash prize when it's empty
    const prizeIn = document.querySelector('[data-cost="prizes"]');
    if (prizeIn && !prizeIn.value && document.getElementById('tt-cash')?.checked) prizeIn.placeholder = '$' + (dollarsIn(val('tt-cash-amt')) || 0);
    const costs = COST_LINES.reduce((n, [k]) => n + (k === 'prizes' && !c.prizes && document.getElementById('tt-cash')?.checked ? dollarsIn(val('tt-cash-amt')) : dollarsIn(c[k])), 0);
    const pct = Math.min(30, dollarsIn(c.feePct)) / 100;
    const minT = num('tt-minteams', 4), maxT = num('tt-maxteams', 8);
    const money = (x) => (x < 0 ? '-$' : '$') + Math.abs(Math.round(x)).toLocaleString();
    const row = (teams) => { const inc = fee * teams, left = inc * (1 - pct) - costs; return `<div class="flex justify-between gap-2"><span>${teams} teams: ${money(inc)} in</span><b class="${left >= 0 ? 'text-[#00F296]' : 'text-red-300'}">${left >= 0 ? 'Profit ' : 'Loss '}${money(left)}</b></div>`; };
    const breakEven = (teams) => teams ? Math.ceil(costs / (teams * (1 - pct || 1))) : 0;
    const el = document.getElementById('tt-cost-sum'); if (!el) return;
    el.innerHTML = `<div class="flex justify-between"><span class="text-white/70">Total expenses</span><b>${money(costs)}</b></div>
        ${row(minT)}${maxT !== minT ? row(maxT) : ''}
        ${costs ? `<div class="pt-1 text-[11px] text-amber-200">Break-even fee: <b>${money(breakEven(minT))}</b> per team with ${minT} teams${maxT !== minT ? ` · <b>${money(breakEven(maxT))}</b> with ${maxT}` : ''}</div>` : ''}`;
};

/** 🎁 Prize for the champion: "$ Cash prize" (+ amount) and "🏆 Trophy" (+ optional picture). */
function prizeFormHtml(v) {
    const cash = v('prizeCash', false) === true, trophy = v('trophy', false) === true;
    const cents = +v('prizeCents', 0) || 0;
    const amt = F.basics.prizeAmt !== undefined ? F.basics.prizeAmt : (cents ? (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100)) : '');
    const photo = F.trophyPreview || v('trophyPhoto', '');
    return `<div class="bg-black/40 border ${cash || trophy ? 'border-amber-400/70' : 'border-white/10'} rounded-2xl p-3 space-y-3" id="tt-prize-box">
        <div class="text-[10px] font-black uppercase tracking-wider text-amber-300">🎁 Prizes · 🥇 1st place (champion)</div>
        <label class="flex items-center gap-3 cursor-pointer"><div class="flex-1 text-sm font-black">💵 Cash prize</div>
            <input id="tt-cash" type="checkbox" class="w-6 h-6 accent-amber-400" ${cash ? 'checked' : ''} onchange="document.getElementById('tt-cash-row').style.display=this.checked?'':'none'"></label>
        <div id="tt-cash-row" style="display:${cash ? '' : 'none'}">${LBL('How much? ($)')}<input id="tt-cash-amt" inputmode="decimal" class="${INPUT}" value="${esc(amt)}" placeholder="e.g. 400"></div>
        <label class="flex items-center gap-3 cursor-pointer"><div class="flex-1 text-sm font-black">🏆 Trophy</div>
            <input id="tt-trophy" type="checkbox" class="w-6 h-6 accent-amber-400" ${trophy ? 'checked' : ''} onchange="document.getElementById('tt-trophy-row').style.display=this.checked?'':'none'"></label>
        <div id="tt-trophy-row" class="space-y-2" style="display:${trophy ? '' : 'none'}">
            ${photo ? `<div class="relative w-28 h-28"><img src="${esc(photo)}" class="w-28 h-28 rounded-2xl object-cover border border-amber-400/60" alt="Trophy">
                <button type="button" onclick="ttTrophyClear()" class="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-black border border-white/30 text-xs"><i class="fa-solid fa-xmark"></i></button></div>` : ''}
            <label class="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs font-black cursor-pointer">📷 ${photo ? 'Change the picture' : 'Add a picture of the trophy (optional)'}
                <input type="file" accept="image/*" class="hidden" onchange="ttTrophyPick(this)"></label>
        </div>
        <div id="tt-more-prizes" class="space-y-2">${morePrizesHtml()}</div></div>`;
}
// 🥈 more prizes, one at a time: "+ Add 2nd place prize", then 3rd, 4th, MVP, then any other
const PRIZE_PLACES = ['🥈 2nd', '🥉 3rd', '4th', '⭐ MVP', '🥅 Top scorer', '🧤 Best goalkeeper'];
const nextPlace = (list) => PRIZE_PLACES.find(p => !list.some(x => x.place === p)) || '🎁 Other';
function morePrizesHtml() {
    const list = F.extraPrizes || [];
    const next = nextPlace(list);
    return `${list.map((p, i) => `<div class="grid gap-2 items-center" style="grid-template-columns:100px 1fr 28px">
            <input class="${INPUT} !py-2 !text-xs" value="${esc(p.place)}" oninput="ttPrizeSet(${i},'place',this.value)">
            <input class="${INPUT} !py-2" value="${esc(p.prize)}" placeholder="e.g. $100, medals" oninput="ttPrizeSet(${i},'prize',this.value)">
            <button type="button" onclick="ttPrizeDel(${i})" class="w-7 h-7 rounded-full bg-black/60 border border-white/20 text-xs"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}
        ${list.length < 8 ? `<button type="button" onclick="ttPrizeAdd()" class="w-full py-2.5 rounded-xl border border-dashed border-amber-400/60 text-amber-200 text-xs font-black">＋ Add ${esc(next.replace(/^[^A-Za-z0-9]+\s*/, ''))}${/^\d/.test(next.replace(/^[^A-Za-z0-9]+\s*/, '')) ? ' place' : ''} prize</button>` : ''}`;
}
window.ttPrizeSet = (i, k, x) => { if (F.extraPrizes[i]) F.extraPrizes[i][k] = x; };
window.ttPrizeAdd = () => { F.extraPrizes = [...(F.extraPrizes || []), { place: nextPlace(F.extraPrizes || []), prize: '' }]; const el = document.getElementById('tt-more-prizes'); if (el) el.innerHTML = morePrizesHtml(); };
window.ttPrizeDel = (i) => { F.extraPrizes.splice(i, 1); const el = document.getElementById('tt-more-prizes'); if (el) el.innerHTML = morePrizesHtml(); };
/** 1st (from the champion box, or what was typed before) + the 2nd, 3rd… lines. */
function prizesWithExtras(old, fields) {
    const first = withAutoPrize((old || []).filter(p => p.auto || /1st/.test(p.place || '')), fields);
    return [...first, ...(F.extraPrizes || []).filter(p => String(p.prize || '').trim()).map(p => ({ place: String(p.place || '').trim() || '🎁', prize: String(p.prize).trim().slice(0, 80) }))];
}
/** What happens on a day (pick any; "Other" lets you type). label = the readable line shown everywhere. */
export const DAY_TYPES = [['opening', '🎉 Opening ceremony'], ['group', 'Group stage'], ['league', 'League games'], ['knockout', 'Knockout stage'],
    ['r16', 'Round of 16'], ['qf', 'Quarter-finals'], ['sf', 'Semi-finals'], ['third', '3rd place game'], ['final', '🏆 Final'],
    ['awards', '🥇 Awards / trophy'], ['closing', 'Closing ceremony'], ['photos', '📸 Team photos'],
    ['shootout', '🥅 Penalty shootout contest'], ['food', '🍔 Food / BBQ'], ['music', '🎵 Music / DJ'], ['rain', '☔ Rain date'], ['other', '✏️ Other']];
// older tournaments may still have these: they keep showing on them
const OLD_DAY_NAMES = { skills: 'Skills challenge', kids: 'Kids games' };
const DAY_NAME = { ...OLD_DAY_NAMES, ...Object.fromEntries(DAY_TYPES.map(([k, l]) => [k, l.replace(/^[^A-Za-z0-9]+\s*/, '')])) };
/** The day's types (older days only have a typed label: shown as "Other"). */
function dayTypesOf(d) {
    if (Array.isArray(d.types)) return d.types;
    if (d.label && !d.other) { d.other = d.label; d.types = ['other']; return d.types; }
    return [];
}
export function dayLabelOf(types, other) {
    return types.filter(k => k !== 'other').map(k => DAY_NAME[k] || k).concat(other ? [other] : []).join(' · ').slice(0, 120);
}
/** 📝 When does registration close? Default: when the tournament starts. Or an earlier day + time. */
function regCloseFormHtml(v) {
    const cur = String(v('regClose', '') || ''), early = !!cur;
    const [d, hm] = cur.split(' ');
    return `<div class="bg-black/40 border ${early ? 'border-amber-400/70' : 'border-white/10'} rounded-2xl p-3 space-y-3">
        <div class="text-[10px] font-black uppercase tracking-wider text-amber-300">📝 When does registration close?</div>
        <label class="flex items-center gap-3 cursor-pointer"><input type="radio" name="tt-regwhen" value="start" class="w-5 h-5 accent-amber-400" ${early ? '' : 'checked'} onchange="document.getElementById('tt-reg-row').style.display='none'">
            <span class="text-sm font-bold">When the tournament starts</span></label>
        <label class="flex items-center gap-3 cursor-pointer"><input type="radio" name="tt-regwhen" value="early" id="tt-reg-early" class="w-5 h-5 accent-amber-400" ${early ? 'checked' : ''} onchange="document.getElementById('tt-reg-row').style.display=''">
            <span class="text-sm font-bold">Earlier, on a day and time I pick</span></label>
        <div id="tt-reg-row" class="grid grid-cols-[1fr_120px] gap-3" style="display:${early ? '' : 'none'}">
            <div class="min-w-0">${LBL('Closes on')}<input id="tt-reg-date" type="date" class="${INPUT}" value="${esc(d || '')}"></div>
            <div class="min-w-0">${LBL('At')}<input id="tt-reg-time" type="time" class="${INPUT} !px-2" value="${esc(hm || '23:59')}"></div>
        </div></div>`;
}
/** Keeps what's typed on page 1 when the trophy picture redraws the form. */
function readBasics() {
    return {
        name: val('tt-name'), date: val('tt-start-date'), time: val('tt-start-time'), park: val('tt-park'), city: val('tt-city'), state: val('tt-state') || 'FL',
        format: segVal('tt-format') || '8v8', minTeams: num('tt-minteams', 4), maxTeams: num('tt-maxteams', 8), minPlayers: num('tt-minpl', 7), maxPlayers: num('tt-maxpl', 12),
        price: val('tt-price'), requirePay: !!document.getElementById('tt-reqpay')?.checked, communityId: val('tt-comm'), description: val('tt-desc'),
        prizeCash: !!document.getElementById('tt-cash')?.checked, prizeAmt: val('tt-cash-amt'), trophy: !!document.getElementById('tt-trophy')?.checked,
        trophyPhoto: F.trophyCleared ? '' : (F.basics.trophyPhoto !== undefined ? F.basics.trophyPhoto : (F.pre.trophyPhoto || '')),
        regClose: document.getElementById('tt-reg-early')?.checked && val('tt-reg-date') ? `${val('tt-reg-date')} ${val('tt-reg-time') || '23:59'}` : '',
    };
}
window.ttTrophyPick = function (input) {
    const f = input.files && input.files[0]; if (!f) return;
    if (!String(f.type).startsWith('image/')) { toast('Pick a picture.', 'error'); return; }
    F.basics = readBasics();
    F.trophyFile = f; F.trophyCleared = false;
    if (F.trophyPreview) URL.revokeObjectURL(F.trophyPreview);
    F.trophyPreview = URL.createObjectURL(f);
    drawCreate();
};
window.ttTrophyClear = function () {
    F.basics = readBasics();
    F.trophyFile = null; F.trophyPreview = ''; F.trophyCleared = true; F.basics.trophyPhoto = '';
    drawCreate();
};
window.ttCreateNext = function () {
    const b = readBasics();
    if (b.prizeCash && !(parseFloat(String(b.prizeAmt || '').replace(',', '.')) > 0)) { toast('Put the cash prize amount (or untick it).', 'error'); return; }
    if (document.getElementById('tt-reg-early')?.checked && !b.regClose) { toast('Pick the day registration closes (or choose "When the tournament starts").', 'error'); return; }
    if (b.regClose && b.date && b.regClose > `${b.date} ${b.time || '23:59'}`) { toast('Registration has to close before the tournament starts.', 'error'); return; }
    if (!b.name || !b.date || !b.time || !b.park || !b.city) { toast('Fill in the name, starting date and time, park and city.', 'error'); return; }
    if (b.minTeams > b.maxTeams) { toast("Min teams can't be more than max teams.", 'error'); return; }
    if (b.minPlayers > b.maxPlayers) { toast("Min players can't be more than max players.", 'error'); return; }
    // Day 1 follows the starting date / time (until they change it on page 2)
    const prev = F.basics;
    F.basics = b;
    if (F.days.length && (!F.days[0].date || F.days[0].date === (prev.date || F.pre.date))) F.days[0].date = b.date;
    if (F.days.length && (!F.days[0].time || F.days[0].time === (prev.time || F.pre.time))) F.days[0].time = b.time;
    F.step = 2;
    drawCreate();
};
window.ttCreateBack = () => { F.step = Math.max(1, F.step - 1); drawCreate(); };
window.ttDaySet = (i, k, x) => { if (F.days[i]) F.days[i][k] = x; if (['date', 'time', 'until'].includes(k)) ttPreviewRefresh(); };
// ---------------------------------------------------------------- page 2: ⏱️ format & timing
/** A tournament-like object from what's typed so far (for the preview). */
function previewT() {
    const b = F.basics, days = (F.days.length ? F.days : [{ date: b.date, time: b.time, until: '' }]).filter(d => d.date);
    return { date: b.date, time: b.time, days: days.length ? days : [{ date: b.date || '2030-01-01', time: b.time || '09:00' }], rules: F.rules };
}
function ttPreviewRefresh() {
    const n = F.basics.minTeams || 4;
    const a = document.getElementById('tt-preview'); if (a) a.innerHTML = previewHtml(previewT(), n, `📅 Your schedule with ${n} teams (your minimum)`) + (F.basics.maxTeams > n ? `<div class="text-[10px] text-white/50 text-center pt-1">With ${F.basics.maxTeams} teams (your max): ${esc(PLAN_TEXT[planFor(F.basics.maxTeams, F.rules.fmt)])}</div>` : '');
    const c = document.getElementById('tt-preview3'); if (c) c.innerHTML = previewHtml(previewT(), n, `📅 Your schedule with ${n} teams (your minimum)`);
}
const ruleSel = (k, opts, cur, redraw) => `<select class="${INPUT}" onchange="ttRule('${k}', this.value, ${redraw ? 'true' : 'false'})">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
const minOpts = (list, unit = 'min') => list.map(x => [x, x ? `${x} ${unit}` : 'None']);
function drawFormatStep(title, dots) {
    const r = F.rules, n = F.basics.minTeams || 4, chip = (k, v, l, on) => `<button type="button" onclick="ttRule('${k}', '${v}', true)" class="px-3 py-2 rounded-xl text-xs font-black border ${on ? 'bg-amber-400 text-slate-950 border-amber-400' : 'bg-black/50 text-white/80 border-white/15'}">${l}</button>`;
    const fmtCard = (v) => { const on = r.fmt === v, p = planFor(n, v), note = planNote(n, v);
        return `<button type="button" onclick="ttRule('fmt', '${v}', true)" class="text-left rounded-2xl p-3 border-2 ${on ? 'border-amber-400 bg-amber-400/10' : 'border-white/10 bg-black/40'}">
            <div class="text-sm font-black ${on ? 'text-amber-200' : ''}">${FMT_TEXT[v]}</div>
            <div class="text-[10px] text-white/60">${note ? '⚠️ ' + esc(note) : `With ${n} teams: ${esc(PLAN_TEXT[p])}`}</div></button>`; };
    const nf = +r.fields || 1;
    sheet('tt-create', title, `${dots}
        <div class="text-center"><div class="text-lg font-black">⏱️ Format & timing</div><div class="text-[11px] text-white/55">We build the schedule for ${n} teams (your minimum). If more sign up, it's rebuilt at the draw and you can change anything.</div></div>
        <div>${LBL('Format')}<div class="grid gap-2">${['auto', 'knockout', 'groups', 'league'].map(fmtCard).join('')}</div></div>
        <div>${LBL('Games are played in')}<div class="flex gap-2">${chip('halves', 'false', '1️⃣ One period', !r.halves)}${chip('halves', 'true', '2️⃣ Two halves', r.halves)}</div></div>
        <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0">${LBL(r.halves ? 'Each half' : 'Game length')}${ruleSel('len', minOpts([8, 10, 12, 15, 20, 25, 30, 35, 40, 45]), r.len)}</div>
            ${r.halves ? `<div class="min-w-0">${LBL('Halftime')}${ruleSel('half', minOpts([0, 2, 3, 5, 10, 15]), r.half)}</div>` : '<div></div>'}
            <div class="min-w-0">${LBL('Break between games')}${ruleSel('gap', minOpts([0, 3, 5, 10, 15, 20]), r.gap)}</div>
            <div class="min-w-0">${LBL('Games at the same time')}${ruleSel('fields', [[1, '1 field'], [2, '2 fields'], [3, '3 fields'], [4, '4 fields']], nf, true)}</div>
        </div>
        ${nf > 1 ? `<div>${LBL('Field names (optional)')}<div class="grid grid-cols-2 gap-2">${Array.from({ length: nf }, (_, i) => `<input class="${INPUT}" maxlength="20" value="${esc((r.fieldNames || [])[i] || '')}" placeholder="Field ${i + 1}" oninput="ttFieldName(${i}, this.value)">`).join('')}</div></div>` : ''}
        <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0">${LBL('Late allowed')}${ruleSel('late', minOpts([0, 5, 10, 15, 20]), r.late)}</div>
            <div class="min-w-0">${LBL('No-show = forfeit')}${ruleSel('forfeit', [['3-0', 'Loses 3-0'], ['1-0', 'Loses 1-0'], ['5-0', 'Loses 5-0']], r.forfeit)}</div>
        </div>
        <details class="rounded-2xl bg-black/40 border border-white/10" ${F.moreOpen ? 'open' : ''} ontoggle="window.__ttMore = this.open">
            <summary class="cursor-pointer px-3 py-3 text-sm font-black">⚙️ More options</summary>
            <div class="px-3 pb-3 space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div class="min-w-0">${LBL('Check-in before 1st game')}${ruleSel('check', minOpts([0, 10, 15, 20, 30, 45, 60]), r.check)}</div>
                    <div class="min-w-0">${LBL("Rest between a team's games")}${ruleSel('rest', minOpts([0, 5, 10, 15, 20, 30]), r.rest)}</div>
                    <div class="min-w-0">${LBL('Knockout draw')}${ruleSel('koTie', [['pens', 'Penalties'], ['et', 'Extra time + pens'], ['golden', 'Golden goal']], r.koTie, true)}</div>
                    ${r.koTie !== 'golden' ? `<div class="min-w-0">${LBL('Penalty kicks')}${ruleSel('kicks', [[3, '3 each'], [5, '5 each']], r.kicks)}</div>` : '<div></div>'}
                    <div class="min-w-0">${LBL('Semis & Final longer by')}${ruleSel('longer', minOpts([0, 5, 10, 15, 20]), r.longer)}</div>
                    <div class="min-w-0">${LBL('Awards after the Final')}${ruleSel('awards', minOpts([0, 10, 15, 20, 30]), r.awards)}</div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div class="min-w-0">${LBL('Lunch break at (optional)')}<input type="time" class="${INPUT} !px-2" value="${esc(r.lunch || '')}" onchange="ttRule('lunch', this.value, false)"></div>
                    <div class="min-w-0">${LBL('Lunch length')}${ruleSel('lunchLen', minOpts([15, 20, 30, 45, 60]), r.lunchLen)}</div>
                </div>
            </div>
        </details>
        <div id="tt-preview"></div>
        <div class="grid grid-cols-[96px_1fr] gap-2 pt-1">
            <button onclick="ttCreateBack()" class="${DARK} py-3">‹ Back</button>
            <button onclick="ttCreateNext2()" class="${GOLDBTN} py-3 text-sm">Next: the days ›</button>
        </div>`);
    ttPreviewRefresh();
}
const NUM_RULES = ['len', 'half', 'gap', 'fields', 'late', 'check', 'rest', 'kicks', 'longer', 'awards', 'lunchLen'];
window.ttRule = (k, v, redraw) => {
    F.rules[k] = k === 'halves' ? v === 'true' : NUM_RULES.includes(k) ? +v : v;
    if (k === 'halves' && F.rules.halves && F.rules.len > 30) F.rules.len = 20;   // 2 × 45 is rarely what they mean
    if (!redraw) { ttPreviewRefresh(); return; }
    F.moreOpen = !!window.__ttMore;
    const box = document.querySelector('#tt-create > div'), top = box ? box.scrollTop : 0;
    drawCreate();
    const b2 = document.querySelector('#tt-create > div'); if (b2) b2.scrollTop = top;
};
window.ttFieldName = (i, v) => { const a = F.rules.fieldNames = (F.rules.fieldNames || []).slice(); a[i] = v; ttPreviewRefresh(); };
window.ttCreateNext2 = () => { F.step = 3; drawCreate(); };
window.ttDayType = (i, k) => {
    const d = F.days[i]; if (!d) return;
    const cur = dayTypesOf(d);
    d.types = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k];
    F.dayOpen = i;   // keep the dropdown open while picking
    const box = document.querySelector('#tt-create > div'), top = box ? box.scrollTop : 0;
    drawCreate();
    const b2 = document.querySelector('#tt-create > div'); if (b2) b2.scrollTop = top;
};
window.ttDayAdd = () => {
    const last = F.days[F.days.length - 1] || {};
    let date = '';
    if (last.date) { const [y, m, d] = last.date.split('-').map(Number); const n = new Date(y, m - 1, d + 7); date = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; }
    F.days.push({ date, time: last.time || '', until: last.until || '', label: '' });
    drawCreate();
    const box = document.querySelector('#tt-create > div'); if (box) box.scrollTop = box.scrollHeight;
};
window.ttDayRemove = (i) => { F.days.splice(i, 1); drawCreate(); };
window.saveTourney = async function (editId) {
    const b = F.basics;
    const days = F.days.filter(d => d.date).map(d => { const types = dayTypesOf(d), other = types.includes('other') ? String(d.other || '').trim() : '';
        return { date: d.date, time: d.time || '', until: d.until || '', types, other, label: dayLabelOf(types, other) }; })
        .sort((x, y) => `${x.date} ${x.time}`.localeCompare(`${y.date} ${y.time}`));
    if (!days.length || !days[0].time) { toast('Day 1 needs a date and a start time.', 'error'); return; }
    const cid = b.communityId || '';
    saveParkIfNew(b.park, b.city, b.state || 'FL');   // a new field: suggested next time (same list as games / VS)
    const fields = { name: b.name, date: days[0].date, time: days[0].time, days, park: b.park, city: b.city, state: b.state || 'FL', location: `${b.park}, ${b.city}`, format: b.format,
        minTeams: b.minTeams, maxTeams: b.maxTeams, minPlayers: b.minPlayers, maxPlayers: b.maxPlayers,
        priceCents: Math.round((parseFloat(String(b.price || '').replace(',', '.')) || 0) * 100), requirePay: !!b.requirePay, description: b.description,
        communityId: cid, communityName: cid ? (((window.communitiesCache || {})[cid] || {}).name || '') : '', updatedAt: serverTimestamp(),
        rules: { ...F.rules, fieldNames: (F.rules.fieldNames || []).slice(0, +F.rules.fields || 1).map(x => String(x || '').trim().slice(0, 20)) } };
    if (fields.requirePay && !fields.priceCents) fields.requirePay = false;
    // 🎁 prize for the champion
    fields.prizeCash = !!b.prizeCash;
    fields.prizeCents = b.prizeCash ? Math.round((parseFloat(String(b.prizeAmt || '').replace(',', '.')) || 0) * 100) : 0;
    fields.trophy = !!b.trophy;
    fields.trophyPhoto = b.trophy ? (b.trophyPhoto || '') : '';
    fields.regClose = b.regClose || '';
    const btn = document.querySelector('#tt-create button[onclick^="saveTourney"]'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
        if (b.trophy && F.trophyFile) {
            const { uploadMedia } = await import('./wa-chat.js');
            fields.trophyPhoto = (await uploadMedia(F.trophyFile, 'teams/trophy')).url;
        }
    } catch (e) { toast("Couldn't upload the trophy picture. Saving without it.", 'error'); }
    try {
        if (editId) {
            await change(editId, (t) => { if ((t.teams || []).length > fields.maxTeams) throw new Error('TOO_MANY'); Object.assign(t, fields); t.prizes = prizesWithExtras(t.prizes, fields); });
            document.getElementById('tt-create')?.remove(); toast('Tournament updated.');
            return;
        }
        const ref = doc(C('tournaments'));
        const t = { ...fields, organizerId: myUid(), organizerName: myName(), status: 'signup', plan: '', teams: [], teamIds: [], participantUids: [myUid()], matches: [], prizes: prizesWithExtras(F.pre.prizes || [], fields), championId: '', announcements: [], createdAt: serverTimestamp() };
        await setDoc(ref, t);
        document.getElementById('tt-create')?.remove();
        window.closeCreateActionSheet && window.closeCreateActionSheet();
        toast('Tournament created! 🏆 Share it so teams can register.');
        window.openTourney(ref.id, { ...t, id: ref.id });
    } catch (e) { toast(String(e && e.message) === 'TOO_MANY' ? 'More teams already registered than that.' : "Couldn't save the tournament.", 'error'); if (btn) { btn.disabled = false; btn.textContent = editId ? 'Save changes' : 'Create tournament'; } }
};
/** 📋 Copy tournament: a new one with the same settings (fee, prize, trophy picture, format, rules, community, the day plan).
 *  The dates move to the same weekday, at least a week from today (keeping the days apart the same); change anything. */
export function copyOfTourney(t) {
    const ds = daysOf(t), first = ds[0].date;
    const at = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let shift = 0;
    if (first) { const min = at(ymdToday()); min.setDate(min.getDate() + 7); while (at(first).getTime() + shift * 86400000 < min.getTime()) shift += 7; }
    const move = (ymd) => { if (!ymd) return ''; const d = at(ymd); d.setDate(d.getDate() + shift); return fmt(d); };
    const keep = ['name', 'park', 'city', 'state', 'location', 'format', 'minTeams', 'maxTeams', 'minPlayers', 'maxPlayers', 'priceCents', 'requirePay', 'description',
        'communityId', 'communityName', 'prizeCash', 'prizeCents', 'trophy', 'trophyPhoto', 'prizes', 'prizeNote', 'rules'];
    const out = {};
    keep.forEach(k => { if (t[k] !== undefined) out[k] = JSON.parse(JSON.stringify(t[k])); });
    out.days = ds.map(d => ({ date: move(d.date), time: d.time || '', until: d.until || '', label: d.label || '', ...(Array.isArray(d.types) ? { types: [...d.types], other: d.other || '' } : {}) }));
    out.date = out.days[0].date; out.time = out.days[0].time;
    if (t.regClose) { const [d, hm] = String(t.regClose).split(' '); out.regClose = `${move(d)} ${hm || '23:59'}`; }
    return out;
}
window.copyTourney = function () {
    const t = cur(); if (!t) return;
    window.openCreateTourney(copyOfTourney(t));
    toast('Copied. Check the dates and the name, then create it. 📋');
};
/** The 🥇 1st prize line from the cash / trophy ticks ("$400 + 🏆 Trophy"). Only replaces a line it made itself. */
export function prizeText(f) {
    const parts = [];
    if (f.prizeCash && +f.prizeCents > 0) parts.push(money(+f.prizeCents));
    if (f.trophy) parts.push('🏆 Trophy');
    return parts.join(' + ');
}
function withAutoPrize(list, f) {
    const out = (list || []).map(p => ({ ...p }));
    const text = prizeText(f);
    const i = out.findIndex(p => p.auto);
    if (i >= 0) { if (text) out[i].prize = text; else out.splice(i, 1); return out; }
    if (text && !out.some(p => /1st/.test(p.place || ''))) out.unshift({ place: '🥇 1st', prize: text, auto: true });
    return out;
}
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
const TT_MEMBERS = {};   // teams read for the organizer (not their own team)
const isTTBoss = (t) => !!t && t.organizerId === myUid();
const membersOfTeam = (teamId) => { const full = (TS().mine || []).find(y => y.id === teamId) || (TT_MEMBERS[teamId] ? { members: TT_MEMBERS[teamId] } : null) || (TS().all || []).find(y => y.id === teamId); return (full && full.members) || []; };
const pId = (p) => String(p.id || p.uid || p.name);
window.openJoinTourney = function () {
    const t = cur(); if (!t) return;
    const mine = myCaptainTeams().filter(x => !(t.teamIds || []).includes(x.id));
    if (!mine.length) { toast(myCaptainTeams().length ? 'Your teams are already in.' : 'You need to be the captain of a team. Make one in the Teams tab.', 'error'); return; }
    sheet('tt-join', `Register for ${esc(t.name)}`, `
        ${+t.priceCents ? `<p class="text-xs text-white/70">Entry fee: <b>${money(t.priceCents)}</b> per team. Pay the organizer; they mark you as paid.${t.requirePay ? ' <b class="text-amber-300">Your team is only confirmed once you\'ve paid.</b>' : ''}</p>` : ''}
        <p class="text-xs text-white/70">Pick your team, then your players (${+t.minPlayers || 1}–${+t.maxPlayers || 30} per team).</p>
        <div class="space-y-2">${mine.map(x => `<button onclick="openTourneyPlayers('${jsq(x.id)}', true)" class="w-full flex items-center gap-3 p-3 bg-black/40 hover:bg-black rounded-xl border border-white/10 text-left">${teamLogoHtml(x, 36)}<span class="flex-1 text-sm font-black">${esc(x.name)}</span><span class="text-[11px] text-white/50">${(x.members || []).length} players ›</span></button>`).join('')}</div>`);
};
/** "Register your team": a captain registers a team; no team yet -> make one first, then come right back. */
window.ttRegisterTeam = async function (id) {
    if (!myUid()) { toast('Sign in first to register your team.', 'error'); window.switchTab && window.switchTab('profile'); return; }
    if (!TT.open || TT.open.id !== id) window.openTourney(id, null, 'info');
    const t = TT.open || TT.list.find(x => x.id === id); if (!t) return;
    if (!canRegister(t)) { toast(t.status === 'signup' && !regOver(t) ? 'Registration is full.' : 'Registration is closed.', 'error'); return; }
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
window.openTourneyPlayers = async function (teamId, joining) {
    const t = cur(); if (!t) return;
    // the organizer can pick any team's players (even when the team's roster is private): read them from the team
    const mineTeam = myCaptainTeams().some(x => x.id === teamId);
    if (!mineTeam && isTTBoss(t)) {
        try { const s = await getDoc(doc(db, 'artifacts', appId, 'teams', teamId)); if (s.exists()) TT_MEMBERS[teamId] = s.data().members || []; } catch (e) { /* below */ }
    }
    const members = membersOfTeam(teamId);
    const cur = new Set(rosterOf(teamOf(t, teamId)).map(r => r.id));
    // 🔁 fill-ins: people who aren't on the team but play for it in this tournament (subs / borrowed players)
    window._ttFill = rosterOf(teamOf(t, teamId)).filter(r => r.fillIn || String(r.id).startsWith('fill_') || String(r.id).startsWith('man_'));   // man_ = a team added by hand
    window._ttFillTeam = teamId;
    const min = +t.minPlayers || 1, max = +t.maxPlayers || 30;
    const name = joining ? (myCaptainTeams().find(x => x.id === teamId) || {}).name : nameOf(t, teamId);
    document.getElementById('tt-join')?.remove();
    sheet('tt-players', `👥 ${esc(name || 'Team')}: players`, `
        <div class="flex items-center justify-between"><p class="text-xs text-white/70">Pick ${min === max ? min : `${min} to ${max}`} players.</p>
            <button onclick="document.querySelectorAll('[data-pl]').forEach(c => c.checked = true); ttCountPl()" class="text-[11px] font-bold text-[#00F296]">Select all</button></div>
        <div class="space-y-1.5">${members.map(p => `<label class="flex items-center gap-3 p-2.5 bg-black/40 rounded-xl border border-white/10 cursor-pointer">
            <input type="checkbox" class="w-5 h-5 accent-[#00F296]" data-pl="${esc(pId(p))}" onchange="ttCountPl()" ${!cur.size || cur.has(pId(p)) ? 'checked' : ''}>
            <span class="flex-1 min-w-0 text-xs font-bold truncate">${p.number ? esc(p.number) + ' · ' : ''}${esc(p.name || 'Player')}${p.uid ? '' : ' <span class="text-[9px] text-white/40">(no app)</span>'}</span><span class="text-[10px] text-white/45">${esc(p.position || '')}</span></label>`).join('') || '<p class="text-xs text-white/50">This team has no players yet. Add them in the Teams tab first.</p>'}</div>
        <div id="tt-fill-list" class="space-y-1.5">${ttFillRows()}</div>
        <div class="bg-black/40 border border-sky-400/30 rounded-2xl p-3 space-y-2">
            <div class="text-[10px] font-black uppercase tracking-wider text-sky-300">➕ Add a fill-in (not on the team)</div>
            <input id="tt-fill-q" oninput="ttFillSearch()" placeholder="Search a FutNet player, or type a name" maxlength="40" class="w-full bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-sm text-white">
            <div id="tt-fill-res" class="space-y-1.5"></div>
            <button onclick="ttAddFill('', '')" class="w-full bg-sky-400/20 border border-sky-400/40 text-sky-100 font-bold py-2 rounded-xl text-xs">Add by name (not on FutNet)</button>
        </div>
        ${mineTeam ? `<button onclick="ttGoAddPlayers('${jsq(t.id)}','${jsq(teamId)}')" class="w-full text-[11px] font-bold text-[#00F296] py-1">➕ Add more players to the team</button>` : ''}
        <div id="tt-pl-count" class="text-[11px] text-center text-white/60"></div>
        <button onclick="saveTourneyPlayers('${jsq(teamId)}', ${joining ? 'true' : 'false'})" class="${BTN} w-full py-3 text-sm">${joining ? 'Register my team' : 'Save players'}</button>`);
    window.ttCountPl();
};
function ttFillRows() {
    return (window._ttFill || []).map(f => `<label class="flex items-center gap-3 p-2.5 bg-sky-400/10 rounded-xl border border-sky-400/30 cursor-pointer">
        <input type="checkbox" class="w-5 h-5 accent-[#00F296]" data-pl="${esc(f.id)}" onchange="ttCountPl()" checked>
        <span class="flex-1 min-w-0 text-xs font-bold truncate">🔁 ${esc(f.name || 'Player')}${f.uid ? '' : ' <span class="text-[9px] text-white/40">(no app)</span>'}</span><span class="text-[10px] text-sky-300">fill-in</span></label>`).join('');
}
window.ttFillSearch = function () {
    const q = String(document.getElementById('tt-fill-q')?.value || '').trim().toLowerCase(), box = document.getElementById('tt-fill-res'); if (!box) return;
    if (q.length < 2) { box.innerHTML = ''; return; }
    const seen = new Set();
    const list = [...(window.cachedDirectoryList || []), ...(window.directoryList || [])].filter(u => {
        const id = String(u.uid || u.id || ''); if (!id || seen.has(id)) return false; seen.add(id);
        return (u.name || `${u.firstName || ''} ${u.lastName || ''}`).toLowerCase().includes(q);
    }).slice(0, 6);
    box.innerHTML = list.map(u => { const id = String(u.uid || u.id), nm = u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim(); return `<button onclick="ttAddFill('${jsq(id)}', '${jsq(nm)}')" class="w-full flex items-center justify-between p-2.5 bg-black/40 rounded-xl border border-white/10 text-left"><span class="text-xs font-bold truncate">${esc(nm)}</span><span class="text-[11px] font-black text-[#00F296]">Add</span></button>`; }).join('');
};
window.ttAddFill = function (uid, name) {
    name = String(name || document.getElementById('tt-fill-q')?.value || '').trim().slice(0, 40);
    if (!name) { toast('Type their name.', 'error'); return; }
    if ((window._ttFill || []).some(f => (uid && f.uid === uid) || f.name === name)) { toast('Already added.'); return; }
    window._ttFill = [...(window._ttFill || []), { id: 'fill_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, number: '', uid: uid || '', position: '', fillIn: true }];
    const el = document.getElementById('tt-fill-list'); if (el) el.innerHTML = ttFillRows();
    const q = document.getElementById('tt-fill-q'); if (q) q.value = ''; const r = document.getElementById('tt-fill-res'); if (r) r.innerHTML = '';
    window.ttCountPl();
};
window.ttCountPl = () => {
    const t = cur(); if (!t) return;
    const n = [...document.querySelectorAll('[data-pl]')].filter(c => c.checked).length;
    const min = +t.minPlayers || 1, max = +t.maxPlayers || 30;
    const el = document.getElementById('tt-pl-count');
    if (el) el.innerHTML = `${n} picked${n < min ? ` · <span class="text-amber-300">need at least ${min}</span>` : n > max ? ` · <span class="text-red-300">max ${max}</span>` : ' · <span class="text-[#00F296]">✓</span>'}`;
};
window.saveTourneyPlayers = async function (teamId, joining) {
    const t0 = cur(); if (!t0) return;
    const members = membersOfTeam(teamId);
    const ids = [...document.querySelectorAll('[data-pl]')].filter(c => c.checked).map(c => c.dataset.pl);
    const min = +t0.minPlayers || 1, max = +t0.maxPlayers || 30;
    if ((ids.length < min || ids.length > max) && !(isTTBoss(t0) && !joining && ids.length)) { toast(`Pick ${min === max ? min : `between ${min} and ${max}`} players.`, 'error'); return; }
    const roster = [...members.filter(p => ids.includes(pId(p))).map(p => ({ id: pId(p), name: p.name || 'Player', number: p.number || '', uid: p.uid || '', position: p.position || '' })),
        ...(window._ttFill || []).filter(f => ids.includes(f.id))];
    const x = myCaptainTeams().find(y => y.id === teamId);
    try {
        await change(t0.id, (t) => {
            const cur = t.teams.find(y => y.teamId === teamId);
            if (joining) {
                if (t.status !== 'signup' || regOver(t)) throw new Error('STARTED');
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
    const t0 = cur(); if (!t0) return;
    if (!confirm('Take this team out of the tournament?')) return;
    try { await change(t0.id, (t) => { if (t.status !== 'signup') throw new Error('STARTED'); t.teams = t.teams.filter(y => y.teamId !== teamId); }); toast('Team removed.'); }
    catch (e) { toast(String(e && e.message) === 'STARTED' ? "Registration is closed: teams can't leave now." : "Couldn't change it.", 'error'); }
};
window.toggleTourneyPaid = async function (teamId) {
    const t0 = cur(); if (!t0) return;
    try { await change(t0.id, (t) => { const y = t.teams.find(z => z.teamId === teamId); if (!y) return false; y.paid = !y.paid; }); }
    catch (e) { toast("Couldn't change it.", 'error'); }
};

// ---------------------------------------------------------------- the steps (organizer)
window.tourneyDraw = async function (redo) {
    const t0 = cur(); if (!t0) return;
    // "Must pay to be confirmed": only paid teams go into the draw; the others are taken out.
    const pool = (t0.teams || []).filter(x => !t0.requirePay || x.paid);
    const n = pool.length, unpaid = (t0.teams || []).filter(x => !x.paid);
    if (n < 2) { toast(t0.requirePay ? 'At least 2 teams need to be paid (confirmed).' : 'At least 2 teams need to be registered.', 'error'); return; }
    const fmt = rulesOf(t0).fmt, planned = minTeamsOf(t0);
    // the schedule was built for the minimum: tell the organizer when the number of teams changes it
    const changed = n !== planned ? `\n\n⚠️ You planned for ${planned} teams. With ${n}, the format and game times change (rebuilt now, you can edit them).` : '';
    const note = planNote(n, fmt) ? `\n\n⚠️ ${planNote(n, fmt)}` : '';
    if (!redo) {
        const money = !unpaid.length ? '' : t0.requirePay ? `\n\nNot paid, so they're taken OUT: ${unpaid.map(x => x.name).join(', ')}.` : `\n\n${unpaid.length} team${unpaid.length === 1 ? " hasn't" : "s haven't"} paid yet.`;
        if (!confirm(`Close registration and do the draw with ${n} teams?\n\n${PLAN_TEXT[planFor(n, fmt)]}${changed}${note}${money}`)) return;
    }
    try {
        await change(t0.id, (t) => {
            if (!['signup', 'draw'].includes(t.status)) return false;
            if (t.requirePay) t.teams = t.teams.filter(x => x.paid);
            const b = buildMatches(t.teams.map(x => x.teamId), rulesOf(t).fmt);
            t.plan = b.plan; t.matches = b.matches; t.status = 'draw';
            // ⏱️ day, time and field for every game, from the format & timing (the organizer checks them after confirming)
            if (t.rules) scheduleMatches(t);
        });
        TT.tab = 'bracket';
        toast(redo ? 'New draw done. 🎲' : `Registration closed. Here is the draw 🎲${n !== planned && t0.rules ? ` The schedule was rebuilt for ${n} teams.` : ''} Redraw or confirm it.`);
    } catch (e) { toast("Couldn't do the draw.", 'error'); }
};
window.tourneyReopen = async function () {
    if (!confirm('Reopen registration? The draw is thrown away.')) return;
    try { await change(TT.open.id, (t) => { t.status = 'signup'; t.matches = []; t.plan = ''; }); toast('Registration is open again.'); }
    catch (e) { toast("Couldn't change it.", 'error'); }
};
window.tourneyConfirmDraw = async function () {
    if (!confirm('Confirm the draw? Everyone gets told who they play. Game times come next.')) return;
    try {
        await change(TT.open.id, (t) => { if (t.status !== 'draw') return false; t.status = 'waiting'; });
        toast('Draw confirmed. Everyone was told. ⏳ Now check the game times.');
        setTimeout(() => window.openTourneyTimes(), 400);   // 📅 next: when and where
    } catch (e) { toast("Couldn't confirm it.", 'error'); }
};
/** Fill the game times from the timeline, then the organizer checks/changes them and publishes. */
window.openTourneyTimes = function () {
    const t = cur(); if (!t) return;
    const ms = (t.matches || []).map(m => ({ ...m }));
    const tmp = { ...t, matches: ms };
    if (t.rules) scheduleMatches(tmp, true);   // ⏱️ from the format & timing (keeps times already set)
    else assignDays(tmp);
    // games on the same day: spread 30 minutes apart unless already set
    const byDay = {};
    tmp.matches.forEach(m => { if (!m.date) return; (byDay[m.date] = byDay[m.date] || []).push(m); });
    const orig = new Map((t.matches || []).map(m => [m.id, m]));
    Object.values(byDay).forEach(list => list.forEach((m, i) => {
        if ((orig.get(m.id) || {}).time || t.rules) return;
        const [h, mm] = String(m.time || '09:00').split(':').map(Number); const mins = h * 60 + (mm || 0) + i * 30;
        m.time = `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    }));
    sheet('tt-times', '📅 Game times', `
        <p class="text-[11px] text-white/60">Filled in from your format & timing. Change anything, then publish: everyone in the tournament gets told and the games show on the FutNet Games page.</p>
        ${t.rules ? `<button onclick="ttRebuildTimes()" class="${DARK} w-full py-2.5">🔄 Rebuild all times from the format & timing</button>` : ''}
        ${tmp.matches.map(m => `<div class="bg-black/40 border border-white/10 rounded-xl p-2.5 space-y-2" data-mt="${esc(m.id)}">
            <div class="text-[11px] font-black ${m.stage === 'final' ? 'text-amber-300' : 'text-[#00F296]'}">${esc(matchLabel(m))}: ${esc(nameOf(t, m.a) || fromLabel(m.aFrom))} vs ${esc(nameOf(t, m.b) || fromLabel(m.bFrom))}</div>
            <div class="grid grid-cols-[1fr_120px] gap-2"><input type="date" class="${INPUT} !py-2" data-k="date" value="${esc(m.date || '')}"><input type="time" class="${INPUT} !py-2 !px-2" data-k="time" value="${esc(m.time || '')}"></div>
            <div class="grid grid-cols-2 gap-2"><input class="${INPUT} !py-2" data-k="place" value="${esc(m.place || '')}" placeholder="Park (blank = ${esc(t.park || 'the park')})">
                <input class="${INPUT} !py-2" data-k="field" list="tt-fields" value="${esc(m.field || '')}" placeholder="Field (e.g. Field 1)"></div>
        </div>`).join('')}
        <datalist id="tt-fields">${Array.from({ length: rulesOf(t).fields || 1 }, (_, i) => `<option value="${esc(fieldName(rulesOf(t), i) || 'Field ' + (i + 1))}">`).join('')}</datalist>
        <button onclick="saveTourneyTimes(true)" class="${GOLDBTN} w-full py-3 text-sm">📣 Publish times</button>
        <button onclick="saveTourneyTimes(false)" class="${DARK} w-full py-2.5">Save without telling anyone</button>`);
};
window.saveTourneyTimes = async function (publish) {
    const t0 = cur(); if (!t0) return;
    const rows = [...document.querySelectorAll('[data-mt]')].map(el => ({ id: el.dataset.mt, date: el.querySelector('[data-k=date]').value, time: el.querySelector('[data-k=time]').value, place: el.querySelector('[data-k=place]').value.trim(), field: (el.querySelector('[data-k=field]') || {}).value?.trim() || '' }));
    if (publish && rows.some(r => !r.date || !r.time)) { toast('Every game needs a day and a time before publishing.', 'error'); return; }
    try {
        await change(t0.id, (t) => {
            rows.forEach(r => { const m = t.matches.find(x => x.id === r.id); if (m) Object.assign(m, { date: r.date, time: r.time, place: r.place, field: r.field }); });
            if (publish && ['draw', 'waiting'].includes(t.status)) t.status = 'set';
            if (publish) t.timesAt = Date.now();
        });
        document.getElementById('tt-times')?.remove();
        toast(publish ? 'Game times published. 📣' : 'Saved.');
    } catch (e) { toast("Couldn't save the times.", 'error'); }
};
window.ttRebuildTimes = function () {
    if (!confirm('Rebuild every game time from the format & timing? Times you changed by hand are replaced (nothing is saved until you publish or save).')) return;
    const t = cur(); if (!t) return;
    const keepOpen = { ...t, matches: (t.matches || []).map(m => m.done ? { ...m } : { ...m, date: '', time: '', field: '' }) };
    TT.over = keepOpen; try { window.openTourneyTimes(); } finally { TT.over = null; }
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
// 🎁 Prizes (Admin): starts with 1st, then "+ Add 2nd place prize", and so on
window.openTourneyPrizes = function () {
    const t = cur(); if (!t) return;
    window._ttPz = (t.prizes || []).length ? t.prizes.map(p => ({ place: p.place || '', prize: p.prize || '' })) : [{ place: '🥇 1st', prize: '' }];
    window._ttPzNote = t.prizeNote || '';
    ttDrawPrizes();
};
function ttDrawPrizes() {
    const pz = window._ttPz || [];
    const next = pz.length ? nextPlace(pz) : '🥇 1st';
    const nice = next.replace(/^[^A-Za-z0-9]+\s*/, '');
    sheet('tt-prizes', '🎁 Prizes', `
        ${pz.map((p, i) => `<div class="grid gap-2 items-center" style="grid-template-columns:100px 1fr 28px"><input class="${INPUT} !py-2 !text-xs" value="${esc(p.place)}" oninput="_ttPz[${i}].place=this.value">
            <input class="${INPUT} !py-2" value="${esc(p.prize)}" placeholder="${i === 0 ? 'e.g. $400 + trophy' : 'e.g. $100, medals'}" oninput="_ttPz[${i}].prize=this.value">
            ${i > 0 ? `<button onclick="_ttPz.splice(${i},1); ttDrawPrizesNow()" class="w-7 h-7 rounded-full bg-black/60 border border-white/20 text-xs"><i class="fa-solid fa-xmark"></i></button>` : '<span></span>'}</div>`).join('')}
        ${pz.length < 9 ? `<button onclick="_ttPz.push({ place: '${jsq(next)}', prize: '' }); ttDrawPrizesNow()" class="w-full py-2.5 rounded-xl border border-dashed border-amber-400/60 text-amber-200 text-xs font-black">＋ Add ${esc(nice)}${/^\d/.test(nice) ? ' place' : ''} prize</button>` : ''}
        <div>${LBL('Note (optional)')}<input id="tp-note" class="${INPUT}" value="${esc(window._ttPzNote)}" oninput="_ttPzNote=this.value" placeholder="e.g. Prize money depends on how many teams register"></div>
        <button onclick="saveTourneyPrizes()" class="${GOLDBTN} w-full py-3 text-sm">Save prizes</button>`);
}
window.ttDrawPrizesNow = ttDrawPrizes;
window.saveTourneyPrizes = async function () {
    const prizes = (window._ttPz || []).map(p => ({ place: String(p.place || '').trim(), prize: String(p.prize || '').trim() })).filter(p => p.prize);
    try { await change(TT.open.id, (t) => { t.prizes = prizes; t.prizeNote = val('tp-note'); }); document.getElementById('tt-prizes')?.remove(); toast('Prizes saved. 🎁'); }
    catch (e) { toast("Couldn't save the prizes.", 'error'); }
};

// ---------------------------------------------------------------- scores
window.openTourneyScore = function (mid) {
    const t = cur(); if (!t) return;
    if (!canScore(t) && !((t.matches || []).find(x => x.id === mid) || {}).clock) { toast('Publish the game times first (Admin tab).', 'error'); return; }
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
    const t = cur(); if (!t) return;
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
    const t0 = cur(); if (!t0) return;
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
            if (m.clock) m.clock = { ...m.clock, runAt: 0, acc: m.clock.runAt ? (+m.clock.acc || 0) + Date.now() - m.clock.runAt : (+m.clock.acc || 0), ft: true };
            // a changed result can change who goes through: clear later rounds that depended on it and weren't played
            t.matches.forEach(x => { if (!x.done && (x.aFrom || x.bFrom)) { if (x.aFrom) x.a = ''; if (x.bFrom) x.b = ''; } });
            champ = advance(t);
            t.championId = champ; t.status = champ ? 'final' : 'running';
        });
        document.getElementById('tt-score')?.remove();
        if (champ) { toast(`🏆 ${nameOf(cur(), champ) || 'We have a champion'}!`); TT.tab = 'info'; }
        else toast('Score saved. ✅');
    } catch (e) { toast(String(e && e.message) === 'PENS' ? 'Pick who won on penalties.' : "Couldn't save the score.", 'error'); }
};
window.clearTourneyScore = async function (mid) {
    const t0 = cur(); if (!t0) return;
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
    const t = cur(); if (!t) return;
    const m = (t.matches || []).find(x => x.id === mid); if (!m) return;
    sheet('tt-when', `📅 ${esc(matchLabel(m))}`, `
        <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0">${LBL('Day')}<input id="tw-date" type="date" class="${INPUT}" value="${esc(m.date || '')}"></div>
            <div class="min-w-0">${LBL('Time')}<input id="tw-time" type="time" class="${INPUT}" value="${esc(m.time || '')}"></div>
        </div>
        <div>${LBL('Park (blank = the tournament park)')}<input id="tw-place" class="${INPUT}" value="${esc(m.place || '')}" placeholder="${esc(t.location || '')}"></div>
        <div>${LBL('Field')}<input id="tw-field" list="tw-fields" class="${INPUT}" value="${esc(m.field || '')}" placeholder="e.g. Field 1"><datalist id="tw-fields">${Array.from({ length: rulesOf(t).fields || 1 }, (_, i) => `<option value="${esc(fieldName(rulesOf(t), i) || 'Field ' + (i + 1))}">`).join('')}</datalist></div>
        <button onclick="saveTourneyWhen('${jsq(mid)}')" class="${BTN} w-full py-3 text-sm">Save</button>`);
};
window.saveTourneyWhen = async function (mid) {
    const t0 = cur(); if (!t0) return;
    const date = val('tw-date'), time = val('tw-time'), place = val('tw-place'), field = val('tw-field');
    try {
        await change(t0.id, (t) => { const m = t.matches.find(x => x.id === mid); if (!m) return false; Object.assign(m, { date, time, place, field }); });
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
    const t = cur(); if (!t) return;
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
    recordTourneyView(id);   // 📈 Analytics (who opened it)
};
window.closeTourney = () => { TT.open = null; if (TT.chatUnsub) { TT.chatUnsub(); TT.chatUnsub = null; TT.chatId = ''; } document.getElementById('tt-page')?.remove(); };
window.ttTab = (k) => { TT.tab = k; drawPage(); };
window.ttTeamFilter = (id) => { TT.teamFilter = id; TT.teamFilterOf = TT.open && TT.open.id; drawPage(); };
window.shareTourney = async function () {
    const t = cur(); if (!t) return;
    const text = `🏆 ${t.name} · ${daysText(t)} at ${t.location || ''}. ${canRegister(t) ? 'Register your team on FutNet!' : ''}`;
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
        <div class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider"><span class="${m.stage === 'final' ? 'text-amber-300' : 'text-[#00F296]'}">${m.stage === 'final' ? '🏆 ' : ''}${esc(matchLabel(m))}${(m.livestream && m.livestream.status === 'live') || matchIsLive(m) ? ' <span onclick="event.stopPropagation(); openTourneyMatch(\'' + jsq(t.id) + '\', \'' + jsq(m.id) + '\')" class="ml-1 bg-red-600 text-white px-1.5 py-0.5 rounded normal-case tracking-normal cursor-pointer">● LIVE' + (m.livestream && m.livestream.status === 'live' ? ' 🎥' : '') + '</span>' : ''}</span>${can ? `<span class="text-white/45 normal-case tracking-normal font-bold">${m.done ? 'Edit' : 'Enter score'} ›</span>` : ''}</div>
        <div class="flex items-center gap-2">${side(A, m.aFrom)}${mid}${side(B, m.bFrom, true)}</div>
        ${timesOut && (m.date || m.time) ? `<div class="flex items-center justify-center gap-2 text-[10px] text-white/60"><span>📅 ${esc(shortDate(m.date))}${m.time ? ' · ' + esc(prettyTime(m.time)) : ''}${m.place ? ' · ' + esc(m.place) : ''}${m.field ? ' · ' + esc(m.field) : ''}</span>${boss && t.status !== 'final' ? `<button onclick="event.stopPropagation(); openTourneyWhen('${jsq(m.id)}')" class="text-amber-300 font-bold underline">change</button>` : ''}</div>`
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
    const plan = t.plan || planFor(n, rulesOf(t).fmt);
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
            <div class="flex items-center gap-2"><i class="fa-solid fa-circle-dollar-to-slot text-[#00F296] w-4"></i>${+t.priceCents ? `${money(t.priceCents)} per team${t.requirePay ? ' · <b class="text-amber-300">must pay to be confirmed</b>' : ''}` : 'Free'}</div>
            ${t.communityId ? `<div class="flex items-center gap-2"><i class="fa-solid fa-people-roof text-[#00F296] w-4"></i>${esc(t.communityName || 'Community')}</div>` : ''}
            <div class="flex items-start gap-2"><i class="fa-solid fa-sitemap text-[#00F296] w-4 mt-0.5"></i><span>${t.status === 'signup' ? `${n >= 2 ? `With ${n} teams: ${esc(PLAN_TEXT[planFor(n, rulesOf(t).fmt)])}` : t.rules ? `With ${min} teams: ${esc(PLAN_TEXT[planFor(min, rulesOf(t).fmt)])}` : 'The format comes from how many teams register (4 = knockout, 6 = 2 groups of 3, 8 = quarter-finals).'}` : esc(PLAN_TEXT[plan])}</span></div>
        </div>
        ${rulesHtml(t)}
        ${t.rules && t.status === 'signup' ? previewHtml(t, Math.max(n, min), `📅 Planned schedule with ${Math.max(n, min)} teams`) : ''}
        ${(t.prizes || []).length ? `<button onclick="ttTab('prizes')" class="w-full bg-amber-400/10 border border-amber-400/40 rounded-2xl p-3 text-left text-xs"><b class="text-amber-200">🎁 Prizes:</b> ${t.prizes.map(p => esc(p.place) + ' ' + esc(p.prize)).join(' · ')}</button>` : ''}
        ${t.description ? `<div class="bg-black/40 border border-white/10 rounded-2xl p-3"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">Details & rules</div><p class="text-xs text-white/85 whitespace-pre-line">${esc(t.description)}</p></div>` : ''}
        ${canRegister(t) && !(myCaptainTeams().length && myCaptainTeams().every(y => (t.teamIds || []).includes(y.id))) ? `<button onclick="ttRegisterTeam('${jsq(t.id)}')" class="${GOLDBTN} w-full py-3 text-sm">📝 Register your team</button>` : ''}
        ${t.status === 'signup' && !regOver(t) ? `<p class="text-[11px] text-center text-white/60">📝 Registration closes ${esc(regCloseText(t))}</p>` : ''}
        ${t.status === 'signup' && regOver(t) ? `<p class="text-xs text-center text-amber-300 font-bold">Registration is closed${t.regClose ? '' : ': the tournament has started'}.</p>` : t.status === 'signup' && n >= max ? '<p class="text-xs text-center text-amber-300 font-bold">Registration is full.</p>' : ''}
        <div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-2xl p-3"><div class="text-[9px] font-bold text-white/55 uppercase">Organized by</div><div class="text-sm font-black">${esc(t.organizerName || 'Organizer')}</div></div>
    </div>`;
    const teams = `<div class="space-y-2">${(t.teams || []).map(x => { const r = rosterOf(x); const mine = myIn.some(y => y.teamId === x.teamId) && !x.manual; return `<div class="bg-black/40 border ${mine ? 'border-[#00F296]/50' : 'border-white/10'} rounded-2xl p-3 space-y-2">
            <div class="flex items-center gap-3">
                <button onclick="${x.manual ? '' : `window.openTeam && openTeam('${jsq(x.teamId)}')`}" class="shrink-0">${teamLogoHtml(x, 40)}</button>
                <div class="flex-1 min-w-0"><div class="text-sm font-black truncate">${esc(x.name)}${t.championId === x.teamId ? ' 🏆' : ''}</div>
                    <div class="text-[11px] text-white/55">${r.length} players${x.manual ? ' · added by the organizer' : x.joinedByName ? ' · captain ' + esc(x.joinedByName) : ''}${+t.priceCents ? ` · <span class="${x.paid ? 'text-[#00F296]' : 'text-amber-300'}">${x.paid ? (t.requirePay ? '✅ Confirmed (paid)' : 'Paid') : (t.requirePay ? '⏳ Pending payment' : 'Not paid yet')}</span>` : ''}</div></div>
                ${boss && +t.priceCents ? `<button onclick="toggleTourneyPaid('${jsq(x.teamId)}')" class="${x.paid ? DARK : BTN} shrink-0">${x.paid ? 'Undo paid' : '💵 Paid'}</button>` : ''}
            </div>
            ${r.length ? `<div class="flex flex-wrap gap-1">${r.map(p => `<span class="text-[10px] font-bold rounded-full px-2 py-1 bg-white/10">${p.number ? esc(p.number) + ' · ' : ''}${esc(p.name || 'Player')}${p.uid && window.badgeHtml ? window.badgeHtml(p.uid) : ''}</span>`).join('')}</div>` : ''}
            ${(mine && t.status !== 'final') || boss ? `<div class="flex gap-2">${`<button onclick="openTourneyPlayers('${jsq(x.teamId)}', false)" class="${DARK}">👥 ${boss && t.status === 'final' ? 'Fix players' : mine ? 'Change players' : 'Pick players'}</button>`}
                ${t.status === 'signup' ? `<button onclick="leaveTourney('${jsq(x.teamId)}')" class="text-[11px] font-bold text-red-400 px-2">${mine ? 'Leave' : 'Remove'}</button>` : ''}</div>` : ''}
        </div>`; }).join('') || '<p class="text-xs text-white/45 text-center py-6">No teams yet. Share it so captains can register!</p>'}
        ${t.status === 'signup' ? `<p class="text-[11px] text-white/50 text-center">${n} of ${max} teams${n < min ? ` · needs at least ${min}` : ''}</p>` : ''}</div>`;
    const ms = t.matches || [];
    // 🔎 all matches, or only one team's
    const tf = TT.teamFilter && TT.teamFilterOf === t.id ? TT.teamFilter : '';
    const inTeams = (t.teams || []).filter(x => ms.some(m => m.a === x.teamId || m.b === x.teamId));
    const ttPicker = inTeams.length > 2 ? `<select onchange="ttTeamFilter(this.value)" aria-label="Show matches of"
        class="w-full bg-black/60 border ${tf ? 'border-amber-400 text-amber-200' : 'border-white/15 text-white'} rounded-xl px-3 py-2.5 text-xs font-bold">
        <option value="">All teams (${ms.length} matches)</option>
        ${inTeams.map(x => `<option value="${esc(x.teamId)}" ${tf === x.teamId ? 'selected' : ''}>${esc(nameOf(t, x.teamId) || x.name || 'Team')} (${ms.filter(m => m.a === x.teamId || m.b === x.teamId).length})</option>`).join('')}
    </select>` : '';
    const bracket = !ms.length ? `<p class="text-xs text-white/50 text-center py-6">The bracket shows here after the draw.${t.status === 'signup' ? ' Registration is still open.' : ''}</p>` : tf ? `<div class="space-y-3">
        ${ttPicker}
        ${ms.filter(m => m.a === tf || m.b === tf).map(m => `<div class="space-y-1"><div class="text-[10px] font-black uppercase tracking-wider text-white/55">${esc(matchLabel(m))}</div>${matchRow(t, m, boss)}</div>`).join('') || '<p class="text-xs text-white/45 text-center py-6">This team has no matches yet.</p>'}
    </div>` : `<div class="space-y-4">
        ${ttPicker}
        ${t.status === 'draw' ? `<div class="text-[11px] text-center text-amber-200 font-bold">🎲 Draw preview${boss ? ': redraw or confirm it in Admin.' : ': not final yet.'}</div>` : ''}
        ${boss && canScore(t) && t.status !== 'final' ? '<p class="text-[11px] text-white/55">Tap a game to enter its score. The next round fills in by itself.</p>' : ''}
        ${plan === 'league' ? `${tableHtml(t, 'league', '', 'League table', 2)}<div class="space-y-2">${ms.filter(m => m.stage === 'league').map(m => matchRow(t, m, boss)).join('')}</div>` : ''}
        ${plan === 'groups' ? ['A', 'B'].map(g => `${tableHtml(t, 'group', g, `Group ${g}`, 1)}<div class="space-y-2">${ms.filter(m => m.stage === 'group' && m.group === g).map(m => matchRow(t, m, boss)).join('')}</div>`).join('') : ''}
        ${['qf', 'sf', 'final'].filter(s => ms.some(m => m.stage === s)).map(s => `<div class="space-y-2"><div class="text-[10px] font-black uppercase tracking-wider ${s === 'final' ? 'text-amber-300' : 'text-white/55'}">${s === 'qf' ? 'Quarter-finals' : s === 'sf' ? 'Semi-finals' : 'Final'}</div>${ms.filter(m => m.stage === s).map(m => matchRow(t, m, boss)).join('')}</div>`).join('')}
        ${scorersHtml(t)}
    </div>`;
    const mLabel = (id) => { const x = (t.matches || []).find(y => y.id === id); return x ? `${matchLabel(x)}: ${nameOf(t, x.a) || '?'} vs ${nameOf(t, x.b) || '?'}` : ''; };
    const chat = `<div class="space-y-3">
        <div class="space-y-2 max-h-[55vh] overflow-y-auto" id="tt-chat-list">${(TT.chat || []).map(c => `<div class="flex gap-2 ${c.uid === myUid() ? 'flex-row-reverse text-right' : ''}">
            <img src="${esc(c.avatar || DEFAULT_AV)}" onerror="this.onerror=null;this.src='${DEFAULT_AV}'" class="w-7 h-7 rounded-full object-cover shrink-0">
            <div class="max-w-[78%] ${c.uid === myUid() ? 'bg-[#00F296]/15 border-[#00F296]/30' : 'bg-black/50 border-white/10'} border rounded-2xl px-3 py-2">
                <div class="text-[10px] font-black ${c.uid === t.organizerId ? 'text-amber-300' : 'text-white/60'}">${esc(c.name || 'Player')}${c.uid === t.organizerId ? ' · organizer' : ''}${window.badgeHtml ? window.badgeHtml(c.uid) : ''}</div>
                ${c.matchId && mLabel(c.matchId) ? `<button onclick="openTourneyMatch('${jsq(t.id)}', '${jsq(c.matchId)}')" class="block text-[9px] font-black text-amber-300/90 underline text-left">on ${esc(mLabel(c.matchId))}</button>` : ''}
                <div class="text-xs text-white/90 whitespace-pre-wrap break-words text-left">${smartText(c.text)}</div>
                <div class="text-[9px] text-white/35">${esc(new Date(c.at || 0).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</div></div></div>`).join('') || '<p class="text-xs text-white/45 text-center py-6">No messages yet. Say hi to the other teams!</p>'}</div>
        ${myUid() ? `<div class="flex gap-2"><input id="tt-chat-in" class="${INPUT}" maxlength="1000" placeholder="${iPlay || boss ? 'Message everyone in the tournament…' : 'Ask the organizer a question…'}" onkeydown="if(event.key==='Enter')sendTourneyChat()"><button onclick="sendTourneyChat()" class="${BTN} shrink-0"><i class="fa-solid fa-paper-plane"></i></button></div>` : ''}
    </div>`;
    const prizes = `<div class="space-y-2">
        ${t.trophy && t.trophyPhoto ? `<div class="flex flex-col items-center gap-1"><img src="${esc(t.trophyPhoto)}" onclick="window.open('${jsq(t.trophyPhoto)}','_blank')" class="w-44 h-44 rounded-3xl object-cover border-2 border-amber-400/70 shadow-xl cursor-pointer" alt="The trophy"><div class="text-[11px] font-black text-amber-200">🏆 The trophy</div></div>` : ''}${(t.prizes || []).map(p => `<div class="flex items-center gap-3 bg-amber-400/10 border border-amber-400/40 rounded-2xl p-3"><div class="text-sm font-black text-amber-200 w-20 shrink-0">${esc(p.place)}</div><div class="text-sm font-bold">${esc(p.prize)}</div></div>`).join('') || '<p class="text-xs text-white/45 text-center py-6">No prizes listed yet.</p>'}
        ${t.prizeNote ? `<p class="text-[11px] text-white/60">${esc(t.prizeNote)}</p>` : ''}
        ${boss ? `<button onclick="openTourneyPrizes()" class="${GOLDBTN} w-full py-3">🎁 Edit prizes</button>` : ''}</div>`;
    const nextStep = {
        signup: `<button onclick="tourneyDraw(false)" class="${GOLDBTN} w-full py-3 text-sm">🎲 Close registration & do the draw</button><p class="text-[11px] text-white/55">${n} of ${max} teams registered${n < min ? ` (you wanted at least ${min})` : ''}. The format: ${n >= 2 ? esc(PLAN_TEXT[planFor(n, rulesOf(t).fmt)]) : 'needs 2+ teams'}</p>${t.rules && n >= 2 && n !== min ? `<p class="text-[11px] text-amber-200">⚠️ You planned for ${min} teams. With ${n}, the schedule is rebuilt at the draw.</p>` : ''}`,
        draw: `<button onclick="tourneyConfirmDraw()" class="${GOLDBTN} w-full py-3 text-sm">✅ Confirm the draw (tell everyone)</button><div class="grid grid-cols-2 gap-2"><button onclick="tourneyDraw(true)" class="${DARK} py-2.5">🎲 Redraw</button><button onclick="tourneyReopen()" class="${DARK} py-2.5">↩️ Reopen registration</button></div>`,
        waiting: `<button onclick="openTourneyTimes()" class="${GOLDBTN} w-full py-3 text-sm">📅 Set the game times</button><p class="text-[11px] text-white/55">They're filled in from your format & timing; change anything, then publish. Published games show on the FutNet Games page.</p>`,
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
            <button onclick="copyTourney()" class="${DARK} py-3">📋 Copy tournament</button>
            <button onclick="openTourneyAnalytics()" class="${DARK} py-3">📈 Analytics</button>
            ${t.status !== 'final' && t.status !== 'cancelled' ? `<button onclick="openTourneyStorm()" class="${DARK} py-3 ${ttStormOn(t) ? '!border-amber-400/70 !text-amber-200' : ''}">⛈️ Storm watch</button>` : ''}
            ${t.status === 'signup' ? `<button onclick="openTourneyAddTeam()" class="${DARK} py-3">➕ Add a team</button>` : ''}
            ${t.status !== 'final' ? `<button onclick="cancelTourney()" class="${DARK} py-3 text-red-400">❌ Cancel</button>` : ''}
        </div>
        ${+t.priceCents ? `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 text-xs"><b>Payments:</b> ${(t.teams || []).filter(x => x.paid).length} of ${n} paid · ${money((t.teams || []).filter(x => x.paid).length * t.priceCents)} collected. Mark payments in the Teams tab.</div>` : ''}
        ${(t.announcements || []).length ? `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-1.5"><div class="text-[10px] font-black uppercase tracking-wider text-white/55">Updates sent</div>${t.announcements.slice().reverse().map(a => `<div class="text-[11px] text-white/75"><span class="text-white/45">${esc(new Date(a.at).toLocaleDateString([], { month: 'short', day: 'numeric' }))}:</span> ${esc(a.text)}</div>`).join('')}</div>` : ''}
    </div>`;
    const showPrizes = (t.prizes || []).length || t.trophyPhoto || boss;
    el.innerHTML = `<div class="max-w-4xl mx-auto w-full px-4 pt-3 pb-24 space-y-3">
        <div class="bg-[#040E13]/90 backdrop-blur-md border-2 border-emerald-500/30 px-5 py-3.5 rounded-3xl shadow-lg flex items-center justify-between gap-3">
            <button onclick="closeTourney()" aria-label="Back" class="w-9 h-9 bg-black/60 hover:bg-black text-white rounded-full flex items-center justify-center border border-white/20 shrink-0"><i class="fa-solid fa-chevron-left text-xs"></i></button>
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2"><h2 class="text-base font-black tracking-tight truncate">${esc(t.name || 'Tournament')}</h2>
                    <span class="px-2.5 py-0.5 bg-amber-400/20 text-amber-200 font-black text-[9px] rounded-full uppercase tracking-wider border border-amber-400/50 shrink-0">${esc(STEPS[stepIndex(t.status)][2] + ' ' + STEPS[stepIndex(t.status)][1])}</span>
                    ${(t.matches || []).some(m => matchIsLive(m) || (m.livestream && m.livestream.status === 'live')) ? `<button onclick="ttTab('bracket')" class="px-2 py-0.5 bg-red-600 text-white font-black text-[9px] rounded-full shrink-0">● LIVE</button>` : ''}</div>
                <p class="text-xs text-white/60 truncate mt-0.5"><i class="fa-solid fa-location-dot text-[#00F296] mr-1"></i>${esc(t.location || '')}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                ${mapsUrl ? `<a href="${mapsUrl}" target="_blank" rel="noopener" aria-label="Navigate" class="w-9 h-9 bg-[#00F296] text-slate-950 rounded-full flex items-center justify-center"><i class="fa-solid fa-location-arrow text-xs"></i></a>` : ''}
                <button onclick="shareTourney()" aria-label="Share" class="w-9 h-9 bg-[#00F296] text-slate-950 rounded-full flex items-center justify-center"><i class="fa-solid fa-share-nodes text-xs"></i></button>
            </div>
        </div>
        ${ttStormCardHtml(t)}
        <div data-scroll-hint class="bg-black/40 border-2 border-emerald-500/30 p-1.5 rounded-2xl flex items-center space-x-1 overflow-x-auto shadow-md backdrop-blur-md">
            ${boss ? tabBtn('admin', '⚙️ Admin') : ''}${tabBtn('info', 'Info')}${tabBtn('teams', `Teams (${n}/${max})`)}${tabBtn('bracket', '🏆 Bracket')}${tabBtn('chat', '💬 Chat')}${showPrizes ? tabBtn('prizes', '🎁 Prizes') : ''}
        </div>
        <div class="bg-[#040E13]/95 border-2 border-emerald-500/30 rounded-3xl p-4 shadow-2xl">
            ${tab === 'admin' ? admin : tab === 'teams' ? teams : tab === 'bracket' ? bracket : tab === 'chat' ? chat : tab === 'prizes' ? prizes : info}
        </div>
    </div>`;
    if (tab === 'chat') { const l = document.getElementById('tt-chat-list'); if (l) l.scrollTop = l.scrollHeight; }
}
// ---------------------------------------------------------------- ⛈️ Storm watch (same as games and VS)
//   t.gameStatus = { stormWatch, state: 'on' | 'likely' | 'unlikely', note, by, byName, at }. Saving also sends an update to everyone (announcements).
const TT_STORM = {
    on: { emoji: '✅', label: 'Games on', cls: 'bg-emerald-500/15 text-[#00F296] border-emerald-400/60' },
    likely: { emoji: '🟡', label: 'Games likely', cls: 'bg-amber-500/15 text-amber-300 border-amber-400/60' },
    unlikely: { emoji: '🔴', label: 'Games not likely', cls: 'bg-red-500/15 text-red-300 border-red-400/60' },
};
export const ttStormOn = (t) => !!(t && t.gameStatus && t.gameStatus.stormWatch === true) && !['final', 'cancelled'].includes(t.status);
const ttStormState = (t) => (TT_STORM[t && t.gameStatus && t.gameStatus.state] ? t.gameStatus.state : 'on');
function ttStormCardHtml(t) {
    if (!ttStormOn(t)) return '';
    const s0 = TT_STORM[ttStormState(t)], note = String(t.gameStatus.note || '').trim();
    return `<div class="bg-[#1A1405]/95 border-2 border-amber-400/60 rounded-2xl p-3 space-y-2">
        <div class="flex items-center gap-3"><div class="text-3xl leading-none">⛈️</div>
            <div class="flex-1 min-w-0"><div class="text-[10px] font-black uppercase tracking-wider text-amber-300">Storm watch</div><div class="text-xs text-white/80">The organizer is watching the weather.</div></div>
            <span class="shrink-0 px-3 py-1.5 rounded-full border-2 text-xs font-black ${s0.cls}">${s0.emoji} ${s0.label}</span></div>
        ${note ? `<p class="text-xs text-white/90">${esc(note)}</p>` : ''}</div>`;
}
window.openTourneyStorm = function () {
    const t = cur(); if (!t) return;
    const on = ttStormOn(t), st = ttStormState(t);
    sheet('tt-storm', '⛈️ Storm watch', `
        <p class="text-[11px] text-white/65">Shows a weather box on the tournament and tells everyone in it (every team's players and you).</p>
        <div class="space-y-2">${Object.entries(TT_STORM).map(([k, s0]) => `<label class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 cursor-pointer">
            <input type="radio" name="tt-storm-state" value="${k}" ${st === k ? 'checked' : ''} class="w-4 h-4 accent-[#00F296]"><span class="text-xs font-bold">${s0.emoji} ${s0.label}</span></label>`).join('')}</div>
        <input id="tt-storm-note" maxlength="160" value="${esc((t.gameStatus && t.gameStatus.note) || '')}" placeholder="Note for players (optional), e.g. We'll decide at 8 AM" class="${INPUT}">
        <button onclick="saveTourneyStorm(true)" class="${GOLDBTN} w-full py-3">${on ? 'Save and notify' : 'Turn on and notify'}</button>
        ${on ? `<button onclick="saveTourneyStorm(false)" class="${DARK} w-full py-2.5">Turn Storm watch off</button>` : ''}
        <p class="text-[10px] text-white/45">Need to move the games? Use 📅 Change game times. Calling it off? ❌ Cancel.</p>`);
};
window.saveTourneyStorm = async function (turnOn) {
    const t0 = cur(); if (!t0) return;
    const state = (document.querySelector('input[name="tt-storm-state"]:checked') || {}).value || 'on';
    const note = (document.getElementById('tt-storm-note')?.value || '').trim().slice(0, 160);
    const s0 = TT_STORM[state];
    const text = turnOn ? `⛈️ Storm watch: ${s0.emoji} ${s0.label}${note ? `. ${note}` : ''}` : '☀️ Storm watch is off. The games are on as planned.';
    try {
        await change(t0.id, (t) => {
            t.gameStatus = { stormWatch: !!turnOn, state, note, by: myUid(), byName: myName(), at: Date.now() };
            t.announcements = [...(t.announcements || []), { text, at: Date.now(), by: myUid(), byName: myName() }].slice(-20);   // everyone gets it
        });
        document.getElementById('tt-storm')?.remove();
        toast(turnOn ? `Saved: ${s0.label}. Everyone was notified.` : 'Storm watch off. Everyone was notified.');
    } catch (e) { toast("Couldn't save.", 'error'); }
};

// ---------------------------------------------------------------- 📈 Analytics (organizer): views + teams, players, games, goals
//   Who opened it: tournaments/{id}/views/{uid}, written and read by the server (recordTourneyView / tourneyViews), once per person per 30 min.
function recordTourneyView(id) {
    if (!id || !window.currentUser) return;
    try { const k = 'futnet_ttview_' + id; const last = +localStorage.getItem(k) || 0; if (Date.now() - last < 30 * 60000) return; localStorage.setItem(k, String(Date.now())); } catch (e) { /* ignore */ }
    import("https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js").then(({ getFunctions, httpsCallable }) => httpsCallable(getFunctions(), 'recordTourneyView')({ id })).catch(() => {});
}
window.openTourneyAnalytics = async function () {
    const t = cur(); if (!t) return;
    const teams = t.teams || [], ms = t.matches || [], played = ms.filter(m => m.done);
    const players = teams.reduce((n, x) => n + rosterOf(x).length, 0), fills = teams.reduce((n, x) => n + rosterOf(x).filter(p => p.fillIn || String(p.id || '').startsWith('fill_')).length, 0);
    const goals = played.reduce((n, m) => n + (+m.ga || 0) + (+m.gb || 0), 0);
    const sc = {}; ms.forEach(m => (m.goals || []).forEach(g => { if (!g.name || g.own) return; const k = g.name + '|' + g.teamId; sc[k] = sc[k] || { name: g.name, team: nameOf(t, g.teamId), n: 0 }; sc[k].n++; }));
    const top = Object.values(sc).sort((a, b) => b.n - a.n).slice(0, 5);
    const paid = teams.filter(x => x.paid).length;
    const box = (n, l, c = 'text-white') => `<div class="bg-black/40 border border-white/10 rounded-xl p-2 text-center"><div class="text-xl font-black ${c}">${n}</div><div class="text-[10px] text-white/55">${l}</div></div>`;
    const head = `<div class="text-[11px] font-black uppercase tracking-wider text-amber-300">The tournament</div>
        <div class="grid grid-cols-3 gap-2">${box(`${teams.length}/${maxTeamsOf(t)}`, 'teams', 'text-amber-200')}${box(players, 'players')}${box(fills, 'fill-ins')}
        ${+t.priceCents ? box(`${paid}/${teams.length}`, 'paid', 'text-[#00F296]') + box(money(paid * t.priceCents), 'collected', 'text-[#00F296]') : ''}
        ${box(`${played.length}/${ms.length}`, 'games played')}${box(goals, 'goals', 'text-[#00F296]')}${played.length ? box((goals / played.length).toFixed(1), 'goals a game') : ''}</div>
        ${top.length ? `<div class="text-[11px] font-black uppercase tracking-wider text-amber-300 pt-1">Top scorers</div><div class="space-y-1">${top.map((x, i) => `<div class="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs"><span class="w-5 font-black text-amber-200">${i + 1}</span><span class="flex-1 truncate font-bold">${esc(x.name)} <span class="text-white/45 font-normal">${esc(x.team)}</span></span><span class="font-black">${x.n} ⚽</span></div>`).join('')}</div>` : ''}`;
    const AV = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/icons/person-circle.svg';
    const draw = (rest) => sheet('tt-analytics', '📈 Analytics', head + rest);
    draw('<p class="text-xs text-white/50 text-center py-6"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Loading who opened it…</p>');
    let list = null;
    try { const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js"); list = ((await httpsCallable(getFunctions(), 'tourneyViews')({ id: t.id })).data || {}).list || []; } catch (e) { list = null; }
    if (!document.getElementById('tt-analytics')) return;
    if (!list) { draw('<p class="text-xs text-white/55 py-4">Couldn\'t load who opened it. Is the newest server code deployed?</p>'); return; }
    const inIt = new Set(teams.flatMap(x => [x.joinedBy, ...rosterOf(x).map(p => p.uid)]).filter(Boolean));
    const visits = list.reduce((n, v) => n + (+v.count || 0), 0), notIn = list.filter(v => !inIt.has(v.uid)).length;
    draw(`<div class="text-[11px] font-black uppercase tracking-wider text-amber-300 pt-1">Who opened it</div>
        <div class="grid grid-cols-3 gap-2">${box(list.length, 'people', 'text-amber-200')}${box(visits, 'visits')}${box(notIn, 'looked, not in it', 'text-amber-300')}</div>
        <p class="text-[10px] text-white/45">Everyone who opened this tournament (once per 30 minutes). Your own visits don't count.</p>
        <div class="space-y-1.5">${list.map(v => `<div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl px-3 py-2">
            <img src="${esc(v.avatar || AV)}" onerror="this.onerror=null;this.src='${AV}'" class="w-8 h-8 rounded-full object-cover">
            <span class="flex-1 min-w-0"><span class="block text-xs font-black truncate">${esc(v.name)} ${inIt.has(v.uid) ? '<span class="text-[9px] text-[#00F296]">IN IT</span>' : ''}</span>
            <span class="block text-[10px] text-white/50">${v.lastAt ? 'Last seen ' + esc(new Date(v.lastAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}</span></span>
            <span class="text-xs font-black text-white/80">${+v.count || 1}×</span></div>`).join('') || '<p class="text-xs text-white/50 text-center py-4">Nobody has opened it yet. Share it to get it seen!</p>'}</div>`);
};

// ---------------------------------------------------------------- ➕ Add a team by hand (organizer): a team that isn't on FutNet
//   { teamId: 'man_…', manual: true, name, colors: { primary }, roster: [{ id, name, number }], paid, joinedBy: organizer }
const KIT_COLORS = ['#DC2626', '#2563EB', '#16A34A', '#F59E0B', '#7C3AED', '#0EA5E9', '#EC4899', '#111827', '#F8FAFC', '#F97316'];
window.openTourneyAddTeam = function () {
    const t = cur(); if (!t) return;
    window._ttKit = KIT_COLORS[(t.teams || []).length % KIT_COLORS.length];
    sheet('tt-addteam', '➕ Add a team', `
        <p class="text-[11px] text-white/60">For a team that isn't on FutNet. You can change its players later in the Teams tab (Fix players).</p>
        <div>${LBL('Team name')}<input id="tat-name" maxlength="30" class="${INPUT}" placeholder="e.g. Los Galácticos"></div>
        <div>${LBL('Shirt color')}<div class="flex flex-wrap gap-2">${KIT_COLORS.map(c => `<button type="button" data-kit="${c}" onclick="window._ttKit='${c}'; document.querySelectorAll('[data-kit]').forEach(b => b.style.outline = b.dataset.kit === '${c}' ? '3px solid #FACC15' : 'none')" class="w-9 h-9 rounded-full border border-white/30" style="background:${c}; outline:${c === window._ttKit ? '3px solid #FACC15' : 'none'}"></button>`).join('')}</div></div>
        <div>${LBL('Players (one per line, optional)')}<textarea id="tat-roster" rows="6" maxlength="1200" class="${INPUT}" placeholder="Juan\nCarlos\nMiguel"></textarea></div>
        ${+t.priceCents ? `<label class="flex items-center gap-2 text-xs font-bold"><input id="tat-paid" type="checkbox" class="w-4 h-4 accent-[#00F296]"> They already paid</label>` : ''}
        <button onclick="saveTourneyAddTeam()" class="${GOLDBTN} w-full py-3">➕ Add the team</button>`);
    setTimeout(() => document.getElementById('tat-name')?.focus(), 50);
};
window.saveTourneyAddTeam = async function () {
    const t0 = cur(); if (!t0) return;
    const name = (document.getElementById('tat-name')?.value || '').trim().slice(0, 30);
    if (!name) { toast('Write the team name.', 'error'); return; }
    const roster = (document.getElementById('tat-roster')?.value || '').split('\n').map(x => x.trim().slice(0, 40)).filter(Boolean).slice(0, 30)
        .map((nm, i) => ({ id: `man_${Date.now().toString(36)}_${i}`, name: nm, number: '', uid: '', position: '' }));
    const paid = !(+t0.priceCents) || !!document.getElementById('tat-paid')?.checked;
    const teamId = 'man_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
        await change(t0.id, (t) => {
            if (t.status !== 'signup') throw new Error('STARTED');
            if ((t.teams || []).length >= maxTeamsOf(t)) throw new Error('FULL');
            if ((t.teams || []).some(x => String(x.name || '').toLowerCase() === name.toLowerCase())) throw new Error('SAME');
            t.teams = [...(t.teams || []), { teamId, manual: true, name, short: '', logo: null, colors: { primary: window._ttKit || '#2563EB' }, paid, joinedBy: myUid(), joinedByName: myName(), joinedAt: Date.now(), roster }];
            t.teamIds = [...(t.teamIds || []), teamId];
        });
        document.getElementById('tt-addteam')?.remove();
        toast(`${name} was added. ➕`);
        TT.tab = 'teams'; drawPage();
    } catch (e) {
        const m0 = String(e && e.message);
        toast(m0 === 'FULL' ? 'The tournament is full.' : m0 === 'STARTED' ? 'Registration is closed.' : m0 === 'SAME' ? 'There is already a team with that name.' : "Couldn't add the team.", 'error');
    }
};

window.tourneyCardHtml = tourneyCardHtml;
window.tourneyMatchCardHtml = tourneyMatchCardHtml;

// Links: futnet.site/#tourney=ID (&tab=chat) open the tournament (notifications and shared links).
(function openFromLink() {
    const h = window.location.hash + '&' + window.location.search;
    const m = h.match(/[#&?]tourney=([^&/]+)/); if (!m) return;
    const id = decodeURIComponent(m[1]);
    const tab = (h.match(/[#&?]tab=(info|teams|bracket|chat|prizes|admin)\b/) || [])[1];
    const mid = (h.match(/[#&?]tab=match(?::|%3A)([^&/]+)/) || [])[1];   // a comment on one match
    let tries = 0;
    const go = () => {
        if (mid) { if (TT.list.some(t => t.id === id)) { window.openTourneyMatch(id, decodeURIComponent(mid)); return; } if (tries++ > 30) { window.openTourney(id, null, 'bracket'); return; } setTimeout(go, 500); return; }
        if (myUid() || tries++ > 20) window.openTourney(id, null, tab); else setTimeout(go, 500);
    };
    go();
})();
