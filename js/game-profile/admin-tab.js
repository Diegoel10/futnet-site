// js/game-profile/admin-tab.js: Complete admin panel with roster management, match tracker, and add players screen
import { db, appId } from '../firebase-config.js';
import { doc, setDoc, deleteDoc, addDoc, collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.activeGameProfileTab = window.activeGameProfileTab || 'manage-event';

window.switchGameProfileTab = function(tabKey) {
    window.activeGameProfileTab = tabKey;
    if (typeof window.renderEventDetailModalContent === 'function') {
        window.renderEventDetailModalContent();
    }
};

export function renderAdminTab(event) {
    if (!event) return '';
    const attendees = Array.isArray(event.attendees) ? event.attendees : [];
    const waitingList = Array.isArray(event.waitingList) ? event.waitingList : [];
    const matches = Array.isArray(event.matches) ? event.matches : [];
    const currentTab = window.activeGameProfileTab || 'manage-event';

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

    const attendeesHtml = attendees.length === 0 
        ? '<div class="text-center text-xs text-white/40 py-4">No players confirmed yet.</div>'
        : attendees.map(att => {
            const isGeneratedAvatar = (url) => typeof url === 'string' && url.includes('api.dicebear.com');
            const dirByUid = window.directoryList?.find(u => String(u.uid) === String(att.uid));
            const dirByName = window.directoryList?.find(u => u.name && att.name && u.name.toLowerCase() === att.name.toLowerCase());
            const attOwn = att.avatar || att.photoURL;
            let attAvatar =
                dirByUid?.avatar || dirByUid?.photoURL ||
                (attOwn && !isGeneratedAvatar(attOwn) ? attOwn : null) ||
                dirByName?.avatar || dirByName?.photoURL ||
                attOwn ||
                `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(att.name || 'Player')}`;

            const isOrg = att.uid === event.organizerId;
            const paidStatus = att.paid || 'Unpaid';
            const safeName = (att.name || 'Player').replace(/'/g, "\\'");
            const orgBadge = isOrg ? '<span class="text-[8px] bg-[#00F296]/20 text-[#00F296] px-2 py-0.5 rounded font-black border border-[#00F296]/40">Organizer</span>' : '';

            let guestsHtml = '';
            if (att.guests && att.guests.length > 0) {
                guestsHtml = att.guests.map((g, gIdx) => `
                    <div class="flex items-center justify-between text-xs bg-black/30 p-2 rounded-xl border border-white/5">
                        <div>
                            <span class="text-white/80 font-medium">➕ ${g.name || 'Guest'}</span>
                            <span class="text-[9px] text-[#00F296] ml-1">(+1 of ${att.name || 'Player'})</span>
                            <div class="text-[10px] text-white/60 mt-0.5">${g.paid || 'Unpaid'}</div>
                        </div>
                        <button data-action="manage-guest" data-event-id="${event.id}" data-uid="${att.uid}" data-guest-idx="${gIdx}" data-guest-name="${(g.name || 'Guest').replace(/'/g, "\\'")}" class="bg-black/60 hover:bg-black text-white font-bold px-2.5 py-1 rounded-xl text-[10px] border border-white/10">Manage</button>
                    </div>
                `).join('');
            }

            return `
                <div class="bg-black/40 border border-white/10 p-3 rounded-2xl space-y-2">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3 overflow-hidden">
                            <img src="${attAvatar}" class="w-8 h-8 rounded-full object-cover bg-black border border-white/20 shrink-0" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                            <div class="truncate">
                                <div class="flex items-center gap-1.5 flex-wrap">
                                    <span class="text-xs font-bold text-white truncate">${att.name || 'Player'}</span>
                                    ${orgBadge}
                                </div>
                                <div class="text-[10px] text-white/60 mt-0.5">${paidStatus}</div>
                            </div>
                        </div>
                        
                        <button data-action="manage-player" data-event-id="${event.id}" data-uid="${att.uid}" data-name="${safeName}" class="bg-black/60 hover:bg-black text-white font-bold px-3 py-1.5 rounded-xl text-xs border border-white/15 transition flex items-center gap-1">
                            <i class="fa-solid fa-sliders text-[10px]"></i> Manage
                        </button>
                    </div>
                    ${guestsHtml ? `<div class="ml-8 pl-3 border-l-2 border-emerald-500/40 space-y-1.5 pt-1">${guestsHtml}</div>` : ''}
                </div>
            `;
        }).join('');

    const waitlistHtml = waitingList.length > 0 ? `
        <div class="space-y-2 pt-2 border-t border-white/10">
            <h5 class="text-[10px] font-black text-amber-400 uppercase tracking-wider">⏳ Waitlist (${waitingList.length})</h5>
            ${waitingList.map(w => `
                <div class="bg-amber-950/30 border border-amber-500/30 p-2.5 rounded-xl flex items-center justify-between text-xs">
                    <span class="font-bold text-white">${w.name || 'Player'}</span>
                    <button onclick="removePlayerFromEvent('${event.id}', '${w.uid}')" class="text-red-400 hover:text-red-300 font-bold text-[11px]">Remove</button>
                </div>
            `).join('')}
        </div>
    ` : '';

    const liveActive = event.liveMatchActive;
    let liveTimerText = "00:00";
    let t1GoalCount = 0;
    let t2GoalCount = 0;

    if (liveActive) {
        t1GoalCount = Array.isArray(liveActive.team1Goals) ? liveActive.team1Goals.length : 0;
        t2GoalCount = Array.isArray(liveActive.team2Goals) ? liveActive.team2Goals.length : 0;

        if (typeof window.calculateCurrentLiveSeconds === 'function') {
            const currentSecs = window.calculateCurrentLiveSeconds(liveActive);
            const m = Math.floor(currentSecs / 60);
            const s = currentSecs % 60;
            liveTimerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
    }

    const liveBannerHtml = liveActive ? `
        <div class="bg-gradient-to-r from-emerald-950 to-teal-950 border-2 border-[#00F296] rounded-2xl p-4 space-y-3 shadow-xl animate-pulse">
            <div class="flex items-center justify-between">
                <span class="bg-[#00F296] text-slate-950 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">🔴 LIVE MATCH</span>
                <span class="text-xs font-mono font-black text-[#00F296]">
                    ${liveTimerText}
                </span>
            </div>
            <div class="flex items-center justify-between text-sm font-black text-white">
                <span>${liveActive.teamA || 'Team 1'}</span>
                <span class="text-[#00F296] font-mono text-base">${t1GoalCount} - ${t2GoalCount}</span>
                <span>${liveActive.teamB || 'Team 2'}</span>
            </div>
            <div class="flex gap-2 pt-1">
                <button onclick="openStartMatchScreen('${event.id}')" class="flex-1 bg-[#00F296] text-slate-950 font-black py-2 rounded-xl text-xs shadow">Resume / Manage</button>
                <button onclick="discardLiveMatch('${event.id}')" class="bg-red-500/20 text-red-300 border border-red-500/40 font-bold px-3 py-2 rounded-xl text-xs">Discard</button>
            </div>
        </div>
    ` : '';

    const matchesListHtml = matches.length === 0 
        ? '<div class="text-center text-xs text-white/40 py-3">No match results recorded yet.</div>'
        : matches.map((m, mIdx) => {
            const teamA = m.teamA || "Team 1";
            const teamB = m.teamB || "Team 2";
            const t1Goals = Array.isArray(m.team1Goals) ? m.team1Goals : [];
            const t2Goals = Array.isArray(m.team2Goals) ? m.team2Goals : [];
            const isFinished = m.isFinished !== undefined ? m.isFinished : true;

            const t1ScorersHtml = t1Goals.map(scorer => {
                const avatar = resolvePlayerAvatar(scorer);
                return `
                    <div class="flex items-center gap-2 bg-black/50 px-3 py-1.5 rounded-full border border-white/10 text-xs">
                        <i class="fa-solid fa-futbol text-[#00F296] text-[10px]"></i>
                        <img src="${avatar}" class="w-5 h-5 rounded-full object-cover border border-[#00F296]/40" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                        <span class="text-white font-bold">${scorer}</span>
                    </div>
                `;
            }).join('');

            const t2ScorersHtml = t2Goals.map(scorer => {
                const avatar = resolvePlayerAvatar(scorer);
                return `
                    <div class="flex items-center gap-2 bg-black/50 px-3 py-1.5 rounded-full border border-white/10 text-xs">
                        <i class="fa-solid fa-futbol text-red-400 text-[10px]"></i>
                        <img src="${avatar}" class="w-5 h-5 rounded-full object-cover border border-red-400/40" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                        <span class="text-white font-bold">${scorer}</span>
                    </div>
                `;
            }).join('');

            return `
                <div class="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-3 shadow-md">
                    <div class="flex items-center justify-between text-xs font-black">
                        <span class="text-white">${teamA}</span>
                        <div class="flex items-center gap-2">
                            <span class="bg-[#00F296]/20 text-[#00F296] px-3.5 py-1 rounded-full border border-[#00F296]/40 text-xs tracking-wider font-mono">${t1Goals.length} - ${t2Goals.length}</span>
                            <span class="text-[9px] px-2 py-0.5 rounded font-bold ${isFinished ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}">${isFinished ? 'Ended' : 'Pending'}</span>
                        </div>
                        <span class="text-white">${teamB}</span>
                    </div>

                    <div class="grid grid-cols-2 gap-2 pt-1 border-t border-white/10">
                        <div class="space-y-1.5">${t1ScorersHtml || '<span class="text-[10px] text-white/40 italic">No goals recorded</span>'}</div>
                        <div class="space-y-1.5">${t2ScorersHtml || '<span class="text-[10px] text-white/40 italic">No goals recorded</span>'}</div>
                    </div>

                    <div class="grid grid-cols-2 gap-2 pt-2 border-t border-white/10">
                        <button onclick="openEditMatchModal('${event.id}', ${mIdx})" class="bg-black/60 hover:bg-black text-white font-bold py-2 rounded-xl text-xs border border-white/20 transition flex items-center justify-center gap-1.5">
                            <i class="fa-solid fa-pen text-[10px]"></i> Edit Match
                        </button>
                        <button onclick="deleteMatchRecord('${event.id}', ${mIdx})" class="bg-red-500/20 hover:bg-red-500/30 text-red-300 font-bold py-2 rounded-xl text-xs border border-red-500/40 transition flex items-center justify-center gap-1.5">
                            <i class="fa-solid fa-trash text-[10px]"></i> Delete Match
                        </button>
                    </div>
                </div>
            `;
        }).join('');

    const pillsNavHtml = `
        <div class="grid grid-cols-3 gap-2 bg-black/40 p-1.5 rounded-xl border border-white/10">
            <button onclick="switchGameProfileTab('manage-event')" class="py-2 px-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition whitespace-nowrap text-center ${currentTab === 'manage-event' ? 'bg-[#00F296]/25 text-[#00F296] border border-[#00F296]/50 shadow' : 'text-white/60 hover:text-white'}">
                Manage Event
            </button>
            <button onclick="switchGameProfileTab('manage-players')" class="py-2 px-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition whitespace-nowrap text-center ${currentTab === 'manage-players' ? 'bg-[#00F296]/25 text-[#00F296] border border-[#00F296]/50 shadow' : 'text-white/60 hover:text-white'}">
                Manage Players
            </button>
            <button onclick="switchGameProfileTab('manage-matches')" class="py-2 px-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition whitespace-nowrap text-center ${currentTab === 'manage-matches' ? 'bg-[#00F296]/25 text-[#00F296] border border-[#00F296]/50 shadow' : 'text-white/60 hover:text-white'}">
                Manage Matches
            </button>
        </div>
    `;

    let activeTabContentHtml = '';

    if (currentTab === 'manage-event') {
        activeTabContentHtml = `
            <div class="space-y-3">
                <div class="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-3">
                    <h5 class="text-xs font-black uppercase text-[#00F296]">Event Controls</h5>
                    <div class="flex flex-wrap gap-2">
                        <button onclick="openTwoPageGameWizard('${event.id}', 'edit')" class="bg-[#00F296] text-slate-950 font-black px-4 py-2.5 rounded-xl text-xs shadow">Edit Game</button>
                        <button onclick="openTwoPageGameWizard('${event.id}', 'copy')" class="bg-black/60 text-white font-bold px-4 py-2.5 rounded-xl text-xs border border-white/20">Copy Event</button>
                        <button onclick="confirmCancelGame('${event.id}')" class="bg-red-500/20 text-red-400 font-bold px-4 py-2.5 rounded-xl text-xs border border-red-500/40">Cancel Game</button>
                    </div>
                </div>
            </div>
        `;
    } else if (currentTab === 'manage-players') {
        activeTabContentHtml = `
            <div class="space-y-4">
                <button onclick="openAddPlayersScreen('${event.id}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3 rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2">
                    <i class="fa-solid fa-user-plus"></i> Add Players
                </button>
                <div class="space-y-2.5">
                    ${attendeesHtml}
                </div>
                ${waitlistHtml}
            </div>
        `;
    } else if (currentTab === 'manage-matches') {
        const isSessionEnded = event.isSessionEnded || false;
        activeTabContentHtml = `
            <div class="space-y-4">
                <div class="flex items-center justify-between gap-2">
                    <button onclick="checkAndOpenStartMatch('${event.id}')" class="flex-1 bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-2.5 rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2">
                        <i class="fa-solid fa-play"></i> Start Match
                    </button>
                    <button onclick="toggleSessionEnded('${event.id}')" class="px-3 py-2.5 rounded-xl text-xs font-black ${isSessionEnded ? 'bg-amber-400 text-slate-950 shadow' : 'bg-black/60 text-white/70 border border-white/15'}">${isSessionEnded ? 'Session Ended' : 'End Session'}</button>
                </div>
                <div class="space-y-3">
                    ${liveBannerHtml}
                    ${matchesListHtml}
                </div>
            </div>
        `;
    }

    return `
        <div class="space-y-4">
            ${pillsNavHtml}
            <div>
                ${activeTabContentHtml}
            </div>
        </div>
    `;
}

// Add Players Modal Screen
window.openAddPlayersScreen = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    let modal = document.getElementById('admin-add-players-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'admin-add-players-modal';
        modal.className = 'fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 text-white shadow-2xl space-y-4">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 class="text-sm font-black uppercase text-white">➕ Add Player to Roster</h3>
                <button onclick="document.getElementById('admin-add-players-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-3">
                <div>
                    <label class="block text-[10px] font-black uppercase tracking-wider text-white/60 mb-1">Player Name</label>
                    <input type="text" id="admin-add-player-name" placeholder="Enter player name..." class="w-full bg-black border border-teal-500/60 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-[#00F296]">
                </div>
            </div>
            <div class="flex gap-2 pt-2">
                <button onclick="document.getElementById('admin-add-players-modal').remove()" class="flex-1 bg-black/60 text-white py-2.5 rounded-xl text-xs font-bold border border-white/20">Cancel</button>
                <button onclick="submitAdminAddPlayer('${eventId}')" class="flex-1 bg-[#00F296] text-slate-950 font-black py-2.5 rounded-xl text-xs shadow">Add Player</button>
            </div>
        </div>
    `;
};

window.submitAdminAddPlayer = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    const input = document.getElementById('admin-add-player-name');
    const nameVal = input ? input.value.trim() : '';
    if (!nameVal) {
        window.showToast("Please enter a player name", "error");
        return;
    }

    event.attendees = event.attendees || [];
    event.attendees.push({
        uid: 'usr_' + Math.random().toString(36).substring(2, 9),
        name: nameVal,
        avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(nameVal)}`,
        role: 'Player',
        status: 'confirmed',
        paid: 'Unpaid',
        guests: []
    });

    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), { attendees: event.attendees }, { merge: true });
        window.showToast(`${nameVal} added to roster!`);
        document.getElementById('admin-add-players-modal')?.remove();
    } catch (e) {
        window.showToast("Failed to add player", "error");
    }
};

