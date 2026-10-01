// js/game-profile/team-tool.js: Full Team Builder & Tactical Lineup Tool with team-restricted slots and randomize guest-pairing options
import { db, appId } from '../firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.activeTeamTab = window.activeTeamTab !== undefined ? window.activeTeamTab : 0;
window.teamAssignments = window.teamAssignments || {};
window.teamFormations = window.teamFormations || {};
window.teamNames = window.teamNames || {};
window.teamColors = window.teamColors || {};
window.teamCaptains = window.teamCaptains || {};

async function updateTeamToolFirestore(event) {
    const docRef = doc(db, 'artifacts', appId, 'eventsList', event.id);
    
    event.teamAssignments = window.teamAssignments[event.id] || event.teamAssignments || {};
    event.teamNames = window.teamNames[event.id] || event.teamNames || {};
    event.teamColors = window.teamColors[event.id] || event.teamColors || {};
    event.teamCaptains = window.teamCaptains[event.id] || event.teamCaptains || {};
    
    window.eventsList = (window.eventsList || []).map(ev => ev.id === event.id ? event : ev);
    
    const cleanPayload = JSON.parse(JSON.stringify(event));

    if (cleanPayload.attendees) {
        cleanPayload.attendees.forEach(att => {
            if (!att.avatar || att.avatar.startsWith('data:')) {
                att.avatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(att.name || 'Player')}`;
            }
            if (att.guests) {
                att.guests.forEach(g => {
                    if (!g.avatar || g.avatar.startsWith('data:')) {
                        g.avatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(g.name || 'Guest')}`;
                    }
                });
            }
        });
    }

    await setDoc(docRef, cleanPayload, { merge: true });
    window.dispatchEvent(new CustomEvent('eventsDataUpdated', { detail: { eventId: event.id } }));
}

function getFlattenedPlayersList(attendees) {
    const list = [];
    (attendees || []).forEach(att => {
        const safeAvatar = (att && (att.avatar || att.photoURL)) ? String(att.avatar || att.photoURL) : `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(att?.name || 'Player')}`;
        list.push({
            uid: String(att?.uid || 'usr_' + Math.random().toString(36).substring(2,7)),
            name: String(att?.name || att?.firstName || 'Player'),
            avatar: safeAvatar,
            position: String(att?.position || 'Player'),
            guests: att?.guests || []
        });
        
        if (att?.guests && Array.isArray(att.guests)) {
            att.guests.forEach((g, gIdx) => {
                const guestAvatar = (g && g.avatar) ? String(g.avatar) : safeAvatar;
                list.push({
                    uid: `${att?.uid || 'usr'}_guest_${gIdx}`,
                    name: String(g?.name || 'Guest'),
                    avatar: guestAvatar,
                    position: 'Guest',
                    isHostGuest: true,
                    hostUid: String(att?.uid || '')
                });
            });
        }
    });
    return list;
}

window.openTeamMakingModal = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) {
        if (typeof window.showToast === 'function') window.showToast("Event data not found.", "error");
        return;
    }

    let modal = document.getElementById('team-making-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'team-making-modal';
        modal.className = 'fixed inset-0 z-[150] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200';
        document.body.appendChild(modal);
    }

    window.currentTeamBuildingEvent = event;
    window.teamAssignments[event.id] = event.teamAssignments || {};
    window.teamNames[event.id] = event.teamNames || {};
    window.teamColors[event.id] = event.teamColors || {};
    window.teamCaptains[event.id] = event.teamCaptains || {};
    window.activeTeamTab = 0;

    try {
        renderTeamMakingContent();
    } catch (e) {
        console.error("Error rendering team maker:", e);
        if (typeof window.showToast === 'function') window.showToast("Failed to open Team Builder.", "error");
        modal.remove();
    }
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

window.changeTeamColor = async function(eventId, teamIndex, colorHex) {
    window.teamColors[eventId] = window.teamColors[eventId] || {};
    window.teamColors[eventId][teamIndex] = colorHex;
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (event) {
        await updateTeamToolFirestore(event);
        renderTeamMakingContent();
    }
};

