// js/game-profile/modal-core.js
import { db, appId } from '../firebase-config.js';
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { renderAdminTab } from './admin-tab.js';
import { renderInfoTab } from './info-tab.js';
import { renderRosterTab } from './roster-tab.js';
import { renderStatsTab } from './stats-tab.js';
import { renderCommentsTab } from './comments-tab.js';
import './team-tool.js';

window.openEventDetails = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    window.activeModalEventId = eventId;
    
    // PRE-SYNC: Immediately load saved team names and assignments into global window caches so tabs like Stats & Leaderboards instantly see them
    window.teamNames = window.teamNames || {};
    window.teamNames[event.id] = event.teamNames || {};
    
    window.teamAssignments = window.teamAssignments || {};
    window.teamAssignments[event.id] = event.teamAssignments || {};

    const isCreator = window.currentUser && event.organizerId === window.currentUser.uid;
    window.activeModalTab = isCreator ? 'admin' : 'info';
    window.adminManagePlayersExpanded = false;
    window.adminMatchResultsExpanded = false;
    window.activeStatsSubTab = 'matches';
    window.expandedLeaderboardTeams = window.expandedLeaderboardTeams || {};
    window.expandedMatchCards = window.expandedMatchCards || {};

    // 🚀 Switch to the full screen view AND immediately render its content
    if (typeof window.switchTab === 'function') {
        window.switchTab('event-details-screen');
    }
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
    const container = document.getElementById('tab-event-details-screen') || document.getElementById('event-detail-modal');
    if (!container) return;
    
    const event = (window.eventsList || []).find(ev => ev.id === window.activeModalEventId);
    if (!event) return;

    const isCreator = window.currentUser && event.organizerId === window.currentUser.uid;
    const tab = window.activeModalTab;
    const commentsCount = event.comments?.length || 0;

    // 🛡️ Calculate max capacity & check current user RSVP state (including guests)
    const formatMatch = (event.format || "").match(/(\d+)/);
    const playersPerTeam = formatMatch ? parseInt(formatMatch[1], 10) : 7;
    const maxCapacity = playersPerTeam * (event.teamsCount || 3);
    
    // Count total confirmed heads (attendees + guests)
    let totalConfirmed = 0;
    (event.attendees || []).forEach(a => {
        totalConfirmed += 1 + (a.guests ? a.guests.length : 0);
    });

    const isFull = totalConfirmed >= maxCapacity;
    const rosterDisplayLabel = isFull ? "Roster (Full)" : `Roster (${totalConfirmed})`;

    const userUid = window.currentUser?.uid;
    const isConfirmed = (event.attendees || []).some(a => a.uid === userUid);
    const isWaiting = (event.waitingList || []).some(w => w.uid === userUid);

    let rsvpBtnHtml = '';
    if (isConfirmed) {
        rsvpBtnHtml = `<button onclick="handleRSVPAction('${event.id}', 'cancel')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-black px-4 py-2 rounded-xl text-xs shadow transition">Leave Game</button>`;
    } else if (isWaiting) {
        rsvpBtnHtml = `<button onclick="handleRSVPAction('${event.id}', 'cancel')" class="bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 font-black px-4 py-2 rounded-xl text-xs shadow transition">Leave Waitlist</button>`;
    } else if (isFull) {
        rsvpBtnHtml = `<button onclick="openJoinGameModal('${event.id}')" class="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow transition">Join Waitlist</button>`;
    } else {
        rsvpBtnHtml = `<button onclick="openJoinGameModal('${event.id}')" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow transition">Join Game</button>`;
    }

    container.innerHTML = `
        <div class="max-w-4xl mx-auto space-y-6 pb-12 text-slate-900">
            <!-- Sticky Top Navigation / Back Bar -->
            <div class="sticky top-20 z-30 bg-white/95 backdrop-blur-md border border-slate-200 rounded-3xl p-6 shadow-md flex items-center justify-between">
                <div class="flex items-center gap-4">
                    <button onclick="closeEventModal()" class="w-10 h-10 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full flex items-center justify-center font-bold transition">
                        <i class="fa-solid fa-arrow-left"></i>
                    </button>
                    <div>
                        <div class="flex items-center gap-2 mb-1">
                            <h2 class="text-xl sm:text-2xl font-black tracking-tight text-slate-900">${event.title}</h2>
                            <span class="px-2.5 py-0.5 bg-brand/10 text-brand font-black text-[10px] rounded-full uppercase tracking-wider border border-brand/30">${event.visibility || 'Public'}</span>
                        </div>
                        <p class="text-xs text-slate-500 flex items-center gap-1.5"><i class="fa-solid fa-location-dot text-brand"></i> ${event.location}</p>
                    </div>
                </div>

                <div class="flex items-center gap-2">
                    <!-- Dynamic RSVP Action Button -->
                    ${rsvpBtnHtml}

                    <!-- Yellow Share Button -->
                    <div class="relative">
                        <button onclick="toggleShareDropdown()" class="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black px-3.5 py-2 rounded-xl text-xs flex items-center gap-2 shadow transition">
                            <i class="fa-solid fa-share-nodes"></i> Share
                        </button>
                        <div id="share-dropdown" class="hidden absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-50 w-48 py-2 divide-y divide-slate-100 text-xs">
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

                    ${isCreator ? `<button onclick="copyEvent('${event.id}')" class="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-3 py-2 rounded-xl text-xs hidden sm:flex items-center gap-1.5"><i class="fa-solid fa-copy"></i> Copy</button>` : ''}
                </div>
            </div>

            <!-- Navigation Tabs Bar -->
            <div class="bg-white border border-slate-200 p-2 rounded-2xl flex items-center space-x-1 overflow-x-auto shadow-sm">
                ${isCreator ? `<button onclick="switchModalTab('admin')" class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition ${tab === 'admin' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}"><i class="fa-solid fa-gear mr-1"></i> Admin</button>` : ''}
                <button onclick="switchModalTab('info')" class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition ${tab === 'info' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">Game Info</button>
                <button onclick="switchModalTab('roster')" class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition ${tab === 'roster' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">${rosterDisplayLabel}</button>
                <button onclick="switchModalTab('stats')" class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition ${tab === 'stats' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">Game Stats</button>
                <button onclick="switchModalTab('comments')" class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition ${tab === 'comments' ? 'bg-brand text-slate-950 shadow' : 'text-slate-600 hover:text-slate-900'}">Comments (${commentsCount})</button>
            </div>

            <!-- Tab Content Routing Container -->
            <div class="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                ${tab === 'admin' && isCreator ? renderAdminTab(event) : ''}
                ${tab === 'info' ? renderInfoTab(event) : ''}
                ${tab === 'roster' ? renderRosterTab(event) : ''}
                ${tab === 'stats' ? renderStatsTab(event) : ''}
                ${tab === 'comments' ? renderCommentsTab(event) : ''}
            </div>
        </div>
    `;
};

// 🎮 Open Join Game Guest Selection Modal Flow
window.openJoinGameModal = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    const allowPlusOnes = event.allowPlusOnes || false;
    const maxGuests = event.plusOneLimit || 3;

    if (!allowPlusOnes) {
        window.confirmJoinGameWithGuests(eventId, []);
        return;
    }

    let modal = document.getElementById('join-guests-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'join-guests-modal';
        modal.className = 'fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm';
        document.body.appendChild(modal);
    }

    window._currentGuestCount = 0;
    window._maxGuestLimit = maxGuests;
    window._activeJoiningEventId = eventId;

    modal.innerHTML = `
        <div class="bg-white rounded-3xl max-w-sm w-full p-6 space-y-5 shadow-2xl text-slate-900 text-center animate-in fade-in zoom-in duration-200">
            <div class="flex justify-between items-center border-b border-slate-100 pb-3">
                <h3 class="text-xs font-black uppercase text-slate-900">Joining: ${event.title}</h3>
                <button onclick="document.getElementById('join-guests-modal').remove()" class="text-slate-400 hover:text-slate-700 text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="space-y-3 py-2">
                <h4 class="text-sm font-black text-slate-800">Bringing guests?</h4>
                <p class="text-[11px] text-slate-500">You can bring up to ${maxGuests} guest(s).</p>
                
                <div class="flex items-center justify-center gap-6 pt-2">
                    <button type="button" onclick="window.updateJoinGuestCount(-1)" class="w-10 h-10 bg-slate-100 hover:bg-slate-200 text-slate-800 font-black rounded-xl text-base transition flex items-center justify-center shadow-sm">
                        <i class="fa-solid fa-minus"></i>
                    </button>
                    <span id="join-guest-count-display" class="text-3xl font-black text-slate-900 w-12 text-center">0</span>
                    <button type="button" onclick="window.updateJoinGuestCount(1)" class="w-10 h-10 bg-slate-100 hover:bg-slate-200 text-slate-800 font-black rounded-xl text-base transition flex items-center justify-center shadow-sm">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </div>
            </div>

            <button type="button" onclick="window.proceedToGuestNamesStep()" class="w-full bg-brand hover:bg-brand-dark text-slate-950 font-black py-3 rounded-xl text-xs shadow transition uppercase tracking-wider">
                Confirm & Continue
            </button>
        </div>
    `;
};

window.updateJoinGuestCount = function(change) {
    let current = window._currentGuestCount || 0;
    const max = window._maxGuestLimit || 3;
    
    current += change;
    if (current < 0) current = 0;
    if (current > max) current = max;

    window._currentGuestCount = current;
    const display = document.getElementById('join-guest-count-display');
    if (display) display.innerText = current;
};

window.proceedToGuestNamesStep = function() {
    const count = window._currentGuestCount || 0;
    const eventId = window._activeJoiningEventId;
    const modal = document.getElementById('join-guests-modal');

    if (count === 0) {
        if (modal) modal.remove();
        window.confirmJoinGameWithGuests(eventId, []);
        return;
    }

    if (!modal) return;
    modal.innerHTML = `
        <div class="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-slate-900 text-left animate-in fade-in zoom-in duration-200">
            <div class="flex justify-between items-center border-b border-slate-100 pb-3">
                <h3 class="text-xs font-black uppercase text-slate-900">Enter Guest Names (${count})</h3>
                <button onclick="document.getElementById('join-guests-modal').remove()" class="text-slate-400 hover:text-slate-700 text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div id="guest-names-inputs-container" class="space-y-3 max-h-52 overflow-y-auto pr-1">
                ${Array.from({ length: count }, (_, i) => `
                    <div>
                        <label class="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Guest #${i + 1} Name</label>
                        <input type="text" id="guest-name-input-${i}" placeholder="Enter full name..." required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 text-xs focus:outline-none focus:border-brand font-medium">
                    </div>
                `).join('')}
            </div>

            <button type="button" onclick="window.submitJoinGameWithGuestNames('${eventId}', ${count})" class="w-full bg-brand hover:bg-brand-dark text-slate-950 font-black py-3 rounded-xl text-xs shadow transition uppercase tracking-wider text-center">
                Confirm & Join Game
            </button>
        </div>
    `;
};

window.submitJoinGameWithGuestNames = function(eventId, count) {
    const guestsArray = [];
    for (let i = 0; i < count; i++) {
        const input = document.getElementById(`guest-name-input-${i}`);
        const nameVal = input ? input.value.trim() : '';
        if (!nameVal) {
            window.showToast(`Please enter a name for Guest #${i + 1}`, "error");
            if (input) input.focus();
            return;
        }
        guestsArray.push({ name: nameVal, paid: 'Unpaid' });
    }

    const modal = document.getElementById('join-guests-modal');
    if (modal) modal.remove();

    window.confirmJoinGameWithGuests(eventId, guestsArray);
};

