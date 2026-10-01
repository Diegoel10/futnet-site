// js/game-profile/stats-tab.js: Dark-mode themed Game Stats with goalscorers displayed on match cards, live points, and live top scorers
export function renderStatsTab(event) {
    const subTab = window.activeStatsSubTab || 'matches';
    const teamsCount = event.teamsCount || 3;
    const liveActive = event.liveMatchActive;
    const attendees = Array.isArray(event.attendees) ? event.attendees : [];

    const resolvePlayerAvatar = (name) => {
        if (!name) return 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
        const foundAtt = attendees.find(a => (a.name || '').toLowerCase() === name.toLowerCase());
        if (foundAtt && (foundAtt.avatar || foundAtt.photoURL)) {
            return foundAtt.avatar || foundAtt.photoURL;
        }
        if (window.directoryList) {
            const foundDir = window.directoryList.find(u => (u.name || '').toLowerCase() === name.toLowerCase());
            if (foundDir && (foundDir.avatar || foundDir.photoURL)) {
                return foundDir.avatar || foundDir.photoURL;
            }
        }
        return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`;
    };

    const getTeamNameByIndex = (idx) => {
        return (window.teamNames && window.teamNames[event.id] && window.teamNames[event.id][idx]) || `Team ${idx + 1}`;
    };

    return `
        <div class="space-y-4 py-2 text-white">
            <div class="bg-black/40 border border-emerald-500/30 p-1 rounded-2xl flex items-center space-x-1 backdrop-blur-md">
                <button onclick="switchStatsSubTab('matches')" class="flex-1 py-2 rounded-xl text-xs font-black transition ${subTab === 'matches' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">Matches</button>
                <button onclick="switchStatsSubTab('leaderboard')" class="flex-1 py-2 rounded-xl text-xs font-black transition ${subTab === 'leaderboard' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">Leaderboard</button>
                <button onclick="switchStatsSubTab('top-scorers')" class="flex-1 py-2 rounded-xl text-xs font-black transition ${subTab === 'top-scorers' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">Top Scorers</button>
            </div>

            ${subTab === 'matches' ? `
                <div class="space-y-3">
                    ${liveActive ? `
                        <div class="bg-gradient-to-r from-emerald-950 to-teal-950 border-2 border-[#00F296] rounded-2xl p-4 space-y-3 shadow-xl animate-pulse">
                            <div class="flex items-center justify-between">
                                <span class="bg-[#00F296] text-slate-950 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">🔴 LIVE MATCH</span>
                                <span class="text-[10px] text-[#00F296] font-bold">In Progress</span>
                            </div>
                            <div class="bg-black/60 border border-emerald-500/40 text-white rounded-2xl py-3 px-6 flex items-center justify-around text-center shadow-inner font-mono">
                                <span class="text-xs font-black tracking-wide truncate max-w-[120px] flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-[#00F296] inline-block animate-ping"></span>${liveActive.teamA}</span>
                                <span class="text-xl font-black text-[#00F296] px-3">${(liveActive.team1Goals || []).length} - ${(liveActive.team2Goals || []).length}</span>
                                <span class="text-xs font-black tracking-wide truncate max-w-[120px] flex items-center gap-1.5">${liveActive.teamB}<span class="w-2 h-2 rounded-full bg-[#00F296] inline-block animate-ping"></span></span>
                            </div>
                            <div class="grid grid-cols-2 gap-2 pt-1 border-t border-white/10 text-xs">
                                <div class="space-y-1">
                                    ${(liveActive.team1Goals || []).map(scorer => `
                                        <div class="flex items-center gap-1.5 bg-black/40 px-2.5 py-1 rounded-full border border-white/10">
                                            <i class="fa-solid fa-futbol text-[#00F296] text-[9px]"></i>
                                            <img src="${resolvePlayerAvatar(scorer)}" class="w-4 h-4 rounded-full object-cover">
                                            <span class="text-white font-bold text-[10px]">${scorer}</span>
                                        </div>
                                    `).join('')}
                                </div>
                                <div class="space-y-1">
                                    ${(liveActive.team2Goals || []).map(scorer => `
                                        <div class="flex items-center gap-1.5 bg-black/40 px-2.5 py-1 rounded-full border border-white/10">
                                            <i class="fa-solid fa-futbol text-red-400 text-[9px]"></i>
                                            <img src="${resolvePlayerAvatar(scorer)}" class="w-4 h-4 rounded-full object-cover">
                                            <span class="text-white font-bold text-[10px]">${scorer}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    ` : ''}

                    ${(event.matches || []).length === 0 && !liveActive ? '<p class="text-xs text-white/40 italic text-center py-8">No match results recorded yet.</p>' : ''}
                    
                    ${(event.matches || []).map((m, idx) => {
                        window.teamNames[event.id] = window.teamNames[event.id] || {};
                        const teamA = m.teamA || window.teamNames[event.id][0] || "Team 1";
                        const teamB = m.teamB || window.teamNames[event.id][1] || "Team 2";
                        const t1Goals = Array.isArray(m.team1Goals) ? m.team1Goals : [];
                        const t2Goals = Array.isArray(m.team2Goals) ? m.team2Goals : [];
                        const isFinished = m.isFinished !== undefined ? m.isFinished : true;

                        const t1ScorersHtml = t1Goals.map(scorer => `
                            <div class="flex items-center gap-1.5 bg-black/40 px-2.5 py-1 rounded-full border border-white/10 text-xs">
                                <i class="fa-solid fa-futbol text-[#00F296] text-[9px]"></i>
                                <img src="${resolvePlayerAvatar(scorer)}" class="w-4 h-4 rounded-full object-cover border border-[#00F296]/40">
                                <span class="text-white font-bold text-[10px]">${scorer}</span>
                            </div>
                        `).join('');

                        const t2ScorersHtml = t2Goals.map(scorer => `
                            <div class="flex items-center gap-1.5 bg-black/40 px-2.5 py-1 rounded-full border border-white/10 text-xs">
                                <i class="fa-solid fa-futbol text-red-400 text-[9px]"></i>
                                <img src="${resolvePlayerAvatar(scorer)}" class="w-4 h-4 rounded-full object-cover border border-red-400/40">
                                <span class="text-white font-bold text-[10px]">${scorer}</span>
                            </div>
                        `).join('');

                        return `
                            <div class="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-3 shadow-md">
                                <div class="flex items-center justify-between text-xs font-bold text-white/60 uppercase">
                                    <span>Game #${idx + 1}</span>
                                    <span class="px-2 py-0.5 rounded-full text-[10px] ${isFinished ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}">${isFinished ? 'Finished' : 'In Progress'}</span>
                                </div>
                                <div class="bg-black/80 text-white rounded-2xl py-3 px-6 flex items-center justify-around text-center shadow-inner border border-white/10">
                                    <span class="text-xs font-black tracking-wide truncate max-w-[120px]">${teamA}</span>
                                    <span class="text-xl font-black text-[#00F296] px-3 font-mono">${t1Goals.length} - ${t2Goals.length}</span>
                                    <span class="text-xs font-black tracking-wide truncate max-w-[120px]">${teamB}</span>
                                </div>
                                <div class="grid grid-cols-2 gap-2 pt-1 border-t border-white/10">
                                    <div class="space-y-1">${t1ScorersHtml || '<span class="text-[10px] text-white/40 italic">No goals</span>'}</div>
                                    <div class="space-y-1">${t2ScorersHtml || '<span class="text-[10px] text-white/40 italic">No goals</span>'}</div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : ''}

            ${subTab === 'leaderboard' ? `
                <div class="bg-black/40 border border-emerald-500/30 rounded-2xl overflow-hidden shadow-xl backdrop-blur-md">
                    <table class="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr class="bg-black/60 border-b border-white/10 text-white/70 uppercase font-black text-[10px]">
                                <th class="p-3">Team</th>
                                <th class="p-3 text-center">Played</th>
                                <th class="p-3 text-center">W / T / L</th>
                                <th class="p-3 text-center">GF / GA / GD</th>
                                <th class="p-3 text-right">Points</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-white/10">
                            ${(() => {
                                const stats = {};
                                for(let i=0; i<teamsCount; i++) {
                                    const tName = getTeamNameByIndex(i);
                                    stats[i] = { index: i, name: tName, played: 0, wins: 0, ties: 0, losses: 0, gf: 0, ga: 0, points: 0, isLive: false };
                                }

                                (event.matches || []).forEach(m => {
                                    if (!m.isFinished) return;
                                    const t1Score = (m.team1Goals || []).length;
                                    const t2Score = (m.team2Goals || []).length;
                                    
                                    let t1Idx = 0, t2Idx = 1;
                                    for (let i = 0; i < teamsCount; i++) {
                                        if (m.teamA === getTeamNameByIndex(i)) t1Idx = i;
                                        if (m.teamB === getTeamNameByIndex(i)) t2Idx = i;
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

                                if (liveActive) {
                                    const t1Score = (liveActive.team1Goals || []).length;
                                    const t2Score = (liveActive.team2Goals || []).length;
                                    
                                    let t1Idx = 0, t2Idx = 1;
                                    for (let i = 0; i < teamsCount; i++) {
                                        if (liveActive.teamA === getTeamNameByIndex(i)) t1Idx = i;
                                        if (liveActive.teamB === getTeamNameByIndex(i)) t2Idx = i;
                                    }

                                    if (stats[t1Idx] && stats[t2Idx]) {
                                        stats[t1Idx].gf += t1Score;
                                        stats[t1Idx].ga += t2Score;
                                        stats[t2Idx].gf += t2Score;
                                        stats[t2Idx].ga += t1Score;

                                        stats[t1Idx].isLive = true;
                                        stats[t2Idx].isLive = true;

                                        if (t1Score > t2Score) {
                                            stats[t1Idx].points += 3;
                                        } else if (t2Score > t1Score) {
                                            stats[t2Idx].points += 3;
                                        } else {
                                            stats[t1Idx].points += 1;
                                            stats[t2Idx].points += 1;
                                        }
                                    }
                                }

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
                                        <tr class="hover:bg-white/5 transition border-b border-white/5">
                                            <td class="p-3 font-bold text-white">
                                                <div class="flex items-center gap-2">
                                                    ${st.isLive ? '<span class="w-2.5 h-2.5 rounded-full bg-[#00F296] inline-block animate-ping shrink-0" title="Team currently playing live"></span>' : ''}
                                                    <span>#${idx + 1} ${st.name}</span>
                                                    <button onclick="toggleLeaderboardTeamRoster('${teamKey}')" class="text-white/40 hover:text-white p-1 transition" title="View Team Players">
                                                        <i class="fa-solid fa-chevron-${isExpanded ? 'up' : 'down'} text-[10px]"></i>
                                                    </button>
                                                </div>
                                                ${isExpanded ? `
                                                    <div class="flex flex-wrap gap-1.5 pt-2 pb-1">
                                                        ${teamPlayers.length === 0 ? '<span class="text-[10px] text-white/40 italic">No players assigned</span>' : teamPlayers.map(p => `
                                                            <div class="flex items-center gap-1.5 bg-black/60 border border-white/10 px-2 py-1 rounded-full">
                                                                <img src="${p.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'}" class="w-5 h-5 rounded-full object-cover">
                                                                <span class="text-[10px] font-bold text-white">${p.name.split(' ')[0]}</span>
                                                            </div>
                                                        `).join('')}
                                                    </div>
                                                ` : ''}
                                            </td>
                                            <td class="p-3 text-center text-white/70">${st.played + (st.isLive ? 1 : 0)}</td>
                                            <td class="p-3 text-center text-white/70">${st.wins} / ${st.ties} / ${st.losses}</td>
                                            <td class="p-3 text-center font-semibold text-white/80">${st.gf} / ${st.ga} / <span class="${gd > 0 ? 'text-[#00F296] font-bold' : gd < 0 ? 'text-red-400 font-bold' : ''}">${gdFormatted}</span></td>
                                            <td class="p-3 text-right font-black text-[#00F296]">${st.points} pts ${st.isLive ? '<span class="text-[9px] text-amber-400 font-normal">(Live)</span>' : ''}</td>
                                        </tr>
                                    `;
                                }).join('');
                            })()}
                        </tbody>
                    </table>
                </div>
            ` : ''}

            ${subTab === 'top-scorers' ? `
                <div class="bg-black/40 border border-emerald-500/30 rounded-2xl overflow-hidden shadow-xl backdrop-blur-md">
                    <table class="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr class="bg-black/60 border-b border-white/10 text-white/70 uppercase font-black text-[10px]">
                                <th class="p-3">Player</th>
                                <th class="p-3 text-right">Goals</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-white/10">
                            ${(() => {
                                const goalCounts = {};
                                
                                (event.matches || []).forEach(m => {
                                    [...(m.team1Goals || []), ...(m.team2Goals || [])].forEach(scorer => {
                                        goalCounts[scorer] = (goalCounts[scorer] || 0) + 1;
                                    });
                                });

                                if (liveActive) {
                                    [...(liveActive.team1Goals || []), ...(liveActive.team2Goals || [])].forEach(scorer => {
                                        goalCounts[scorer] = (goalCounts[scorer] || 0) + 1;
                                    });
                                }

                                const sortedScorers = Object.entries(goalCounts).sort((a,b) => b[1] - a[1]);
                                if (sortedScorers.length === 0) return `<tr><td colspan="2" class="p-6 text-center text-white/40 italic">No goalscorers recorded yet.</td></tr>`;
                                
                                return sortedScorers.map(([name, count], idx) => {
                                    const avatarUrl = resolvePlayerAvatar(name);
                                    return `
                                        <tr class="hover:bg-white/5 transition">
                                            <td class="p-3 font-bold text-white flex items-center gap-2.5">
                                                <span class="text-white/40 font-black">#${idx + 1}</span>
                                                <img src="${avatarUrl}" class="w-7 h-7 rounded-full object-cover border border-white/20">
                                                <span>${name}</span>
                                            </td>
                                            <td class="p-3 text-right font-black text-[#00F296]">⚽ ${count}</td>
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