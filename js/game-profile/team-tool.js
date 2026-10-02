// js/game-profile/team-tool.js: Full Team Builder & Lineup Tool rendered as a dedicated overlay modal view with robust avatar resolution
import { db, appId } from '../firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.activeTeamTab = window.activeTeamTab !== undefined ? window.activeTeamTab : 0;
window.teamAssignments = window.teamAssignments || {};
window.teamFormations = window.teamFormations || {};
window.teamNames = window.teamNames || {};
window.teamColors = window.teamColors || {};
window.teamCaptains = window.teamCaptains || {};

window.TEAM_COLOR_OPTIONS = [
    { name: 'Blue',   hex: '#3b82f6' },
    { name: 'Red',    hex: '#ef4444' },
    { name: 'Yellow', hex: '#eab308' },
    { name: 'Green',  hex: '#22c55e' },
    { name: 'Purple', hex: '#a855f7' },
    { name: 'Pink',   hex: '#ec4899' },
    { name: 'Orange', hex: '#f97316' },
    { name: 'White',  hex: '#ffffff' },
    { name: 'Black',  hex: '#000000' }
];

window.getTeamColors = function(event) {
    if (!event) return [];
    const count = event.teamsCount || 3;
    const saved = (window.teamColors && window.teamColors[event.id]) || event.teamColors || {};
    const palette = window.TEAM_COLOR_OPTIONS.map(c => c.hex);
    const result = new Array(count).fill(null);
    const used = new Set();
    for (let i = 0; i < count; i++) {
        const c = saved[i];
        if (c && !used.has(String(c).toLowerCase())) {
            result[i] = c;
            used.add(String(c).toLowerCase());
        }
    }
    for (let i = 0; i < count; i++) {
        if (result[i]) continue;
        const free = palette.find(p => !used.has(p.toLowerCase())) || palette[i % palette.length];
        result[i] = free;
        used.add(free.toLowerCase());
    }
    return result;
};

window.getTeamNames = function(event) {
    if (!event) return [];
    const count = event.teamsCount || 3;
    const saved = (window.teamNames && window.teamNames[event.id]) || event.teamNames || {};
    return Array.from({ length: count }, (_, i) => saved[i] || `Team ${i + 1}`);
};

window.getTeamColor = function(event, teamIndex) {
    return window.getTeamColors(event)[teamIndex];
};

window.teamAccent = function(hex) {
    return String(hex || '').toLowerCase() === '#000000' ? '#9ca3af' : hex;
};

window.teamTextOn = function(hex) {
    const h = String(hex || '#000000').replace('#', '');
    const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#0f172a' : '#ffffff';
};

// Robust helper to resolve profile avatars across directory, attendees, and saved assignments
function resolvePlayerAvatar(person, attendees) {
    const fallback = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(person?.name || 'Player')}`;
    if (!person) return fallback;

    const uid = person.uid ? String(person.uid) : '';
    
    // 1. Check directory list if available
    if (uid && Array.isArray(window.directoryList)) {
        const hit = window.directoryList.find(u => String(u.uid) === uid);
        if (hit && hit.avatar && hit.avatar.trim() !== '') return hit.avatar;
        if (hit && hit.photoURL && hit.photoURL.trim() !== '') return hit.photoURL;
    }

    // 2. Check direct attendee record
    if (uid && Array.isArray(attendees)) {
        const attHit = attendees.find(a => String(a.uid) === uid);
        if (attHit && (attHit.avatar || attHit.photoURL)) {
            return attHit.avatar || attHit.photoURL;
        }
    }

    // 3. Use person's own avatar if valid
    const own = person.avatar || person.photoURL;
    if (own && typeof own === 'string' && own.trim() !== '') return own;

    return fallback;
}

async function updateTeamToolFirestore(event) {
    if (!event || !event.id) return;
    const realDocId = (window.eventDocIds && window.eventDocIds[event.id]) || event.id;
    const docRef = doc(db, 'artifacts', appId, 'eventsList', realDocId);
    
    event.teamAssignments = window.teamAssignments[event.id] || event.teamAssignments || {};
    event.teamNames = window.teamNames[event.id] || event.teamNames || {};
    event.teamColors = window.teamColors[event.id] || event.teamColors || {};
    event.teamCaptains = window.teamCaptains[event.id] || event.teamCaptains || {};
    
    window.eventsList = (window.eventsList || []).map(ev => ev.id === event.id ? event : ev);
    
    const cleanPayload = JSON.parse(JSON.stringify(event));
    try {
        await setDoc(docRef, cleanPayload, { merge: true });
        window.dispatchEvent(new CustomEvent('eventsDataUpdated', { detail: { eventId: event.id } }));
    } catch (err) {
        console.error("Failed to update team tool in Firestore:", err);
    }
}

function getFlattenedPlayersList(attendees) {
    const list = [];
    (attendees || []).forEach(att => {
        const safeAvatar = resolvePlayerAvatar(att, attendees);

        list.push({
            uid: String(att?.uid || 'usr_' + Math.random().toString(36).substring(2,7)),
            name: String(att?.name || att?.firstName || 'Player'),
            avatar: safeAvatar,
            position: String(att?.position || 'Player'),
            guests: att?.guests || []
        });
        
        if (att?.guests && Array.isArray(att.guests)) {
            att.guests.forEach((g, gIdx) => {
                const guestAvatar = (g && g.avatar && !g.avatar.startsWith('data:')) ? String(g.avatar) : safeAvatar;
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
    const event = (window.eventsList || []).find(ev => ev.id === eventId) || window.currentTeamBuildingEvent;
    if (!event) {
        if (typeof window.showToast === 'function') window.showToast("Event data not found.", "error");
        return;
    }

    window.activeModalEventId = event.id;
    window.activeTeamTab = window.activeTeamTab !== undefined ? window.activeTeamTab : 0;
    window.currentTeamBuildingEvent = event;

    window.teamAssignments[event.id] = event.teamAssignments || {};
    window.teamNames[event.id] = event.teamNames || {};
    window.teamColors[event.id] = event.teamColors || {};
    window.teamCaptains[event.id] = event.teamCaptains || {};

    let modal = document.getElementById('standalone-team-builder-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'standalone-team-builder-modal';
        modal.className = 'fixed inset-0 z-[180] flex flex-col bg-[#040E13] overflow-y-auto p-4 sm:p-6 text-white pointer-events-auto';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="max-w-4xl mx-auto w-full space-y-6 pointer-events-auto">
            ${renderTeamToolTab(event)}
        </div>
    `;
};

