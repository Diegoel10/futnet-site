// js/game-profile.js: Full game profile modal, share sheet, collapsible finished games, admin game cancellation, waitlist/RSVP No lists, and team tools
import { db, appId } from './firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.openEventDetails = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    let modal = document.getElementById('event-detail-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'event-detail-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm overflow-y-auto';
        document.body.appendChild(modal);
    }

    window.activeModalEventId = eventId;
    const isCreator = window.currentUser && event.organizerId === window.currentUser.uid;
    window.activeModalTab = isCreator ? 'admin' : 'info';
    window.adminManagePlayersExpanded = false;
    window.adminMatchResultsExpanded = false; // Collapsed by default
    window.activeStatsSubTab = 'matches';
    window.expandedLeaderboardTeams = window.expandedLeaderboardTeams || {};
    window.expandedMatchCards = window.expandedMatchCards || {};

    window.renderEventDetailModalContent();
};

window.switchModalTab = function(tabName) {
    window.activeModalTab = tabName;
    window.renderEventDetailModalContent();
};

window.switchStatsSubTab = function(subTab) {
    window.activeStatsSubTab = subTab;
    window.renderEventDetailModalContent();
};

window.toggleAdminManagePlayers = function() {
    window.adminManagePlayersExpanded = !window.adminManagePlayersExpanded;
    window.renderEventDetailModalContent();
};

window.toggleAdminMatchResults = function() {
    window.adminMatchResultsExpanded = !window.adminMatchResultsExpanded;
    window.renderEventDetailModalContent();
};

window.toggleMatchCardExpansion = function(mIndex) {
    window.expandedMatchCards[mIndex] = !window.expandedMatchCards[mIndex];
    window.renderEventDetailModalContent();
};

window.toggleLeaderboardTeamRoster = function(teamKey) {
    window.expandedLeaderboardTeams[teamKey] = !window.expandedLeaderboardTeams[teamKey];
    window.renderEventDetailModalContent();
};

