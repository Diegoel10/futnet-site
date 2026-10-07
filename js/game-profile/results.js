// js/game-profile/results.js: End Event results page.
// When the admin taps "End Event", everyone can see who won (by points: 3 a win, 1 a draw,
// then goal difference, then goals scored), the full standings, each team with its players'
// photos, and the top scorers. Same rules as the app and the community leaderboard.
import { escapeHtml } from './event-store.js';

const FALLBACK_COLORS = ['#3b82f6', '#ef4444', '#eab308', '#22c55e', '#a855f7', '#ec4899', '#f97316', '#ffffff', '#000000'];
const DEFAULT_AVATAR = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';

const teamCountOf = (ev) => {
    if (typeof ev.teamsCount === 'number') return ev.teamsCount;
    const n = parseInt(String(ev.teamsCount || '').match(/(\d+)/)?.[1], 10);
    return Number.isFinite(n) && n > 0 ? n : 3;
};
const namesOf = (ev) => window.getTeamNames ? window.getTeamNames(ev)
    : Array.from({ length: teamCountOf(ev) }, (_, i) => (ev.teamNames || {})[i] || `Team ${i + 1}`);
const colorsOf = (ev) => window.getTeamColors ? window.getTeamColors(ev)
    : Array.from({ length: teamCountOf(ev) }, (_, i) => (ev.teamColors || {})[i] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]);
const accent = (hex) => window.teamAccent ? window.teamAccent(hex) : hex;
const playersOf = (ev, i) => {
    const ta = ev.teamAssignments || {};
    const list = Array.isArray(ta) ? ta[i] : ta[i] ?? ta[String(i)];
    return (Array.isArray(list) ? list : []).filter(p => p && (p.uid || p.name));
};
const avatarOf = (p) => (window.resolvePlayerAvatar ? window.resolvePlayerAvatar(p) : (p.avatar || DEFAULT_AVATAR));

/** Standings, winner and top scorers for one game. */
export function computeSessionResults(ev) {
    const count = teamCountOf(ev);
    const names = namesOf(ev);
    const colors = colorsOf(ev);
    const rows = Array.from({ length: count }, (_, i) => ({
        index: i, name: names[i] || `Team ${i + 1}`, color: colors[i] || FALLBACK_COLORS[i % 9],
        played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0, players: playersOf(ev, i)
    }));
    const pick = (idx, name, fallback) => {
        if (Number.isInteger(idx) && idx >= 0 && idx < count) return idx;
        const byName = names.indexOf(name);
        return byName !== -1 ? byName : fallback;
    };

    const goals = {};
    let finished = 0;
    (ev.matches || []).forEach(m => {
        if (!m || m.isFinished === false) return;
        const a = pick(m.teamAIndex, m.teamA, 0);
        const b = pick(m.teamBIndex, m.teamB, 1);
        if (!rows[a] || !rows[b] || a === b) return;
        const s1 = (m.team1Goals || []).length, s2 = (m.team2Goals || []).length;
        finished++;
        rows[a].played++; rows[b].played++;
        rows[a].gf += s1; rows[a].ga += s2; rows[b].gf += s2; rows[b].ga += s1;
        if (s1 > s2) { rows[a].wins++; rows[a].points += 3; rows[b].losses++; }
        else if (s2 > s1) { rows[b].wins++; rows[b].points += 3; rows[a].losses++; }
        else { rows[a].draws++; rows[b].draws++; rows[a].points++; rows[b].points++; }
        [...(m.team1Goals || []), ...(m.team2Goals || [])].forEach(n => { if (n) goals[n] = (goals[n] || 0) + 1; });
    });

    const standings = rows.slice().sort((x, y) =>
        y.points - x.points || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.index - y.index);
    const top = standings[0];
    const second = standings[1];
    const tied = !!(top && second && top.points === second.points && (top.gf - top.ga) === (second.gf - second.ga) && top.gf === second.gf);

    const attendees = ev.attendees || [];
    const scorers = Object.entries(goals).map(([name, n]) => {
        const att = attendees.find(a => String(a.name || '').toLowerCase() === name.toLowerCase());
        return { name, goals: n, avatar: avatarOf(att || { name }) };
    }).sort((x, y) => y.goals - x.goals || x.name.localeCompare(y.name));

    return { standings, winner: finished && !tied ? top : null, tied: finished > 0 && tied, matches: finished, scorers };
}