window.confirmJoinGameWithGuests = async function(eventId, guestsArray) {
    if (!window.currentUser || !window.userProfile) {
        window.showToast("You must be logged in to join a game", "error");
        return;
    }

    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    event.attendees = event.attendees || [];
    event.waitingList = event.waitingList || [];

    const formatMatch = (event.format || "").match(/(\d+)/);
    const playersPerTeam = formatMatch ? parseInt(formatMatch[1], 10) : 7;
    const maxCapacity = playersPerTeam * (event.teamsCount || 3);

    event.attendees = event.attendees.filter(a => String(a.uid) !== String(window.currentUser.uid));
    event.waitingList = event.waitingList.filter(w => String(w.uid) !== String(window.currentUser.uid));

    let currentConfirmedHeads = 0;
    event.attendees.forEach(a => {
        currentConfirmedHeads += 1 + (a.guests ? a.guests.length : 0);
    });

    const profile = window.userProfile;
    const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
    const avatarUrl = profile.avatar || window.currentUser.photoURL || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';

    const newAttendee = {
        uid: String(window.currentUser.uid),
        name: String(fullName || 'Player'),
        avatar: String(avatarUrl),
        position: String(profile.position || 'Player'),
        role: 'Player',
        status: 'confirmed',
        paid: 'Unpaid',
        guests: []
    };

    const totalIncomingHeads = 1 + guestsArray.length;
    const availableSpots = maxCapacity - currentConfirmedHeads;

    if (availableSpots >= totalIncomingHeads) {
        newAttendee.guests = guestsArray;
        event.attendees.push(newAttendee);
        window.showToast(guestsArray.length > 0 ? "Successfully joined with your guest(s)!" : "Successfully joined game!");
    } else if (availableSpots > 0) {
        let remainingSpots = availableSpots - 1; 
        const acceptedGuests = [];
        const waitlistedGuests = [];

        guestsArray.forEach(g => {
            if (remainingSpots > 0) {
                acceptedGuests.push(g);
                remainingSpots--;
            } else {
                waitlistedGuests.push(g);
            }
        });

        newAttendee.guests = acceptedGuests;
        event.attendees.push(newAttendee);

        const waitAttendee = {
            ...newAttendee,
            status: 'waiting',
            guests: waitlistedGuests
        };
        event.waitingList.push(waitAttendee);
        window.showToast(`Roster capacity reached! Accepted player + ${acceptedGuests.length} guest(s); remaining guest(s) placed on waitlist.`, "info");
    } else {
        newAttendee.status = 'waiting';
        newAttendee.guests = guestsArray;
        event.waitingList.push(newAttendee);
        window.showToast("Roster is full. You and your guest(s) were added to the waitlist!", "info");
    }

    await updateEventInFirestore(event);
    window.renderEventDetailModalContent();
};