window.setTeamCaptain = async function(eventId, teamIndex, captainUid) {
    window.teamCaptains[eventId] = window.teamCaptains[eventId] || {};
    window.teamCaptains[eventId][teamIndex] = captainUid;
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (event) {
        await updateTeamToolFirestore(event);
        if (typeof window.showToast === 'function') window.showToast("Captain updated!");
        renderTeamMakingContent();
    }
};

window.saveTeamNameModal = async function(eventId, teamIndex) {
    const inputEl = document.getElementById(`team-name-input-${teamIndex}`);
    if (!inputEl) return;
    const newName = inputEl.value.trim();
    if (!newName) return;

    window.teamNames[eventId] = window.teamNames[eventId] || {};
    window.teamNames[eventId][teamIndex] = newName;

    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (event) {
        event.teamNames = window.teamNames[eventId];
        try {
            await updateTeamToolFirestore(event);
            if (typeof window.showToast === 'function') {
                window.showToast(`Team name updated to "${newName}"!`);
            }
            renderTeamMakingContent();
        } catch (err) {
            console.error("Failed to save team name:", err);
        }
    }
};

// Prompt randomize options modal (fully random vs keep guests together)
window.promptRandomizeOptions = function(eventId) {
    let modal = document.getElementById('randomize-options-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'randomize-options-modal';
        modal.className = 'fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white text-center">
            <h3 class="text-sm font-black uppercase text-white">Randomize Teams</h3>
            <p class="text-[11px] text-white/60">How would you like to distribute the players?</p>
            <div class="space-y-2.5 pt-2">
                <button onclick="document.getElementById('randomize-options-modal').remove(); window.executeRandomizeTeams('${eventId}', false)" class="w-full bg-[#00F296] text-slate-950 font-black py-3 rounded-xl text-xs shadow transition">
                    Fully Randomized
                </button>
                <button onclick="document.getElementById('randomize-options-modal').remove(); window.executeRandomizeTeams('${eventId}', true)" class="w-full bg-black/60 text-white font-bold py-3 rounded-xl text-xs border border-white/20 transition">
                    Keep Players & Guests Together
                </button>
                <button onclick="document.getElementById('randomize-options-modal').remove()" class="w-full bg-transparent text-white/40 hover:text-white py-2 text-xs">
                    Cancel
                </button>
            </div>
        </div>
    `;
};

window.executeRandomizeTeams = async function(eventId, keepGuestsTogether) {
    const event = window.currentTeamBuildingEvent;
    if (!event) return;
    
    const teamsCount = event.teamsCount || 3;
    window.teamAssignments[eventId] = {};
    for (let i = 0; i < teamsCount; i++) {
        window.teamAssignments[eventId][i] = [];
    }

    if (keepGuestsTogether) {
        const attendees = event.attendees || [];
        const shuffledAttendees = [...attendees].sort(() => Math.random() - 0.5);
        shuffledAttendees.forEach((att, idx) => {
            const targetTeam = idx % teamsCount;
            const mainPlayer = {
                uid: String(att.uid || 'usr_' + Math.random()),
                name: String(att.name || 'Player'),
                avatar: att.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(att.name || 'Player')}`,
                position: att.position || 'Player'
            };
            window.teamAssignments[eventId][targetTeam].push(mainPlayer);

            if (att.guests && Array.isArray(att.guests)) {
                att.guests.forEach((g, gIdx) => {
                    window.teamAssignments[eventId][targetTeam].push({
                        uid: `${att.uid || 'usr'}_guest_${gIdx}`,
                        name: String(g.name || 'Guest'),
                        avatar: g.avatar || mainPlayer.avatar,
                        position: 'Guest',
                        isHostGuest: true
                    });
                });
            }
        });
    } else {
        const allPlayers = getFlattenedPlayersList(event.attendees);
        for (let i = allPlayers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allPlayers[i], allPlayers[j]] = [allPlayers[j], allPlayers[i]];
        }

        allPlayers.forEach((player, idx) => {
            const targetTeam = idx % teamsCount;
            window.teamAssignments[eventId][targetTeam].push(player);
        });
    }

    event.teamAssignments = window.teamAssignments[eventId];
    
    try {
        await updateTeamToolFirestore(event);
        if (typeof window.showToast === 'function') {
            window.showToast("Teams randomized successfully!");
        }
        renderTeamMakingContent();
    } catch (err) {
        console.error("Failed to randomize teams:", err);
    }
};

