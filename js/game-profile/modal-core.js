// js/game-profile/modal-core.js
import { db, appId } from '../firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { renderAdminTab } from './admin-tab.js';
import { renderInfoTab } from './info-tab.js';
import { renderRosterTab } from './roster-tab.js';
import { renderStatsTab } from './stats-tab.js';
import { renderCommentsTab } from './comments-tab.js';
import './team-tool.js';

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
    const commentsCount = event.comments?.length || 0;

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

            <!-- Tab Content Routing -->
            ${tab === 'admin' && isCreator ? renderAdminTab(event) : ''}
            ${tab === 'info' ? renderInfoTab(event) : ''}
            ${tab === 'roster' ? renderRosterTab(event) : ''}
            ${tab === 'stats' ? renderStatsTab(event) : ''}
            ${tab === 'comments' ? renderCommentsTab(event) : ''}
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
    event.typingUsers = (event.typingUsers || []).filter(u => u.uid !== window.currentUser?.uid);

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
        }
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