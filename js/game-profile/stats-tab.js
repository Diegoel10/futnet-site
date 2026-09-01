// js/game-profile/stats-tab.js
export function renderStatsTab(event) {
    const subTab = window.activeStatsSubTab || 'matches';
    const teamsCount = event.teamsCount || 3;

    return `
        <div class="space-y-4 py-2">
            <div class="bg-slate-100 p-1 rounded-2xl border border-slate-200 flex items-center space-x-1">
                <button onclick="switchStatsSubTab('matches')" class="flex-1 py-2 rounded-xl text-xs font-black transition ${subTab === 'matches' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">Matches</button>
                <button onclick="switchStatsSubTab('leaderboard')" class="flex-1 py-2 rounded-xl text-xs font-black transition ${subTab === 'leaderboard' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">Leaderboard</button>
                <button onclick="switchStatsSubTab('top-scorers')" class="flex-1 py-2 rounded-xl text-xs font-black transition ${subTab === 'top-scorers' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">Top Scorers</button>
            </div>

            ${subTab === 'matches' ? `
                <div class="space-y-3">
                    ${(event.matches || []).length === 0 ? '<p class="text-xs text-slate-400 italic text-center py-8">No match results recorded yet.</p>' : ''}
                    ${(event.matches || []).map((m, idx) => {
                        window.teamNames[event.id] = window.teamNames[event.id] || {};
                        const teamA = m.teamA || window.teamNames[event.id][0] || "Team 1";
                        const teamB = m.teamB || window.teamNames[event.id][1] || "Team 2";
                        const t1Goals = m.team1Goals || [];
                        const t2Goals = m.team2Goals || [];
                        const isFinished = m.isFinished || false;

                        return `
                            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm text-center">
                                <div class="flex items-center justify-between text-xs font-bold text-slate-500 uppercase">
                                    <span>Game #${idx + 1}</span>
                                    <span class="px-2 py-0.5 rounded-full text-[10px] ${isFinished ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${isFinished ? 'Finished' : 'In Progress'}</span>
                                </div>
                                <div class="bg-slate-800 text-white rounded-2xl py-3 px-6 flex items-center justify-center space-x-6 shadow-inner">
                                    <span class="text-xs font-black tracking-wide truncate max-w-[120px]">${teamA}</span>
                                    <span class="text-xl font-black bg-brand text-slate-950 px-3 py-0.5 rounded-xl shadow">${t1Goals.length}</span>
                                    <span class="text-slate-400 font-bold uppercase text-xs">VS</span>
                                    <span class="text-xl font-black bg-brand text-slate-950 px-3 py-0.5 rounded-xl shadow">${t2Goals.length}</span>
                                    <span class="text-xs font-black tracking-wide truncate max-w-[120px]">${teamB}</span>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : ''}

            ${subTab === 'leaderboard' ? `
                <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                    <table class="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr class="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-black text-[10px]">
                                <th class="p-3">Team</th>
                                <th class="p-3 text-center">Played</th>
                                <th class="p-3 text-center">W / T / L</th>
                                <th class="p-3 text-center">GF / GA / GD</th>
                                <th class="p-3 text-right">Points</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${(() => {
                                const stats = {};
                                for(let i=0; i<teamsCount; i++) {
                                    const tName = (window.teamNames[event.id] && window.teamNames[event.id][i]) || `Team ${i + 1}`;
                                    stats[i] = { index: i, name: tName, played: 0, wins: 0, ties: 0, losses: 0, gf: 0, ga: 0, points: 0 };
                                }

                                (event.matches || []).forEach(m => {
                                    if (!m.isFinished) return;
                                    const t1Score = (m.team1Goals || []).length;
                                    const t2Score = (m.team2Goals || []).length;
                                    
                                    let t1Idx = 0, t2Idx = 1;
                                    for (let i = 0; i < teamsCount; i++) {
                                        const currentName = (window.teamNames[event.id] && window.teamNames[event.id][i]) || `Team ${i + 1}`;
                                        if (m.teamA === currentName) t1Idx = i;
                                        if (m.teamB === currentName) t2Idx = i;
                                    }

                                    if (stats[t1Idx] && stats[t2Idx]) {
                                        stats[t1Idx].played++;
                                        stats[t2Idx].played++;
                                        stats[t1Idx].gf += t1Score;
                                        stats[t1Idx].ga += t2Score;
                                        stats[t2Idx].gf += t2Score;
                                        stats[t2Idx].ga += t1Score;

                                        if (t1Score > t2Score) {
                                            stats[t1Idx].wins++; stats[t1Idx].points += 3;
                                            stats[t2Idx].losses++;
                                        } else if (t2Score > t1Score) {
                                            stats[t2Idx].wins++; stats[t2Idx].points += 3;
                                            stats[t1Idx].losses++;
                                        } else {
                                            stats[t1Idx].ties++; stats[t1Idx].points += 1;
                                            stats[t2Idx].ties++; stats[t2Idx].points += 1;
                                        }
                                    }
                                });

                                const sorted = Object.values(stats).sort((a,b) => {
                                    if (b.points !== a.points) return b.points - a.points;
                                    const gdA = a.gf - a.ga;
                                    const gdB = b.gf - b.ga;
                                    if (gdB !== gdA) return gdB - gdA;
                                    return b.gf - a.gf;
                                });

                                return sorted.map((st, idx) => {
                                    const gd = st.gf - st.ga;
                                    const gdFormatted = gd > 0 ? `+${gd}` : `${gd}`;
                                    const teamKey = `${event.id}_team_${st.index}`;
                                    const isExpanded = window.expandedLeaderboardTeams[teamKey] || false;
                                    const teamPlayers = (window.teamAssignments && window.teamAssignments[event.id] && window.teamAssignments[event.id][st.index]) || [];

                                    return `
                                        <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                                            <td class="p-3 font-bold text-slate-900">
                                                <div class="flex items-center gap-2">
                                                    <span>#${idx + 1} ${st.name}</span>
                                                    <button onclick="toggleLeaderboardTeamRoster('${teamKey}')" class="text-slate-400 hover:text-slate-700 p-1 transition" title="View Team Players">
                                                        <i class="fa-solid fa-chevron-${isExpanded ? 'up' : 'down'} text-[10px]"></i>
                                                    </button>
                                                </div>
                                                ${isExpanded ? `
                                                    <div class="flex flex-wrap gap-1.5 pt-2 pb-1">
                                                        ${teamPlayers.length === 0 ? '<span class="text-[10px] text-slate-400 italic">No players assigned</span>' : teamPlayers.map(p => `
                                                            <div class="flex items-center gap-1.5 bg-slate-100 border border-slate-200 px-2 py-1 rounded-full shadow-2xs">
                                                                <img src="${p.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-5 h-5 rounded-full object-cover">
                                                                <span class="text-[10px] font-bold text-slate-800">${p.name.split(' ')[0]}</span>
                                                            </div>
                                                        `).join('')}
                                                    </div>
                                                ` : ''}
                                            </td>
                                            <td class="p-3 text-center text-slate-600">${st.played}</td>
                                            <td class="p-3 text-center text-slate-600">${st.wins} / ${st.ties} / ${st.losses}</td>
                                            <td class="p-3 text-center font-semibold text-slate-700">${st.gf} / ${st.ga} / <span class="${gd > 0 ? 'text-emerald-600 font-bold' : gd < 0 ? 'text-red-500 font-bold' : ''}">${gdFormatted}</span></td>
                                            <td class="p-3 text-right font-black text-brand-dark">${st.points} pts</td>
                                        </tr>
                                    `;
                                }).join('');
                            })()}
                        </tbody>
                    </table>
                </div>
            ` : ''}

            ${subTab === 'top-scorers' ? `
                <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                    <table class="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr class="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-black text-[10px]">
                                <th class="p-3">Player</th>
                                <th class="p-3 text-right">Goals</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${(() => {
                                const goalCounts = {};
                                (event.matches || []).forEach(m => {
                                    [...(m.team1Goals || []), ...(m.team2Goals || [])].forEach(scorer => {
                                        goalCounts[scorer] = (goalCounts[scorer] || 0) + 1;
                                    });
                                });
                                const sortedScorers = Object.entries(goalCounts).sort((a,b) => b[1] - a[1]);
                                if (sortedScorers.length === 0) return `<tr><td colspan="2" class="p-6 text-center text-slate-400 italic">No goalscorers recorded yet.</td></tr>`;
                                return sortedScorers.map(([name, count], idx) => {
                                    const attendeeObj = (event.attendees || []).find(a => a.name === name);
                                    const avatarUrl = attendeeObj?.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';
                                    return `
                                        <tr class="hover:bg-slate-50 transition">
                                            <td class="p-3 font-bold text-slate-900 flex items-center gap-2.5">
                                                <span class="text-slate-400 font-black">#${idx + 1}</span>
                                                <img src="${avatarUrl}" class="w-7 h-7 rounded-full object-cover border border-slate-200">
                                                <span>${name}</span>
                                            </td>
                                            <td class="p-3 text-right font-black text-brand-dark">⚽ ${count}</td>
                                        </tr>
                                    `;
                                }).join('');
                            })()}
                        </tbody>
                    </table>
                </div>
            ` : ''}
        </div>
    `;
}