// js/game-profile/admin-tab.js
export function renderAdminTab(event) {
    const isSessionEnded = event.isSessionEnded || false;
    const teamsCount = event.teamsCount || 3;

    window.teamNames = window.teamNames || {};
    window.teamNames[event.id] = window.teamNames[event.id] || event.teamNames || {};

    return `
        <div class="space-y-4">
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                <div>
                    <h4 class="text-xs font-black text-slate-900 uppercase">Edit Game Details</h4>
                    <p class="text-[11px] text-slate-500">Modify title, time, rules or venue.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="openEditEventForm('${event.id}')" class="bg-brand text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow">Edit Game</button>
                    <button onclick="cancelGameEvent('${event.id}')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold px-3 py-2 rounded-xl text-xs shadow">Cancel Game</button>
                </div>
            </div>

            <!-- Manage Roster Players Section (With Add Player Bar Inside) -->
            <div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
                <div onclick="toggleAdminManagePlayers()" class="flex items-center justify-between cursor-pointer">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-users-gear text-brand text-xs"></i>
                        <h4 class="text-xs font-black text-slate-900 uppercase tracking-wider">MANAGE ROSTER PLAYERS & TEAM CAPTAINS</h4>
                    </div>
                    <i class="fa-solid fa-chevron-${window.adminManagePlayersExpanded ? 'up' : 'down'} text-slate-500 text-xs"></i>
                </div>
                
                <div class="${window.adminManagePlayersExpanded ? 'space-y-4 pt-3 border-t border-slate-100' : 'hidden'}">
                    <!-- Add Player Input Bar Inside -->
                    <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                        <label class="block text-[10px] font-black text-slate-600 uppercase tracking-wider">➕ Add Player to Roster</label>
                        <div class="relative flex gap-2">
                            <div class="relative flex-1">
                                <input type="text" id="admin-add-player-input" oninput="filterDirectoryAutocomplete(this.value, '${event.id}')" placeholder="Search app profiles or type custom name..." autocomplete="off" class="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand font-medium">
                                <div id="friend-autocomplete-dropdown" class="hidden absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-40 overflow-y-auto divide-y divide-slate-100"></div>
                            </div>
                            <button onclick="addFriendToGameRoster('${event.id}')" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow transition shrink-0">Add Player</button>
                        </div>
                    </div>

                    <!-- Existing Roster List -->
                    <div class="space-y-2">
                         ${(event.attendees || []).map(att => {
                            const captainTeamNum = att.captainTeamIndex !== undefined ? (att.captainTeamIndex + 1) : null;
                            return `
                                <div class="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200 shadow-sm">
                                    <div class="flex items-center gap-3">
                                        <img src="${att.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-8 h-8 rounded-full object-cover">
                                        <div>
                                            <span class="text-xs font-bold text-slate-900">${att.name}</span>
                                            ${att.uid === event.organizerId ? '<span class="ml-2 text-[9px] bg-brand/20 text-emerald-800 px-2 py-0.5 rounded font-black">Organizer</span>' : ''}
                                            ${captainTeamNum ? `<span class="ml-2 text-[9px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-black">⭐ Captain (${window.teamNames[event.id][att.captainTeamIndex] || `Team ${captainTeamNum}`})</span>` : ''}
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <select onchange="assignTeamCaptain('${event.id}', '${att.uid}', this.value)" class="bg-amber-50 border border-amber-300 rounded-lg px-2 py-1 text-[11px] font-bold text-amber-900">
                                            <option value="">Assign Captain...</option>
                                            ${Array.from({length: teamsCount}, (_, i) => `<option value="${i}">${window.teamNames[event.id][i] || `Team ${i + 1}`}</option>`).join('')}
                                        </select>
                                        <select onchange="updatePlayerPaidStatus('${event.id}', '${att.uid}', this.value)" class="bg-white border border-slate-300 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-800">
                                            <option value="Unpaid" ${att.paid === 'Unpaid' ? 'selected' : ''}>Unpaid</option>
                                            <option value="Paid" ${att.paid === 'Paid' ? 'selected' : ''}>Paid</option>
                                            <option value="Free" ${att.paid === 'Free' ? 'selected' : ''}>Free</option>
                                        </select>
                                        <button onclick="removePlayerFromEvent('${event.id}', '${att.uid}')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1 rounded-xl text-xs font-bold">Remove</button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>

            <!-- Match Results Section -->
            <div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-4 shadow-sm">
                <div onclick="toggleAdminMatchResults()" class="flex items-center justify-between cursor-pointer">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-futbol text-brand text-xs"></i>
                        <h4 class="text-xs font-black text-slate-900 uppercase tracking-wider">MATCH RESULTS & ADD GAMES</h4>
                    </div>
                    <div class="flex items-center gap-3">
                        <button onclick="event.stopPropagation(); toggleSessionEnded('${event.id}')" class="px-3 py-1.5 rounded-xl text-xs font-black ${isSessionEnded ? 'bg-amber-400 text-slate-950 shadow' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">${isSessionEnded ? 'Session Ended' : 'End Session'}</button>
                        <i class="fa-solid fa-chevron-${window.adminManagePlayersExpanded ? 'up' : 'down'} text-slate-500 text-xs"></i>
                    </div>
                </div>

                <div class="${window.adminMatchResultsExpanded ? 'space-y-4 pt-3 border-t border-slate-100' : 'hidden'}">
                    ${(event.matches || []).map((match, mIndex) => {
                        // Dynamically resolve team names using stored indexes or matching fallback names
                        const tNamesMap = window.teamNames[event.id] || {};
                        let teamA = match.teamAIndex !== undefined ? tNamesMap[match.teamAIndex] : null;
                        if (!teamA) {
                            const foundIdx = Object.keys(tNamesMap).find(k => tNamesMap[k] === match.teamA);
                            teamA = foundIdx !== undefined ? tNamesMap[foundIdx] : (match.teamA || tNamesMap[0] || "Team 1");
                        }

                        let teamB = match.teamBIndex !== undefined ? tNamesMap[match.teamBIndex] : null;
                        if (!teamB) {
                            const foundIdxB = Object.keys(tNamesMap).find(k => tNamesMap[k] === match.teamB);
                            teamB = foundIdxB !== undefined ? tNamesMap[foundIdxB] : (match.teamB || tNamesMap[1] || "Team 2");
                        }

                        const t1Goals = (match.team1Goals || []);
                        const t2Goals = (match.team2Goals || []);
                        const isFinished = match.isFinished || false;
                        
                        const isCardExpanded = window.expandedMatchCards[mIndex] !== undefined ? window.expandedMatchCards[mIndex] : !isFinished;

                        return `
                            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4 shadow-sm">
                                <div class="flex items-center justify-between">
                                    <div class="flex items-center gap-2">
                                        <span class="text-xs font-black uppercase text-slate-900">GAME #${mIndex + 1}: <strong class="text-brand">${teamA}</strong> vs <strong class="text-brand">${teamB}</strong></span>
                                        <span class="text-[10px] px-2.5 py-0.5 rounded-full font-bold ${isFinished ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-amber-100 text-amber-800 border border-amber-200'}">${isFinished ? 'FINISHED' : 'IN PROGRESS'}</span>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <button onclick="toggleMatchFinished('${event.id}', ${mIndex})" class="bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm">
                                            <i class="fa-solid fa-rotate"></i> ${isFinished ? 'Reopen Game' : 'Finish Game'}
                                        </button>
                                        <button onclick="toggleMatchCardExpansion(${mIndex})" class="bg-slate-200 hover:bg-slate-300 text-slate-700 px-2.5 py-1 rounded-xl text-xs font-bold" title="Expand/Collapse">
                                            <i class="fa-solid fa-chevron-${isCardExpanded ? 'up' : 'down'}"></i>
                                        </button>
                                        <button onclick="removeMatchSession('${event.id}', ${mIndex})" class="text-red-500 hover:text-red-700 bg-red-50 border border-red-200 p-2 rounded-xl text-xs"><i class="fa-solid fa-trash"></i></button>
                                    </div>
                                </div>

                                <div class="bg-slate-800 text-white rounded-2xl p-4 flex items-center justify-around text-center shadow-inner">
                                    <div class="text-sm font-black tracking-wider text-white uppercase w-1/3 truncate">${teamA}</div>
                                    <div class="flex items-center gap-3">
                                        <span class="text-2xl font-black bg-brand text-slate-950 px-4 py-1 rounded-xl shadow">${t1Goals.length}</span>
                                        <span class="text-xs font-bold text-slate-400 uppercase">VS</span>
                                        <span class="text-2xl font-black bg-brand text-slate-950 px-4 py-1 rounded-xl shadow">${t2Goals.length}</span>
                                    </div>
                                    <div class="text-sm font-black tracking-wider text-white uppercase w-1/3 truncate">${teamB}</div>
                                </div>
                                <div class="text-center text-[9px] font-bold uppercase tracking-widest text-slate-400 -mt-2">FINAL SCORE</div>

                                <div class="${isCardExpanded ? 'grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2' : 'hidden'}">
                                    <div class="bg-white border border-slate-200 p-3.5 rounded-xl space-y-3 shadow-sm">
                                        <div class="text-xs font-black text-slate-800 uppercase">${teamA} GOALS</div>
                                        <div class="space-y-1.5">
                                            ${t1Goals.map((gName, gIdx) => {
                                                const scorerObj = (event.attendees || []).find(a => a.name === gName);
                                                const avatarUrl = scorerObj?.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';
                                                return `
                                                    <div class="bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-xs font-bold text-slate-800 flex items-center justify-between">
                                                        <div class="flex items-center gap-2">
                                                            <img src="${avatarUrl}" class="w-6 h-6 rounded-full object-cover border border-slate-300">
                                                            <span>⚽ ${gName}</span>
                                                        </div>
                                                        <button onclick="removeTeamGoal('${event.id}', ${mIndex}, 1, ${gIdx})" class="text-red-500 hover:text-red-700 text-sm font-bold">&times;</button>
                                                    </div>
                                                `;
                                            }).join('')}
                                        </div>
                                        <button onclick="promptTeamGoal('${event.id}', ${mIndex}, 1)" class="w-full bg-brand hover:bg-brand-dark text-slate-950 font-black py-2 rounded-xl text-xs transition shadow flex items-center justify-center gap-1.5">
                                            <i class="fa-solid fa-plus"></i> + Goal
                                        </button>
                                    </div>

                                    <div class="bg-white border border-slate-200 p-3.5 rounded-xl space-y-3 shadow-sm">
                                        <div class="text-xs font-black text-slate-800 uppercase">${teamB} GOALS</div>
                                        <div class="space-y-1.5">
                                            ${t2Goals.map((gName, gIdx) => {
                                                const scorerObj = (event.attendees || []).find(a => a.name === gName);
                                                const avatarUrl = scorerObj?.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';
                                                return `
                                                    <div class="bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-xs font-bold text-slate-800 flex items-center justify-between">
                                                        <div class="flex items-center gap-2">
                                                            <img src="${avatarUrl}" class="w-6 h-6 rounded-full object-cover border border-slate-300">
                                                            <span>⚽ ${gName}</span>
                                                        </div>
                                                        <button onclick="removeTeamGoal('${event.id}', ${mIndex}, 2, ${gIdx})" class="text-red-500 hover:text-red-700 text-sm font-bold">&times;</button>
                                                    </div>
                                                `;
                                            }).join('')}
                                        </div>
                                        <button onclick="promptTeamGoal('${event.id}', ${mIndex}, 2)" class="w-full bg-brand hover:bg-brand-dark text-slate-950 font-black py-2 rounded-xl text-xs transition shadow flex items-center justify-center gap-1.5">
                                            <i class="fa-solid fa-plus"></i> + Goal
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}

                    ${!isSessionEnded ? `
                        <div onclick="openNewGameSetupModal('${event.id}')" class="bg-slate-50 border-2 border-dashed border-slate-300 hover:border-brand rounded-2xl p-5 text-center cursor-pointer transition flex items-center justify-between shadow-sm group">
                            <div class="flex items-center gap-3 text-left">
                                <div class="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-brand text-lg shadow-sm">
                                    <i class="fa-solid fa-calendar-days"></i>
                                </div>
                                <div>
                                    <div class="text-xs font-black text-slate-900 uppercase">GAME #${(event.matches || []).length + 1}</div>
                                    <div class="text-[11px] text-slate-500">Choose competing teams and track scores.</div>
                                </div>
                            </div>
                            <button class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow transition flex items-center gap-1.5">
                                <i class="fa-solid fa-plus"></i> Add New Game
                            </button>
                        </div>
                    ` : '<div class="text-center text-xs text-amber-600 font-bold py-2 bg-amber-50 rounded-xl border border-amber-200">Session ended. No further games can be added.</div>'}
                </div>
            </div>
        </div>
    `;
}

// Global Directory Autocomplete Helper for Admin Roster Addition
window.filterDirectoryAutocomplete = function(queryStr, eventId) {
    const dropdown = document.getElementById('friend-autocomplete-dropdown');
    if (!dropdown) return;
    const query = queryStr.toLowerCase().trim();
    if (!query) {
        dropdown.classList.add('hidden');
        return;
    }

    const combinedPool = [
        ...(window.friendsList || []),
        ...(window.directoryList || []),
        ...((window.eventsList || []).flatMap(ev => ev.attendees || []))
    ];

    if (window.userProfile) {
        combinedPool.push({
            name: `${window.userProfile.firstName} ${window.userProfile.lastName || ''}`.trim(),
            avatar: window.userProfile.avatar,
            uid: window.userProfile.uid
        });
    }

    const seen = new Set();
    const uniqueProfiles = combinedPool.filter(p => {
        const key = p.uid || p.name;
        if (!p.name || seen.has(key)) return false;
        seen.has(key);
        return true;
    });

    const matches = uniqueProfiles.filter(p => p.name.toLowerCase().includes(query));

    if (matches.length > 0) {
        dropdown.innerHTML = matches.map(f => `
            <div onclick="selectDirectoryProfileForRoster('${f.name.replace(/'/g, "\\'")}', '${f.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}', '${f.uid || ('usr_' + Date.now())}')" class="p-2.5 hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-2">
                <img src="${f.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-6 h-6 rounded-full object-cover">
                <span class="font-bold text-slate-900">${f.name}</span>
            </div>
        `).join('');
        dropdown.classList.remove('hidden');
    } else {
        dropdown.innerHTML = `<div class="p-2.5 text-xs text-slate-400">Custom name (no profile found)</div>`;
        dropdown.classList.remove('hidden');
    }
};

window.selectDirectoryProfileForRoster = function(name, avatar, uid) {
    const input = document.getElementById('admin-add-player-input');
    if (input) input.value = name;
    window.selectedDirectoryUserToAdd = { name, avatar, uid };
    const dropdown = document.getElementById('friend-autocomplete-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
};