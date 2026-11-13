// Goals are saved by name, and names change ("Joubert" -> "Joubert Bernard"): find the player by exact
// name, then ignoring case, then a name that starts with the other (only when exactly one player matches).
export function findScorer(gName, people) {
    const norm = (x) => String(x || '').toLowerCase().trim().split(/\s+/).filter(Boolean).join(' ');
    const g = norm(gName); if (!g) return null;
    const named = (people || []).filter(p => p && norm(p.name));
    const exact = named.find(p => p.name === gName); if (exact) return exact;
    const same = named.filter(p => norm(p.name) === g);
    if (same.length) return same.find(p => p.uid) || same[0];
    const pre = named.filter(p => { const n = norm(p.name); return g.startsWith(n + ' ') || n.startsWith(g + ' '); });
    const ids = new Set(pre.map(p => p.uid || p.name));
    if (ids.size === 1) return pre[0];
    if (ids.size > 1) return null;
    // Same first name, and one last name starts with the other: "John Z" = "John Zolnowski" (only one such player).
    const [gf, ...gr] = g.split(' '); const gl = gr.join(' ');
    if (!gl) return null;
    const abbr = named.filter(p => { const [f, ...r] = norm(p.name).split(' '); const l = r.join(' '); return f === gf && l && (l.startsWith(gl) || gl.startsWith(l)); });
    const ids2 = new Set(abbr.map(p => p.uid || p.name));
    return ids2.size === 1 ? abbr[0] : null;
}
window.findScorer = findScorer;
// js/leaderboard.js
import { escapeHtml, jsArg, isOwnGoal } from './game-profile/event-store.js';
// Goals and teams are saved a little differently by the website, the iPhone app and the Android app:
//   a goal can be "John Z" or { name/scorer, uid/userId }; a match's teams can be by index (teamAIndex) or by name (teamA).
// These read all of them, so stats come out the same whichever phone ran the game.
const goalName = (g) => String((g && typeof g === 'object') ? (g.name || g.scorer || g.playerName || '') : (g || '')).trim();
const goalUid = (g) => (g && typeof g === 'object') ? String(g.uid || g.userId || g.playerId || '') : '';
const teamIdx = (idx, name, names, fb) => {
    const n = Number(idx);
    if (idx !== null && idx !== undefined && idx !== '' && Number.isInteger(n) && n >= 0 && n < names.length) return n;
    const k = names.indexOf(name); if (k !== -1) return k;
    const lower = names.map(x => String(x).toLowerCase().trim()).indexOf(String(name || '').toLowerCase().trim());
    return lower !== -1 ? lower : fb;
};
const teamList = (ta, i) => { const l = ta ? (ta[i] !== undefined ? ta[i] : ta[String(i)]) : null; return Array.isArray(l) ? l.filter(Boolean) : []; };
export function computePlayerStats(events) {
    const playerStats = {};

    const getPlayerRecord = (name, avatar, uid, position) => {
        const key = uid || name;
        if (!playerStats[key]) {
            playerStats[key] = {
                name: name || 'Player',
                uid: uid || '',
                avatar: avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100',
                position: position || 'Player',
                played: 0,
                goals: 0,
                matchesWon: 0,
                sessionsWon: 0,
                sessionsPlayed: 0
            };
        } else if (position && position !== 'Player' && playerStats[key].position === 'Player') {
            playerStats[key].position = position;
        }
        return playerStats[key];
    };

    events.forEach(ev => {
        const attendees = ev.attendees || [];
        const teamsCount = parseInt((String(ev.teamsCount || '').match(/(\d+)/) || [])[1], 10) || 3;
        const tNames = Array.from({ length: teamsCount }, (_, i) => (ev.teamNames && (ev.teamNames[i] || ev.teamNames[String(i)])) || `Team ${i + 1}`);

        attendees.forEach(att => {
            getPlayerRecord(att.name, att.avatar, att.uid, att.position);
        });

        const matches = ev.matches || [];
        const everyone = [...attendees, ...Object.values(ev.teamAssignments || {}).flat().filter(Boolean)];
        const scorerOf = (g) => {
            const u = goalUid(g);
            if (u) { const p = everyone.find(x => String(x.uid || x.userId || '') === u); return p ? { ...p, uid: u } : { uid: u, name: goalName(g) }; }
            return findScorer(goalName(g), everyone);
        };
        matches.forEach(m => {
            if (m.isFinished === false) return;

            const t1Goals = m.team1Goals || [];
            const t2Goals = m.team2Goals || [];
            const t1Score = t1Goals.length;
            const t2Score = t2Goals.length;

            [...t1Goals, ...t2Goals].forEach(g => {
                if (!g || isOwnGoal(g) || !goalName(g) && !goalUid(g)) return;   // own goals count for the team, not for anyone's stats
                const matchedAtt = scorerOf(g);
                const stats = getPlayerRecord(matchedAtt?.name || goalName(g), matchedAtt?.avatar, matchedAtt?.uid, matchedAtt?.position);
                stats.goals += 1;
            });

            const teamAssignments = ev.teamAssignments || {};
            const teamNames = ev.teamNames || {};
            
            const t1Index = teamIdx(m.teamAIndex, m.teamA, tNames, 0), t2Index = teamIdx(m.teamBIndex, m.teamB, tNames, 1);
            void teamNames;
            const t1Players = teamList(teamAssignments, t1Index);
            const t2Players = teamList(teamAssignments, t2Index);

            t1Players.forEach(p => {
                if (p && p.name) {
                    const stats = getPlayerRecord(p.name, p.avatar, p.uid, p.position);
                    stats.played += 1;
                    if (t1Score > t2Score) stats.matchesWon += 1;
                }
            });

            t2Players.forEach(p => {
                if (p && p.name) {
                    const stats = getPlayerRecord(p.name, p.avatar, p.uid, p.position);
                    stats.played += 1;
                    if (t2Score > t1Score) stats.matchesWon += 1;
                }
            });
        });

        if (ev.isSessionEnded && matches.length > 0) {
            // Sessions played: everyone on a team of a finished session, once per session.
            const seen = new Set();
            for (let i = 0; i < teamsCount; i++) {
                teamList(ev.teamAssignments, i).forEach(p => {
                    if (!p || !p.name) return;
                    const rec = getPlayerRecord(p.name, p.avatar, p.uid, p.position);
                    if (seen.has(rec)) return;
                    seen.add(rec); rec.sessionsPlayed += 1;
                });
            }
            const stats = {};
            for (let i = 0; i < teamsCount; i++) {
                const tName = (ev.teamNames && ev.teamNames[i]) || `Team ${i + 1}`;
                stats[i] = { index: i, name: tName, points: 0, gf: 0, ga: 0 };
            }

            matches.forEach(m => {
                if (m.isFinished === false) return;
                const t1Score = (m.team1Goals || []).length;
                const t2Score = (m.team2Goals || []).length;
                const t1Idx = teamIdx(m.teamAIndex, m.teamA, tNames, 0), t2Idx = teamIdx(m.teamBIndex, m.teamB, tNames, 1);
                if (stats[t1Idx] && stats[t2Idx]) {
                    stats[t1Idx].gf += t1Score; stats[t1Idx].ga += t2Score;
                    stats[t2Idx].gf += t2Score; stats[t2Idx].ga += t1Score;
                    if (t1Score > t2Score) { stats[t1Idx].points += 3; }
                    else if (t2Score > t1Score) { stats[t2Idx].points += 3; }
                    else { stats[t1Idx].points += 1; stats[t2Idx].points += 1; }
                }
            });

            const sortedTeams = Object.values(stats).sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                return (b.gf - b.ga) - (a.gf - a.ga);
            });

            const winningTeam = sortedTeams[0];
            if (winningTeam) {
                const winningPlayers = teamList(ev.teamAssignments, winningTeam.index);
                winningPlayers.forEach(p => {
                    if (p && p.name) {
                        const rec = getPlayerRecord(p.name, p.avatar, p.uid, p.position);
                        rec.sessionsWon += 1;
                    }
                });
            }
        }
    });

    // A goal saved under a name that didn't match anyone in THAT game (spelled differently, nickname, the player
    // wasn't on a team list that day…) became a separate name-only row, so the real player's total came out short.
    // Put those goals back on the player with that name (only when exactly one player matches).
    const withUid = Object.values(playerStats).filter(r => r.uid);
    Object.keys(playerStats).forEach(k => {
        const r = playerStats[k];
        if (r.uid) return;
        const owner = findScorer(r.name, withUid);
        if (!owner || !owner.uid) return;
        owner.goals += r.goals; owner.played += r.played; owner.matchesWon += r.matchesWon;
        owner.sessionsWon += r.sessionsWon; owner.sessionsPlayed += r.sessionsPlayed;
        delete playerStats[k];
    });

    return Object.values(playerStats);
}