window.checkAndOpenStartMatch = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (event && event.liveMatchActive) {
        if (!confirm("There is a game going, would you like to start a second match?")) {
            return;
        }
    }
    if (typeof window.openStartMatchScreen === 'function') {
        window.openStartMatchScreen(eventId);
    }
};

window.openTwoPageGameWizard = function(eventId, mode) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    window._wizardData = {
        mode: mode,
        eventId: eventId,
        title: event.title || '',
        visibility: event.visibility || 'Public',
        date: mode === 'copy' ? '' : (event.date || ''),
        time: event.time || '20:00',
        location: event.location || '',
        teamsCount: event.teamsCount || 3,
        format: event.format || '7v7',
        fee: event.fee !== undefined ? event.fee : 'Free',
        description: event.description || '',
        rules: event.rules || '',
        allowPlusOnes: event.allowPlusOnes !== undefined ? event.allowPlusOnes : true,
        plusOneLimit: event.plusOneLimit !== undefined ? event.plusOneLimit : 1
    };

    renderWizardPage1();
};

window.renderWizardPage1 = function() {
    let modal = document.getElementById('two-page-game-wizard-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'two-page-game-wizard-modal';
        modal.className = 'fixed inset-0 z-[190] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md overflow-y-auto';
        document.body.appendChild(modal);
    }

    const d = window._wizardData;
    const isPublic = d.visibility === 'Public';

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-[32px] p-6 space-y-4 max-w-md w-full text-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 class="text-sm font-black uppercase text-white">${d.mode === 'copy' ? '📋 Copy Game (1/2)' : '✏ Edit Game (1/2)'}</h3>
                <button onclick="document.getElementById('two-page-game-wizard-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="space-y-4 text-xs">
                <div>
                    <label class="block font-black uppercase text-[10px] tracking-wider text-[#00F296] mb-1">🏆 Game / Event Title</label>
                    <input type="text" id="wiz-title" value="${d.title}" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white focus:outline-none focus:border-[#00F296]" placeholder="Soccer pick-up (default)">
                </div>

                <div>
                    <label class="block font-black uppercase text-[10px] tracking-wider text-[#00F296] mb-1">👁 Game Visibility</label>
                    <div class="grid grid-cols-2 gap-2">
                        <button type="button" onclick="window._wizardData.visibility='Public'; renderWizardPage1()" class="p-3 rounded-2xl border text-left transition ${isPublic ? 'bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black border-transparent shadow' : 'bg-black/60 text-white/70 border-white/10'}">
                            <div class="font-black text-xs">Public</div>
                            <div class="text-[9px] opacity-80">Anyone can see and join</div>
                        </button>
                        <button type="button" onclick="window._wizardData.visibility='Private'; renderWizardPage1()" class="p-3 rounded-2xl border text-left transition ${!isPublic ? 'bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black border-transparent shadow' : 'bg-black/60 text-white/70 border-white/10'}">
                            <div class="font-black text-xs">Private</div>
                            <div class="text-[9px] opacity-80">Invite only</div>
                        </button>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-black uppercase text-[10px] tracking-wider text-[#00F296] mb-1">📅 Date</label>
                        <input type="date" id="wiz-date" value="${d.date}" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white focus:outline-none focus:border-[#00F296]">
                    </div>
                    <div>
                        <label class="block font-black uppercase text-[10px] tracking-wider text-[#00F296] mb-1">⏰ Time</label>
                        <input type="time" id="wiz-time" value="${d.time}" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white focus:outline-none focus:border-[#00F296]">
                    </div>
                </div>

                <div>
                    <label class="block font-black uppercase text-[10px] tracking-wider text-[#00F296] mb-1">📍 Park & Location *</label>
                    <input type="text" id="wiz-location" value="${d.location}" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white focus:outline-none focus:border-[#00F296]" placeholder="Enter park name...">
                </div>

                <div class="grid grid-cols-3 gap-2">
                    <div>
                        <label class="block font-black uppercase text-[9px] tracking-wider text-[#00F296] mb-1">Teams</label>
                        <select id="wiz-teams" class="w-full bg-black/80 border border-white/20 rounded-xl px-2 py-2.5 font-bold text-white">
                            <option value="2" ${d.teamsCount == 2 ? 'selected' : ''}>2 Teams</option>
                            <option value="3" ${d.teamsCount == 3 ? 'selected' : ''}>3 Teams</option>
                            <option value="4" ${d.teamsCount == 4 ? 'selected' : ''}>4 Teams</option>
                        </select>
                    </div>
                    <div>
                        <label class="block font-black uppercase text-[9px] tracking-wider text-[#00F296] mb-1">Format</label>
                        <select id="wiz-format" class="w-full bg-black/80 border border-white/20 rounded-xl px-2 py-2.5 font-bold text-white">
                            <option value="5v5" ${d.format === '5v5' ? 'selected' : ''}>5v5</option>
                            <option value="7v7" ${d.format === '7v7' ? 'selected' : ''}>7v7</option>
                            <option value="8v8" ${d.format === '8v8' ? 'selected' : ''}>8v8</option>
                            <option value="11v11" ${d.format === '11v11' ? 'selected' : ''}>11v11</option>
                        </select>
                    </div>
                    <div>
                        <label class="block font-black uppercase text-[9px] tracking-wider text-[#00F296] mb-1">Fee</label>
                        <input type="text" id="wiz-fee" value="${d.fee}" class="w-full bg-black/80 border border-white/20 rounded-xl px-2 py-2.5 font-bold text-white text-center">
                    </div>
                </div>

                <button onclick="window.goToWizardPage2()" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3.5 rounded-xl text-xs uppercase tracking-wider shadow-md transition flex items-center justify-center gap-2 mt-4">
                    Next: Description & Rules <i class="fa-solid fa-arrow-right"></i>
                </button>
            </div>
        </div>
    `;
};

window.goToWizardPage2 = function() {
    const d = window._wizardData;
    d.title = document.getElementById('wiz-title')?.value.trim() || '';
    d.date = document.getElementById('wiz-date')?.value || '';
    d.time = document.getElementById('wiz-time')?.value || '';
    d.location = document.getElementById('wiz-location')?.value.trim() || '';
    d.teamsCount = parseInt(document.getElementById('wiz-teams')?.value, 10) || 3;
    d.format = document.getElementById('wiz-format')?.value || '7v7';
    d.fee = document.getElementById('wiz-fee')?.value.trim() || 'Free';

    renderWizardPage2();
};

window.renderWizardPage2 = function() {
    const modal = document.getElementById('two-page-game-wizard-modal');
    if (!modal) return;

    const d = window._wizardData;

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-[32px] p-6 space-y-4 max-w-md w-full text-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 class="text-sm font-black uppercase text-white">${d.mode === 'copy' ? '📋 Copy Game (2/2)' : '✏ Edit Game (2/2)'}</h3>
                <button onclick="document.getElementById('two-page-game-wizard-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="space-y-4 text-xs">
                <div>
                    <label class="block font-black uppercase text-[10px] tracking-wider text-[#00F296] mb-1">📝 Description</label>
                    <textarea id="wiz-desc" rows="3" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white focus:outline-none focus:border-[#00F296]" placeholder="Friendly match...">${d.description}</textarea>
                </div>

                <div>
                    <label class="block font-black uppercase text-[10px] tracking-wider text-[#00F296] mb-1">📜 Rules</label>
                    <textarea id="wiz-rules" rows="3" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white focus:outline-none focus:border-[#00F296]" placeholder="No sliding tackles...">${d.rules}</textarea>
                </div>

                <div>
                    <label class="block font-black uppercase text-[10px] tracking-wider text-[#00F296] mb-1">➕ Allow Plus Ones?</label>
                    <div class="grid grid-cols-2 gap-2">
                        <button type="button" onclick="window._wizardData.allowPlusOnes=false; renderWizardPage2()" class="p-3 rounded-2xl border text-center transition ${!d.allowPlusOnes ? 'bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black border-transparent shadow' : 'bg-black/60 text-white/70 border-white/10'}">
                            No
                        </button>
                        <button type="button" onclick="window._wizardData.allowPlusOnes=true; renderWizardPage2()" class="p-3 rounded-2xl border text-center transition ${d.allowPlusOnes ? 'bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black border-transparent shadow' : 'bg-black/60 text-white/70 border-white/10'}">
                            Yes
                        </button>
                    </div>
                </div>

                <div>
                    <label class="block font-black uppercase text-[10px] tracking-wider text-[#00F296] mb-1">Max Plus Ones Limit:</label>
                    <select id="wiz-plus-limit" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white">
                        <option value="1" ${d.plusOneLimit == 1 ? 'selected' : ''}>1</option>
                        <option value="2" ${d.plusOneLimit == 2 ? 'selected' : ''}>2</option>
                        <option value="3" ${d.plusOneLimit == 3 ? 'selected' : ''}>3</option>
                        <option value="4" ${d.plusOneLimit == 4 ? 'selected' : ''}>4</option>
                        <option value="5" ${d.plusOneLimit == 5 ? 'selected' : ''}>5</option>
                        <option value="6" ${d.plusOneLimit == 6 ? 'selected' : ''}>6</option>
                    </select>
                </div>

                <div class="flex gap-2 pt-3">
                    <button onclick="window.renderWizardPage1()" class="w-1/3 bg-black/60 text-white py-3.5 rounded-xl font-bold border border-white/20 flex items-center justify-center gap-1">
                        <i class="fa-solid fa-arrow-left"></i> Back
                    </button>
                    <button onclick="window.submitTwoPageGameWizard()" class="w-2/3 bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3.5 rounded-xl uppercase tracking-wider shadow">
                        ${d.mode === 'copy' ? '🚀 Publish Game' : '💾 Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    `;
};

window.submitTwoPageGameWizard = async function() {
    const d = window._wizardData;
    d.description = document.getElementById('wiz-desc')?.value.trim() || '';
    d.rules = document.getElementById('wiz-rules')?.value.trim() || '';
    d.plusOneLimit = parseInt(document.getElementById('wiz-plus-limit')?.value, 10) || 1;

    if (!d.date || !d.location) {
        window.showToast("Please fill in Date and Location.", "error");
        return;
    }

    if (d.mode === 'copy') {
        const originalEvent = (window.eventsList || []).find(ev => ev.id === d.eventId);
        const newEventPayload = {
            ...(originalEvent || {}),
            title: d.title || 'Soccer Pick-up',
            visibility: d.visibility,
            date: d.date,
            time: d.time,
            location: d.location,
            teamsCount: d.teamsCount,
            format: d.format,
            fee: d.fee,
            description: d.description,
            rules: d.rules,
            allowPlusOnes: d.allowPlusOnes,
            plusOneLimit: d.plusOneLimit,
            attendees: [],
            waitingList: [],
            matches: [],
            createdAt: new Date().toISOString()
        };
        delete newEventPayload.id;

        try {
            await addDoc(collection(db, 'artifacts', appId, 'eventsList'), newEventPayload);
            window.showToast("Game copied and published successfully!");
            document.getElementById('two-page-game-wizard-modal')?.remove();
        } catch (e) {
            window.showToast("Failed to copy game", "error");
        }
    } else {
        try {
            await setDoc(doc(db, 'artifacts', appId, 'eventsList', d.eventId), {
                title: d.title || 'Soccer Pick-up',
                visibility: d.visibility,
                date: d.date,
                time: d.time,
                location: d.location,
                teamsCount: d.teamsCount,
                format: d.format,
                fee: d.fee,
                description: d.description,
                rules: d.rules,
                allowPlusOnes: d.allowPlusOnes,
                plusOneLimit: d.plusOneLimit
            }, { merge: true });

            window.showToast("Game updated successfully!");
            document.getElementById('two-page-game-wizard-modal')?.remove();
        } catch (e) {
            window.showToast("Failed to update game", "error");
        }
    }
};

window.confirmCancelGame = async function(eventId) {
    if (confirm("Are you sure you want to cancel this match? All participants will be notified.")) {
        try {
            await deleteDoc(doc(db, 'artifacts', appId, 'eventsList', eventId));
            window.showToast("Game cancelled successfully.");
            window.switchTab('events');
        } catch (err) {
            window.showToast("Failed to cancel game", "error");
        }
    }
};

window.openEditMatchModal = function(eventId, matchIndex) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    const match = event.matches[matchIndex];
    if (!match) return;

    const teamA = match.teamA || "Team 1";
    const teamB = match.teamB || "Team 2";
    const t1Goals = Array.isArray(match.team1Goals) ? [...match.team1Goals] : [];
    const t2Goals = Array.isArray(match.team2Goals) ? [...match.team2Goals] : [];
    const isFinished = match.isFinished !== undefined ? match.isFinished : true;

    const getTeamPlayers = (teamName) => {
        let tIdx = -1;
        if (event.teamNames) {
            tIdx = Object.keys(event.teamNames).find(k => event.teamNames[k] === teamName);
        }
        if (tIdx !== undefined && tIdx !== -1 && event.teamAssignments && event.teamAssignments[tIdx]) {
            return event.teamAssignments[tIdx].filter(p => p && p.name);
        }
        return (event.attendees || []).map(a => ({ name: a.name || 'Player', avatar: a.avatar || a.photoURL }));
    };

    const t1Players = getTeamPlayers(teamA);
    const t2Players = getTeamPlayers(teamB);

    let modal = document.getElementById('edit-match-admin-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'edit-match-admin-modal';
        modal.className = 'fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md overflow-y-auto';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-md w-full p-6 text-white shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 class="text-sm font-black uppercase text-white">✏ Edit Match Result</h3>
                <button onclick="document.getElementById('edit-match-admin-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="flex items-center justify-between bg-black/50 p-3 rounded-2xl border border-white/10">
                <span class="text-xs font-bold text-white/80">Match Status for Stats:</span>
                <button type="button" onclick="window._editMatchIsFinished = !window._editMatchIsFinished; this.innerText = window._editMatchIsFinished ? 'Ended' : 'Pending'; this.className = window._editMatchIsFinished ? 'px-3 py-1 rounded-xl text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'px-3 py-1 rounded-xl text-xs font-black bg-amber-500/20 text-amber-300 border border-amber-500/40';" class="px-3 py-1 rounded-xl text-xs font-black ${isFinished ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}">${isFinished ? 'Ended' : 'Pending'}</button>
            </div>

            <div class="bg-black/40 border border-emerald-500/30 rounded-2xl p-4 space-y-3">
                <div class="flex justify-between items-center text-xs font-black text-[#00F296]">
                    <span>${teamA} Goals (${t1Goals.length})</span>
                    <select id="edit-match-add-scorer-A" class="bg-black text-white text-xs px-2.5 py-1 rounded-xl border border-white/20 font-bold">
                        <option value="">+ Add Goal Scorer</option>
                        ${t1Players.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
                    </select>
                </div>
                <div class="flex justify-end">
                    <button onclick="window.addGoalToEditMatch('${eventId}', 'A')" class="bg-[#00F296]/20 text-[#00F296] border border-[#00F296]/40 font-bold px-3 py-1 rounded-xl text-[10px]">Add Goal</button>
                </div>
                <div id="edit-match-scorers-list-A" class="space-y-1.5">
                    ${t1Goals.map((scorer, idx) => `
                        <div class="flex items-center justify-between text-xs bg-black/60 px-3 py-1.5 rounded-xl border border-white/10">
                            <span class="font-bold text-white">⚽ ${scorer}</span>
                            <button onclick="window.removeGoalFromEditMatch('${eventId}', 'A',${idx})" class="text-red-400 hover:text-red-300 font-bold text-xs"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="bg-black/40 border border-red-500/30 rounded-2xl p-4 space-y-3">
                <div class="flex justify-between items-center text-xs font-black text-red-400">
                    <span>${teamB} Goals (${t2Goals.length})</span>
                    <select id="edit-match-add-scorer-B" class="bg-black text-white text-xs px-2.5 py-1 rounded-xl border border-white/20 font-bold">
                        <option value="">+ Add Goal Scorer</option>
                        ${t2Players.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
                    </select>
                </div>
                <div class="flex justify-end">
                    <button onclick="window.addGoalToEditMatch('${eventId}', 'B')" class="bg-red-500/20 text-red-300 border border-red-500/40 font-bold px-3 py-1 rounded-xl text-[10px]">Add Goal</button>
                </div>
                <div id="edit-match-scorers-list-B" class="space-y-1.5">
                    ${t2Goals.map((scorer, idx) => `
                        <div class="flex items-center justify-between text-xs bg-black/60 px-3 py-1.5 rounded-xl border border-white/10">
                            <span class="font-bold text-white">⚽ ${scorer}</span>
                            <button onclick="window.removeGoalFromEditMatch('${eventId}', 'B',${idx})" class="text-red-400 hover:text-red-300 font-bold text-xs"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="flex gap-2 pt-2">
                <button onclick="document.getElementById('edit-match-admin-modal').remove()" class="flex-1 bg-black/60 hover:bg-black text-white py-3 rounded-xl text-xs font-bold border border-white/20">Cancel</button>
                <button onclick="window.saveEditedMatch('${eventId}', ${matchIndex})" class="flex-1 bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-xs uppercase tracking-wider shadow">Save Match</button>
            </div>
        </div>
    `;

    window._editMatchState = {
        team1Goals: t1Goals,
        team2Goals: t2Goals,
        isFinished: isFinished
    };
    window._editMatchCurrentPlayers = { A: t1Players, B: t2Players };
};

window._editMatchState = { team1Goals: [], team2Goals: [], isFinished: true };
window._editMatchCurrentPlayers = { A: [], B: [] };

window.addGoalToEditMatch = function(eventId, teamKey) {
    const selectEl = document.getElementById(`edit-match-add-scorer-${teamKey}`);
    if (!selectEl) return;
    const scorerName = selectEl.value;
    if (!scorerName) {
        window.showToast("Please select a player.", "error");
        return;
    }

    if (teamKey === 'A') {
        window._editMatchState.team1Goals.push(scorerName);
    } else {
        window._editMatchState.team2Goals.push(scorerName);
    }
    
    refreshEditMatchModalUI(eventId);
};

window.removeGoalFromEditMatch = function(eventId, teamKey, gIdx) {
    if (teamKey === 'A') {
        window._editMatchState.team1Goals.splice(gIdx, 1);
    } else {
        window._editMatchState.team2Goals.splice(gIdx, 1);
    }
    refreshEditMatchModalUI(eventId);
};

function refreshEditMatchModalUI(eventId) {
    const t1Goals = window._editMatchState.team1Goals;
    const t2Goals = window._editMatchState.team2Goals;

    const listA = document.getElementById('edit-match-scorers-list-A');
    const listB = document.getElementById('edit-match-scorers-list-B');

    if (listA) {
        listA.innerHTML = t1Goals.map((scorer, idx) => `
            <div class="flex items-center justify-between text-xs bg-black/60 px-3 py-1.5 rounded-xl border border-white/10">
                <span class="font-bold text-white">⚽ ${scorer}</span>
                <button onclick="window.removeGoalFromEditMatch('${eventId}', 'A', ${idx})" class="text-red-400 hover:text-red-300 font-bold text-xs"><i class="fa-solid fa-xmark"></i></button>
            </div>
        `).join('');
    }

    if (listB) {
        listB.innerHTML = t2Goals.map((scorer, idx) => `
            <div class="flex items-center justify-between text-xs bg-black/60 px-3 py-1.5 rounded-xl border border-white/10">
                <span class="font-bold text-white">⚽ ${scorer}</span>
                <button onclick="window.removeGoalFromEditMatch('${eventId}', 'B', ${idx})" class="text-red-400 hover:text-red-300 font-bold text-xs"><i class="fa-solid fa-xmark"></i></button>
            </div>
        `).join('');
    }
}

window.saveEditedMatch = async function(eventId, matchIndex) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !event.matches || !event.matches[matchIndex]) return;

    event.matches[matchIndex].team1Goals = window._editMatchState.team1Goals;
    event.matches[matchIndex].team2Goals = window._editMatchState.team2Goals;
    event.matches[matchIndex].isFinished = window._editMatchState.isFinished !== undefined ? window._editMatchState.isFinished : true;

    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), { matches: event.matches }, { merge: true });
        window.showToast("Match updated successfully!");
        const modal = document.getElementById('edit-match-admin-modal');
        if (modal) modal.remove();
    } catch (e) {
        window.showToast("Failed to update match", "error");
    }
};

window.toggleSessionEnded = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    const newStatus = !event.isSessionEnded;
    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), { isSessionEnded: newStatus }, { merge: true });
        window.showToast(newStatus ? "Session ended successfully." : "Session reopened.");
    } catch (e) {
        window.showToast("Failed to update session status", "error");
    }
};

window.deleteMatchRecord = async function(eventId, matchIndex) {
    if (!confirm("Are you sure you want to delete this match record?")) return;
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    let matches = Array.isArray(event.matches) ? [...event.matches] : [];
    if (matchIndex < matches.length) {
        matches.splice(matchIndex, 1);
        try {
            await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), { matches }, { merge: true });
            window.showToast("Match record deleted.");
        } catch (e) {
            window.showToast("Failed to delete match", "error");
        }
    }
};

window.removePlayerFromEvent = async function(eventId, uid) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    event.attendees = (event.attendees || []).filter(a => a.uid !== uid);
    event.waitingList = (event.waitingList || []).filter(w => w.uid !== uid);
    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), { attendees: event.attendees, waitingList: event.waitingList }, { merge: true });
        window.showToast("Player removed.");
    } catch (e) {
        window.showToast("Failed to remove player", "error");
    }
};

document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const eventId = btn.getAttribute('data-event-id');
    const uid = btn.getAttribute('data-uid');
    
    if (action === 'manage-player') {
        const name = btn.getAttribute('data-name');
        window.openPlayerManagementModal(eventId, uid, name);
    } else if (action === 'manage-guest') {
        const guestIdx = parseInt(btn.getAttribute('data-guest-idx'), 10);
        const guestName = btn.getAttribute('data-guest-name');
        window.openGuestManagementModal(eventId, uid, guestIdx, guestName);
    }
});

window.openGuestManagementModal = function(eventId, attendeeUid, guestIndex, guestName) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    const attendee = (event.attendees || []).find(a => a.uid === attendeeUid);
    if (!attendee || !attendee.guests || !attendee.guests[guestIndex]) return;
    const guest = attendee.guests[guestIndex];
    const isPaid = guest.paid === 'Paid';

    let modal = document.getElementById('guest-management-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'guest-management-modal';
        modal.className = 'fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm';
        document.body.appendChild(modal);
    }

    const nextPaidState = isPaid ? 'Unpaid' : 'Paid';
    const paidBtnClass = isPaid ? 'bg-[#00F296] text-slate-950 shadow-md' : 'bg-black/40 text-white border border-white/10';
    const paidIconClass = isPaid ? 'fa-circle-check text-sm' : 'fa-circle text-white/40';
    const paidText = isPaid ? 'Mark as Unpaid' : 'Mark as Paid';

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h4 class="text-xs font-black uppercase text-white truncate">Manage Guest: ${guestName}</h4>
                <button id="modal-guest-close-btn" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-4">
                <div>
                    <label class="block text-[10px] font-black uppercase tracking-wider text-white/50 mb-1.5">Payment Status</label>
                    <button id="modal-guest-pay-btn" class="w-full py-3 px-4 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 ${paidBtnClass}">
                        <i class="fa-solid ${paidIconClass}"></i>
                        ${paidText}
                    </button>
                </div>
                <div class="pt-2 border-t border-white/10">
                    <button id="modal-guest-remove-btn" class="w-full bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 py-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2">
                        <i class="fa-solid fa-user-minus"></i> Remove Guest
                    </button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modal-guest-close-btn').onclick = () => modal.remove();
    document.getElementById('modal-guest-pay-btn').onclick = () => {
        window.updateGuestPaidStatus(eventId, attendeeUid, guestIndex, nextPaidState);
        modal.remove();
    };
    document.getElementById('modal-guest-remove-btn').onclick = () => {
        window.removeGuestFromAttendee(eventId, attendeeUid, guestIndex);
        modal.remove();
    };
};

window.updateGuestPaidStatus = async function(eventId, attendeeUid, guestIndex, paidStatus) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    event.attendees = (event.attendees || []).map(att => {
        if (att.uid === attendeeUid && att.guests) {
            const updatedGuests = [...att.guests];
            updatedGuests[guestIndex] = { ...updatedGuests[guestIndex], paid: paidStatus };
            return { ...att, guests: updatedGuests };
        }
        return att;
    });
    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), { attendees: event.attendees }, { merge: true });
        window.showToast("Guest payment status updated!");
    } catch (err) {
        window.showToast("Failed to update guest payment", "error");
    }
};

window.removeGuestFromAttendee = async function(eventId, uid, guestIndex) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    event.attendees = (event.attendees || []).map(att => {
        if (att.uid === uid && att.guests) {
            const updatedGuests = [...att.guests];
            updatedGuests.splice(guestIndex, 1);
            return { ...att, guests: updatedGuests };
        }
        return att;
    });
    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), { attendees: event.attendees }, { merge: true });
        window.showToast("Guest removed successfully!");
    } catch (err) {
        window.showToast("Failed to remove guest", "error");
    }
};

window.openPlayerManagementModal = function(eventId, uid, playerName) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    const player = (event.attendees || []).find(a => a.uid === uid);
    if (!player) return;
    const isPaid = player.paid === 'Paid';

    let modal = document.getElementById('player-management-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'player-management-modal';
        modal.className = 'fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm';
        document.body.appendChild(modal);
    }

    const nextPaidState = isPaid ? 'Unpaid' : 'Paid';
    const paidBtnClass = isPaid ? 'bg-[#00F296] text-slate-950 shadow-md' : 'bg-black/40 text-white border border-white/10';
    const paidIconClass = isPaid ? 'fa-circle-check text-sm' : 'fa-circle text-white/40';
    const paidText = isPaid ? 'Mark as Unpaid' : 'Mark as Paid';

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h4 class="text-xs font-black uppercase text-white truncate">Manage: ${playerName}</h4>
                <button id="modal-player-close-btn" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-4">
                <div>
                    <label class="block text-[10px] font-black uppercase tracking-wider text-white/50 mb-1.5">Payment Status</label>
                    <button id="modal-player-pay-btn" class="w-full py-3 px-4 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 ${paidBtnClass}">
                        <i class="fa-solid ${paidIconClass}"></i>
                        ${paidText}
                    </button>
                </div>
                <div class="pt-2 border-t border-white/10">
                    <button id="modal-player-remove-btn" class="w-full bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 py-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2">
                        <i class="fa-solid fa-user-minus"></i> Remove from Roster
                    </button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('modal-player-close-btn').onclick = () => modal.remove();
    document.getElementById('modal-player-pay-btn').onclick = () => {
        window.updatePlayerPaidStatus(eventId, uid, nextPaidState);
        modal.remove();
    };
    document.getElementById('modal-player-remove-btn').onclick = () => {
        window.removePlayerFromEvent(eventId, uid);
        modal.remove();
    };
};

window.updatePlayerPaidStatus = async function(eventId, uid, paidStatus) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    event.attendees = (event.attendees || []).map(att => {
        if (att.uid === uid) {
            return { ...att, paid: paidStatus };
        }
        return att;
    });
    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), { attendees: event.attendees }, { merge: true });
        window.showToast("Player payment updated!");
    } catch (e) {
        window.showToast("Failed to update payment", "error");
    }
};