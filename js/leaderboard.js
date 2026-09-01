// js/leaderboard.js
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

    const events = window.eventsList || [];
    const playerStats = {};

    const getPlayerRecord = (name, avatar, uid, position) => {
        const key = uid || name;
        if (!playerStats[key]) {
            playerStats[key] = {
                name: name || 'Player',
                avatar: avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100',
                position: position || 'Player',
                played: 0,
                goals: 0,
                matchesWon: 0,
                sessionsWon: 0
            };
        } else if (position && position !== 'Player' && playerStats[key].position === 'Player') {
            playerStats[key].position = position;
        }
        return playerStats[key];
    };

    events.forEach(ev => {
        const attendees = ev.attendees || [];
        const teamsCount = ev.teamsCount || 3;

        attendees.forEach(att => {
            getPlayerRecord(att.name, att.avatar, att.uid, att.position);
        });

        const matches = ev.matches || [];
        matches.forEach(m => {
            if (!m.isFinished) return;

            const t1Goals = m.team1Goals || [];
            const t2Goals = m.team2Goals || [];
            const t1Score = t1Goals.length;
            const t2Score = t2Goals.length;

            t1Goals.forEach(gName => {
                const matchedAtt = attendees.find(a => a.name === gName);
                const stats = getPlayerRecord(gName, matchedAtt?.avatar, matchedAtt?.uid, matchedAtt?.position);
                stats.goals += 1;
            });

            t2Goals.forEach(gName => {
                const matchedAtt = attendees.find(a => a.name === gName);
                const stats = getPlayerRecord(gName, matchedAtt?.avatar, matchedAtt?.uid, matchedAtt?.position);
                stats.goals += 1;
            });

            const teamAssignments = ev.teamAssignments || {};
            const teamNames = ev.teamNames || {};
            
            let t1Index = 0, t2Index = 1;
            for (let i = 0; i < teamsCount; i++) {
                const defName = teamNames[i] || `Team ${i + 1}`;
                if (m.teamA === defName) t1Index = i;
                if (m.teamB === defName) t2Index = i;
            }

            const t1Players = teamAssignments[t1Index] || [];
            const t2Players = teamAssignments[t2Index] || [];

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
            const stats = {};
            for (let i = 0; i < teamsCount; i++) {
                const tName = (ev.teamNames && ev.teamNames[i]) || `Team ${i + 1}`;
                stats[i] = { index: i, name: tName, points: 0, gf: 0, ga: 0 };
            }

            matches.forEach(m => {
                if (!m.isFinished) return;
                const t1Score = (m.team1Goals || []).length;
                const t2Score = (m.team2Goals || []).length;
                let t1Idx = 0, t2Idx = 1;
                for (let i = 0; i < teamsCount; i++) {
                    const cName = (ev.teamNames && ev.teamNames[i]) || `Team ${i + 1}`;
                    if (m.teamA === cName) t1Idx = i;
                    if (m.teamB === cName) t2Idx = i;
                }
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
                const winningPlayers = (ev.teamAssignments && ev.teamAssignments[winningTeam.index]) || [];
                winningPlayers.forEach(p => {
                    if (p && p.name) {
                        const rec = getPlayerRecord(p.name, p.avatar, p.uid, p.position);
                        rec.sessionsWon += 1;
                    }
                });
            }
        }
    });

    const playersArray = Object.values(playerStats);
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
            <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                <td class="p-4 font-black text-slate-900">${rankBadge}</td>
                <td class="p-4 flex items-center gap-3">
                    <img src="${p.avatar}" class="w-8 h-8 rounded-full object-cover border border-slate-200">
                    <div>
                        <div class="font-bold text-slate-900">${p.name}</div>
                        <div class="text-[10px] text-slate-400">${p.position}</div>
                    </div>
                </td>
                <td class="p-4 text-center font-medium text-slate-700">${p.position}</td>
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
            originalSwitchTab(tabName);
            if (tabName === 'leaderboard') {
                renderLeaderboard('goals');
            }
        };
    }
});