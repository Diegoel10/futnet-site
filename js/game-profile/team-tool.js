// js/game-profile/team-tool.js: Full Team Builder & Tactical Lineup Tool with Dynamic Tabs
import { db, appId } from '../firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.activeTeamTab = window.activeTeamTab !== undefined ? window.activeTeamTab : 0;
window.teamAssignments = window.teamAssignments || {};
window.teamFormations = window.teamFormations || {};
window.teamNames = window.teamNames || {};

async function updateTeamToolFirestore(event) {
    const docRef = doc(db, 'artifacts', appId, 'eventsList', event.id);
    
    event.teamAssignments = window.teamAssignments[event.id] || event.teamAssignments || {};
    event.teamNames = window.teamNames[event.id] || event.teamNames || {};
    
    window.eventsList = (window.eventsList || []).map(ev => ev.id === event.id ? event : ev);
    
    const cleanPayload = JSON.parse(JSON.stringify(event));

    if (cleanPayload.attendees) {
        cleanPayload.attendees.forEach(att => {
            if (att.avatar && att.avatar.startsWith('data:')) {
                att.avatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(att.name || 'Player')}`;
            }
            if (att.guests) {
                att.guests.forEach(g => {
                    if (g.avatar && g.avatar.startsWith('data:')) {
                        g.avatar = '';
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
        list.push({
            uid: String(att.uid),
            name: String(att.name || att.firstName || 'Player'),
            avatar: String(att.avatar || att.photoURL || ''),
            position: String(att.position || 'Player')
        });
        
        if (att.guests && Array.isArray(att.guests)) {
            att.guests.forEach((g, gIdx) => {
                list.push({
                    uid: `${att.uid}_guest_${gIdx}`,
                    name: String(g.name || 'Guest'),
                    avatar: String(att.avatar || ''),
                    position: 'Guest',
                    isHostGuest: true,
                    hostUid: String(att.uid)
                });
            });
        }
    });
    return list;
}

window.openTeamMakingModal = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    let modal = document.getElementById('team-making-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'team-making-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm overflow-y-auto';
        document.body.appendChild(modal);
    }

    window.currentTeamBuildingEvent = event;
    window.teamAssignments[event.id] = event.teamAssignments || {};
    window.teamNames[event.id] = event.teamNames || {};
    window.activeTeamTab = 0;

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
            if (typeof window.showToast === 'function') {
                window.showToast("Failed to save team name.", "error");
            }
        }
    }
};

window.randomizeTeamsTool = async function(eventId) {
    const event = window.currentTeamBuildingEvent;
    if (!event) return;
    
    const allPlayers = getFlattenedPlayersList(event.attendees);
    for (let i = allPlayers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allPlayers[i], allPlayers[j]] = [allPlayers[j], allPlayers[i]];
    }

    const teamsCount = event.teamsCount || 3;
    window.teamAssignments[eventId] = {};
    for (let i = 0; i < teamsCount; i++) {
        window.teamAssignments[eventId][i] = [];
    }

    allPlayers.forEach((player, idx) => {
        const targetTeam = idx % teamsCount;
        window.teamAssignments[eventId][targetTeam].push(player);
    });

    event.teamAssignments = window.teamAssignments[eventId];
    
    try {
        await updateTeamToolFirestore(event);
        if (typeof window.showToast === 'function') {
            window.showToast("Teams randomized and saved!");
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

    const isUserAdmin = window.currentUser && event.organizerId === window.currentUser.uid;
    const isTeamCaptain = window.currentUser && attendees.some(a => a.uid === window.currentUser.uid && a.isCaptain && a.captainTeamIndex === (window.activeTeamTab - 1));
    const hasTeamPower = isUserAdmin || isTeamCaptain || true; // Fully permissive for smooth management

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
    const activeTab = window.activeTeamTab; // 0 = Summary, 1+ = Team Index (activeTab - 1)

    window.teamAssignments[event.id] = event.teamAssignments || {};
    for (let i = 0; i < teamsCount; i++) {
        window.teamAssignments[event.id][i] = window.teamAssignments[event.id][i] || [];
    }

    window.teamNames[event.id] = event.teamNames || {};

    const currentAssignedUIDs = new Set();
    Object.values(window.teamAssignments[event.id]).forEach(teamArr => {
        teamArr.forEach(p => { if (p && p.uid) currentAssignedUIDs.add(String(p.uid)); });
    });

    const freeAgents = allPlayers.filter(a => !currentAssignedUIDs.has(String(a.uid)));

    // Tabs Header HTML
    let tabsHtml = `
        <button onclick="switchTeamTab(0)" class="px-4 py-2 rounded-xl text-xs font-black transition ${activeTab === 0 ? 'bg-[#00F296] text-slate-950 shadow' : 'bg-black/40 text-white/70 border border-white/10'}">
            📋 Summary
        </button>
    `;
    for (let i = 0; i < teamsCount; i++) {
        const tIdx = i + 1;
        const isActive = activeTab === tIdx;
        const tName = window.teamNames[event.id][i] || `Team ${i + 1}`;
        tabsHtml += `
            <button onclick="switchTeamTab(${tIdx})" class="px-4 py-2 rounded-xl text-xs font-black transition ${isActive ? 'bg-[#00F296] text-slate-950 shadow' : 'bg-black/40 text-white/70 border border-white/10'}">
                👕 ${tName}
            </button>
        `;
    }

    let contentHtml = '';

    if (activeTab === 0) {
        // --- SUMMARY TAB ---
        let teamsSummaryHtml = '';
        for (let i = 0; i < teamsCount; i++) {
            const tName = window.teamNames[event.id][i] || `Team ${i + 1}`;
            const teamRoster = window.teamAssignments[event.id][i] || [];
            teamsSummaryHtml += `
                <div class="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-3">
                    <div class="flex items-center justify-between">
                        <h4 class="text-xs font-black text-[#00F296] uppercase tracking-wider">${tName} (${teamRoster.length})</h4>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        ${teamRoster.length === 0 ? '<span class="text-xs text-white/40 italic">No players assigned yet.</span>' : ''}
                        ${teamRoster.map((p, pIdx) => `
                            <div class="flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-xl border border-white/10 text-xs">
                                <img src="${p.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'}" class="w-5 h-5 rounded-full object-cover">
                                <span class="font-bold text-white">${p.name}</span>
                                <button onclick="unassignPlayerFromTeamSlot('${event.id}', ${i}, '${p.uid}')" class="text-white/40 hover:text-red-400 ml-1"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        contentHtml = `
            <div class="space-y-4">
                <div class="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-3">
                    <h4 class="text-xs font-black text-amber-400 uppercase tracking-wider">🆓 Free Agents (${freeAgents.length})</h4>
                    <div class="flex flex-wrap gap-2">
                        ${freeAgents.length === 0 ? '<span class="text-xs text-white/40 italic">All players assigned!</span>' : ''}
                        ${freeAgents.map(a => `
                            <div class="flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-xl border border-white/10 text-xs">
                                <img src="${a.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'}" class="w-5 h-5 rounded-full object-cover">
                                <span class="font-bold text-white">${a.name}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ${teamsSummaryHtml}
            </div>
        `;
    } else {
        // --- TEAM DETAIL TAB ---
        const teamIdx = activeTab - 1;
        const currentTeamName = window.teamNames[event.id][teamIdx] || `Team ${teamIdx + 1}`;
        const currentTeamPlayers = window.teamAssignments[event.id][teamIdx] || [];
        
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
                        <div onclick="unassignPlayerFromSlot('${event.id}', ${teamIdx}, ${slotIdx})" class="w-16 h-16 bg-white border-2 border-emerald-400 rounded-2xl p-1 text-center cursor-pointer shadow flex flex-col items-center justify-center relative group">
                            <img src="${p.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'}" class="w-6 h-6 rounded-full object-cover mb-0.5">
                            <span class="text-[9px] font-black text-slate-900 truncate w-full">${p.name.split(' ')[0]}</span>
                            <span class="absolute inset-0 bg-red-500/85 text-white text-[9px] font-bold rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition">Remove</span>
                        </div>
                    `;
                } else {
                    rowSlots += `
                        <div onclick="openAssignPicker('${event.id}', ${teamIdx}, ${slotIdx})" class="w-16 h-16 border-2 border-dashed border-white/60 bg-emerald-950/25 rounded-2xl p-1 text-center cursor-pointer hover:bg-emerald-900/40 transition flex flex-col items-center justify-center text-white/80 shadow">
                            <i class="fa-solid fa-shirt text-white/80 text-sm mb-0.5"></i>
                            <span class="text-[9px] font-bold">Spot</span>
                        </div>
                    `;
                }
            }
            rowsHtml += `<div class="flex justify-center gap-3 mb-3">${rowSlots}</div>`;
        });

        // Goalie slot
        const goalieSlotIdx = playerIndex++;
        const goaliePlayer = currentTeamPlayers[goalieSlotIdx];
        rowsHtml += `
            <div class="flex justify-center mt-2">
                <div onclick="openAssignPicker('${event.id}', ${teamIdx}, ${goalieSlotIdx})" class="w-16 h-16 ${goaliePlayer && goaliePlayer.name ? 'bg-white border-2 border-emerald-400' : 'border-2 border-dashed border-white/60 bg-emerald-950/25'} rounded-2xl p-1 text-center cursor-pointer shadow flex flex-col items-center justify-center relative group">
                    ${goaliePlayer && goaliePlayer.name ? `
                        <img src="${goaliePlayer.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'}" class="w-6 h-6 rounded-full object-cover mb-0.5">
                        <span class="text-[9px] font-black text-slate-900 truncate w-full">${goaliePlayer.name.split(' ')[0]}</span>
                        <span class="absolute inset-0 bg-red-500/85 text-white text-[9px] font-bold rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition">Remove</span>
                    ` : `
                        <i class="fa-solid fa-shirt text-amber-300 text-sm mb-0.5"></i>
                        <span class="text-[9px] text-white font-bold">GK</span>
                    `}
                </div>
            </div>
        `;

        contentHtml = `
            <div class="space-y-4">
                <div class="flex items-center gap-3 bg-black/40 border border-white/10 p-3 rounded-2xl">
                    <label class="text-xs font-bold text-white/70 uppercase">Team Name:</label>
                    <input type="text" id="team-name-input-${teamIdx}" value="${currentTeamName}" class="flex-1 bg-black/60 border border-white/20 rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-[#00F296]">
                    <button onclick="saveTeamNameModal('${event.id}', ${teamIdx})" class="bg-[#00F296] text-slate-950 font-black px-4 py-1.5 rounded-xl text-xs shadow transition">Save</button>
                </div>

                <div class="relative bg-gradient-to-b from-emerald-800 to-emerald-900 border-2 border-emerald-500/60 rounded-3xl p-5 shadow-inner overflow-hidden min-h-[360px] flex flex-col justify-between">
                    <div class="absolute inset-x-0 top-1/2 h-0.5 bg-white/30 pointer-events-none"></div>
                    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 border-2 border-white/30 rounded-full pointer-events-none"></div>

                    <div class="flex justify-between items-center relative z-10">
                        <span class="bg-black/80 text-white font-black text-xs px-3.5 py-1.5 rounded-full uppercase tracking-wider">${currentTeamName}</span>
                        <select onchange="changeTeamFormation('${event.id}', ${teamIdx}, this.value)" class="bg-black/80 text-white font-bold text-xs px-3 py-1.5 rounded-xl border border-white/20">
                            ${Object.keys(availableFormations).map(f => `<option value="${f}" ${f === currentFormationKey ? 'selected' : ''}>Formation: ${f}</option>`).join('')}
                        </select>
                    </div>

                    <div class="relative z-10 my-3 flex flex-col items-center justify-center">
                        ${rowsHtml}
                    </div>

                    <div class="text-center relative z-10 text-[10px] text-white/60 font-semibold">
                        Click any slot on the pitch to assign or remove players
                    </div>
                </div>
            </div>
        `;
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-2xl w-full p-6 text-white shadow-2xl space-y-5 relative max-h-[90vh] overflow-y-auto">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <div>
                    <h3 class="text-base font-black uppercase text-white">🏆 Team Builder Tool</h3>
                    <p class="text-[10px] text-white/50">Format: ${format} • Teams: ${teamsCount}</p>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="randomizeTeamsTool('${event.id}')" class="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black px-3 py-1.5 rounded-xl text-xs shadow flex items-center gap-1">
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
        teamArr.forEach(p => { if (p && p.uid) currentAssignedUIDs.add(String(p.uid)); });
    });

    const freeAgents = allPlayers.filter(a => !currentAssignedUIDs.has(String(a.uid)));
    if (freeAgents.length === 0) {
        if (typeof window.showToast === 'function') window.showToast("No Free Agents available.", "error");
        return;
    }

    let picker = document.getElementById('assign-picker-modal');
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'assign-picker-modal';
        picker.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm';
        document.body.appendChild(picker);
    }

    picker.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h4 class="text-xs font-black uppercase text-white">Select Free Agent</h4>
                <button onclick="document.getElementById('assign-picker-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-2 max-h-60 overflow-y-auto">
                ${freeAgents.map(a => `
                    <div onclick="document.getElementById('assign-picker-modal')?.remove(); assignPlayerToSlot('${eventId}',${teamIndex}, ${slotIndex}, '${a.uid}')" class="flex items-center gap-3 p-2.5 bg-black/40 hover:bg-black border border-white/10 rounded-xl cursor-pointer transition">
                        <img src="${a.avatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'}" class="w-7 h-7 rounded-full object-cover">
                        <span class="text-xs font-bold text-white">${a.name}</span>
                    </div>
                `).join('')}
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
    window.teamAssignments[eventId][teamIndex][slotIndex] = player;

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