window.switchTeamTab = function(teamIndex) {
    window.activeTeamTab = teamIndex;
    const event = window.currentTeamBuildingEvent || (window.eventsList || []).find(ev => ev.id === window.activeModalEventId);
    if (event) {
        window.openTeamMakingModal(event.id);
    }
};

window.changeTeamFormation = async function(eventId, teamIndex, formationKey) {
    window.teamFormations[eventId] = window.teamFormations[eventId] || {};
    window.teamFormations[eventId][teamIndex] = formationKey;
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (event) {
        await updateTeamToolFirestore(event);
        window.openTeamMakingModal(eventId);
    }
};

window.changeTeamColor = async function(eventId, teamIndex, colorHex) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId) || window.currentTeamBuildingEvent;
    if (!event) return;

    const colors = window.getTeamColors(event);
    const names = window.getTeamNames(event);
    const clash = colors.findIndex((c, i) => i !== teamIndex && String(c).toLowerCase() === String(colorHex).toLowerCase());
    if (clash !== -1) {
        if (typeof window.showToast === 'function') window.showToast(`${names[clash]} already uses that color.`, 'error');
        return;
    }

    window.teamColors[eventId] = window.teamColors[eventId] || {};
    colors.forEach((c, i) => { window.teamColors[eventId][i] = c; });
    window.teamColors[eventId][teamIndex] = colorHex;

    event.teamColors = window.teamColors[eventId];
    await updateTeamToolFirestore(event);
    window.openTeamMakingModal(eventId);
};

window.setTeamCaptain = async function(eventId, teamIndex, captainUid) {
    window.teamCaptains[eventId] = window.teamCaptains[eventId] || {};
    window.teamCaptains[eventId][teamIndex] = captainUid;
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (event) {
        await updateTeamToolFirestore(event);
        if (typeof window.showToast === 'function') window.showToast("Captain updated!");
        window.openTeamMakingModal(eventId);
    }
};

window.saveTeamNameModal = async function(eventId, teamIndex) {
    const inputEl = document.getElementById(`team-name-input-${teamIndex}`);
    if (!inputEl) return;
    const newName = inputEl.value.trim();
    if (!newName) return;

    const event = (window.eventsList || []).find(ev => ev.id === eventId) || window.currentTeamBuildingEvent;
    if (!event) return;

    const names = window.getTeamNames(event);
    const clash = names.findIndex((n, i) => i !== teamIndex && n.trim().toLowerCase() === newName.toLowerCase());
    if (clash !== -1) {
        if (typeof window.showToast === 'function') window.showToast(`Another team is already named "${names[clash]}".`, 'error');
        return;
    }

    window.teamNames[eventId] = window.teamNames[eventId] || {};
    window.teamNames[eventId][teamIndex] = newName;
    event.teamNames = window.teamNames[eventId];
    try {
        await updateTeamToolFirestore(event);
        if (typeof window.showToast === 'function') window.showToast(`Team name updated to "${newName}"!`);
        window.openTeamMakingModal(eventId);
    } catch (err) {
        console.error("Failed to save team name:", err);
    }
};

window.promptRandomizeOptions = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId) || window.currentTeamBuildingEvent;
    if (!event) return;

    const teamAssigned = window.teamAssignments[eventId] || event.teamAssignments || {};
    let placedCount = 0;
    Object.values(teamAssigned).forEach(arr => {
        if (Array.isArray(arr)) arr.forEach(p => { if (p && p.uid) placedCount++; });
    });

    if (placedCount === 0) {
        window.promptRandomizeDistribution(eventId, false);
        return;
    }

    let modal = document.getElementById('randomize-options-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'randomize-options-modal';
        modal.className = 'fixed inset-0 z-[190] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm pointer-events-auto';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white text-center pointer-events-auto">
            <h3 class="text-sm font-black uppercase text-white">You have players already selected</h3>
            <p class="text-[11px] text-white/60">What would you like to do?</p>
            <div class="space-y-2.5 pt-2">
                <button onclick="window.promptRandomizeDistribution('${eventId}', true)" class="w-full bg-[#00F296] text-slate-950 font-black py-3 rounded-xl text-xs shadow transition">
                    Keep players &amp; randomize the rest
                </button>
                <button onclick="window.promptRandomizeDistribution('${eventId}', false)" class="w-full bg-black/60 text-white font-bold py-3 rounded-xl text-xs border border-white/20 transition">
                    Fully randomize again
                </button>
                <button onclick="document.getElementById('randomize-options-modal').remove()" class="w-full bg-transparent text-white/40 hover:text-white py-2 text-xs">
                    Cancel
                </button>
            </div>
        </div>
    `;
};

window.promptRandomizeDistribution = function(eventId, keepExisting) {
    let modal = document.getElementById('randomize-options-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'randomize-options-modal';
        modal.className = 'fixed inset-0 z-[190] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm pointer-events-auto';
        document.body.appendChild(modal);
    }

    const togetherLabel = keepExisting ? 'Try to keep players with their plus ones' : 'Keep players &amp; plus ones together';
    const togetherNote = keepExisting
        ? '<p class="text-[10px] text-white/40">"Try" because teams may not have room for everyone since some players are already placed.</p>'
        : '';

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white text-center pointer-events-auto">
            <h3 class="text-sm font-black uppercase text-white">Randomize Teams</h3>
            <p class="text-[11px] text-white/60">How would you like to distribute the players?</p>
            <div class="space-y-2.5 pt-2">
                <button onclick="document.getElementById('randomize-options-modal').remove(); window.executeRandomizeTeams('${eventId}', false, ${keepExisting ? 'true' : 'false'})" class="w-full bg-[#00F296] text-slate-950 font-black py-3 rounded-xl text-xs shadow transition">
                    Fully Randomized
                </button>
                <button onclick="document.getElementById('randomize-options-modal').remove(); window.executeRandomizeTeams('${eventId}', true, ${keepExisting ? 'true' : 'false'})" class="w-full bg-black/60 text-white font-bold py-3 rounded-xl text-xs border border-white/20 transition">
                    ${togetherLabel}
                </button>
                ${togetherNote}
                <button onclick="document.getElementById('randomize-options-modal').remove()" class="w-full bg-transparent text-white/40 hover:text-white py-2 text-xs">
                    Cancel
                </button>
            </div>
        </div>
    `;
};