window.cancelGameEvent = async function(eventId) {
    if (!confirm("Are you sure you want to cancel and delete this game?")) return;
    try {
        const eventDocRef = doc(db, 'artifacts', appId, 'eventsList', eventId);
        await deleteDoc(eventDocRef);
        window.showToast("Game cancelled and deleted.");
        closeEventModal();
    } catch (err) {
        console.error("Error cancelling game:", err);
        window.showToast("Failed to cancel game", "error");
    }
};

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

    if (typeof window.switchTab === 'function') {
        window.switchTab('create-event');
    }

    setTimeout(() => {
        const titleEl = document.getElementById('ce-title');
        const visibilityEl = document.getElementById('ce-visibility');
        const dateEl = document.getElementById('ce-date');
        const timeEl = document.getElementById('ce-time');
        const parkSearchEl = document.getElementById('ce-park-search');
        const parkNameEl = document.getElementById('ce-parkname');
        const cityEl = document.getElementById('ce-city');
        const stateEl = document.getElementById('ce-state');
        const descEl = document.getElementById('ce-description');
        const rulesEl = document.getElementById('ce-rules');
        const teamsCountEl = document.getElementById('ce-teams-count');
        const formatEl = document.getElementById('ce-format');
        const feeEl = document.getElementById('ce-fee');

        if (titleEl) titleEl.value = event.title || '';
        if (visibilityEl) visibilityEl.value = event.visibility || 'Public';
        if (dateEl) dateEl.value = event.date || '';
        
        if (event.time) {
            let tVal = event.time;
            if (tVal.includes('AM') || tVal.includes('PM')) {
                const parts = tVal.split(' ');
                const timeParts = parts[0].split(':');
                let h = parseInt(timeParts[0], 10);
                const m = timeParts[1];
                if (parts[1] === 'PM' && h < 12) h += 12;
                if (parts[1] === 'AM' && h === 12) h = 0;
                tVal = `${String(h).padStart(2, '0')}:${m}`;
            }
            if (timeEl) timeEl.value = tVal;
        }

        const locParts = (event.location || "").match(/^(.*?)\s*\((.*?),\s*(.*?)\)$/);
        if (locParts) {
            if (parkSearchEl) parkSearchEl.value = locParts[1];
            if (parkNameEl) parkNameEl.value = locParts[1];
            if (cityEl) cityEl.value = locParts[2];
            if (stateEl) stateEl.value = locParts[3];
        } else {
            if (parkNameEl) parkNameEl.value = event.location || '';
            if (parkSearchEl) parkSearchEl.value = event.location || '';
        }

        if (descEl) descEl.value = event.description || '';
        if (rulesEl) rulesEl.value = event.rules || '';
        if (teamsCountEl) teamsCountEl.value = event.teamsCount || 3;
        if (formatEl) formatEl.value = event.format || '7v7';
        if (feeEl) feeEl.value = event.fee !== undefined ? event.fee : 'Free';

        const formEl = document.querySelector('#tab-create-event form') || document.querySelector('#create-event-form');
        if (formEl) {
            let hiddenId = document.getElementById('ce-edit-event-id');
            if (!hiddenId) {
                hiddenId = document.createElement('input');
                hiddenId.type = 'hidden';
                hiddenId.id = 'ce-edit-event-id';
                formEl.appendChild(hiddenId);
            }
            hiddenId.value = event.id;
        }

        window.editingEventSnapshot = event;
    }, 150);
};