window.renderTeamMakingContent = function() {
    const modal = document.getElementById('team-making-modal');
    if (!modal || !window.currentTeamBuildingEvent) return;
    
    const currentEvtId = window.currentTeamBuildingEvent.id;
    const latestEvent = (window.eventsList || []).find(ev => ev.id === currentEvtId);
    if (latestEvent) {
        window.currentTeamBuildingEvent = latestEvent;
    }
    const event = window.currentTeamBuildingEvent;

    const attendees = event.attendees || [];
    const allPlayers = getFlattenedPlayersList(attendees);
    const teamsCount = event.teamsCount || 3;
    const format = event.format || '7v7';

    const defaultColors = ['#3b82f6', '#ef4444', '#eab308', '#22c55e', '#a855f7'];

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

    const availableFormations = formationOptions[format] || { '3-3-1': [3, 3, 1] };
    const defaultFormatKey = Object.keys(availableFormations)[0];

    window.teamFormations[event.id] = window.teamFormations[event.id] || {};
    window.teamColors[event.id] = window.teamColors[event.id] || {};
    window.teamCaptains[event.id] = window.teamCaptains[event.id] || {};
    const activeTab = window.activeTeamTab;

    window.teamAssignments[event.id] = event.teamAssignments || {};
    for (let i = 0; i < teamsCount; i++) {
        window.teamAssignments[event.id][i] = window.teamAssignments[event.id][i] || [];
    }

    window.teamNames[event.id] = window.teamNames[event.id] || {};

    const currentAssignedUIDs = new Set();
    Object.values(window.teamAssignments[event.id]).forEach(teamArr => {
        if (Array.isArray(teamArr)) {
            teamArr.forEach(p => { if (p && p.uid) currentAssignedUIDs.add(String(p.uid)); });
        }
    });

    const freeAgents = allPlayers.filter(a => !currentAssignedUIDs.has(String(a.uid)));

    let tabsHtml = `
        <button onclick="switchTeamTab(0)" class="px-3.5 py-2 rounded-xl text-xs font-black transition ${activeTab === 0 ? 'bg-[#00F296] text-slate-950 shadow' : 'bg-black/50 text-white/70 border border-white/10'}">
            📋 Summary
        </button>
    `;
    for (let i = 0; i < teamsCount; i++) {
        const tIdx = i + 1;
        const isActive = activeTab === tIdx;
        const tName = window.teamNames[event.id][i] || `Team ${i + 1}`;
        const tColor = window.teamColors[event.id][i] || defaultColors[i % defaultColors.length];
        tabsHtml += `
            <button onclick="switchTeamTab(${tIdx})" style="border-color: ${tColor} !important;" class="px-3.5 py-2 rounded-xl text-xs font-black transition border ${isActive ? 'bg-[#00F296] text-slate-950 shadow' : 'bg-black/50 text-white/80'}">
                <span class="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style="background-color: ${tColor};"></span> ${tName}
            </button>
        `;
    }

    let contentHtml = '';

    if (activeTab === 0) {
        let teamsSummaryHtml = '';
        for (let i = 0; i < teamsCount; i++) {
            const tName = window.teamNames[event.id][i] || `Team ${i + 1}`;
            const tColor = window.teamColors[event.id][i] || defaultColors[i % defaultColors.length];
            const teamRoster = window.teamAssignments[event.id][i] || [];
            const captainUid = window.teamCaptains[event.id][i];

            const rosterPillsHtml = teamRoster.length === 0 
                ? '<span class="text-xs text-white/40 italic">No players assigned yet. Click Add Player or Randomize.</span>'
                : teamRoster.map(p => {
                    const isCap = String(p?.uid) === String(captainUid);
                    const pAvatar = p?.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
                    const pName = p?.name || 'Player';
                    const pUid = p?.uid || '';
                    return `
                        <div class="flex items-center gap-2 bg-black/70 px-3 py-1.5 rounded-full border text-xs shadow-sm" style="border-color: ${tColor};">
                            <img src="${pAvatar}" class="w-6 h-6 rounded-full object-cover border border-white/20">
                            <span class="font-bold text-white">${pName} ${isCap ? '👑' : ''}</span>
                            <button onclick="unassignPlayerFromTeamSlot('${event.id}', ${i}, '${pUid}')" class="text-white/40 hover:text-red-400 ml-1"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    `;
                }).join('');

            teamsSummaryHtml += `
                <div class="bg-black/40 border-2 rounded-2xl p-4 space-y-3 shadow-lg" style="border-color: ${tColor}66;">
                    <div class="flex items-center justify-between border-b border-white/10 pb-2">
                        <div class="flex items-center gap-2">
                            <span class="w-3 h-3 rounded-full" style="background-color: ${tColor};"></span>
                            <h4 class="text-xs font-black uppercase tracking-wider" style="color: ${tColor};">${tName} (${teamRoster.length})</h4>
                        </div>
                        <button onclick="openAssignPicker('${event.id}', ${i}, null)" class="text-[10px] font-bold text-white/80 hover:text-white bg-black/60 px-3 py-1.5 rounded-lg border border-white/15 flex items-center gap-1 shadow">
                            <i class="fa-solid fa-plus text-[9px] text-[#00F296]"></i> Add Player
                        </button>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        ${rosterPillsHtml}
                    </div>
                </div>
            `;
        }

        const freeAgentsPillsHtml = freeAgents.length === 0 
            ? '<span class="text-xs text-white/40 italic">All players assigned!</span>'
            : freeAgents.map(a => {
                const aAvatar = a?.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
                const aName = a?.name || 'Player';
                return `
                    <div class="flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-xl border border-white/10 text-xs">
                        <img src="${aAvatar}" class="w-5 h-5 rounded-full object-cover">
                        <span class="font-bold text-white">${aName}</span>
                    </div>
                `;
            }).join('');

        contentHtml = `
            <div class="space-y-4">
                <div class="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-3">
                    <h4 class="text-xs font-black text-amber-400 uppercase tracking-wider">⏳ Free Agents (${freeAgents.length})</h4>
                    <div class="flex flex-wrap gap-2">
                        ${freeAgentsPillsHtml}
                    </div>
                </div>
                ${teamsSummaryHtml}
            </div>
        `;
    } else {
        const teamIdx = activeTab - 1;
        const currentTeamName = window.teamNames[event.id][teamIdx] || `Team ${teamIdx + 1}`;
        const currentTeamColor = window.teamColors[event.id][teamIdx] || defaultColors[teamIdx % defaultColors.length];
        const currentTeamPlayers = window.teamAssignments[event.id][teamIdx] || [];
        const currentCaptainUid = window.teamCaptains[event.id][teamIdx] || "";
        
        window.teamFormations[event.id][teamIdx] = window.teamFormations[event.id][teamIdx] || defaultFormatKey;
        const currentFormationKey = window.teamFormations[event.id][teamIdx];
        const rowCounts = availableFormations[currentFormationKey] || [3, 3, 1];

        let playerIndex = 0;
        let rowsHtml = '';

        rowCounts.slice().reverse().forEach((count) => {
            let rowSlots = '';
            for (let c = 0; c < count; c++) {
                const slotIdx = playerIndex++;
                const p = currentTeamPlayers[slotIdx];
                if (p && p.name) {
                    rowSlots += `
                        <div onclick="unassignPlayerFromSlot('${event.id}', ${teamIdx}, ${slotIdx})" class="w-24 h-16 bg-white/95 border-2 border-emerald-400 rounded-2xl p-1 text-center cursor-pointer shadow-lg flex flex-col items-center justify-center relative group">
                            <img src="${p.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'}" class="w-6 h-6 rounded-full object-cover mb-0.5 border border-slate-900">
                            <span class="text-[9px] font-black text-slate-950 truncate w-full px-1">${p.name}</span>
                            <span class="absolute inset-0 bg-red-500/90 text-white text-[10px] font-bold rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition">Remove</span>
                        </div>
                    `;
                } else {
                    rowSlots += `
                        <div onclick="openAssignPicker('${event.id}', ${teamIdx}, ${slotIdx})" class="w-24 h-16 border-2 border-dashed border-white/70 bg-emerald-950/40 rounded-2xl p-1 text-center cursor-pointer hover:bg-emerald-900/60 transition flex flex-col items-center justify-center text-white shadow">
                            <i class="fa-solid fa-shirt text-white/90 text-sm mb-0.5"></i>
                            <span class="text-[9px] font-bold uppercase tracking-wider">Spot</span>
                        </div>
                    `;
                }
            }
            rowsHtml += `<div class="flex justify-center gap-3 mb-3">${rowSlots}</div>`;
        });

        const goalieSlotIdx = playerIndex++;
        const goaliePlayer = currentTeamPlayers[goalieSlotIdx];
        rowsHtml += `
            <div class="flex justify-center mt-2">
                <div onclick="openAssignPicker('${event.id}', ${teamIdx}, ${goalieSlotIdx})" class="w-28 h-16 ${goaliePlayer && goaliePlayer.name ? 'bg-white/95 border-2 border-emerald-400' : 'border-2 border-dashed border-amber-400/80 bg-emerald-950/40'} rounded-2xl p-1 text-center cursor-pointer shadow-lg flex flex-col items-center justify-center relative group">
                    ${goaliePlayer && goaliePlayer.name ? `
                        <img src="${goaliePlayer.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'}" class="w-6 h-6 rounded-full object-cover mb-0.5 border border-slate-900">
                        <span class="text-[9px] font-black text-slate-950 truncate w-full px-1">${goaliePlayer.name}</span>
                        <span class="absolute inset-0 bg-red-500/90 text-white text-[10px] font-bold rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition">Remove</span>
                    ` : `
                        <i class="fa-solid fa-hand text-amber-300 text-sm mb-0.5"></i>
                        <span class="text-[10px] text-amber-300 font-black uppercase">GK Spot</span>
                    `}
                </div>
            </div>
        `;

        const captainOptionsHtml = currentTeamPlayers.filter(p => p && p.name).map(p => `<option value="${p.uid}" ${p.uid === currentCaptainUid ? 'selected' : ''}>👑 ${p.name}</option>`).join('');
        const formationsOptionsHtml = Object.keys(availableFormations).map(f => `<option value="${f}" ${f === currentFormationKey ? 'selected' : ''}>Formation: ${f}</option>`).join('');

        const squadMembersListHtml = currentTeamPlayers.length === 0 
            ? '<span class="text-xs text-white/40 italic">No players assigned to this team yet.</span>'
            : currentTeamPlayers.map(p => {
                const isCap = String(p?.uid) === String(currentCaptainUid);
                const pAvatar = p?.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
                const pName = p?.name || 'Player';
                const pPos = p?.position || 'Player';
                const pUid = p?.uid || '';
                return `
                    <div class="flex items-center justify-between p-2.5 bg-black/60 rounded-xl border border-white/10 text-xs">
                        <div class="flex items-center gap-2.5">
                            <img src="${pAvatar}" class="w-7 h-7 rounded-full object-cover border border-white/20">
                            <div>
                                <div class="font-bold text-white">${pName} ${isCap ? '👑 (Captain)' : ''}</div>
                                <div class="text-[10px] text-white/50">${pPos}</div>
                            </div>
                        </div>
                        <button onclick="unassignPlayerFromTeamSlot('${event.id}', ${teamIdx}, '${pUid}')" class="text-red-400 hover:text-red-300 font-bold px-2.5 py-1 rounded-lg text-xs bg-red-500/10 border border-red-500/30">Remove</button>
                    </div>
                `;
            }).join('');

        contentHtml = `
            <div class="space-y-4">
                <!-- Team Configuration Panel -->
                <div class="bg-black/50 border border-white/10 p-4 rounded-2xl space-y-3">
                    <h4 class="text-xs font-black text-white/70 uppercase tracking-wider">Team Configuration</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div class="space-y-1">
                            <label class="block text-[10px] font-bold text-white/60 uppercase">Team Name</label>
                            <input type="text" id="team-name-input-${teamIdx}" value="${currentTeamName}" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-[#00F296]">
                        </div>
                        <div class="space-y-1">
                            <label class="block text-[10px] font-bold text-white/60 uppercase">Team Color</label>
                            <div class="flex items-center gap-2 pt-1">
                                ${defaultColors.map(col => `
                                    <button onclick="changeTeamColor('${event.id}', ${teamIdx}, '${col}')" class="w-6 h-6 rounded-full border-2 transition ${currentTeamColor === col ? 'border-white scale-110 shadow' : 'border-transparent'}" style="background-color: ${col};"></button>
                                `).join('')}
                            </div>
                        </div>
                        <div class="space-y-1">
                            <label class="block text-[10px] font-bold text-white/60 uppercase">Captain</label>
                            <select onchange="setTeamCaptain('${event.id}', ${teamIdx}, this.value)" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2 text-xs font-bold text-white">
                                <option value="">Select Captain</option>
                                ${captainOptionsHtml}
                            </select>
                        </div>
                    </div>
                    <button onclick="saveTeamNameModal('${event.id}', ${teamIdx})" class="w-full bg-[#00F296] text-slate-950 font-black py-2.5 rounded-xl text-xs shadow transition mt-1">Save Team Name</button>
                </div>

                <!-- Tactical Lineup Soccer Pitch -->
                <div class="relative bg-gradient-to-b from-emerald-800 to-emerald-950 border-2 rounded-3xl p-5 shadow-inner overflow-hidden min-h-[400px] flex flex-col justify-between" style="border-color: ${currentTeamColor};">
                    <div class="absolute inset-x-0 top-1/2 h-0.5 bg-white/30 pointer-events-none"></div>
                    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 border-2 border-white/30 rounded-full pointer-events-none"></div>

                    <div class="flex justify-between items-center relative z-10">
                        <span class="text-white font-black text-xs px-3.5 py-1.5 rounded-full uppercase tracking-wider shadow" style="background-color: ${currentTeamColor};">${currentTeamName}</span>
                        <select onchange="changeTeamFormation('${event.id}', ${teamIdx}, this.value)" class="bg-black/90 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl border border-white/20">
                            ${formationsOptionsHtml}
                        </select>
                    </div>

                    <div class="relative z-10 my-4 flex flex-col items-center justify-center">
                        ${rowsHtml}
                    </div>

                    <div class="text-center relative z-10 text-[10px] text-white/70 font-semibold">
                        Tap any slot on the pitch to assign or remove players
                    </div>
                </div>

                <!-- Squad Members List under Team -->
                <div class="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-3">
                    <div class="flex justify-between items-center">
                        <h4 class="text-xs font-black text-white/80 uppercase tracking-wider">Squad Members (${currentTeamPlayers.length})</h4>
                        <button onclick="openAssignPicker('${event.id}', ${teamIdx}, null)" class="text-[10px] font-bold text-[#00F296] hover:underline bg-black/60 px-2.5 py-1 rounded-lg border border-white/10">
                            + Add Player to Team
                        </button>
                    </div>
                    <div class="space-y-2 max-h-48 overflow-y-auto pr-1">
                        ${squadMembersListHtml}
                    </div>
                </div>
            </div>
        `;
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-2xl w-full p-6 text-white shadow-2xl space-y-5 relative max-h-[90vh] overflow-y-auto">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <div>
                    <h3 class="text-base font-black uppercase text-white">⚽ Team Builder & Lineups</h3>
                    <p class="text-[10px] text-white/50">Format: ${format} • Build your squad</p>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="promptRandomizeOptions('${event.id}')" class="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black px-3 py-1.5 rounded-xl text-xs shadow flex items-center gap-1">
                        <i class="fa-solid fa-shuffle text-[10px]"></i> Randomize
                    </button>
                    <button onclick="document.getElementById('team-making-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>

            <!-- Tabs Navigation Bar -->
            <div class="flex items-center gap-2 overflow-x-auto pb-1">
                ${tabsHtml}
            </div>

            <!-- Active Tab Content -->
            ${contentHtml}

            <div class="text-center pt-2">
                <button onclick="document.getElementById('team-making-modal').remove()" class="w-full bg-black/60 hover:bg-black text-white font-bold py-3 rounded-xl text-xs border border-white/20 transition">Close</button>
            </div>
        </div>
    `;
};

window.openAssignPicker = function(eventId, teamIndex, slotIndex) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    const allPlayers = getFlattenedPlayersList(event.attendees);
    window.teamAssignments[eventId] = event.teamAssignments || {};
    
    const currentAssignedUIDs = new Set();
    Object.values(window.teamAssignments[eventId]).forEach(teamArr => {
        if (Array.isArray(teamArr)) {
            teamArr.forEach(p => { if (p && p.uid) currentAssignedUIDs.add(String(p.uid)); });
        }
    });

    // Restrict to players not yet assigned anywhere, OR already in this specific team
    const teamPlayersSet = new Set((window.teamAssignments[eventId][teamIndex] || []).map(p => p?.uid));
    const eligiblePlayers = allPlayers.filter(a => !currentAssignedUIDs.has(String(a.uid)) || teamPlayersSet.has(String(a.uid)));

    if (eligiblePlayers.length === 0) {
        if (typeof window.showToast === 'function') window.showToast("No available players found.", "error");
        return;
    }

    let picker = document.getElementById('assign-picker-modal');
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'assign-picker-modal';
        picker.className = 'fixed inset-0 z-[160] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm';
        document.body.appendChild(picker);
    }

    const eligibleListHtml = eligiblePlayers.map(a => {
        const aAvatar = a?.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
        const aName = a?.name || 'Player';
        const aUid = a?.uid || '';
        return `
            <div onclick="document.getElementById('assign-picker-modal')?.remove(); assignPlayerToSlot('${eventId}', ${teamIndex}, ${slotIndex !== null ? slotIndex : 'null'}, '${aUid}')" class="flex items-center gap-3 p-2.5 bg-black/40 hover:bg-black border border-white/10 rounded-xl cursor-pointer transition">
                <img src="${aAvatar}" class="w-7 h-7 rounded-full object-cover">
                <span class="text-xs font-bold text-white">${aName}</span>
            </div>
        `;
    }).join('');

    picker.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h4 class="text-xs font-black uppercase text-white">Select Player for Team</h4>
                <button onclick="document.getElementById('assign-picker-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                ${eligibleListHtml}
            </div>
            <button onclick="document.getElementById('assign-picker-modal').remove()" class="w-full bg-black/60 text-white py-2.5 rounded-xl text-xs font-bold border border-white/20">Cancel</button>
        </div>
    `;
};

window.assignPlayerToSlot = async function(eventId, teamIndex, slotIndex, uid) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    const allPlayers = getFlattenedPlayersList(event.attendees);
    const player = allPlayers.find(a => String(a.uid) === String(uid));
    if (!player) return;

    window.teamAssignments[eventId] = event.teamAssignments || {};
    window.teamAssignments[eventId][teamIndex] = window.teamAssignments[eventId][teamIndex] || [];

    if (slotIndex !== null && slotIndex !== 'null') {
        window.teamAssignments[eventId][teamIndex][slotIndex] = player;
    } else {
        // If added from summary/squad button without a specific pitch slot, push to roster array
        if (!window.teamAssignments[eventId][teamIndex].some(p => p && String(p.uid) === String(uid))) {
            window.teamAssignments[eventId][teamIndex].push(player);
        }
    }

    event.teamAssignments = window.teamAssignments[eventId];
    try {
        await updateTeamToolFirestore(event);
        renderTeamMakingContent();
    } catch (err) {
        console.error("Failed to assign player:", err);
    }
};

window.unassignPlayerFromSlot = async function(eventId, teamIndex, slotIndex) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    if (!window.teamAssignments[eventId] || !window.teamAssignments[eventId][teamIndex]) return;

    window.teamAssignments[eventId][teamIndex][slotIndex] = null;
    event.teamAssignments = window.teamAssignments[eventId];
    try {
        await updateTeamToolFirestore(event);
        renderTeamMakingContent();
    } catch (err) {
        console.error("Failed to unassign player:", err);
    }
};

window.unassignPlayerFromTeamSlot = async function(eventId, teamIndex, uid) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    if (!window.teamAssignments[eventId] || !window.teamAssignments[eventId][teamIndex]) return;

    window.teamAssignments[eventId][teamIndex] = window.teamAssignments[eventId][teamIndex].filter(p => p && String(p.uid) !== String(uid));
    event.teamAssignments = window.teamAssignments[eventId];
    try {
        await updateTeamToolFirestore(event);
        renderTeamMakingContent();
    } catch (err) {
        console.error("Failed to remove player from team:", err);
    }
};