window.executeRandomizeTeams = async function(eventId, keepGuestsTogether, keepExisting) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId) || window.currentTeamBuildingEvent;
    if (!event) return;

    const teamsCount = event.teamsCount || 3;
    const capacity = keepExisting ? (parseInt(event.format) || 8) : Infinity;

    const previous = window.teamAssignments[eventId] || event.teamAssignments || {};
    const teams = {};
    for (let i = 0; i < teamsCount; i++) {
        teams[i] = keepExisting && Array.isArray(previous[i]) ? previous[i].filter(Boolean) : [];
    }

    const placedUIDs = new Set();
    Object.values(teams).forEach(arr => arr.forEach(p => { if (p && p.uid) placedUIDs.add(String(p.uid)); }));

    const sizeOf = (i) => teams[i].filter(p => p && p.uid).length;
    const shuffle = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    };
    const addToTeam = (i, player) => {
        teams[i].push(player);
        placedUIDs.add(String(player.uid));
    };
    const pickTeam = (needed) => {
        const options = [];
        for (let i = 0; i < teamsCount; i++) {
            if (capacity - sizeOf(i) >= needed) options.push(i);
        }
        if (options.length === 0) return -1;
        const min = Math.min(...options.map(sizeOf));
        const best = options.filter(i => sizeOf(i) === min);
        return best[Math.floor(Math.random() * best.length)];
    };

    const flat = getFlattenedPlayersList(event.attendees);
    const groups = [];
    flat.forEach(p => {
        if (p.isHostGuest && groups.length) groups[groups.length - 1].push(p);
        else groups.push([p]);
    });

    const pool = groups.map(g => g.filter(p => !placedUIDs.has(String(p.uid)))).filter(g => g.length > 0);

    let leftOut = 0;
    if (keepGuestsTogether) {
        shuffle(pool).forEach(group => {
            const t = pickTeam(group.length);
            if (t !== -1) {
                group.forEach(p => addToTeam(t, p));
            } else {
                group.forEach(p => {
                    const t2 = pickTeam(1);
                    if (t2 !== -1) addToTeam(t2, p);
                    else leftOut++;
                });
            }
        });
    } else {
        shuffle(pool.flat()).forEach(p => {
            const t = pickTeam(1);
            if (t !== -1) addToTeam(t, p);
            else leftOut++;
        });
    }

    window.teamAssignments[eventId] = teams;
    event.teamAssignments = teams;

    try {
        await updateTeamToolFirestore(event);
        if (typeof window.showToast === 'function') {
            if (leftOut > 0) window.showToast(`Teams randomized. ${leftOut} player(s) didn't fit.`);
            else window.showToast("Teams randomized successfully!");
        }
        window.openTeamMakingModal(eventId);
    } catch (err) {
        console.error("Failed to randomize teams:", err);
    }
};