window.renderEventDetailModalContent = function() {
    const modal = document.getElementById('event-detail-modal');
    if (!modal) return;
    const event = (window.eventsList || []).find(ev => ev.id === window.activeModalEventId);
    if (!event) return;

    const isCreator = window.currentUser && event.organizerId === window.currentUser.uid;
    const tab = window.activeModalTab;
    const attendeesCount = event.attendees?.length || 0;
    const waitingCount = event.waitingList?.length || 0;
    const declinedCount = event.declinedList?.length || 0;
    const commentsCount = event.comments?.length || 0;
    const isAttendee = (event.attendees || []).some(a => a.uid === window.currentUser?.uid);
    const teamsCount = event.teamsCount || 3;
    const isSessionEnded = event.isSessionEnded || false;

    const typingUsers = (event.typingUsers || []).filter(u => u.uid !== window.currentUser?.uid);
    let typingText = "";
    if (typingUsers.length === 1) {
        typingText = `${typingUsers[0].name} is typing...`;
    } else if (typingUsers.length > 1) {
        typingText = "Multiple people are typing...";
    }

    modal.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-3xl max-w-3xl w-full p-6 text-slate-900 shadow-2xl space-y-6 relative max-h-[90vh] overflow-y-auto">
            <!-- Modal Header -->
            <div class="flex items-start justify-between border-b border-slate-100 pb-4">
                <div>
                    <div class="flex items-center gap-2 mb-1">
                        <h2 class="text-2xl font-black tracking-tight text-slate-900">${event.title}</h2>
                        <span class="px-2.5 py-0.5 bg-brand/10 text-brand font-black text-[10px] rounded-full uppercase tracking-wider border border-brand/30">${event.visibility || 'Public'}</span>
                    </div>
                    <p class="text-xs text-slate-500 flex items-center gap-1.5"><i class="fa-solid fa-location-dot text-brand"></i> ${event.location}</p>
                </div>
                <div class="flex items-center gap-2">
                    <div class="relative">
                        <button onclick="toggleShareDropdown()" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-3.5 py-2 rounded-xl text-xs flex items-center gap-2 shadow transition">
                            <i class="fa-solid fa-share-nodes"></i> Share
                        </button>
                        <div id="share-dropdown" class="hidden absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 w-48 py-2 divide-y divide-slate-100 text-xs">
                            <button onclick="shareToWhatsApp('${event.title.replace(/'/g, "\\'")}', '${event.location.replace(/'/g, "\\'")}')" class="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-bold text-slate-800 flex items-center gap-2.5">
                                <i class="fa-brands fa-whatsapp text-emerald-500 text-base"></i> WhatsApp
                            </button>
                            <button onclick="shareToTwitter('${event.title.replace(/'/g, "\\'")}')" class="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-bold text-slate-800 flex items-center gap-2.5">
                                <i class="fa-brands fa-x-twitter text-black text-base"></i> X (Twitter)
                            </button>
                            <button onclick="copyEventLink('${event.title}')" class="w-full text-left px-4 py-2.5 hover:bg-slate-50 font-bold text-slate-800 flex items-center gap-2.5">
                                <i class="fa-solid fa-link text-brand text-base"></i> Copy Link
                            </button>
                        </div>
                    </div>

                    ${isCreator ? `<button onclick="copyEvent('${event.id}'); closeEventModal();" class="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-3 py-2 rounded-xl text-xs flex items-center gap-1.5"><i class="fa-solid fa-copy"></i> Copy</button>` : ''}
                    <button onclick="closeEventModal()" class="text-slate-400 hover:text-slate-700 text-xl font-bold px-2"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>

            <!-- Navigation Tabs Bar -->
            <div class="bg-slate-100 p-1.5 rounded-2xl border border-slate-200 flex items-center space-x-1 overflow-x-auto">
                ${isCreator ? `<button onclick="switchModalTab('admin')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition ${tab === 'admin' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}"><i class="fa-solid fa-gear"></i> Admin</button>` : ''}
                <button onclick="switchModalTab('info')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition ${tab === 'info' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">Game Info</button>
                <button onclick="switchModalTab('roster')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition ${tab === 'roster' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">Roster (${attendeesCount})</button>
                <button onclick="switchModalTab('stats')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition ${tab === 'stats' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">Game Stats</button>
                <button onclick="switchModalTab('comments')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition ${tab === 'comments' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">Comments (${commentsCount})</button>
            </div>

            <!-- ADMIN TAB -->
            ${tab === 'admin' && isCreator ? `
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

                    <!-- Manage Roster Players Section -->
                    <div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
                        <div onclick="toggleAdminManagePlayers()" class="flex items-center justify-between cursor-pointer">
                            <div class="flex items-center gap-2">
                                <i class="fa-solid fa-users-gear text-brand text-xs"></i>
                                <h4 class="text-xs font-black text-slate-900 uppercase tracking-wider">MANAGE ROSTER PLAYERS & TEAM CAPTAINS</h4>
                            </div>
                            <i class="fa-solid fa-chevron-${window.adminManagePlayersExpanded ? 'up' : 'down'} text-slate-500 text-xs"></i>
                        </div>
                        
                        <div class="${window.adminManagePlayersExpanded ? 'space-y-3 pt-3 border-t border-slate-100' : 'hidden'}">
                            <div class="space-y-2">
                                ${(event.attendees || []).map(att => {
                                    window.teamNames[event.id] = window.teamNames[event.id] || {};
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

                    <!-- Match Results Section (Collapsed by default) -->
                    <div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-4 shadow-sm">
                        <div onclick="toggleAdminMatchResults()" class="flex items-center justify-between cursor-pointer">
                            <h4 class="text-xs font-black text-slate-900 uppercase tracking-wider">MATCH RESULTS & ADD GAMES</h4>
                            <div class="flex items-center gap-3">
                                <button onclick="event.stopPropagation(); toggleSessionEnded('${event.id}')" class="px-3 py-1.5 rounded-xl text-xs font-black ${isSessionEnded ? 'bg-amber-400 text-slate-950 shadow' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">${isSessionEnded ? 'Session Ended' : 'End Session'}</button>
                                <i class="fa-solid fa-chevron-${window.adminMatchResultsExpanded ? 'up' : 'down'} text-slate-500 text-xs"></i>
                            </div>
                        </div>

                        <div class="${window.adminMatchResultsExpanded ? 'space-y-4 pt-3 border-t border-slate-100' : 'hidden'}">
                            ${(event.matches || []).map((match, mIndex) => {
                                window.teamNames[event.id] = window.teamNames[event.id] || {};
                                const teamA = match.teamA || window.teamNames[event.id][0] || "Team 1";
                                const teamB = match.teamB || window.teamNames[event.id][1] || "Team 2";
                                const t1Goals = (match.team1Goals || []);
                                const t2Goals = (match.team2Goals || []);
                                const isFinished = match.isFinished || false;
                                const isCardExpanded = window.expandedMatchCards[mIndex] || false;

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

                                        <!-- Score Box -->
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

                                        <!-- Goals Management Columns (Auto-collapsed if finished unless expanded) -->
                                        <div class="${(!isFinished || isCardExpanded) ? 'grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2' : 'hidden'}">
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
            ` : ''}

            <!-- GAME INFO TAB -->
            ${tab === 'info' ? `
                <div class="space-y-4">
                    ${isSessionEnded ? `
                        <div class="bg-emerald-50 border-2 border-emerald-400 rounded-2xl p-5 text-center space-y-2 shadow-md">
                            <div class="text-xs font-black text-emerald-700 uppercase tracking-widest"><i class="fa-solid fa-trophy mr-1"></i> Session Winner Announced!</div>
                            ${(() => {
                                const teamsCount = event.teamsCount || 3;
                                const stats = {};
                                for(let i=0; i<teamsCount; i++) {
                                    const tName = (window.teamNames[event.id] && window.teamNames[event.id][i]) || `Team ${i + 1}`;
                                    stats[i] = { name: tName, points: 0, gf: 0, ga: 0 };
                                }
                                (event.matches || []).forEach(m => {
                                    if (!m.isFinished) return;
                                    const t1Score = (m.team1Goals || []).length;
                                    const t2Score = (m.team2Goals || []).length;
                                    let t1Idx = 0, t2Idx = 1;
                                    for (let i = 0; i < teamsCount; i++) {
                                        const cName = (window.teamNames[event.id] && window.teamNames[event.id][i]) || `Team ${i + 1}`;
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
                                const sorted = Object.values(stats).sort((a,b) => {
                                    if (b.points !== a.points) return b.points - a.points;
                                    return (b.gf - b.ga) - (a.gf - a.ga);
                                });
                                const winner = sorted[0];
                                return winner ? `<div class="text-xl font-black text-emerald-900">${winner.name} Crowned Session Champions (${winner.points} pts)! 🏆</div>` : `<div class="text-sm font-bold text-emerald-800">Session finalized.</div>`;
                            })()}
                        </div>
                    ` : ''}

                    <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                        <div class="flex items-center gap-3 cursor-pointer group" onclick="viewPlayerProfile('${event.organizerId || ''}', '${event.organizer}')">
                            <img src="${event.organizerAvatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-10 h-10 rounded-full object-cover border border-slate-300 shadow-sm group-hover:border-brand transition">
                            <div>
                                <div class="text-[10px] font-bold text-slate-400 uppercase">👑 Organizer (Click to Connect)</div>
                                <div class="text-sm font-black text-slate-900 group-hover:text-brand transition">${event.organizer}</div>
                            </div>
                        </div>
                        ${isAttendee ? `<button onclick="handleRSVPAction('${event.id}', 'cancel')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-4 py-2 rounded-xl text-xs font-bold">❌ Cancel (RSVP No)</button>` : `<button onclick="handleRSVPAction('${event.id}', 'join')" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-5 py-2.5 rounded-xl text-xs shadow">⚽ Join Game</button>`}
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-1">
                            <div class="text-[10px] font-bold text-slate-400 uppercase">📅 Date</div>
                            <div class="text-sm font-black text-slate-900">${event.date}</div>
                        </div>
                        <div class="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-1">
                            <div class="text-[10px] font-bold text-slate-400 uppercase">⏰ Time</div>
                            <div class="text-sm font-black text-slate-900">${event.time}</div>
                        </div>
                    </div>

                    <div class="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex items-center justify-between gap-3">
                        <div class="overflow-hidden">
                            <div class="text-[10px] font-bold text-slate-400 uppercase">📍 Location</div>
                            <div class="text-xs font-black text-slate-900 mt-0.5 truncate">${event.location}</div>
                        </div>
                        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}" target="_blank" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow shrink-0 transition">
                            <i class="fa-solid fa-location-arrow"></i> Navigate
                        </a>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-1">
                            <div class="text-[10px] font-bold text-slate-400 uppercase">⚽ Game Type & Format</div>
                            <div class="text-sm font-black text-slate-900">${event.format || '7v7'}</div>
                        </div>
                        <div class="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-1">
                            <div class="text-[10px] font-bold text-slate-400 uppercase">👥 Amount of Teams</div>
                            <div class="text-sm font-black text-slate-900">${event.teamsCount || 3} Teams</div>
                        </div>
                    </div>
                </div>
            ` : ''}

            <!-- ROSTER TAB (With Waitlist and RSVP No Sections) -->
            ${tab === 'roster' ? `
                <div class="space-y-6">
                    <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                        <div>
                            <h4 class="text-xs font-black text-slate-900 uppercase">🏆 Team Building Tool</h4>
                            <p class="text-[11px] text-slate-500">Organize confirmed players into balanced teams.</p>
                        </div>
                        <button onclick="openTeamMakingModal('${event.id}')" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-4 py-2.5 rounded-xl text-xs shadow flex items-center gap-2">
                            <i class="fa-solid fa-users-rectangle"></i> Team Making
                        </button>
                    </div>

                    <!-- Confirmed Roster -->
                    <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                        <h4 class="text-xs font-black text-slate-900 uppercase tracking-wider">🟢 Roster (${attendeesCount})</h4>
                        <div class="space-y-2">
                            ${(event.attendees || []).map(att => `
                                <div onclick="viewPlayerProfile('${att.uid || ''}', '${att.name}')" class="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200 shadow-sm hover:border-brand cursor-pointer transition">
                                    <div class="flex items-center gap-3">
                                        <img src="${att.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-8 h-8 rounded-full object-cover">
                                        <div>
                                            <div class="text-xs font-bold text-slate-900">${att.name} ${att.captainTeamIndex !== undefined ? `⭐ (Captain)` : ''}</div>
                                            <div class="text-[10px] text-slate-500">${att.role || 'Player'} (Click to connect)</div>
                                        </div>
                                    </div>
                                    <span class="text-[10px] bg-brand/10 text-emerald-700 px-3 py-1 rounded-full font-bold">Confirmed</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Waiting List -->
                    <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                        <h4 class="text-xs font-black text-slate-900 uppercase tracking-wider">⏳ Waiting List (${waitingCount})</h4>
                        <div class="space-y-2">
                            ${waitingCount === 0 ? '<p class="text-xs text-slate-400 italic">No players on waiting list.</p>' : ''}
                            ${(event.waitingList || []).map(w => `
                                <div onclick="viewPlayerProfile('${w.uid || ''}', '${w.name}')" class="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200 shadow-sm hover:border-brand cursor-pointer transition">
                                    <div class="flex items-center gap-3">
                                        <img src="${w.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-8 h-8 rounded-full object-cover">
                                        <span class="text-xs font-bold text-slate-900">${w.name}</span>
                                    </div>
                                    <span class="text-[10px] bg-amber-50 text-amber-700 px-3 py-1 rounded-full font-bold">Waiting</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- RSVP No -->
                    <div class="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-3">
                        <h4 class="text-xs font-black text-slate-900 uppercase tracking-wider">❌ RSVP No (${declinedCount})</h4>
                        <div class="space-y-2">
                            ${declinedCount === 0 ? '<p class="text-xs text-slate-400 italic">None</p>' : ''}
                            ${(event.declinedList || []).map(d => `
                                <div class="text-xs font-bold text-slate-700 bg-white p-2.5 rounded-xl border border-slate-200">${d.name}</div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            ` : ''}

            <!-- GAME STATS TAB -->
            ${tab === 'stats' ? `
                <div class="space-y-4 py-2">
                    <div class="bg-slate-100 p-1 rounded-2xl border border-slate-200 flex items-center space-x-1">
                        <button onclick="switchStatsSubTab('matches')" class="flex-1 py-2 rounded-xl text-xs font-black transition ${window.activeStatsSubTab === 'matches' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">Matches</button>
                        <button onclick="switchStatsSubTab('leaderboard')" class="flex-1 py-2 rounded-xl text-xs font-black transition ${window.activeStatsSubTab === 'leaderboard' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">Leaderboard</button>
                        <button onclick="switchStatsSubTab('top-scorers')" class="flex-1 py-2 rounded-xl text-xs font-black transition ${window.activeStatsSubTab === 'top-scorers' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">Top Scorers</button>
                    </div>

                    ${window.activeStatsSubTab === 'matches' ? `
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

                    ${window.activeStatsSubTab === 'leaderboard' ? `
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
                                        const teamsCount = event.teamsCount || 3;
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

                    ${window.activeStatsSubTab === 'top-scorers' ? `
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
            ` : ''}

            <!-- COMMENTS TAB -->
            ${tab === 'comments' ? `
                <div class="space-y-4 flex flex-col h-[50vh]">
                    <div class="flex-1 overflow-y-auto space-y-3 pr-2" id="chat-messages-scroll">
                        ${(event.comments || []).length === 0 ? '<div class="text-center text-xs text-slate-400 py-10">No messages yet. Start the conversation!</div>' : ''}
                        ${(event.comments || []).map(c => `
                            <div class="flex items-end gap-2 ${c.uid === window.currentUser?.uid ? 'justify-end' : 'justify-start'}">
                                ${c.uid !== window.currentUser?.uid ? `<img src="${c.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-7 h-7 rounded-full object-cover mb-1 shadow-sm">` : ''}
                                <div class="max-w-[75%] bg-slate-100 border border-slate-200 rounded-2xl px-4 py-2.5 shadow-sm space-y-1">
                                    <div class="flex items-center justify-between gap-4">
                                        <span class="text-[11px] font-black text-brand-dark">${c.name}</span>
                                        <span class="text-[9px] text-slate-400">${c.timestamp || 'Just now'}</span>
                                    </div>
                                    <p class="text-xs text-slate-800">${c.text}</p>
                                </div>
                                ${c.uid === window.currentUser?.uid ? `<img src="${c.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-7 h-7 rounded-full object-cover mb-1 shadow-sm">` : ''}
                            </div>
                        `).join('')}
                    </div>

                    <div class="pt-2 border-t border-slate-200 space-y-2">
                        <div id="game-typing-indicator" class="text-[11px] italic text-brand font-bold animate-pulse px-1">${typingText}</div>
                        <form onsubmit="handleSendGameComment(event)" class="flex gap-2">
                            <input type="text" id="game-comment-input" oninput="handleGameCommentTyping()" required placeholder="Type a message..." class="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 text-xs focus:outline-none focus:border-brand">
                            <button type="submit" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-5 py-2.5 rounded-xl text-xs transition shadow">Send</button>
                        </form>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
};

// Admin Game Cancellation
window.cancelGameEvent = async function(eventId) {
    if (!confirm("Are you sure you want to cancel and delete this game?")) return;
    try {
        window.eventsList = (window.eventsList || []).filter(e => e.id !== eventId);
        const docRef = doc(db, 'artifacts', appId, 'global', 'events');
        await setDoc(docRef, { list: window.eventsList });
        window.showToast("Game cancelled and deleted.");
        closeEventModal();
        if (window.renderEvents) window.renderEvents();
    } catch (err) {
        console.error("Error cancelling game:", err);
        window.showToast("Failed to cancel game", "error");
    }
};

// Modal to setup competing teams when clicking "+ Add New Game"
window.openNewGameSetupModal = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    if (event.isSessionEnded) {
        window.showToast("Session is ended. No more games can be added.", "error");
        return;
    }

    const teamsCount = event.teamsCount || 3;
    window.teamNames[event.id] = window.teamNames[event.id] || {};
    let teamOptionsHtml = '';
    for (let i = 0; i < teamsCount; i++) {
        const tName = window.teamNames[event.id][i] || `Team ${i + 1}`;
        teamOptionsHtml += `<option value="${tName}">${tName}</option>`;
    }

    let modal = document.getElementById('new-game-setup-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'new-game-setup-modal';
        modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-slate-900">
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <h4 class="text-sm font-black uppercase text-slate-900">⚽ Setup New Match</h4>
                <button onclick="document.getElementById('new-game-setup-modal').remove()" class="text-slate-400 hover:text-slate-700 text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-3">
                <div>
                    <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Team A (Home)</label>
                    <select id="setup-team-a" class="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900">
                        ${teamOptionsHtml}
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Team B (Away)</label>
                    <select id="setup-team-b" class="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900">
                        ${teamOptionsHtml}
                    </select>
                </div>
            </div>
            <div class="flex gap-2 pt-2">
                <button onclick="document.getElementById('new-game-setup-modal').remove()" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl text-xs font-bold transition">Cancel</button>
                <button onclick="confirmCreateNewGame('${event.id}')" class="flex-1 bg-brand hover:bg-brand-dark text-slate-950 font-black py-2.5 rounded-xl text-xs shadow transition">Start Game</button>
            </div>
        </div>
    `;
};

window.confirmCreateNewGame = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    const teamA = document.getElementById('setup-team-a').value;
    const teamB = document.getElementById('setup-team-b').value;

    if (teamA === teamB) {
        window.showToast("Team A and Team B must be different teams!", "error");
        return;
    }

    event.matches = event.matches || [];
    event.matches.push({
        teamA: teamA,
        teamB: teamB,
        team1Goals: [],
        team2Goals: [],
        isFinished: false
    });

    const modal = document.getElementById('new-game-setup-modal');
    if (modal) modal.remove();

    await updateEventInFirestore(event);
    window.showToast(`Game started between ${teamA} and ${teamB}!`);
};

// Strict Team-Restricted Goal Scorer Picker Modal
window.promptTeamGoal = function(eventId, mIndex, teamNum) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    const match = event.matches[mIndex];
    if (!match) return;

    const targetTeamName = teamNum === 1 ? (match.teamA || "Team 1") : (match.teamB || "Team 2");
    
    let teamIdx = teamNum === 1 ? 0 : 1;
    for (let i = 0; i < (event.teamsCount || 3); i++) {
        const cName = (window.teamNames[event.id] && window.teamNames[event.id][i]) || `Team ${i + 1}`;
        if (targetTeamName === cName) {
            teamIdx = i;
            break;
        }
    }

    let teamPlayers = [];
    if (window.teamAssignments && window.teamAssignments[event.id] && window.teamAssignments[event.id][teamIdx]) {
        teamPlayers = window.teamAssignments[event.id][teamIdx];
    }

    if (teamPlayers.length === 0) {
        window.showToast(`No players assigned to ${targetTeamName} in the Team Building Tool yet!`, "error");
        return;
    }

    let picker = document.getElementById('goal-picker-modal');
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'goal-picker-modal';
        picker.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm';
        document.body.appendChild(picker);
    }

    picker.innerHTML = `
        <div class="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-slate-900">
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <h4 class="text-sm font-black uppercase text-slate-900">⚽ Goal Scorer (${targetTeamName})</h4>
                <button onclick="document.getElementById('goal-picker-modal').remove()" class="text-slate-400 hover:text-slate-700 text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                ${teamPlayers.map(player => `
                    <div onclick="selectGoalScorer('${event.id}', ${mIndex}, ${teamNum}, '${(player.name || player).replace(/'/g, "\\'")}')" class="flex items-center gap-3 p-3 bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 rounded-2xl cursor-pointer transition shadow-sm">
                        <img src="${player.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-8 h-8 rounded-full object-cover border border-slate-300 shadow-sm">
                        <span class="text-xs font-bold text-slate-900">${player.name || player}</span>
                    </div>
                `).join('')}
            </div>
            <button onclick="document.getElementById('goal-picker-modal').remove()" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl text-xs font-bold transition">Cancel</button>
        </div>
    `;
};

window.selectGoalScorer = async function(eventId, mIndex, teamNum, playerName) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    event.matches[mIndex] = event.matches[mIndex] || { team1Goals: [], team2Goals: [] };
    if (teamNum === 1) {
        event.matches[mIndex].team1Goals = event.matches[mIndex].team1Goals || [];
        event.matches[mIndex].team1Goals.push(playerName);
    } else {
        event.matches[mIndex].team2Goals = event.matches[mIndex].team2Goals || [];
        event.matches[mIndex].team2Goals.push(playerName);
    }

    const picker = document.getElementById('goal-picker-modal');
    if (picker) picker.remove();

    await updateEventInFirestore(event);
    window.showToast(`Goal added for ${playerName}!`);
};

// Team Making Modal
window.activeTeamTab = 0;
window.teamAssignments = {};
window.teamFormations = {};
window.teamNames = {};

window.openTeamMakingModal = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    let modal = document.getElementById('team-making-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'team-making-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm overflow-y-auto';
        document.body.appendChild(modal);
    }

    window.currentTeamBuildingEvent = event;
    renderTeamMakingContent();
};

window.switchTeamTab = function(teamIndex) {
    window.activeTeamTab = teamIndex;
    renderTeamMakingContent();
};

window.changeTeamFormation = function(eventId, teamIndex, formationKey) {
    window.teamFormations[eventId] = window.teamFormations[eventId] || {};
    window.teamFormations[eventId][teamIndex] = formationKey;
    renderTeamMakingContent();
};

window.updateTeamName = function(eventId, teamIndex, newName) {
    window.teamNames[eventId] = window.teamNames[eventId] || {};
    window.teamNames[eventId][teamIndex] = newName;
};

window.randomizeTeams = function(eventId) {
    const event = window.currentTeamBuildingEvent;
    if (!event) return;
    const attendees = [...(event.attendees || [])];
    for (let i = attendees.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [attendees[i], attendees[j]] = [attendees[j], attendees[i]];
    }

    const teamsCount = event.teamsCount || 3;
    window.teamAssignments[eventId] = {};
    for (let i = 0; i < teamsCount; i++) {
        window.teamAssignments[eventId][i] = [];
    }

    attendees.forEach((player, idx) => {
        const targetTeam = idx % teamsCount;
        window.teamAssignments[eventId][targetTeam].push(player);
    });

    window.showToast("Teams randomized successfully!");
    renderTeamMakingContent();
};

window.renderTeamMakingContent = function() {
    const modal = document.getElementById('team-making-modal');
    if (!modal || !window.currentTeamBuildingEvent) return;
    const event = window.currentTeamBuildingEvent;

    const attendees = event.attendees || [];
    const teamsCount = event.teamsCount || 3;
    const format = event.format || '7v7';

    const isUserAdmin = window.currentUser && event.organizerId === window.currentUser.uid;
    const isTeamCaptain = window.currentUser && attendees.some(a => a.uid === window.currentUser.uid && a.isCaptain && a.captainTeamIndex === window.activeTeamTab);
    const hasTeamPower = isUserAdmin || isTeamCaptain;

    const formationOptions = {
        '3v3': { '2-1': [2, 1], '1-2': [1, 2] },
        '4v4': { '2-1': [2, 1] },
        '5v5': { '2-1-1': [2, 1, 1], '2-2': [2, 2] },
        '7v7': { '3-2-1': [3, 2, 1], '3-1-2': [3, 1, 2], '2-2-2': [2, 2, 2] },
        '8v8': { '3-3-1': [3, 3, 1], '3-2-2': [3, 2, 2], '2-3-2': [2, 3, 2] },
        '9v9': { '3-3-2': [3, 3, 2], '4-3-1': [4, 3, 1], '3-2-3': [3, 2, 3] },
        '10v10': { '4-3-2': [4, 3, 2], '3-4-2': [3, 4, 2], '4-4-1': [4, 4, 1] },
        '11v11': { '4-4-2': [4, 4, 2], '4-3-3': [4, 3, 3], '5-3-2': [5, 3, 2] }
    };

    const availableFormations = formationOptions[format] || { '3-2-1': [3, 2, 1] };
    const defaultFormatKey = Object.keys(availableFormations)[0];

    window.teamFormations[event.id] = window.teamFormations[event.id] || {};
    window.teamFormations[event.id][window.activeTeamTab] = window.teamFormations[event.id][window.activeTeamTab] || defaultFormatKey;

    const currentFormationKey = window.teamFormations[event.id][window.activeTeamTab];
    const rowCounts = availableFormations[currentFormationKey] || [3, 2, 1];

    window.teamAssignments[event.id] = window.teamAssignments[event.id] || {};
    for (let i = 0; i < teamsCount; i++) {
        window.teamAssignments[event.id][i] = window.teamAssignments[event.id][i] || [];
    }

    window.teamNames[event.id] = window.teamNames[event.id] || {};
    const currentTeamName = window.teamNames[event.id][window.activeTeamTab] || `Team ${window.activeTeamTab + 1}`;

    const teamCaptain = attendees.find(a => a.isCaptain && a.captainTeamIndex === window.activeTeamTab);

    const currentAssignedUIDs = new Set();
    Object.values(window.teamAssignments[event.id]).forEach(teamArr => {
        teamArr.forEach(p => currentAssignedUIDs.add(p.uid));
    });

    const freeAgents = attendees.filter(a => !currentAssignedUIDs.has(a.uid));
    const currentTeamPlayers = window.teamAssignments[event.id][window.activeTeamTab] || [];

    let teamTabsHtml = '';
    for (let i = 0; i < teamsCount; i++) {
        const isActive = window.activeTeamTab === i;
        const tName = window.teamNames[event.id][i] || `Team ${i + 1}`;
        teamTabsHtml += `
            <button onclick="switchTeamTab(${i})" class="px-4 py-2 rounded-xl text-xs font-black transition ${isActive ? 'bg-brand text-slate-950 shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
                ${tName}
            </button>
        `;
    }

    let formationDropdownHtml = `
        <select onchange="changeTeamFormation('${event.id}', ${window.activeTeamTab}, this.value)" class="bg-slate-900 text-white font-bold text-xs px-3 py-1.5 rounded-xl border border-slate-700">
            ${Object.keys(availableFormations).map(f => `<option value="${f}" ${f === currentFormationKey ? 'selected' : ''}>Formation: ${f}</option>`).join('')}
        </select>
    `;

    let playerIndex = 0;
    let rowsHtml = '';

    rowCounts.slice().reverse().forEach((count) => {
        let rowSlots = '';
        for (let c = 0; c < count; c++) {
            const slotIdx = playerIndex++;
            const p = currentTeamPlayers[slotIdx];
            if (p) {
                rowSlots += `
                    <div onclick="${hasTeamPower ? `unassignPlayerFromSlot('${event.id}', ${window.activeTeamTab}, ${slotIdx})` : ''}" class="w-16 h-16 bg-white border-2 border-emerald-400 rounded-2xl p-1 text-center cursor-pointer shadow flex flex-col items-center justify-center relative group">
                        <img src="${p.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-6 h-6 rounded-full object-cover mb-0.5">
                        <span class="text-[9px] font-black text-slate-900 truncate w-full">${p.name.split(' ')[0]}</span>
                        ${hasTeamPower ? `<span class="absolute inset-0 bg-red-500/80 text-white text-[9px] font-bold rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition">Remove</span>` : ''}
                    </div>
                `;
            } else {
                rowSlots += `
                    <div onclick="${hasTeamPower ? `openAssignPicker('${event.id}', ${window.activeTeamTab}, ${slotIdx})` : `promptNoPower()`}" class="w-16 h-16 border-2 border-dashed border-white/60 bg-emerald-950/25 rounded-2xl p-1 text-center cursor-pointer hover:bg-emerald-900/40 transition flex flex-col items-center justify-center text-white/80 shadow">
                        <i class="fa-solid fa-shirt text-white/80 text-sm mb-0.5"></i>
                        <span class="text-[9px] font-bold">Spot</span>
                    </div>
                `;
            }
        }
        rowsHtml += `<div class="flex justify-center gap-3 mb-3">${rowSlots}</div>`;
    });

    const goaliePlayer = currentTeamPlayers[playerIndex++];
    rowsHtml += `
        <div class="flex justify-center mt-2">
            <div onclick="${hasTeamPower && goaliePlayer ? `unassignPlayerFromSlot('${event.id}', ${window.activeTeamTab}, 0)` : (hasTeamPower ? `openAssignPicker('${event.id}', ${window.activeTeamTab}, ${playerIndex - 1})` : `promptNoPower()`) }" class="w-16 h-16 ${goaliePlayer ? 'bg-white border-2 border-emerald-400' : 'border-2 border-dashed border-white/60 bg-emerald-950/25'} rounded-2xl p-1 text-center cursor-pointer shadow flex flex-col items-center justify-center relative group">
                ${goaliePlayer ? `
                    <img src="${goaliePlayer.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-6 h-6 rounded-full object-cover mb-0.5">
                    <span class="text-[9px] font-black text-slate-900 truncate w-full">${goaliePlayer.name.split(' ')[0]}</span>
                    ${hasTeamPower ? `<span class="absolute inset-0 bg-red-500/80 text-white text-[9px] font-bold rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition">Remove</span>` : ''}
                ` : `
                    <i class="fa-solid fa-shirt text-amber-300 text-sm mb-0.5"></i>
                    <span class="text-[9px] text-white font-bold">GK</span>
                `}
            </div>
        </div>
    `;

    modal.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-3xl max-w-3xl w-full p-6 text-slate-900 shadow-2xl space-y-6 relative max-h-[90vh] overflow-y-auto">
            <div class="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                    <h3 class="text-xl font-black text-slate-900">🏆 Team Building Tool (${format})</h3>
                    <p class="text-xs text-slate-500">Manage team names, formations, and lineup placements</p>
                </div>
                <button onclick="document.getElementById('team-making-modal').remove()" class="text-slate-400 hover:text-slate-700 text-xl font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="space-y-6">
                <div class="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                    <div class="flex items-center gap-2 flex-wrap">${teamTabsHtml}</div>
                    <div class="flex items-center gap-2">
                        ${isUserAdmin ? `<button onclick="randomizeTeams('${event.id}')" class="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black px-3.5 py-1.5 rounded-xl text-xs shadow flex items-center gap-1.5"><i class="fa-solid fa-shuffle"></i> Randomize</button>` : ''}
                        ${formationDropdownHtml}
                    </div>
                </div>

                <div class="flex items-center gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                    <label class="text-xs font-bold text-slate-700 uppercase">Team Name:</label>
                    <input type="text" value="${currentTeamName}" oninput="updateTeamName('${event.id}', ${window.activeTeamTab}, this.value)" ${hasTeamPower ? '' : 'disabled'} class="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-brand">
                </div>

                <div class="relative bg-gradient-to-b from-emerald-700 to-emerald-800 border-4 border-emerald-600 rounded-3xl p-6 shadow-inner overflow-hidden min-h-[380px] flex flex-col justify-between">
                    <div class="absolute inset-x-0 top-1/2 h-0.5 bg-white/30 pointer-events-none"></div>
                    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 border-2 border-white/30 rounded-full pointer-events-none"></div>

                    <div class="text-center relative z-10 flex flex-col sm:flex-row items-center justify-between px-2 gap-2">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="bg-slate-950/85 text-white font-black text-xs px-4 py-1.5 rounded-full uppercase tracking-wider shadow">${currentTeamName} (${currentTeamPlayers.length} Assigned)</span>
                            
                            ${teamCaptain ? `
                                <div class="bg-white/95 border border-emerald-300 px-3 py-1 rounded-2xl shadow-md flex items-center gap-2">
                                    <img src="${teamCaptain.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-6 h-6 rounded-full object-cover border border-amber-400">
                                    <div class="text-left leading-tight">
                                        <div class="text-[9px] font-black text-amber-600 uppercase">⭐ Captain</div>
                                        <div class="text-[11px] font-black text-slate-900">${teamCaptain.name.split(' ')[0]}</div>
                                    </div>
                                </div>
                            ` : ''}
                        </div>

                        <span class="text-xs text-white font-bold bg-emerald-900/60 px-3 py-1 rounded-xl">Formation: ${currentFormationKey}</span>
                    </div>

                    <div class="relative z-10 my-4 flex flex-col items-center justify-center">
                        ${rowsHtml}
                    </div>

                    <div class="text-center relative z-10 text-[10px] text-white/70 font-semibold">
                        ${hasTeamPower ? 'Click any spot on the pitch or Free Agent below to assign players' : 'Viewing lineup (Admin or Team Captain permissions required to edit)'}
                    </div>
                </div>

                <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                    <h4 class="text-xs font-black text-slate-900 uppercase">🆓 Free Agents List (${freeAgents.length})</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                        ${freeAgents.length === 0 ? '<p class="text-xs text-slate-400 italic col-span-full">All players have been assigned to teams!</p>' : ''}
                        ${freeAgents.map(a => `
                            <div class="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between shadow-sm">
                                <div class="flex items-center gap-2.5">
                                    <img src="${a.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-7 h-7 rounded-full object-cover">
                                    <span class="text-xs font-bold text-slate-900">${a.name}</span>
                                </div>
                                ${hasTeamPower ? `<button onclick="assignPlayerToNextSlot('${event.id}', ${window.activeTeamTab}, '${a.uid}')" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-3 py-1 rounded-lg text-[10px] shadow">Assign</button>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="text-center pt-2">
                    <button onclick="document.getElementById('team-making-modal').remove()" class="bg-slate-900 hover:bg-slate-800 text-white font-bold px-6 py-2.5 rounded-xl text-xs shadow">Done</button>
                </div>
            </div>
        </div>
    `;
};

window.openAssignPicker = function(eventId, teamIndex, slotIndex) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    const attendees = event.attendees || [];
    window.teamAssignments[eventId] = window.teamAssignments[eventId] || {};
    const currentAssignedUIDs = new Set();
    Object.values(window.teamAssignments[eventId]).forEach(teamArr => {
        teamArr.forEach(p => currentAssignedUIDs.add(p.uid));
    });

    const freeAgents = attendees.filter(a => !currentAssignedUIDs.has(a.uid));
    if (freeAgents.length === 0) {
        window.showToast("No Free Agents available.", "error");
        return;
    }

    let picker = document.getElementById('assign-picker-modal');
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'assign-picker-modal';
        picker.className = 'fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4';
        document.body.appendChild(picker);
    }

    picker.innerHTML = `
        <div class="bg-white rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl text-slate-900">
            <h4 class="text-sm font-black uppercase">Select Free Agent for Spot</h4>
            <div class="space-y-2 max-h-60 overflow-y-auto">
                ${freeAgents.map(a => `
                    <div onclick="assignSpecificPlayerToSlot('${eventId}', ${teamIndex}, ${slotIndex}, '${a.uid}')" class="flex items-center gap-3 p-2.5 hover:bg-slate-100 rounded-xl cursor-pointer">
                        <img src="${a.avatar}" class="w-7 h-7 rounded-full object-cover">
                        <span class="text-xs font-bold">${a.name}</span>
                    </div>
                `).join('')}
            </div>
            <button onclick="document.getElementById('assign-picker-modal').remove()" class="w-full bg-slate-200 py-2 rounded-xl text-xs font-bold">Cancel</button>
        </div>
    `;
};

window.assignSpecificPlayerToSlot = function(eventId, teamIndex, slotIndex, uid) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    const player = (event.attendees || []).find(a => a.uid === uid);
    if (!player) return;

    window.teamAssignments[eventId] = window.teamAssignments[eventId] || {};
    window.teamAssignments[eventId][teamIndex] = window.teamAssignments[eventId][teamIndex] || [];
    window.teamAssignments[eventId][teamIndex][slotIndex] = player;

    const picker = document.getElementById('assign-picker-modal');
    if (picker) picker.remove();
    renderTeamMakingContent();
};

window.assignPlayerToNextSlot = function(eventId, teamIndex, uid) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    const player = (event.attendees || []).find(a => a.uid === uid);
    if (!player) return;

    window.teamAssignments[eventId] = window.teamAssignments[eventId] || {};
    window.teamAssignments[eventId][teamIndex] = window.teamAssignments[eventId][teamIndex] || [];
    window.teamAssignments[eventId][teamIndex].push(player);

    renderTeamMakingContent();
};

window.unassignPlayerFromSlot = function(eventId, teamIndex, slotIndex) {
    if (!window.teamAssignments[eventId] || !window.teamAssignments[eventId][teamIndex]) return;
    window.teamAssignments[eventId][teamIndex].splice(slotIndex, 1);
    renderTeamMakingContent();
};

window.promptNoPower = function() {
    window.showToast("Only Admins and Team Captains can manage lineups.", "error");
};

// Match Results Goals Management & Session Finalization
window.toggleMatchFinished = async function(eventId, mIndex) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    event.matches[mIndex].isFinished = !event.matches[mIndex].isFinished;
    await updateEventInFirestore(event);
    window.showToast(event.matches[mIndex].isFinished ? "Game marked as finished!" : "Game reopened.");
};

window.toggleSessionEnded = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    event.isSessionEnded = !event.isSessionEnded;
    await updateEventInFirestore(event);
    window.showToast(event.isSessionEnded ? "Session ended successfully!" : "Session reopened.");
};

window.removeTeamGoal = async function(eventId, mIndex, teamNum, gIdx) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    if (!event.matches[mIndex]) return;

    if (teamNum === 1) {
        event.matches[mIndex].team1Goals.splice(gIdx, 1);
    } else {
        event.matches[mIndex].team2Goals.splice(gIdx, 1);
    }

    await updateEventInFirestore(event);
    window.showToast("Goal removed.");
};

// Share Sheet Actions
window.toggleShareDropdown = function() {
    const dropdown = document.getElementById('share-dropdown');
    if (dropdown) dropdown.classList.toggle('hidden');
};

window.shareToWhatsApp = function(title, location) {
    const text = encodeURIComponent(`⚽ Check out this soccer game on FutNet: "${title}" at ${location}! Join us!`);
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
};

window.shareToTwitter = function(title) {
    const text = encodeURIComponent(`⚽ Playing soccer on FutNet: "${title}". Come join the match!`);
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
};

window.copyEventLink = function(title) {
    navigator.clipboard.writeText(window.location.href).then(() => {
        window.showToast(`Link for "${title}" copied to clipboard!`);
        toggleShareDropdown();
    });
};

// Admin Helpers
window.updatePlayerPaidStatus = async function(eventId, uid, paidStatus) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    event.attendees = (event.attendees || []).map(a => a.uid === uid ? { ...a, paid: paidStatus } : a);
    await updateEventInFirestore(event);
    window.showToast("Player payment status updated!");
};

window.assignTeamCaptain = async function(eventId, uid, teamIndexStr) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    if (teamIndexStr === "") return;

    const teamIndex = parseInt(teamIndexStr);

    event.attendees = (event.attendees || []).map(a => {
        if (a.captainTeamIndex === teamIndex) {
            return { ...a, isCaptain: false, captainTeamIndex: undefined };
        }
        if (a.uid === uid) {
            return { ...a, isCaptain: true, captainTeamIndex: teamIndex };
        }
        return a;
    });

    await updateEventInFirestore(event);
    const tName = (window.teamNames[event.id] && window.teamNames[event.id][teamIndex]) || `Team ${teamIndex + 1}`;
    window.showToast(`Captain assigned to ${tName}!`);
    renderEventDetailModalContent();
};

window.filterFriendsAutocomplete = function(queryStr) {
    const dropdown = document.getElementById('friend-autocomplete-dropdown');
    if (!dropdown) return;
    const query = queryStr.toLowerCase().trim();
    if (!query) {
        dropdown.classList.add('hidden');
        return;
    }
    const friends = window.friendsList || [];
    const matches = friends.filter(f => f.name.toLowerCase().includes(query) || (f.nickname && f.nickname.toLowerCase().includes(query)));

    if (matches.length > 0) {
        dropdown.innerHTML = matches.map(f => `
            <div onclick="selectFriendForRoster('${f.name.replace(/'/g, "\\'")}', '${f.avatar || ''}', '${f.uid || ('fr_' + Date.now())}')" class="p-2.5 hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-2">
                <img src="${f.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-6 h-6 rounded-full object-cover">
                <span class="font-bold text-slate-900">${f.name}</span>
            </div>
        `).join('');
        dropdown.classList.remove('hidden');
    } else {
        dropdown.innerHTML = `<div class="p-2.5 text-xs text-slate-400">No friends found</div>`;
        dropdown.classList.remove('hidden');
    }
};

window.selectFriendForRoster = function(name, avatar, uid) {
    const input = document.getElementById('admin-add-player-input');
    if (input) input.value = name;
    window.selectedFriendToAdd = { name, avatar, uid };
    const dropdown = document.getElementById('friend-autocomplete-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
};

window.addFriendToGameRoster = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    const input = document.getElementById('admin-add-player-input');
    const name = input ? input.value.trim() : '';
    if (!name) return;

    const friendObj = window.selectedFriendToAdd || { name, avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100', uid: 'usr_' + Date.now() };
    event.attendees = event.attendees || [];
    if (!event.attendees.some(a => a.name.toLowerCase() === name.toLowerCase())) {
        event.attendees.push({
            uid: friendObj.uid,
            name: friendObj.name,
            avatar: friendObj.avatar,
            role: 'Player',
            status: 'confirmed',
            paid: 'Unpaid'
        });
        await updateEventInFirestore(event);
        window.showToast(`${name} added to roster!`);
        if (input) input.value = '';
        window.selectedFriendToAdd = null;
    } else {
        window.showToast("Player already on roster.", "error");
    }
};

window.addNewMatchSession = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    if (event.isSessionEnded) {
        window.showToast("Session is ended. No more games can be added.", "error");
        return;
    }
    event.matches = event.matches || [];
    event.matches.push({ team1Goals: [], team2Goals: [], isFinished: false });
    await updateEventInFirestore(event);
};

window.removeMatchSession = async function(eventId, mIndex) {
    if (!confirm("Are you sure you want to delete this game session?")) return;
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    event.matches.splice(mIndex, 1);
    await updateEventInFirestore(event);
    window.showToast("Game session deleted.");
};

window.openEditEventForm = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    window.switchTab('create-event');
    closeEventModal();

    setTimeout(() => {
        document.getElementById('ce-title').value = event.title;
        document.getElementById('ce-visibility').value = event.visibility || 'Public';
        document.getElementById('ce-date').value = event.date;
        document.getElementById('ce-time').value = event.time;
        
        const locParts = event.location.match(/^(.*?)\s*\((.*?),\s*(.*?)\)$/);
        if (locParts) {
            document.getElementById('ce-park-search').value = locParts[1];
            document.getElementById('ce-parkname').value = locParts[1];
            document.getElementById('ce-city').value = locParts[2];
            document.getElementById('ce-state').value = locParts[3];
        } else {
            document.getElementById('ce-parkname').value = event.location;
        }

        document.getElementById('ce-description').value = event.description || '';
        document.getElementById('ce-rules').value = event.rules || '';
        document.getElementById('ce-teams-count').value = event.teamsCount || 3;
        document.getElementById('ce-format').value = event.format || '7v7';
        document.getElementById('ce-fee').value = event.fee || 'Free';

        let hiddenId = document.getElementById('ce-edit-event-id');
        if (!hiddenId) {
            hiddenId = document.createElement('input');
            hiddenId.type = 'hidden';
            hiddenId.id = 'ce-edit-event-id';
            document.querySelector('#tab-create-event form').appendChild(hiddenId);
        }
        hiddenId.value = event.id;

        window.editingOrganizerName = event.organizer;
        window.editingOrganizerAvatar = event.organizerAvatar;
        window.editingOrganizerId = event.organizerId;
        window.editingAttendees = event.attendees;
        window.editingComments = event.comments;
        window.editingMatches = event.matches;
    }, 100);
};

// Typing Indicators & Real-Time Sync
let gameTypingTimer = null;
window.handleGameCommentTyping = async function() {
    if (!window.activeModalEventId || !window.currentUser) return;
    const event = (window.eventsList || []).find(ev => ev.id === window.activeModalEventId);
    if (!event) return;

    event.typingUsers = event.typingUsers || [];
    if (!event.typingUsers.some(u => u.uid === window.currentUser.uid)) {
        event.typingUsers.push({ uid: window.currentUser.uid, name: window.userProfile.firstName });
        await updateEventInFirestore(event);
    }

    clearTimeout(gameTypingTimer);
    gameTypingTimer = setTimeout(async () => {
        event.typingUsers = (event.typingUsers || []).filter(u => u.uid !== window.currentUser.uid);
        await updateEventInFirestore(event);
    }, 2000);
};

async function updateEventInFirestore(event) {
    try {
        const docRef = doc(db, 'artifacts', appId, 'global', 'events');
        const list = (window.eventsList || []).map(ev => ev.id === event.id ? event : ev);
        await setDoc(docRef, { list });
    } catch (err) {
        console.error("Error updating event:", err);
    }
}

window.closeEventModal = function() {
    const modal = document.getElementById('event-detail-modal');
    if (modal) modal.remove();
    window.activeModalEventId = null;
};

window.handleSendGameComment = async function(e) {
    e.preventDefault();
    const input = document.getElementById('game-comment-input');
    const text = input.value.trim();
    if (!text || !window.activeModalEventId) return;

    const event = (window.eventsList || []).find(ev => ev.id === window.activeModalEventId);
    if (!event) return;

    const newComment = {
        uid: window.userProfile.uid,
        name: `${window.userProfile.firstName} ${window.userProfile.lastName}`,
        avatar: window.userProfile.avatar,
        text: text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    event.comments = event.comments || [];
    event.comments.push(newComment);
    event.typingUsers = (event.typingUsers || []).filter(u => u.uid !== window.currentUser.uid);

    await updateEventInFirestore(event);
    input.value = '';
};

window.handleRSVPAction = async function(eventId, action) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    event.attendees = event.attendees || [];
    event.waitingList = event.waitingList || [];
    event.declinedList = event.declinedList || [];

    const userObj = {
        uid: window.userProfile.uid,
        name: `${window.userProfile.firstName} ${window.userProfile.lastName}`,
        avatar: window.userProfile.avatar,
        role: 'Player',
        status: 'confirmed',
        paid: 'Unpaid'
    };

    if (action === 'join') {
        event.declinedList = event.declinedList.filter(d => d.uid !== window.userProfile.uid);
        if (!event.attendees.some(a => a.uid === window.userProfile.uid)) {
            event.attendees.push(userObj);
        }x
    } else if (action === 'cancel') {
        event.attendees = event.attendees.filter(a => a.uid !== window.userProfile.uid);
        if (!event.declinedList.some(d => d.uid === window.userProfile.uid)) {
            event.declinedList.push({ uid: window.userProfile.uid, name: `${window.userProfile.firstName} ${window.userProfile.lastName}` });
        }
    }

    await updateEventInFirestore(event);
    window.showToast("RSVP updated live!");
};

window.removePlayerFromEvent = async function(eventId, uid) {
    if (!confirm("Are you sure you want to remove this player from the roster?")) return;
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    event.attendees = (event.attendees || []).filter(a => a.uid !== uid);
    await updateEventInFirestore(event);
    window.showToast("Player removed from roster.");
};