function avatarStack(players, size = 'w-8 h-8', max = 7) {
    const shown = players.slice(0, max);
    const more = players.length - shown.length;
    return `<div class="flex -space-x-2">${shown.map(p =>
        `<img src="${escapeHtml(avatarOf(p))}" title="${escapeHtml(p.name || '')}" class="${size} rounded-full object-cover border-2 border-[#040E13]" onerror="this.src='${DEFAULT_AVATAR}'">`).join('')}
        ${more > 0 ? `<span class="${size} rounded-full bg-black/80 border-2 border-[#040E13] text-[10px] font-black text-white flex items-center justify-center">+${more}</span>` : ''}</div>`;
}

/** Small "Final results" card shown on top of the game page once the event has ended. */
export function resultsBannerHtml(ev) {
    if (!ev || !ev.isSessionEnded) return '';
    const r = computeSessionResults(ev);
    const line = r.winner ? `${escapeHtml(r.winner.name)} won with ${r.winner.points} pts`
        : r.tied ? 'It ended in a tie!' : 'No matches were recorded';
    const color = r.winner ? accent(r.winner.color) : '#00F296';
    return `
        <button onclick="openSessionResults('${escapeHtml(String(ev.id))}')" class="w-full text-left bg-gradient-to-r from-amber-500/20 to-emerald-500/10 border-2 border-amber-400/60 rounded-3xl p-4 flex items-center gap-3 shadow-[0_0_20px_rgba(251,191,36,0.25)] hover:border-amber-300 transition">
            <div class="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center text-xl shrink-0"><i class="fa-solid fa-trophy"></i></div>
            <div class="flex-1 min-w-0">
                <div class="text-[10px] font-black uppercase tracking-wider text-amber-300">Event ended · Final results</div>
                <div class="text-sm font-black truncate" style="color:${color}">${line}</div>
            </div>
            ${r.winner ? avatarStack(r.winner.players, 'w-7 h-7', 4) : ''}
            <i class="fa-solid fa-chevron-right text-white/50 text-xs"></i>
        </button>`;
}