export function renderTeamToolTab(event) {
    if (!event) return '';
    window.currentTeamBuildingEvent = event;
    const teamsCount = event.teamsCount || 3;
    const format = event.format || '7v7';
    const resolvedColors = window.getTeamColors(event);

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
    const activeTab = window.activeTeamTab || 0;

    window.teamAssignments[event.id] = window.teamAssignments[event.id] || {};
    for (let i = 0; i < teamsCount; i++) {
        window.teamAssignments[event.id][i] = (window.teamAssignments[event.id][i] || []).filter(p => p && p.uid).map(p => {
            const freshAvatar = resolvePlayerAvatar(p, event.attendees);
            return { ...p, avatar: freshAvatar };
        });
    }
    window.teamNames[event.id] = window.teamNames[event.id] || {};

    const allPlayers = getFlattenedPlayersList(event.attendees);
    const currentAssignedUIDs = new Set();
    Object.values(window.teamAssignments[event.id]).forEach(teamArr => {
        if (Array.isArray(teamArr)) {
            teamArr.forEach(p => { if (p && p.uid) currentAssignedUIDs.add(String(p.uid)); });
        }
    });

    const freeAgents = allPlayers.filter(a => !currentAssignedUIDs.has(String(a.uid)));

    let tabsHtml = `
        <button data-action="switch-team-tab" data-team-index="0" class="px-4 py-2.5 rounded-2xl text-xs font-black transition shrink-0 ${activeTab === 0 ? 'bg-[#00F296] text-slate-950 shadow-md' : 'bg-black/60 text-white/80 border border-white/10'}">
            📋 Summary
        </button>
    `;
    for (let i = 0; i < teamsCount; i++) {
        const tIdx = i + 1;
        const isActive = activeTab === tIdx;
        const tName = window.teamNames[event.id][i] || `Team ${i + 1}`;
        const rawColor = resolvedColors[i];
        const tColor = window.teamAccent(rawColor);
        tabsHtml += `
            <button data-action="switch-team-tab" data-team-index="${tIdx}" style="border-color: ${tColor} !important;" class="px-4 py-2.5 rounded-2xl text-xs font-black transition border shrink-0 ${isActive ? 'bg-[#00F296] text-slate-950 shadow-md' : 'bg-black/60 text-white/90'}">
                <span class="inline-block w-3 h-3 rounded-full mr-1.5 align-middle border border-white/40" style="background-color: ${rawColor};"></span> ${tName}
            </button>
        `;
    }

    let contentHtml = '';

    if (activeTab === 0) {
        let teamsSummaryHtml = '';
        for (let i = 0; i < teamsCount; i++) {
            const tName = window.teamNames[event.id][i] || `Team ${i + 1}`;
            const rawColor = resolvedColors[i];
            const tColor = window.teamAccent(rawColor);
            const teamRoster = (window.teamAssignments[event.id][i] || []).filter(p => p && p.uid);
            const captainUid = window.teamCaptains[event.id][i];

            const rosterPillsHtml = teamRoster.length === 0 
                ? '<span class="text-xs text-white/40 italic">No players assigned yet.</span>'
                : teamRoster.map(p => {
                    const isCap = String(p?.uid) === String(captainUid);
                    const pAvatar = resolvePlayerAvatar(p, event.attendees);
                    const pName = p?.name || 'Player';
                    const pUid = p?.uid || '';
                    return `
                        <div class="flex items-center gap-2 bg-black/80 px-3 py-2 rounded-2xl border text-xs shadow-md" style="border-color: ${tColor};">
                            <img src="${pAvatar}" class="w-6 h-6 rounded-full object-cover border border-white/20" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                            <span class="font-bold text-white">${pName} ${isCap ? '⭐' : ''}</span>
                            <button data-action="unassign-team-slot" data-event-id="${event.id}" data-team-index="${i}" data-uid="${pUid}" class="text-white/40 hover:text-red-400 ml-1"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    `;
                }).join('');

            teamsSummaryHtml += `
                <div class="bg-[#040E13]/95 border-2 rounded-3xl p-5 space-y-4 shadow-xl flex flex-col justify-between" style="border-color: ${tColor}66;">
                    <div class="space-y-3">
                        <div class="flex items-center justify-between border-b border-white/10 pb-2.5">
                            <div class="flex items-center gap-2.5">
                                <span class="w-3.5 h-3.5 rounded-full border border-white/40" style="background-color: ${rawColor};"></span>
                                <h4 class="text-xs font-black uppercase tracking-wider" style="color: ${tColor};">${tName} (${teamRoster.length})</h4>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-2.5">
                            ${rosterPillsHtml}
                        </div>
                    </div>
                    <div class="pt-3 border-t border-white/10">
                        <button data-action="open-assign-picker" data-event-id="${event.id}" data-team-index="${i}" data-slot-index="null" class="w-full bg-[#00F296]/20 hover:bg-[#00F296]/30 text-[#00F296] font-black py-3 px-4 rounded-2xl text-xs border border-[#00F296]/50 transition flex items-center justify-center gap-2 shadow">
                            <i class="fa-solid fa-user-plus"></i> + Add Player to ${tName}
                        </button>
                    </div>
                </div>
            `;
        }

        const freeAgentsPillsHtml = freeAgents.length === 0 
            ? '<span class="text-xs text-white/40 italic">All players assigned!</span>'
            : freeAgents.map(a => {
                const aAvatar = resolvePlayerAvatar(a, event.attendees);
                const aName = a?.name || 'Player';
                return `
                    <div class="flex items-center gap-2 bg-black/60 px-3 py-2 rounded-2xl border border-white/10 text-xs">
                        <img src="${aAvatar}" class="w-6 h-6 rounded-full object-cover" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                        <span class="font-bold text-white">${aName}</span>
                    </div>
                `;
            }).join('');

        contentHtml = `
            <div class="space-y-5 pb-10">
                <div class="bg-[#040E13]/95 border border-amber-500/40 rounded-3xl p-5 space-y-3 shadow-xl">
                    <h4 class="text-xs font-black text-amber-400 uppercase tracking-wider">⏳ Free Agents (${freeAgents.length})</h4>
                    <div class="flex flex-wrap gap-2.5">
                        ${freeAgentsPillsHtml}
                    </div>
                </div>
                ${teamsSummaryHtml}
            </div>
        `;
    } else {
        const teamIdx = activeTab - 1;
        const currentTeamName = window.teamNames[event.id][teamIdx] || `Team ${teamIdx + 1}`;
        const currentTeamColor = resolvedColors[teamIdx];
        const currentAccent = window.teamAccent(currentTeamColor);
        const currentTeamPlayers = (window.teamAssignments[event.id][teamIdx] || []).filter(p => p && p.uid);
        const currentCaptainUid = window.teamCaptains[event.id][teamIdx] || "";
        
        window.teamFormations[event.id][teamIdx] = window.teamFormations[event.id][teamIdx] || defaultFormatKey;
        const currentFormationKey = window.teamFormations[event.id][teamIdx];
        const rowCounts = availableFormations[currentFormationKey] || [3, 3, 1];

        let playerIndex = 0;
        let rowsHtml = '';
        const displayRows = [...rowCounts].reverse();

        displayRows.forEach((count, rIdx) => {
            let rowSlots = '';
            for (let c = 0; c < count; c++) {
                const slotIdx = playerIndex++;
                const p = currentTeamPlayers[slotIdx];
                const positionName = rIdx === 0 ? "FWD" : (rIdx === displayRows.length - 1 ? "DEF" : "MID");
                
                if (p && p.name) {
                    const pAvatar = resolvePlayerAvatar(p, event.attendees);
                    rowSlots += `
                        <div data-action="prompt-remove-slot" data-event-id="${event.id}" data-team-index="${teamIdx}" data-slot-index="${slotIdx}" data-player-name="${(p.name || '').replace(/'/g, "\\'")}" class="flex-1 min-w-0 max-w-[7rem] h-10 bg-black/90 border-2 rounded-full px-2 text-center cursor-pointer shadow-lg flex items-center gap-1.5 relative group transition hover:scale-105" style="border-color: ${currentAccent};">
                            <img src="${pAvatar}" class="w-6 h-6 rounded-full object-cover border border-white/20 shrink-0" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                            <div class="truncate text-left leading-tight pointer-events-none">
                                <span class="text-[6px] font-black uppercase block tracking-wider" style="color: ${currentAccent};">${positionName}</span>
                                <span class="text-[9px] font-black text-white truncate block">${p.name}</span>
                            </div>
                        </div>
                    `;
                } else {
                    rowSlots += `
                        <div data-action="open-assign-picker" data-event-id="${event.id}" data-team-index="${teamIdx}" data-slot-index="${slotIdx}" class="flex-1 min-w-0 max-w-[7rem] h-10 bg-black/60 border-2 border-dashed rounded-full px-2 text-center cursor-pointer hover:bg-black/80 transition flex items-center justify-center gap-1.5 shadow" style="border-color: ${currentAccent};">
                            <i class="fa-solid fa-shirt text-white/80 text-xs pointer-events-none"></i>
                            <span class="text-[10px] font-black uppercase text-white/90 tracking-wider pointer-events-none">${positionName}</span>
                        </div>
                    `;
                }
            }
            rowsHtml += `<div class="flex justify-center gap-2 mb-3 w-full px-1">${rowSlots}</div>`;
        });

        const goalieSlotIdx = playerIndex++;
        const goaliePlayer = currentTeamPlayers[goalieSlotIdx];
        if (goaliePlayer && goaliePlayer.name) {
            const gAvatar = resolvePlayerAvatar(goaliePlayer, event.attendees);
            rowsHtml += `
                <div class="flex justify-center mt-3">
                    <div data-action="prompt-remove-slot" data-event-id="${event.id}" data-team-index="${teamIdx}" data-slot-index="${goalieSlotIdx}" data-player-name="${(goaliePlayer.name || '').replace(/'/g, "\\'")}" class="w-28 h-10 bg-black/90 border-2 rounded-full px-2 text-center cursor-pointer shadow-lg flex items-center gap-1.5 transition hover:scale-105" style="border-color: ${currentAccent};">
                        <img src="${gAvatar}" class="w-6 h-6 rounded-full object-cover border border-white/20 shrink-0" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                        <div class="truncate text-left leading-tight pointer-events-none">
                            <span class="text-[6px] font-black uppercase block tracking-wider text-amber-400">GK</span>
                            <span class="text-[9px] font-black text-white truncate block">${goaliePlayer.name}</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            rowsHtml += `
                <div class="flex justify-center mt-3">
                    <div data-action="open-assign-picker" data-event-id="${event.id}" data-team-index="${teamIdx}" data-slot-index="${goalieSlotIdx}" class="w-28 h-10 border-2 border-dashed bg-black/60 rounded-full px-2 text-center cursor-pointer shadow-lg flex items-center justify-center gap-1.5 transition hover:scale-105" style="border-color: ${currentAccent};">
                        <i class="fa-solid fa-hand text-amber-300 text-sm ml-2 pointer-events-none"></i>
                        <span class="text-[10px] font-black uppercase text-amber-300 tracking-wider ml-1 pointer-events-none">GK</span>
                    </div>
                </div>
            `;
        }

        const captainOptionsHtml = currentTeamPlayers.filter(p => p && p.name).map(p => `<option value="${p.uid}" ${p.uid === currentCaptainUid ? 'selected' : ''}>⭐ ${p.name}</option>`).join('');
        const formationsOptionsHtml = Object.keys(availableFormations).map(f => `<option value="${f}" ${f === currentFormationKey ? 'selected' : ''}>Formation: ${f}</option>`).join('');

        const squadMembersListHtml = currentTeamPlayers.length === 0 
            ? '<span class="text-xs text-white/40 italic">No players assigned to this team yet.</span>'
            : currentTeamPlayers.map(p => {
                const isCap = String(p?.uid) === String(currentCaptainUid);
                const pAvatar = resolvePlayerAvatar(p, event.attendees);
                const pName = p?.name || 'Player';
                const pPos = p?.position || 'Player';
                const pUid = p?.uid || '';
                return `
                    <div class="flex items-center justify-between p-3 bg-black/60 rounded-2xl border border-white/10 text-xs shadow-sm">
                        <div class="flex items-center gap-3">
                            <img src="${pAvatar}" class="w-8 h-8 rounded-full object-cover border border-white/20" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                            <div>
                                <div class="font-bold text-white">${pName} ${isCap ? '⭐ (Captain)' : ''}</div>
                                <div class="text-[10px] text-white/50">${pPos}</div>
                            </div>
                        </div>
                        <button data-action="unassign-team-slot" data-event-id="${event.id}" data-team-index="${teamIdx}" data-uid="${pUid}" class="text-red-400 hover:text-red-300 font-bold px-3 py-1.5 rounded-xl text-xs bg-red-500/10 border border-red-500/30 transition">Remove</button>
                    </div>
                `;
            }).join('');

        contentHtml = `
            <div class="space-y-5 pb-16">
                <div class="bg-[#040E13]/95 border border-white/10 p-3 rounded-3xl shadow-xl">
                    <div class="flex items-end gap-2">
                        <div class="flex-1 min-w-0 space-y-1">
                            <label class="block text-[9px] font-bold text-white/60 uppercase">Team</label>
                            <div class="flex items-center gap-1">
                                <input type="text" id="team-name-input-${teamIdx}" value="${currentTeamName}" class="flex-1 min-w-0 bg-black/80 border border-white/20 rounded-xl px-2.5 py-2 text-xs font-bold text-white focus:outline-none focus:border-[#00F296]">
                                <button data-action="save-team-name" data-event-id="${event.id}" data-team-index="${teamIdx}" title="Save team name" class="w-8 h-8 shrink-0 bg-[#00F296] text-slate-950 rounded-xl text-xs flex items-center justify-center shadow"><i class="fa-solid fa-check pointer-events-none"></i></button>
                            </div>
                        </div>
                        <div class="shrink-0 space-y-1">
                            <label class="block text-[9px] font-bold text-white/60 uppercase text-center">Color</label>
                            <button data-action="toggle-color-palette" data-team-index="${teamIdx}" title="Tap to change color" class="block w-8 h-8 rounded-full border-2 border-white/70 shadow transition hover:scale-110" style="background-color: ${currentTeamColor};"></button>
                        </div>
                        <div class="w-[34%] shrink-0 space-y-1">
                            <label class="block text-[9px] font-bold text-white/60 uppercase">Captain</label>
                            <select id="team-captain-select-${teamIdx}" data-action="set-team-captain" data-event-id="${event.id}" data-team-index="${teamIdx}" class="w-full bg-black/80 border border-white/20 rounded-xl px-2 py-2 text-xs font-bold text-white">
                                <option value="">None</option>
                                ${captainOptionsHtml}
                            </select>
                        </div>
                    </div>
                    <div id="team-color-palette-${teamIdx}" class="hidden">
                        <div class="flex flex-wrap items-center gap-2.5 pt-3 mt-3 border-t border-white/10">
                            ${window.TEAM_COLOR_OPTIONS.map(col => {
                                const usedBy = resolvedColors.findIndex((c, i) => i !== teamIdx && c.toLowerCase() === col.hex.toLowerCase());
                                const isCurrent = currentTeamColor.toLowerCase() === col.hex.toLowerCase();
                                if (usedBy !== -1) {
                                    return `<span title="${col.name} - used by${window.getTeamNames(event)[usedBy]}" class="w-8 h-8 rounded-full border-2 border-white/20 opacity-25 cursor-not-allowed" style="background-color: ${col.hex};"></span>`;
                                }
                                return `<button data-action="change-team-color" data-event-id="${event.id}" data-team-index="${teamIdx}" data-color="${col.hex}" title="${col.name}" class="w-8 h-8 rounded-full border-2 transition ${isCurrent ? 'border-[#00F296] scale-110 shadow-md' : 'border-white/40'}" style="background-color: ${col.hex};"></button>`;
                            }).join('')}
                        </div>
                    </div>
                </div>

                <div class="relative border-2 rounded-3xl p-3 shadow-2xl overflow-hidden min-h-[440px] flex flex-col justify-between bg-[#03140C]" style="background-image: url('img/TeamBuildField.png'); background-size: cover; background-position: center; border-color: ${currentAccent};">
                    <div class="absolute inset-0 bg-black/50 pointer-events-none"></div>

                    <div class="flex justify-between items-center relative z-10">
                        <span class="font-black text-xs px-3 py-1.5 rounded-2xl uppercase tracking-wider shadow-lg border border-white/30" style="background-color: ${currentTeamColor}; color: ${window.teamTextOn(currentTeamColor)};">${currentTeamName}</span>
                        <select id="team-formation-select-${teamIdx}" data-action="change-team-formation" data-event-id="${event.id}" data-team-index="${teamIdx}" class="bg-black/90 text-white font-bold text-xs px-4 py-2 rounded-2xl border border-white/20 shadow-md">
                            ${formationsOptionsHtml}
                        </select>
                    </div>

                    <div class="relative z-10 my-4 flex flex-col items-center justify-center w-full">
                        ${rowsHtml}
                    </div>

                    <div class="text-center relative z-10 text-[10px] text-white/80 font-semibold bg-black/60 py-2 rounded-xl">
                        Tap any position on the pitch to assign or remove players
                    </div>
                </div>

                <div class="bg-[#040E13]/95 border border-white/10 rounded-3xl p-5 space-y-4 shadow-xl">
                    <div class="flex justify-between items-center">
                        <h4 class="text-xs font-black text-white/80 uppercase tracking-wider">Squad Members (${currentTeamPlayers.length})</h4>
                    </div>
                    <div class="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                        ${squadMembersListHtml}
                    </div>
                    <div class="pt-2">
                        <button data-action="open-assign-picker" data-event-id="${event.id}" data-team-index="${teamIdx}" data-slot-index="null" class="w-full bg-[#00F296]/20 hover:bg-[#00F296]/30 text-[#00F296] font-black py-3 px-4 rounded-2xl text-xs border border-[#00F296]/50 transition flex items-center justify-center gap-2 shadow">
                            <i class="fa-solid fa-user-plus pointer-events-none"></i> + Add Player to ${currentTeamName}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    return `
        <div class="space-y-6 max-w-4xl mx-auto pb-12 pointer-events-auto">
            <div class="bg-[#040E13]/95 backdrop-blur-md border border-emerald-500/40 rounded-2xl px-3 py-2 shadow-2xl flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <button data-action="close-standalone-modal" class="w-8 h-8 bg-black/50 hover:bg-black text-white rounded-full flex items-center justify-center font-bold border border-white/20 transition shadow">
                        <i class="fa-solid fa-chevron-left text-xs pointer-events-none"></i>
                    </button>
                    <div>
                        <h3 class="text-sm font-black uppercase text-white leading-tight">Team Builder</h3>
                        <p class="text-[10px] text-white/60 font-medium leading-tight">Format: ${format}</p>
                    </div>
                </div>
                <div>
                    <button data-action="prompt-randomize" data-event-id="${event.id}" class="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black px-3 py-1.5 rounded-xl text-[11px] shadow-md transition flex items-center gap-1.5">
                        <i class="fa-solid fa-shuffle text-xs pointer-events-none"></i> Randomize
                    </button>
                </div>
            </div>

            <!-- Tabs Navigation Bar -->
            <div class="flex items-center gap-2.5 overflow-x-auto pb-2 no-scrollbar pointer-events-auto">
                ${tabsHtml}
            </div>

            <!-- Active Tab Content -->
            ${contentHtml}
        </div>
    `;
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const eventId = btn.getAttribute('data-event-id');

    if (action === 'close-standalone-modal') {
        document.getElementById('standalone-team-builder-modal')?.remove();
    } else if (action === 'prompt-randomize') {
        window.promptRandomizeOptions(eventId);
    } else if (action === 'switch-team-tab') {
        const teamIndex = parseInt(btn.getAttribute('data-team-index'), 10);
        window.switchTeamTab(teamIndex);
    } else if (action === 'toggle-color-palette') {
        const teamIndex = btn.getAttribute('data-team-index');
        document.getElementById(`team-color-palette-${teamIndex}`)?.classList.toggle('hidden');
    } else if (action === 'change-team-color') {
        const teamIndex = parseInt(btn.getAttribute('data-team-index'), 10);
        const color = btn.getAttribute('data-color');
        window.changeTeamColor(eventId, teamIndex, color);
    } else if (action === 'save-team-name') {
        const teamIndex = parseInt(btn.getAttribute('data-team-index'), 10);
        window.saveTeamNameModal(eventId, teamIndex);
    } else if (action === 'unassign-team-slot') {
        const teamIndex = parseInt(btn.getAttribute('data-team-index'), 10);
        const uid = btn.getAttribute('data-uid');
        window.unassignPlayerFromTeamSlot(eventId, teamIndex, uid);
    } else if (action === 'open-assign-picker') {
        const teamIndex = parseInt(btn.getAttribute('data-team-index'), 10);
        const slotAttr = btn.getAttribute('data-slot-index');
        const slotIndex = slotAttr === 'null' ? null : parseInt(slotAttr, 10);
        window.openAssignPicker(eventId, teamIndex, slotIndex);
    } else if (action === 'prompt-remove-slot') {
        const teamIndex = parseInt(btn.getAttribute('data-team-index'), 10);
        const slotIndex = parseInt(btn.getAttribute('data-slot-index'), 10);
        const playerName = btn.getAttribute('data-player-name');
        window.promptRemoveOrChangeSlot(eventId, teamIndex, slotIndex, playerName);
    }
});

document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    const eventId = el.getAttribute('data-event-id');

    if (action === 'change-team-formation') {
        const teamIndex = parseInt(el.getAttribute('data-team-index'), 10);
        window.changeTeamFormation(eventId, teamIndex, el.value);
    } else if (action === 'set-team-captain') {
        const teamIndex = parseInt(el.getAttribute('data-team-index'), 10);
        window.setTeamCaptain(eventId, teamIndex, el.value);
    }
});