export function renderLeaderboard(category = 'goals') {
    const tbody = document.getElementById('leaderboard-tbody');
    if (!tbody) return;

    // Highlight active category button
    ['goals', 'wins', 'sessions'].forEach(cat => {
        const btn = document.getElementById(`l-btn-${cat}`);
        if (btn) {
            btn.className = cat === category 
                ? "px-3.5 py-1.5 rounded-lg text-xs font-bold transition bg-brand text-slate-950 shadow-sm" 
                : "px-3.5 py-1.5 rounded-lg text-xs font-bold transition text-slate-600 hover:text-slate-900";
        }
    });

    const metricHeader = document.getElementById('leaderboard-metric-header');
    if (metricHeader) {
        metricHeader.textContent = category === 'goals' ? 'Goals' : (category === 'wins' ? 'Matches Won' : 'Sessions Won');
    }

    const playersArray = computePlayerStats(window.eventsList || []);
    playersArray.sort((a, b) => {
        if (category === 'goals') return b.goals - a.goals;
        if (category === 'wins') return b.matchesWon - a.matchesWon;
        return b.sessionsWon - a.sessionsWon;
    });

    if (playersArray.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400">No leaderboard stats recorded yet. Play and finish matches to populate rankings!</td></tr>`;
        return;
    }

    tbody.innerHTML = playersArray.map((p, idx) => {
        const rank = idx + 1;
        const rankBadge = rank === 1 ? '🥇' : (rank === 2 ? '🥈' : (rank === 3 ? '🥉' : `#${rank}`));
        const metricVal = category === 'goals' ? p.goals : (category === 'wins' ? p.matchesWon : p.sessionsWon);

        return `
            <tr ${p.uid ? `onclick="openPlayerStatsSheet && openPlayerStatsSheet('${jsArg(p.uid)}', '${jsArg(p.name)}', '')"` : ''} class="hover:bg-slate-50 transition border-b border-slate-100 ${p.uid ? 'cursor-pointer' : ''}">
                <td class="p-4 font-black text-slate-900">${rankBadge}</td>
                <td class="p-4 flex items-center gap-3">
                    <img src="${escapeHtml(window.resolvePlayerAvatar ? window.resolvePlayerAvatar(p) : p.avatar)}" class="w-8 h-8 rounded-full object-cover border border-slate-200">
                    <div>
                        <div class="font-bold text-slate-900">${escapeHtml(p.name)}</div>
                        <div class="text-[10px] text-slate-400">${escapeHtml(p.position)}</div>
                    </div>
                </td>
                <td class="p-4 text-center font-medium text-slate-700">${escapeHtml(p.position)}</td>
                <td class="p-4 text-center font-bold text-slate-700">${p.played}</td>
                <td class="p-4 text-right font-black text-brand text-sm">${metricVal}</td>
            </tr>
        `;
    }).join('');
}

window.switchLeaderboardCategory = function(category) {
    renderLeaderboard(category);
};

// Ensure leaderboard renders automatically when switched to
window.addEventListener('DOMContentLoaded', () => {
    const originalSwitchTab = window.switchTab;
    if (originalSwitchTab) {
        window.switchTab = function(tabName) {
            originalSwitchTab.apply(this, arguments);   // keeps the "don't add a history step" flag (Back button)
            if (tabName === 'leaderboard') {
                renderLeaderboard('goals');
            }
        };
    }
});