window.openSessionResults = function(eventId) {
    const ev = (window.eventsList || []).find(e => e.id === eventId);
    if (!ev) return;
    const r = computeSessionResults(ev);

    let m = document.getElementById('session-results-modal');
    if (!m) { m = document.createElement('div'); m.id = 'session-results-modal'; document.body.appendChild(m); }
    m.className = 'fixed inset-0 z-[175] bg-[#040E13] text-white overflow-y-auto';

    const w = r.winner;
    const wColor = w ? accent(w.color) : '#00F296';
    const hero = w ? `
        <div class="relative overflow-hidden rounded-3xl border-2 p-5 text-center space-y-3" style="border-color:${wColor}; background: radial-gradient(circle at top, ${wColor}33, transparent 70%);">
            <div class="text-4xl">🏆</div>
            <div class="text-[11px] font-black uppercase tracking-[0.2em] text-amber-300">Winner</div>
            <div class="text-2xl font-black" style="color:${wColor}">${escapeHtml(w.name)}</div>
            <div class="text-xs text-white/70">${w.points} pts · ${w.wins}W ${w.draws}D ${w.losses}L · ${w.gf}-${w.ga} goals</div>
            <div class="flex flex-wrap justify-center gap-3 pt-2">${w.players.map(p => `
                <div class="flex flex-col items-center w-16">
                    <img src="${escapeHtml(avatarOf(p))}" class="w-14 h-14 rounded-full object-cover border-2 shadow-lg" style="border-color:${wColor}" onerror="this.src='${DEFAULT_AVATAR}'">
                    <span class="text-[10px] font-bold text-white mt-1 truncate w-full">${escapeHtml(String(p.name || 'Player').split(' ')[0])}</span>
                </div>`).join('') || '<span class="text-xs text-white/50 italic">No players were placed on this team.</span>'}</div>
        </div>`
        : `<div class="rounded-3xl border-2 border-white/15 p-5 text-center space-y-2">
            <div class="text-4xl">${r.tied ? '🤝' : '📋'}</div>
            <div class="text-lg font-black">${r.tied ? 'It ended in a tie!' : 'No matches were recorded'}</div>
            <div class="text-xs text-white/60">${r.tied ? 'The top teams finished level on points, goal difference and goals.' : 'Results show up here once matches are saved.'}</div>
        </div>`;

    const standings = r.standings.map((t, i) => {
        const c = accent(t.color);
        const gd = t.gf - t.ga;
        return `
        <div class="bg-black/40 border rounded-2xl p-3 space-y-2.5" style="border-color:${c}66">
            <div class="flex items-center gap-3">
                <span class="w-7 text-center font-black ${i === 0 && w ? 'text-amber-300' : 'text-white/60'}">${i === 0 && w ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1)}</span>
                <span class="w-3.5 h-3.5 rounded-full border border-white/40 shrink-0" style="background:${t.color}"></span>
                <span class="flex-1 font-black text-sm truncate" style="color:${c}">${escapeHtml(t.name)}</span>
                <span class="font-black text-[#00F296]">${t.points} pts</span>
            </div>
            <div class="grid grid-cols-4 gap-1 text-center text-[10px] text-white/70">
                <div class="bg-black/40 rounded-lg py-1"><b class="text-white">${t.played}</b> played</div>
                <div class="bg-black/40 rounded-lg py-1"><b class="text-white">${t.wins}-${t.draws}-${t.losses}</b> W-D-L</div>
                <div class="bg-black/40 rounded-lg py-1"><b class="text-white">${t.gf}-${t.ga}</b> goals</div>
                <div class="bg-black/40 rounded-lg py-1"><b class="${gd > 0 ? 'text-[#00F296]' : gd < 0 ? 'text-red-300' : 'text-white'}">${gd > 0 ? '+' + gd : gd}</b> GD</div>
            </div>
            <div class="flex flex-wrap gap-1.5">${t.players.map(p => `
                <span class="flex items-center gap-1.5 bg-black/60 border border-white/10 rounded-full pl-0.5 pr-2.5 py-0.5">
                    <img src="${escapeHtml(avatarOf(p))}" class="w-6 h-6 rounded-full object-cover" onerror="this.src='${DEFAULT_AVATAR}'">
                    <span class="text-[10px] font-bold text-white">${escapeHtml(p.name || 'Player')}</span>
                </span>`).join('') || '<span class="text-[10px] text-white/40 italic">No players placed</span>'}</div>
        </div>`;
    }).join('');

    const scorers = r.scorers.slice(0, 5).map((s, i) => `
        <div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl p-2.5">
            <span class="w-5 text-center text-xs font-black text-white/50">${i + 1}</span>
            <img src="${escapeHtml(s.avatar)}" class="w-8 h-8 rounded-full object-cover" onerror="this.src='${DEFAULT_AVATAR}'">
            <span class="flex-1 text-xs font-bold truncate">${escapeHtml(s.name)}</span>
            <span class="text-xs font-black text-[#00F296]">⚽ ${s.goals}</span>
        </div>`).join('');

    m.innerHTML = `
        <div class="max-w-xl mx-auto p-4 pb-16 space-y-5">
            <div class="flex items-center gap-3 sticky top-0 bg-[#040E13] py-2 z-10">
                <button onclick="document.getElementById('session-results-modal').remove()" aria-label="Close" class="w-9 h-9 rounded-full bg-black/60 border border-white/15 flex items-center justify-center"><i class="fa-solid fa-xmark text-sm"></i></button>
                <div class="min-w-0">
                    <div class="text-base font-black truncate">Final results</div>
                    <div class="text-[11px] text-white/60 truncate">${escapeHtml(ev.title || 'Game')} · ${escapeHtml(ev.date || '')} · ${r.matches} match${r.matches === 1 ? '' : 'es'}</div>
                </div>
            </div>
            ${hero}
            <div class="space-y-2"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">Standings</div>${standings}</div>
            ${scorers ? `<div class="space-y-2"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">Top scorers</div>${scorers}</div>` : ''}
        </div>`;
};

window.computeSessionResults = computeSessionResults;