window.openAssignPicker = function(eventId, teamIndex, slotIndex) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId) || window.currentTeamBuildingEvent;
    if (!event) return;

    window.teamAssignments[event.id] = event.teamAssignments || {};
    const teamRoster = (window.teamAssignments[event.id][teamIndex] || []).filter(p => p && p.uid);
    const allPlayers = getFlattenedPlayersList(event.attendees);

    if (slotIndex !== null && slotIndex !== 'null') {
        const assignedPitchUIDs = new Set();
        Object.entries(window.teamAssignments[event.id][teamIndex] || {}).forEach(([sIdx, player]) => {
            if (player && player.uid && parseInt(sIdx) !== slotIndex) {
                assignedPitchUIDs.add(String(player.uid));
            }
        });
        
        const unplacedPitchPlayers = teamRoster.filter(p => !assignedPitchUIDs.has(String(p.uid)));
        
        let picker = document.getElementById('assign-picker-modal');
        if (!picker) {
            picker = document.createElement('div');
            picker.id = 'assign-picker-modal';
            picker.className = 'fixed inset-0 z-[190] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm pointer-events-auto';
            document.body.appendChild(picker);
        }

        if (unplacedPitchPlayers.length === 0) {
            const placedPlayersWithPositions = teamRoster.filter(p => assignedPitchUIDs.has(String(p.uid)));
            if (placedPlayersWithPositions.length === 0) {
                picker.innerHTML = `
                    <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white text-center pointer-events-auto">
                        <h4 class="text-xs font-black uppercase text-white">No players available</h4>
                        <p class="text-xs text-white/70">No more players available for now! Add more players to the team first.</p>
                        <button onclick="document.getElementById('assign-picker-modal').remove()" class="w-full bg-[#00F296] text-slate-950 font-bold py-2.5 rounded-xl text-xs">OK</button>
                    </div>
                `;
            } else {
                picker.innerHTML = `
                    <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white pointer-events-auto">
                        <div class="flex items-center justify-between border-b border-white/10 pb-3">
                            <h4 class="text-xs font-black uppercase text-white">Move Player Here</h4>
                            <button onclick="document.getElementById('assign-picker-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                        <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                            ${placedPlayersWithPositions.map(p => {
                                const pAvatar = resolvePlayerAvatar(p, event.attendees);
                                return `
                                    <div onclick="document.getElementById('assign-picker-modal')?.remove(); window.assignPlayerToSlot('${event.id}',${teamIndex}, ${slotIndex}, '${p.uid}')" class="flex items-center gap-3 p-2.5 bg-black/40 hover:bg-black border border-white/10 rounded-xl cursor-pointer transition">
                                        <img src="${pAvatar}" class="w-7 h-7 rounded-full object-cover" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                                        <span class="text-xs font-bold text-white">${p.name} (Move)</span>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }
            return;
        }

        picker.innerHTML = `
            <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white pointer-events-auto">
                <div class="flex items-center justify-between border-b border-white/10 pb-3">
                    <h4 class="text-xs font-black uppercase text-white">Assign Player to Position</h4>
                    <button onclick="document.getElementById('assign-picker-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                    ${unplacedPitchPlayers.map(p => {
                        const pAvatar = resolvePlayerAvatar(p, event.attendees);
                        return `
                            <div onclick="document.getElementById('assign-picker-modal')?.remove(); window.assignPlayerToSlot('${event.id}',${teamIndex}, ${slotIndex}, '${p.uid}')" class="flex items-center gap-3 p-2.5 bg-black/40 hover:bg-black border border-white/10 rounded-xl cursor-pointer transition">
                                <img src="${pAvatar}" class="w-7 h-7 rounded-full object-cover" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                                <span class="text-xs font-bold text-white">${p.name}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        return;
    }

    const currentAssignedUIDs = new Set();
    Object.values(window.teamAssignments[event.id] || {}).forEach(teamArr => {
        if (Array.isArray(teamArr)) {
            teamArr.forEach(p => { if (p && p.uid) currentAssignedUIDs.add(String(p.uid)); });
        }
    });

    const freeAgents = allPlayers.filter(a => !currentAssignedUIDs.has(String(a.uid)));
    let picker = document.getElementById('assign-picker-modal');
    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'assign-picker-modal';
        picker.className = 'fixed inset-0 z-[190] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm pointer-events-auto';
        document.body.appendChild(picker);
    }

    picker.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white pointer-events-auto">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h4 class="text-xs font-black uppercase text-white">Add Player to Team</h4>
                <button onclick="document.getElementById('assign-picker-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                ${freeAgents.map(a => {
                    const aAvatar = resolvePlayerAvatar(a, event.attendees);
                    return `
                        <div onclick="document.getElementById('assign-picker-modal')?.remove(); window.assignPlayerToSlot('${event.id}', ${teamIndex}, null, '${a.uid}')" class="flex items-center gap-3 p-2.5 bg-black/40 hover:bg-black border border-white/10 rounded-xl cursor-pointer transition">
                            <img src="${aAvatar}" class="w-7 h-7 rounded-full object-cover" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                            <span class="text-xs font-bold text-white">${a.name}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
};

window.promptRemoveOrChangeSlot = function(eventId, teamIndex, slotIndex, playerName) {
    let modal = document.getElementById('slot-action-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'slot-action-modal';
        modal.className = 'fixed inset-0 z-[190] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm pointer-events-auto';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white text-center pointer-events-auto">
            <h3 class="text-sm font-black uppercase text-white">Position: ${playerName}</h3>
            <div class="space-y-2.5 pt-2">
                <button onclick="document.getElementById('slot-action-modal').remove(); window.unassignPlayerFromSlot('${eventId}', ${teamIndex}, ${slotIndex})" class="w-full bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 font-black py-3 rounded-xl text-xs shadow transition">
                    Remove Player
                </button>
                <button onclick="document.getElementById('slot-action-modal').remove(); window.openAssignPicker('${eventId}', ${teamIndex}, ${slotIndex})" class="w-full bg-[#00F296] text-slate-950 font-bold py-3 rounded-xl text-xs transition">
                    Change Player
                </button>
                <button onclick="document.getElementById('slot-action-modal').remove()" class="w-full bg-transparent text-white/40 hover:text-white py-2 text-xs">
                    Cancel
                </button>
            </div>
        </div>
    `;
};

