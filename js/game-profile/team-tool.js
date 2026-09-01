// js/game-profile/team-tool.js
import { db, appId } from '../firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

async function updateEventInFirestore(event) {
    try {
        const docRef = doc(db, 'artifacts', appId, 'global', 'events');
        const list = (window.eventsList || []).map(ev => ev.id === event.id ? event : ev);
        await setDoc(docRef, { list });
    } catch (err) {
        console.error("Error updating event:", err);
    }
}

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
    window.teamAssignments[event.id] = event.teamAssignments || {};
    window.teamNames[event.id] = event.teamNames || {};

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

window.saveTeamName = async function(eventId, teamIndex) {
    const inputEl = document.getElementById(`team-name-input-${teamIndex}`);
    if (!inputEl) return;
    const newName = inputEl.value.trim();
    if (!newName) return;

    window.teamNames[eventId] = window.teamNames[eventId] || {};
    window.teamNames[eventId][teamIndex] = newName;

    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (event) {
        event.teamNames = window.teamNames[eventId];
        await updateEventInFirestore(event);
        window.showToast(`Team name updated to "${newName}"!`);
        renderTeamMakingContent();
    }
};

window.randomizeTeams = async function(eventId) {
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

    event.teamAssignments = window.teamAssignments[eventId];
    await updateEventInFirestore(event);

    window.showToast("Teams randomized and saved!");
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

    window.teamAssignments[event.id] = event.teamAssignments || {};
    for (let i = 0; i < teamsCount; i++) {
        window.teamAssignments[event.id][i] = window.teamAssignments[event.id][i] || [];
    }

    window.teamNames[event.id] = event.teamNames || {};
    const currentTeamName = window.teamNames[event.id][window.activeTeamTab] || `Team ${window.activeTeamTab + 1}`;
    const teamCaptain = attendees.find(a => a.isCaptain && a.captainTeamIndex === window.activeTeamTab);

    const currentAssignedUIDs = new Set();
    Object.values(window.teamAssignments[event.id]).forEach(teamArr => {
        teamArr.forEach(p => { if (p && p.uid) currentAssignedUIDs.add(p.uid); });
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
            if (p && p.name) {
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

    const goalieSlotIdx = playerIndex++;
    const goaliePlayer = currentTeamPlayers[goalieSlotIdx];
    rowsHtml += `
        <div class="flex justify-center mt-2">
            <div onclick="${hasTeamPower ? `openAssignPicker('${event.id}', ${window.activeTeamTab}, ${goalieSlotIdx})` : `promptNoPower()`}" class="w-16 h-16 ${goaliePlayer && goaliePlayer.name ? 'bg-white border-2 border-emerald-400' : 'border-2 border-dashed border-white/60 bg-emerald-950/25'} rounded-2xl p-1 text-center cursor-pointer shadow flex flex-col items-center justify-center relative group">
                ${goaliePlayer && goaliePlayer.name ? `
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

    const assignedCount = currentTeamPlayers.filter(p => p && p.name).length;

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
                    <input type="text" id="team-name-input-${window.activeTeamTab}" value="${currentTeamName}" ${hasTeamPower ? '' : 'disabled'} class="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-brand">
                    ${hasTeamPower ? `<button onclick="saveTeamName('${event.id}', ${window.activeTeamTab})" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-4 py-1.5 rounded-xl text-xs shadow transition">Save</button>` : ''}
                </div>

                <div class="relative bg-gradient-to-b from-emerald-700 to-emerald-800 border-4 border-emerald-600 rounded-3xl p-6 shadow-inner overflow-hidden min-h-[380px] flex flex-col justify-between">
                    <div class="absolute inset-x-0 top-1/2 h-0.5 bg-white/30 pointer-events-none"></div>
                    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 border-2 border-white/30 rounded-full pointer-events-none"></div>

                    <div class="text-center relative z-10 flex flex-col sm:flex-row items-center justify-between px-2 gap-2">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="bg-slate-950/85 text-white font-black text-xs px-4 py-1.5 rounded-full uppercase tracking-wider shadow">${currentTeamName} (${assignedCount} Assigned)</span>
                            
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
                                ${hasTeamPower ? `<button onclick="assignPlayerToNextEmptySpot('${event.id}', ${window.activeTeamTab}, '${a.uid}')" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-3 py-1 rounded-lg text-[10px] shadow">Assign</button>` : ''}
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
    window.teamAssignments[eventId] = event.teamAssignments || {};
    const currentAssignedUIDs = new Set();
    Object.values(window.teamAssignments[eventId]).forEach(teamArr => {
        teamArr.forEach(p => { if (p && p.uid) currentAssignedUIDs.add(p.uid); });
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
        picker.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm';
        document.body.appendChild(picker);
    }

    picker.innerHTML = `
        <div class="bg-white rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-slate-900 border border-slate-200">
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <h4 class="text-sm font-black uppercase text-slate-900">Select Free Agent</h4>
                <button onclick="document.getElementById('assign-picker-modal').remove()" class="text-slate-400 hover:text-slate-700 text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-2 max-h-60 overflow-y-auto">
                ${freeAgents.map(a => `
                    <div onclick="assignSpecificPlayerToSlot('${eventId}', ${teamIndex}, ${slotIndex}, '${a.uid}')" class="flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-2xl cursor-pointer transition shadow-xs">
                        <img src="${a.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-8 h-8 rounded-full object-cover">
                        <span class="text-xs font-black text-slate-900">${a.name}</span>
                    </div>
                `).join('')}
            </div>
            <button onclick="document.getElementById('assign-picker-modal').remove()" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl text-xs font-bold transition">Cancel</button>
        </div>
    `;
};

window.assignSpecificPlayerToSlot = async function(eventId, teamIndex, slotIndex, uid) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    const player = (event.attendees || []).find(a => a.uid === uid);
    if (!player) return;

    window.teamAssignments[eventId] = event.teamAssignments || {};
    window.teamAssignments[eventId][teamIndex] = window.teamAssignments[eventId][teamIndex] || [];
    window.teamAssignments[eventId][teamIndex][slotIndex] = player;

    event.teamAssignments = window.teamAssignments[eventId];
    await updateEventInFirestore(event);

    const picker = document.getElementById('assign-picker-modal');
    if (picker) picker.remove();
    renderTeamMakingContent();
};

window.assignPlayerToNextEmptySpot = async function(eventId, teamIndex, uid) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    const player = (event.attendees || []).find(a => a.uid === uid);
    if (!player) return;

    window.teamAssignments[eventId] = event.teamAssignments || {};
    window.teamAssignments[eventId][teamIndex] = window.teamAssignments[eventId][teamIndex] || [];
    
    const teamArr = window.teamAssignments[eventId][teamIndex];
    
    // Find the first completely empty index (undefined, null, or missing name)
    let emptyIdx = -1;
    for (let i = 0; i < teamArr.length; i++) {
        if (!teamArr[i] || !teamArr[i].name) {
            emptyIdx = i;
            break;
        }
    }

    if (emptyIdx === -1) {
        emptyIdx = teamArr.length;
    }
    
    teamArr[emptyIdx] = player;

    event.teamAssignments = window.teamAssignments[eventId];
    await updateEventInFirestore(event);

    renderTeamMakingContent();
};

window.unassignPlayerFromSlot = async function(eventId, teamIndex, slotIndex) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;
    if (!window.teamAssignments[eventId] || !window.teamAssignments[eventId][teamIndex]) return;

    window.teamAssignments[eventId][teamIndex][slotIndex] = null;
    event.teamAssignments = window.teamAssignments[eventId];
    await updateEventInFirestore(event);

    renderTeamMakingContent();
};

window.promptNoPower = function() {
    window.showToast("Only Admins and Team Captains can manage lineups.", "error");
};