async function updateEventInFirestore(event) {
    try {
        const eventDocRef = doc(db, 'artifacts', appId, 'eventsList', event.id);
        await setDoc(eventDocRef, event, { merge: true });
    } catch (err) {
        console.error("Error updating event document:", err);
    }
}

window.closeEventModal = function() {
    window.activeModalEventId = null;
    if (typeof window.switchTab === 'function') {
        window.switchTab('events');
    }
};

window.handleRSVPAction = async function(eventId, action) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !window.currentUser) return;

    event.attendees = event.attendees || [];
    event.waitingList = event.waitingList || [];
    event.declinedList = event.declinedList || [];

    if (action === 'cancel') {
        event.attendees = event.attendees.filter(a => String(a.uid) !== String(window.currentUser.uid));
        event.waitingList = event.waitingList.filter(w => String(w.uid) !== String(window.currentUser.uid));

        if (!event.declinedList.some(d => String(d.uid) === String(window.currentUser.uid))) {
            const profile = window.userProfile || {};
            const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'Player';
            event.declinedList.push({ uid: String(window.currentUser.uid), name: fullName });
        }
        window.showToast("You have left the game.");
        await updateEventInFirestore(event);
        window.renderEventDetailModalContent();
    }
};

window.removePlayerFromEvent = async function(eventId, uid) {
    if (!confirm("Are you sure you want to remove this player from the roster?")) return;
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    event.attendees = (event.attendees || []).filter(a => String(a.uid) !== String(uid));
    event.waitingList = (event.waitingList || []).filter(w => String(w.uid) !== String(uid));
    await updateEventInFirestore(event);
    window.showToast("Player removed from roster.");
};