window.assignPlayerToSlot = async function(eventId, teamIndex, slotIndex, uid) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId) || window.currentTeamBuildingEvent;
    if (!event) return;
    const allPlayers = getFlattenedPlayersList(event.attendees);
    const player = allPlayers.find(a => String(a.uid) === String(uid));
    if (!player) return;

    window.teamAssignments[event.id] = event.teamAssignments || {};
    window.teamAssignments[event.id][teamIndex] = (window.teamAssignments[event.id][teamIndex] || []).filter(p => p && p.uid);

    if (slotIndex !== null && slotIndex !== 'null') {
        window.teamAssignments[event.id][teamIndex][slotIndex] = player;
    } else {
        if (!window.teamAssignments[event.id][teamIndex].some(p => p && String(p.uid) === String(uid))) {
            window.teamAssignments[event.id][teamIndex].push(player);
        }
    }

    event.teamAssignments = window.teamAssignments[event.id];
    try {
        await updateTeamToolFirestore(event);
        window.openTeamMakingModal(event.id);
    } catch (err) {
        console.error("Failed to assign player:", err);
    }
};

window.unassignPlayerFromSlot = async function(eventId, teamIndex, slotIndex) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId) || window.currentTeamBuildingEvent;
    if (!event) return;
    if (!window.teamAssignments[event.id] || !window.teamAssignments[event.id][teamIndex]) return;

    window.teamAssignments[event.id][teamIndex][slotIndex] = null;
    window.teamAssignments[event.id][teamIndex] = window.teamAssignments[event.id][teamIndex].filter(p => p && p.uid);
    event.teamAssignments = window.teamAssignments[event.id];
    try {
        await updateTeamToolFirestore(event);
        window.openTeamMakingModal(event.id);
    } catch (err) {
        console.error("Failed to unassign player:", err);
    }
};

window.unassignPlayerFromTeamSlot = async function(eventId, teamIndex, uid) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId) || window.currentTeamBuildingEvent;
    if (!event) return;
    if (!window.teamAssignments[event.id] || !window.teamAssignments[event.id][teamIndex]) return;

    window.teamAssignments[event.id][teamIndex] = window.teamAssignments[event.id][teamIndex].filter(p => p && p.uid && String(p.uid) !== String(uid));
    event.teamAssignments = window.teamAssignments[event.id];
    try {
        await updateTeamToolFirestore(event);
        window.openTeamMakingModal(event.id);
    } catch (err) {
        console.error("Failed to remove player from team:", err);
    }
};