// js/game-profile/team-tool.js: Full Team Builder & Lineup Tool rendered as a dedicated overlay modal view with robust avatar resolution
import { db, appId } from '../firebase-config.js';
import { mutateEvent, escapeHtml, safeAvatar, jsArg } from './event-store.js';
import './draft-replay.js';

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

    event.teamAssignments = window.teamAssignments[event.id] || event.teamAssignments || {};
    event.teamNames = window.teamNames[event.id] || event.teamNames || {};
    event.teamColors = window.teamColors[event.id] || event.teamColors || {};
    event.teamCaptains = window.teamCaptains[event.id] || event.teamCaptains || {};
    event.teamFormations = window.teamFormations[event.id] || event.teamFormations || {};

    // Only the team fields are written, on top of the freshest copy of the game, so joins,
    // goals and comments made by other people in the meantime are never overwritten.
    const teamFields = {};
    ['teamAssignments', 'teamNames', 'teamColors', 'teamCaptains', 'teamFormations'].forEach(k => {
        teamFields[k] = JSON.parse(JSON.stringify(event[k] || {}));
    });
    // Players are stored without photos (the avatar is looked up from the directory when drawn).
    Object.keys(teamFields.teamAssignments).forEach(k => {
        const arr = teamFields.teamAssignments[k];
        if (Array.isArray(arr)) arr.forEach(p => { if (p && !safeAvatar(p.avatar)) delete p.avatar; });
    });

    const res = await mutateEvent(event.id, (draft) => { Object.assign(draft, teamFields); });
    if (res.ok) window.dispatchEvent(new CustomEvent('eventsDataUpdated', { detail: { eventId: event.id } }));
}

// How many spots the pitch has for a team (players past that are on the bench).
function pitchSlotCount(event, teamIndex) {
    const saved = (window.teamFormations[event.id] || {})[teamIndex] ?? (event.teamFormations || {})[teamIndex] ?? (event.teamFormations || {})[String(teamIndex)];
    const parts = String(saved || '').split('-').map(n => parseInt(n, 10)).filter(n => n > 0);
    if (parts.length) return parts.reduce((a, b) => a + b, 0) + 1;   // + goalkeeper
    return parseInt(event.format, 10) || 8;
}

// The captain stops being captain when he leaves that team.
function dropCaptainIfGone(eventId, teamIndex) {
    const caps = window.teamCaptains[eventId];
    if (!caps) return;
    const roster = (window.teamAssignments[eventId] || {})[teamIndex] || [];
    const cap = caps[teamIndex] ?? caps[String(teamIndex)];
    if (cap && !roster.some(p => p && String(p.uid) === String(cap))) { delete caps[teamIndex]; delete caps[String(teamIndex)]; }
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

/**
 * Players the captain/admin can put in the formation: everyone going (and their guests), plus the
 * waitlist as SUBS. Subs can be moved in and out of a team; their goals count in the stats like anyone's.
 * (Auto-make teams only uses the players who are going.)
 */
function availablePlayers(event) {
    const list = getFlattenedPlayersList(event.attendees);
    const have = new Set(list.map(p => String(p.uid)));
    (event.waitingList || []).forEach(w => {
        const uid = String(w?.uid || '');
        if (!uid || have.has(uid)) return;
        have.add(uid);
        list.push({
            uid, name: String(w?.name || 'Player'),
            avatar: resolvePlayerAvatar(w, event.attendees),
            position: String(w?.position || 'Player'),
            isSub: true
        });
    });
    return list;
}
const subTag = (p) => (p && p.isSub) ? '<span class="text-[8px] font-black text-amber-300 bg-amber-400/15 border border-amber-400/40 rounded px-1 py-0.5 ml-1">SUB</span>' : '';

// ------------------------------------------------------------------ who may change what
// Admins (organizer / community admins): everything, including Build Teams.
// A team's captain: add / remove players and set positions on THEIR team only (no randomize).
// While a captains draft is running, captains pick through Caps mode instead.
const meUid = () => String(window.currentUser?.uid || '');
function isTeamAdmin(event) {
    const u = meUid();
    return !!u && !!event && (String(event.organizerId) === u || (event.communityId && (window.myCommunityRoles || {})[event.communityId] === 'admin'));
}
function captainOf(event, i) {
    const c = (window.teamCaptains && window.teamCaptains[event.id]) || event.teamCaptains || {};
    return String(c[i] ?? c[String(i)] ?? '');
}
function canEditTeam(event, i) {
    if (isTeamAdmin(event)) return true;
    const u = meUid();
    if (!u || captainOf(event, i) !== u) return false;
    return !(event.capsDraft && event.capsDraft.status === 'live');
}
const noPermission = () => window.showToast && window.showToast("Only an admin or this team's captain can change this team.", 'error');

const FORMATIONS = {
    '3v3': { '2-1': [2, 1], '1-2': [1, 2] },
    '4v4': { '2-1': [2, 1] },
    '5v5': { '2-1-1': [2, 1, 1], '2-2': [2, 2] },
    '7v7': { '3-2-1': [3, 2, 1], '3-1-2': [3, 1, 2], '2-2-2': [2, 2, 2] },
    '8v8': { '3-3-1': [3, 3, 1], '3-2-2': [3, 2, 2], '2-3-2': [2, 3, 2] },
    '9v9': { '3-3-2': [3, 3, 2], '4-3-1': [4, 3, 1], '3-2-3': [3, 2, 3] },
    '10v10': { '4-3-2': [4, 3, 2], '3-4-2': [3, 4, 2], '4-4-1': [4, 4, 1] },
    '11v11': { '4-4-2': [4, 4, 2], '4-3-3': [4, 3, 3], '5-3-2': [5, 3, 2] }
};
function formationRows(event, teamIdx) {
    const fmts = FORMATIONS[event.format || '7v7'] || { '3-3-1': [3, 3, 1] };
    const key = ((window.teamFormations || {})[event.id] || {})[teamIdx] ?? (event.teamFormations || {})[teamIdx] ?? (event.teamFormations || {})[String(teamIdx)];
    return fmts[key] || Object.values(fmts)[0];
}
/** Position name of every spot on a team's pitch, in the same order the pitch is drawn (forwards first, keeper last). */
function slotLabels(event, teamIdx) {
    const rows = [...formationRows(event, teamIdx)].reverse();
    const out = [];
    rows.forEach((n, r) => { for (let c = 0; c < n; c++) out.push(r === 0 ? 'FWD' : (r === rows.length - 1 ? 'DEF' : 'MID')); });
    out.push('GK');
    return out;
}

window.openTeamMakingModal = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId) || window.currentTeamBuildingEvent;
    if (!event) {
        if (typeof window.showToast === 'function') window.showToast("Event data not found.", "error");
        return;
    }

    window.activeModalEventId = event.id;
    window.activeTeamTab = window.activeTeamTab !== undefined ? window.activeTeamTab : 0;
    if (!document.getElementById('standalone-team-builder-modal') && event.capsDraft && event.capsDraft.status === 'live') window.activeTeamTab = -1;
    window.currentTeamBuildingEvent = event;

    window.teamAssignments[event.id] = event.teamAssignments || {};
    window.teamNames[event.id] = event.teamNames || {};
    window.teamColors[event.id] = event.teamColors || {};
    window.teamCaptains[event.id] = event.teamCaptains || {};
    if (event.teamFormations) window.teamFormations[event.id] = { ...event.teamFormations, ...(window.teamFormations[event.id] || {}) };

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
    const evCheck = (window.eventsList || []).find(ev => ev.id === eventId);
    if (evCheck && !canEditTeam(evCheck, teamIndex)) { noPermission(); return; }
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
    if (!isTeamAdmin(event)) return;

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
    if (!isTeamAdmin(event)) { window.showToast && window.showToast('Only an admin can build the teams.', 'error'); return; }

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

    const formationOptions = FORMATIONS;
    const admin = isTeamAdmin(event);
    const caps = event.capsDraft && (event.capsDraft.status === 'live' || event.capsDraft.status === 'done') ? event.capsDraft : null;

    const availableFormations = formationOptions[format] || { '3-3-1': [3, 3, 1] };
    const defaultFormatKey = Object.keys(availableFormations)[0];

    window.teamFormations[event.id] = window.teamFormations[event.id] || {};
    window.teamColors[event.id] = window.teamColors[event.id] || {};
    window.teamCaptains[event.id] = window.teamCaptains[event.id] || {};
    let activeTab = window.activeTeamTab || 0;
    if (activeTab === -1 && !caps) activeTab = 0;

    window.teamAssignments[event.id] = window.teamAssignments[event.id] || {};
    for (let i = 0; i < teamsCount; i++) {
        window.teamAssignments[event.id][i] = (window.teamAssignments[event.id][i] || []).filter(p => p && p.uid).map(p => {
            const freshAvatar = resolvePlayerAvatar(p, event.attendees);
            return { ...p, avatar: freshAvatar };
        });
    }
    window.teamNames[event.id] = window.teamNames[event.id] || {};

    const allPlayers = availablePlayers(event);
    const currentAssignedUIDs = new Set();
    Object.values(window.teamAssignments[event.id]).forEach(teamArr => {
        if (Array.isArray(teamArr)) {
            teamArr.forEach(p => { if (p && p.uid) currentAssignedUIDs.add(String(p.uid)); });
        }
    });

    const freeAgents = allPlayers.filter(a => !currentAssignedUIDs.has(String(a.uid)));

    let tabsHtml = caps ? `
        <button data-action="switch-team-tab" data-team-index="-1" class="px-4 py-2.5 rounded-2xl text-xs font-black transition shrink-0 flex items-center gap-1.5 ${activeTab === -1 ? 'bg-[#00F296] text-slate-950 shadow-md' : 'bg-black/60 text-white/80 border border-amber-400/60'}">
            ${CAP_ICON('w-4 h-4')} Caps mode${caps.status === 'live' ? ' <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>' : ''}
        </button>` : '';
    tabsHtml += `
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
                <span class="inline-block w-3 h-3 rounded-full mr-1.5 align-middle border border-white/40" style="background-color: ${rawColor};"></span> ${escapeHtml(tName)}
            </button>
        `;
    }

    let contentHtml = '';

    if (activeTab === -1) {
        contentHtml = renderCapsTab(event, freeAgents);
    } else if (activeTab === 0) {
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
                            <span class="font-bold text-white">${escapeHtml(pName)} ${isCap ? CAP_BADGE : ''}</span>
                            ${canEditTeam(event, i) ? `<button data-action="unassign-team-slot" data-event-id="${event.id}" data-team-index="${i}" data-uid="${pUid}" class="text-white/40 hover:text-red-400 ml-1"><i class="fa-solid fa-xmark"></i></button>` : ''}
                        </div>
                    `;
                }).join('');

            teamsSummaryHtml += `
                <div class="bg-[#040E13]/95 border-2 rounded-3xl p-5 space-y-4 shadow-xl flex flex-col justify-between" style="border-color: ${tColor}66;">
                    <div class="space-y-3">
                        <div class="flex items-center justify-between border-b border-white/10 pb-2.5">
                            <div class="flex items-center gap-2.5">
                                <span class="w-3.5 h-3.5 rounded-full border border-white/40" style="background-color: ${rawColor};"></span>
                                <h4 class="text-xs font-black uppercase tracking-wider" style="color: ${tColor};">${escapeHtml(tName)} (${teamRoster.length})</h4>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-2.5">
                            ${rosterPillsHtml}
                        </div>
                    </div>
                    ${canEditTeam(event, i) ? `<div class="pt-3 border-t border-white/10">
                        <button data-action="open-assign-picker" data-event-id="${event.id}" data-team-index="${i}" data-slot-index="null" class="w-full bg-[#00F296]/20 hover:bg-[#00F296]/30 text-[#00F296] font-black py-3 px-4 rounded-2xl text-xs border border-[#00F296]/50 transition flex items-center justify-center gap-2 shadow">
                            <i class="fa-solid fa-user-plus"></i> + Add Player to ${escapeHtml(tName)}
                        </button>
                    </div>` : ''}
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
                        <span class="font-bold text-white">${escapeHtml(aName)}</span>${subTag(a)}
                    </div>
                `;
            }).join('');

        contentHtml = `
            <div class="space-y-5 pb-10">
                <button onclick="window.openTeamCard('${jsArg(event.id)}')" class="w-full bg-black/60 border border-white/20 hover:border-[#00F296]/60 text-white font-black py-3 rounded-2xl text-xs flex items-center justify-center gap-2"><i class="fa-solid fa-camera pointer-events-none"></i> Share the teams (team card)</button>
                <div class="bg-[#040E13]/95 border border-amber-500/40 rounded-3xl p-5 space-y-3 shadow-xl">
                    <h4 class="text-xs font-black text-amber-400 uppercase tracking-wider">⏳ Free Agents (${freeAgents.length})</h4>
                    ${(event.waitingList || []).length ? '<p class="text-[10px] text-white/50">Players marked SUB are on the waitlist: add them to a team to sub in. Their goals count.</p>' : ''}
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
        const canEdit = canEditTeam(event, teamIdx);
        
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
                        <div ${canEdit ? `data-action="prompt-remove-slot"` : ''} data-event-id="${event.id}" data-team-index="${teamIdx}" data-slot-index="${slotIdx}" data-player-name="${escapeHtml(p.name || '')}" class="flex-1 min-w-0 max-w-[7rem] h-10 bg-black/90 border-2 rounded-full px-2 text-center cursor-pointer shadow-lg flex items-center gap-1.5 relative group transition hover:scale-105" style="border-color: ${currentAccent};">
                            <img src="${pAvatar}" class="w-6 h-6 rounded-full object-cover border border-white/20 shrink-0" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                            <div class="truncate text-left leading-tight pointer-events-none">
                                <span class="text-[6px] font-black uppercase block tracking-wider" style="color: ${currentAccent};">${positionName}</span>
                                <span class="text-[9px] font-black text-white truncate block">${escapeHtml(p.name)}</span>
                            </div>
                        </div>
                    `;
                } else {
                    rowSlots += `
                        <div ${canEdit ? `data-action="open-assign-picker"` : ''} data-event-id="${event.id}" data-team-index="${teamIdx}" data-slot-index="${slotIdx}" class="flex-1 min-w-0 max-w-[7rem] h-10 bg-black/60 border-2 border-dashed rounded-full px-2 text-center cursor-pointer hover:bg-black/80 transition flex items-center justify-center gap-1.5 shadow" style="border-color: ${currentAccent};">
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
                    <div ${canEdit ? `data-action="prompt-remove-slot"` : ''} data-event-id="${event.id}" data-team-index="${teamIdx}" data-slot-index="${goalieSlotIdx}" data-player-name="${escapeHtml(goaliePlayer.name || '')}" class="w-28 h-10 bg-black/90 border-2 rounded-full px-2 text-center cursor-pointer shadow-lg flex items-center gap-1.5 transition hover:scale-105" style="border-color: ${currentAccent};">
                        <img src="${gAvatar}" class="w-6 h-6 rounded-full object-cover border border-white/20 shrink-0" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                        <div class="truncate text-left leading-tight pointer-events-none">
                            <span class="text-[6px] font-black uppercase block tracking-wider text-amber-400">GK</span>
                            <span class="text-[9px] font-black text-white truncate block">${escapeHtml(goaliePlayer.name)}</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            rowsHtml += `
                <div class="flex justify-center mt-3">
                    <div ${canEdit ? `data-action="open-assign-picker"` : ''} data-event-id="${event.id}" data-team-index="${teamIdx}" data-slot-index="${goalieSlotIdx}" class="w-28 h-10 border-2 border-dashed bg-black/60 rounded-full px-2 text-center cursor-pointer shadow-lg flex items-center justify-center gap-1.5 transition hover:scale-105" style="border-color: ${currentAccent};">
                        <i class="fa-solid fa-hand text-amber-300 text-sm ml-2 pointer-events-none"></i>
                        <span class="text-[10px] font-black uppercase text-amber-300 tracking-wider ml-1 pointer-events-none">GK</span>
                    </div>
                </div>
            `;
        }

        const captainOptionsHtml = currentTeamPlayers.filter(p => p && p.name).map(p => `<option value="${p.uid}" ${p.uid === currentCaptainUid ? 'selected' : ''}>⭐ ${escapeHtml(p.name)}</option>`).join('');
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
                                <div class="font-bold text-white">${escapeHtml(pName)} ${isCap ? CAP_BADGE + ' <span class="text-[10px] text-amber-300">Captain</span>' : ''}</div>
                                <div class="text-[10px] text-white/50">${pPos}</div>
                            </div>
                        </div>
                        ${canEdit ? `<button data-action="unassign-team-slot" data-event-id="${event.id}" data-team-index="${teamIdx}" data-uid="${pUid}" class="text-red-400 hover:text-red-300 font-bold px-3 py-1.5 rounded-xl text-xs bg-red-500/10 border border-red-500/30 transition">Remove</button>` : ''}
                    </div>
                `;
            }).join('');

        contentHtml = `
            <div class="space-y-5 pb-16">
                ${!admin ? `<div class="bg-[#040E13]/95 border border-white/10 p-3 rounded-3xl shadow-xl flex items-center gap-3">
                    <span class="w-6 h-6 rounded-full border-2 border-white/60 shrink-0" style="background-color: ${currentTeamColor};"></span>
                    <div class="flex-1 min-w-0"><div class="text-sm font-black text-white truncate">${escapeHtml(currentTeamName)}</div>
                        <div class="text-[10px] text-white/60 truncate">Captain: ${escapeHtml((currentTeamPlayers.find(p => String(p.uid) === String(currentCaptainUid)) || {}).name || 'None')}</div></div>
                    ${canEdit ? '<span class="text-[9px] font-black uppercase text-amber-300 bg-amber-400/15 border border-amber-400/40 rounded-full px-2 py-1">You can edit</span>' : ''}
                </div>` : `<div class="bg-[#040E13]/95 border border-white/10 p-3 rounded-3xl shadow-xl">
                    <div class="flex items-end gap-2">
                        <div class="flex-1 min-w-0 space-y-1">
                            <label class="block text-[9px] font-bold text-white/60 uppercase">Team</label>
                            <div class="flex items-center gap-1">
                                <input type="text" id="team-name-input-${teamIdx}" value="${escapeHtml(currentTeamName)}" class="flex-1 min-w-0 bg-black/80 border border-white/20 rounded-xl px-2.5 py-2 text-xs font-bold text-white focus:outline-none focus:border-[#00F296]">
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
                </div>`}

                <div class="relative border-2 rounded-3xl p-3 shadow-2xl overflow-hidden min-h-[440px] flex flex-col justify-between bg-[#03140C]" style="background-image: url('img/TeamBuildField.png'); background-size: cover; background-position: center; border-color: ${currentAccent};">
                    <div class="absolute inset-0 bg-black/50 pointer-events-none"></div>

                    <div class="flex justify-between items-center relative z-10">
                        <span class="font-black text-xs px-3 py-1.5 rounded-2xl uppercase tracking-wider shadow-lg border border-white/30" style="background-color: ${currentTeamColor}; color: ${window.teamTextOn(currentTeamColor)};">${escapeHtml(currentTeamName)}</span>
                        <select id="team-formation-select-${teamIdx}" ${canEdit ? '' : 'disabled'} data-action="change-team-formation" data-event-id="${event.id}" data-team-index="${teamIdx}" class="bg-black/90 text-white font-bold text-xs px-4 py-2 rounded-2xl border border-white/20 shadow-md">
                            ${formationsOptionsHtml}
                        </select>
                    </div>

                    <div class="relative z-10 my-4 flex flex-col items-center justify-center w-full">
                        ${rowsHtml}
                    </div>

                    <div class="text-center relative z-10 text-[10px] text-white/80 font-semibold bg-black/60 py-2 rounded-xl">
                        ${canEdit ? 'Tap any position on the pitch to assign or remove players' : 'Only an admin or this team\'s captain can change the lineup'}
                    </div>
                </div>

                <div class="bg-[#040E13]/95 border border-white/10 rounded-3xl p-5 space-y-4 shadow-xl">
                    <div class="flex justify-between items-center">
                        <h4 class="text-xs font-black text-white/80 uppercase tracking-wider">Squad Members (${currentTeamPlayers.length})</h4>
                    </div>
                    <div class="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                        ${squadMembersListHtml}
                    </div>
                    ${canEdit ? `<div class="pt-2">
                        <button data-action="open-assign-picker" data-event-id="${event.id}" data-team-index="${teamIdx}" data-slot-index="null" class="w-full bg-[#00F296]/20 hover:bg-[#00F296]/30 text-[#00F296] font-black py-3 px-4 rounded-2xl text-xs border border-[#00F296]/50 transition flex items-center justify-center gap-2 shadow">
                            <i class="fa-solid fa-user-plus pointer-events-none"></i> + Add Player to ${escapeHtml(currentTeamName)}
                        </button>
                    </div>` : ''}
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
                ${admin ? `<div>
                    <button data-action="build-teams" data-event-id="${event.id}" class="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black px-3 py-1.5 rounded-xl text-[11px] shadow-md transition flex items-center gap-1.5">
                        <i class="fa-solid fa-people-group text-xs pointer-events-none"></i> Build Teams
                    </button>
                </div>` : ''}
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
    } else if (action === 'build-teams') {
        window.openBuildTeams(eventId);
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
    if (!canEditTeam(event, teamIndex)) { noPermission(); return; }

    window.teamAssignments[event.id] = event.teamAssignments || {};
    const teamRoster = (window.teamAssignments[event.id][teamIndex] || []).filter(p => p && p.uid);
    const allPlayers = availablePlayers(event);

    if (slotIndex !== null && slotIndex !== 'null') {
        // Players on the pitch = the first N of the team (N = spots in the formation); the rest are on the bench.
        const slots = pitchSlotCount(event, teamIndex);
        const assignedPitchUIDs = new Set();
        teamRoster.slice(0, slots).forEach((player, i) => {
            if (i !== slotIndex) assignedPitchUIDs.add(String(player.uid));
        });

        const unplacedPitchPlayers = teamRoster.filter((p, i) => !assignedPitchUIDs.has(String(p.uid)) && i !== slotIndex);
        
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
                                        <span class="text-xs font-bold text-white">${escapeHtml(p.name)} (Move)</span>
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
                                <span class="text-xs font-bold text-white">${escapeHtml(p.name)}</span>
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
                            <span class="text-xs font-bold text-white">${escapeHtml(a.name)}</span>${subTag(a)}
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
            <h3 class="text-sm font-black uppercase text-white">Position: ${escapeHtml(playerName)}</h3>
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
    if (!canEditTeam(event, teamIndex)) { noPermission(); return; }
    const allPlayers = availablePlayers(event);
    const player = allPlayers.find(a => String(a.uid) === String(uid));
    if (!player) return;

    window.teamAssignments[event.id] = event.teamAssignments || {};
    const all = window.teamAssignments[event.id];
    const same = (p) => p && String(p.uid) === String(uid);
    let arr = (all[teamIndex] || []).filter(p => p && p.uid);
    const oldIdx = arr.findIndex(same);

    // A player is only ever on one team, once (before, moving someone could add him twice).
    Object.keys(all).forEach(k => {
        if (String(k) !== String(teamIndex) && Array.isArray(all[k]) && all[k].some(same)) {
            all[k] = all[k].filter(p => p && p.uid && !same(p));
            dropCaptainIfGone(event.id, k);
        }
    });

    if (slotIndex !== null && slotIndex !== 'null') {
        if (oldIdx !== -1) {
            if (slotIndex < arr.length) { const t = arr[slotIndex]; arr[slotIndex] = arr[oldIdx]; arr[oldIdx] = t; }   // swap spots
            else { arr.splice(oldIdx, 1); arr.push(player); }
        } else if (slotIndex < arr.length) {
            const displaced = arr[slotIndex];
            arr[slotIndex] = player;
            arr.push(displaced);   // the player who had that spot goes to the bench
        } else {
            arr.push(player);
        }
    } else if (oldIdx === -1) {
        arr.push(player);
    }
    all[teamIndex] = arr;

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
    if (!canEditTeam(event, teamIndex)) { noPermission(); return; }
    if (!window.teamAssignments[event.id] || !window.teamAssignments[event.id][teamIndex]) return;

    window.teamAssignments[event.id][teamIndex][slotIndex] = null;
    window.teamAssignments[event.id][teamIndex] = window.teamAssignments[event.id][teamIndex].filter(p => p && p.uid);
    dropCaptainIfGone(event.id, teamIndex);
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
    if (!canEditTeam(event, teamIndex)) { noPermission(); return; }
    if (!window.teamAssignments[event.id] || !window.teamAssignments[event.id][teamIndex]) return;

    window.teamAssignments[event.id][teamIndex] = window.teamAssignments[event.id][teamIndex].filter(p => p && p.uid && String(p.uid) !== String(uid));
    dropCaptainIfGone(event.id, teamIndex);
    event.teamAssignments = window.teamAssignments[event.id];
    try {
        await updateTeamToolFirestore(event);
        window.openTeamMakingModal(event.id);
    } catch (err) {
        console.error("Failed to remove player from team:", err);
    }
};
// =================================================================== Build Teams + Caps mode (captains draft)
// event.capsDraft = {
//   mode: 'turns' (one captain at a time) | 'open' (any captain, any time),
//   status: 'live' | 'done', order: [team index, ...] (pick order), turnIdx (position in order), turnTeam,
//   picks: [{ team, uid, name, by, at }], startedAt, startedBy
// }
// The players a captain picks go into teamAssignments like any team; `slot` on a player = the spot on the
// pitch chosen with "Pick position" (Build line up puts everyone in their spot).
const CAP_ICON = (cls = 'w-6 h-6') => `<svg viewBox="0 0 64 64" class="${cls} inline-block shrink-0" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linejoin="round" aria-hidden="true"><ellipse cx="32" cy="19" rx="25" ry="7"/><path d="M7 19v23c0 4 11 7.5 25 7.5s25-3.5 25-7.5V19"/><path d="M39 30.5a7.5 7.5 0 1 0 0 10" stroke-linecap="round"/></svg>`;
const CAP_BADGE = '<span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-slate-950 text-[9px] font-black align-middle" title="Captain">C</span>';
const AV_FALLBACK = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
const findEvent = (id) => (window.eventsList || []).find(ev => ev.id === id) || window.currentTeamBuildingEvent;
const teamList = (ta, i) => ((ta || {})[i] ?? (ta || {})[String(i)] ?? []).filter(p => p && p.uid);
const shuffled = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const toast = (m, t) => window.showToast && window.showToast(m, t);
const playerRecord = (p) => {
    const r = { uid: String(p.uid), name: p.name || 'Player', position: p.position || 'Player' };
    if (p.isHostGuest) { r.isHostGuest = true; r.hostUid = p.hostUid || ''; }
    if (safeAvatar(p.avatar)) r.avatar = p.avatar;
    return r;
};
/** Players going (and their guests) who aren't on a team yet. */
function draftPool(event, ta) {
    const taken = new Set();
    Object.values(ta || {}).forEach(arr => (arr || []).forEach(p => { if (p && p.uid) taken.add(String(p.uid)); }));
    return getFlattenedPlayersList(event.attendees).filter(p => !taken.has(String(p.uid)));
}
/** Most players a team can have so teams stay even. */
function teamCap(event) {
    const n = getFlattenedPlayersList(event.attendees).length;
    return Math.max(1, Math.ceil(n / (event.teamsCount || 3)));
}
/** Whose turn it is (one captain at a time): next team in the order that still has room. */
function turnTeamOf(event, d, ta) {
    if (!d || d.mode !== 'turns' || !Array.isArray(d.order) || !d.order.length) return null;
    const cap = teamCap(event);
    // A team that lost a player (they cancelled) picks next, then the normal order goes on.
    const owed = (d.priority || []).find(t => teamList(ta, t).length < cap);
    if (owed !== undefined) return owed;
    for (let k = 0; k < d.order.length; k++) {
        const t = d.order[((d.turnIdx || 0) + k) % d.order.length];
        if (teamList(ta, t).length < cap) return t;
    }
    return null;
}
/** Team I may pick for right now (null = not my turn / not a captain). Admins pick for the team on the clock. */
function myPickTeam(event) {
    const d = event.capsDraft;
    if (!d || d.status !== 'live') return null;
    const ta = event.teamAssignments || {};
    const u = meUid();
    const count = event.teamsCount || 3;
    if (d.mode === 'turns') {
        const t = turnTeamOf(event, d, ta);
        if (t === null) return null;
        return (captainOf(event, t) === u || isTeamAdmin(event)) ? t : null;
    }
    for (let i = 0; i < count; i++) if (captainOf(event, i) === u && teamList(ta, i).length < teamCap(event)) return i;
    return isTeamAdmin(event) ? 'any' : null;
}
/** Kickoff in ms from the game's date + time (local clock), or 0. */
function gameStartMs(ev) {
    const date = String(ev?.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
    const m = String(ev?.time || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    let h = m ? parseInt(m[1], 10) : 0; const mi = m ? parseInt(m[2], 10) : 0; const ap = m && m[3] ? m[3].toUpperCase() : '';
    if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0;
    const [y, mo, d] = date.split('-').map(Number);
    return new Date(y, mo - 1, d, h, mi, 0).getTime();
}
const capsLink = (eventId) => `https://futnet.site/#event=${encodeURIComponent(eventId)}&caps=1`;

// ---------------------------------------------------------------- Build Teams: Randomize or Captains
window.openBuildTeams = function(eventId) {
    const event = findEvent(eventId);
    if (!event || !isTeamAdmin(event)) return;
    const live = event.capsDraft && event.capsDraft.status === 'live';
    let m = document.getElementById('randomize-options-modal');
    if (!m) { m = document.createElement('div'); m.id = 'randomize-options-modal'; m.className = 'fixed inset-0 z-[190] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm pointer-events-auto'; document.body.appendChild(m); }
    m.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white text-center pointer-events-auto">
            <h3 class="text-sm font-black uppercase text-white">Build Teams</h3>
            <p class="text-[11px] text-white/60">How do you want to make the teams?</p>
            <div class="grid grid-cols-2 gap-3 pt-1">
                <button onclick="document.getElementById('randomize-options-modal').remove(); window.promptRandomizeOptions('${eventId}')" class="bg-black/60 hover:bg-black border border-[#00F296]/50 rounded-2xl py-5 flex flex-col items-center gap-2 transition">
                    <i class="fa-solid fa-shuffle text-2xl text-[#00F296]"></i><span class="text-xs font-black">Randomize</span></button>
                <button onclick="window.openCapsSetup('${eventId}')" class="bg-black/60 hover:bg-black border border-amber-400/60 rounded-2xl py-5 flex flex-col items-center gap-2 transition text-amber-300">
                    ${CAP_ICON('w-8 h-8')}<span class="text-xs font-black text-white">Captains</span></button>
            </div>
            ${live ? '<p class="text-[10px] text-amber-300">A captains draft is running. Starting a new one replaces it.</p>' : ''}
            <button onclick="document.getElementById('randomize-options-modal').remove()" class="w-full text-white/40 hover:text-white py-1 text-xs">Cancel</button>
        </div>`;
};

window.openCapsSetup = function(eventId) {
    const event = findEvent(eventId);
    if (!event || !isTeamAdmin(event)) return;
    window._capsSetup = { eventId, mode: 'turns', capWho: 'random', firstWho: 'random', caps: {}, first: 0 };
    renderCapsSetup();
};

function renderCapsSetup() {
    const st = window._capsSetup; if (!st) return;
    const event = findEvent(st.eventId); if (!event) return;
    const count = event.teamsCount || 3;
    const names = window.getTeamNames(event), colors = window.getTeamColors(event);
    const players = getFlattenedPlayersList(event.attendees).filter(p => !p.isHostGuest);
    const hasTeams = Object.values(event.teamAssignments || {}).some(a => (a || []).some(p => p && p.uid));
    const chip = (on, label, onclick) => `<button onclick="${onclick}" class="flex-1 py-2 px-2 rounded-xl text-[11px] font-black transition ${on ? 'bg-[#00F296] text-slate-950' : 'bg-black/60 text-white/70 border border-white/15'}">${label}</button>`;
    const label = (t) => `<div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] text-left">${t}</div>`;
    const dot = (i) => `<span class="w-3 h-3 rounded-full border border-white/40 shrink-0" style="background:${colors[i]}"></span>`;
    let m = document.getElementById('randomize-options-modal');
    if (!m) { m = document.createElement('div'); m.id = 'randomize-options-modal'; m.className = 'fixed inset-0 z-[190] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm pointer-events-auto'; document.body.appendChild(m); }
    m.innerHTML = `
        <div class="bg-[#040E13] border border-amber-400/50 rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl text-white pointer-events-auto max-h-[92vh] overflow-y-auto">
            <div class="flex items-center gap-2 border-b border-white/10 pb-3 text-amber-300">${CAP_ICON('w-6 h-6')}<h3 class="text-sm font-black uppercase text-white flex-1">Captains pick the teams</h3>
                <button onclick="document.getElementById('randomize-options-modal').remove()" class="text-white/50 hover:text-white"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="space-y-2">${label("Who's captain?")}
                <div class="flex gap-2">${chip(st.capWho === 'me', "I'll choose", "window._capsSetup.capWho='me';window.renderCapsSetupUI()")}${chip(st.capWho === 'random', 'Random', "window._capsSetup.capWho='random';window.renderCapsSetupUI()")}</div>
                ${st.capWho === 'me' ? Array.from({ length: count }, (_, i) => `
                    <label class="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl p-2">${dot(i)}<span class="text-[11px] font-bold w-20 truncate">${escapeHtml(names[i])}</span>
                        <select onchange="window._capsSetup.caps[${i}]=this.value" class="flex-1 min-w-0 bg-black/70 border border-white/20 rounded-lg px-2 py-1.5 text-base sm:text-xs text-white">
                            <option value="">Pick a captain</option>${players.map(p => `<option value="${escapeHtml(p.uid)}" ${String(st.caps[i] || '') === String(p.uid) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                        </select></label>`).join('') : '<p class="text-[10px] text-white/50 text-left">Captains and their team colors are picked at random.</p>'}
            </div>
            <div class="space-y-2">${label('How do they pick?')}
                <div class="flex gap-2">${chip(st.mode === 'turns', 'One captain at a time', "window._capsSetup.mode='turns';window.renderCapsSetupUI()")}${chip(st.mode === 'open', 'Open pick', "window._capsSetup.mode='open';window.renderCapsSetupUI()")}</div>
                <p class="text-[10px] text-white/50 text-left">${st.mode === 'turns' ? 'Captains take turns: one pick each, in order, everyone sees whose turn it is.' : 'Any captain can pick whenever they want until their team is full.'}</p></div>
            ${st.mode === 'turns' ? `<div class="space-y-2">${label('Who picks first?')}
                <div class="flex gap-2">${chip(st.firstWho === 'me', "I'll choose", "window._capsSetup.firstWho='me';window.renderCapsSetupUI()")}${chip(st.firstWho === 'random', 'Random', "window._capsSetup.firstWho='random';window.renderCapsSetupUI()")}</div>
                ${st.firstWho === 'me' ? `<select onchange="window._capsSetup.first=parseInt(this.value,10)" class="w-full bg-black/70 border border-white/20 rounded-lg px-2 py-2 text-base sm:text-xs text-white">${names.map((n, i) => `<option value="${i}" ${st.first === i ? 'selected' : ''}>${escapeHtml(n)} picks first</option>`).join('')}</select>` : ''}</div>` : ''}
            <div class="space-y-2">${label('Time limit')}
                <select onchange="window._capsSetup.deadline=this.value" class="w-full bg-black/70 border border-white/20 rounded-lg px-2 py-2 text-base sm:text-xs text-white">
                    ${[['none', 'No time limit'], ['game', 'Done by game time'], ['1h', 'Done 1 hour before the game'], ['2h', 'Done 2 hours before the game']].map(([k, t]) => `<option value="${k}" ${(st.deadline || 'none') === k ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
                <p class="text-[10px] text-white/50 text-left">If the captains aren't done by then, the players left are put on teams at random.</p></div>
            ${hasTeams ? '<p class="text-[10px] text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded-xl p-2">This clears the current teams. Only the captains start on a team.</p>' : ''}
            <button onclick="window.startCapsDraft()" class="w-full bg-amber-400 hover:bg-amber-500 text-slate-950 font-black py-3 rounded-xl text-xs shadow flex items-center justify-center gap-2">${CAP_ICON('w-4 h-4')} Start Caps mode</button>
        </div>`;
}
window.renderCapsSetupUI = renderCapsSetup;

window.startCapsDraft = async function() {
    const st = window._capsSetup; if (!st) return;
    const event = findEvent(st.eventId); if (!event || !isTeamAdmin(event)) return;
    const count = event.teamsCount || 3;
    const players = getFlattenedPlayersList(event.attendees).filter(p => !p.isHostGuest);
    if (players.length < count) { toast(`You need at least ${count} players on the roster to have ${count} captains.`, 'error'); return; }
    let caps = {};
    if (st.capWho === 'me') {
        for (let i = 0; i < count; i++) if (!st.caps[i]) { toast('Pick a captain for every team.', 'error'); return; }
        const ids = Object.values(st.caps).map(String);
        if (new Set(ids).size !== ids.length) { toast('Each team needs a different captain.', 'error'); return; }
        for (let i = 0; i < count; i++) caps[i] = String(st.caps[i]);
    } else {
        shuffled(players).slice(0, count).forEach((p, i) => { caps[i] = String(p.uid); });
    }
    const first = st.mode === 'turns' ? (st.firstWho === 'me' ? (st.first || 0) : Math.floor(Math.random() * count)) : 0;
    const kickoff = gameStartMs(event);
    const before = { game: 0, '1h': 3600000, '2h': 7200000 }[st.deadline || 'none'];
    let deadlineAt = null;
    if (before !== undefined) {
        if (!kickoff) { toast("This game has no start time, so it can't have a time limit.", 'error'); return; }
        deadlineAt = kickoff - before;
        if (deadlineAt <= Date.now()) { toast('That time has already passed. Pick a later one or no time limit.', 'error'); return; }
    }
    const order = Array.from({ length: count }, (_, k) => (first + k) % count);
    const byUid = Object.fromEntries(players.map(p => [String(p.uid), p]));
    const btn = document.querySelector('#randomize-options-modal button[onclick="window.startCapsDraft()"]'); if (btn) btn.disabled = true;
    const res = await mutateEvent(event.id, (draft) => {
        const ta = {};
        for (let i = 0; i < count; i++) ta[i] = [playerRecord(byUid[caps[i]])];
        draft.teamAssignments = ta;
        draft.teamCaptains = caps;
        draft.capsDraft = { mode: st.mode, status: 'live', order, turnIdx: 0, turnTeam: st.mode === 'turns' ? order[0] : null, picks: [], startedAt: Date.now(), startedBy: meUid(), deadline: st.deadline || 'none', deadlineAt };
    });
    document.getElementById('randomize-options-modal')?.remove();
    if (!res.ok) return;
    window._capsSetup = null;
    window.teamAssignments[event.id] = res.event.teamAssignments;
    window.teamCaptains[event.id] = res.event.teamCaptains;
    window.activeTeamTab = -1;
    window.openTeamMakingModal(event.id);
    toast('Caps mode is live! Captains were notified.');
};

// ---------------------------------------------------------------- the Caps mode tab (everyone can watch)
function renderCapsTab(event) {
    const d = event.capsDraft || {};
    const count = event.teamsCount || 3;
    const names = window.getTeamNames(event), colors = window.getTeamColors(event);
    const ta = event.teamAssignments || {};
    const pool = draftPool(event, ta);
    const admin = isTeamAdmin(event);
    const u = meUid();
    const myTeam = Array.from({ length: count }, (_, i) => i).find(i => captainOf(event, i) === u);
    const turn = turnTeamOf(event, d, ta);
    const canPick = myPickTeam(event) !== null && pool.length > 0;
    const live = d.status === 'live';
    const capName = (i) => (teamList(ta, i).find(p => String(p.uid) === captainOf(event, i)) || {}).name || 'Captain';
    const avatar = (p) => `<img src="${escapeHtml(resolvePlayerAvatar(p, event.attendees))}" class="w-8 h-8 rounded-full object-cover border border-white/20 shrink-0" onerror="this.src='${AV_FALLBACK}'">`;

    let banner;
    if (!live) banner = `<div class="bg-[#00F296]/15 border border-[#00F296]/50 rounded-2xl p-3 text-center text-xs font-black text-[#00F296]">✅ Teams are set and the line ups are built.</div>`;
    else if (!pool.length) banner = `<div class="bg-[#00F296]/15 border border-[#00F296]/50 rounded-2xl p-3 text-center text-xs font-black text-[#00F296]">Everyone's been picked! Tap Build line up.</div>`;
    else if (d.mode === 'turns' && turn !== null) {
        const mine = captainOf(event, turn) === u;
        const makeUp = (d.priority || []).includes(turn);
        banner = `<div class="rounded-2xl p-3 text-center border-2 ${mine ? 'bg-amber-400 text-slate-950 border-amber-300 animate-pulse' : 'bg-black/50 border-white/15 text-white'}">
            <div class="text-[10px] font-black uppercase tracking-wider ${mine ? '' : 'text-white/60'}">Pick ${(d.picks || []).length + 1}${makeUp ? ' · extra pick: a player on this team cancelled' : ''}</div>
            <div class="text-sm font-black">${mine ? "🧢 It's your turn! Pick a player" : `Waiting for ${escapeHtml(capName(turn))} (${escapeHtml(names[turn])}) to pick…`}</div></div>`;
    } else banner = `<div class="bg-black/50 border border-white/15 rounded-2xl p-3 text-center text-xs font-black text-white">🧢 Open pick: captains pick whenever they want.</div>`;

    const orderStrip = d.mode === 'turns' && live ? `<div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">${(d.order || []).map((t, k) => `
        <div class="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-black border ${t === turn ? 'bg-white text-slate-950 border-white' : 'bg-black/50 text-white/70 border-white/15'}">
            <span class="w-2.5 h-2.5 rounded-full border border-black/30" style="background:${colors[t]}"></span>${k + 1}. ${escapeHtml(capName(t))}</div>`).join('<i class="fa-solid fa-chevron-right text-[8px] text-white/30 shrink-0"></i>')}</div>` : '';

    const share = admin && live ? `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2">
        <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">Link for the captains</div>
        <div class="flex gap-2"><input readonly value="${escapeHtml(capsLink(event.id))}" class="flex-1 min-w-0 bg-black/60 border border-white/15 rounded-lg px-2 py-1.5 text-[11px] text-white/80">
            <button data-action="caps-copy-link" data-event-id="${event.id}" class="shrink-0 bg-[#00F296] text-slate-950 font-black text-[11px] px-3 rounded-lg"><i class="fa-solid fa-copy pointer-events-none"></i> Copy</button></div>
        <p class="text-[10px] text-white/50">Captains also get a notification (and another one when it's their turn).</p></div>` : '';

    const teamsHtml = Array.from({ length: count }, (_, i) => {
        const players = teamList(ta, i);
        const labels = slotLabels(event, i);
        return `<div class="bg-[#040E13]/95 border-2 rounded-2xl p-3 space-y-2" style="border-color:${window.teamAccent(colors[i])}66">
            <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full border border-white/40" style="background:${colors[i]}"></span>
                <span class="text-xs font-black uppercase flex-1" style="color:${window.teamAccent(colors[i])}">${escapeHtml(names[i])} (${players.length})</span>
                ${i === myTeam ? '<span class="text-[9px] font-black uppercase bg-amber-400 text-slate-950 rounded-full px-2 py-0.5">Your team</span>' : ''}</div>
            <div class="space-y-1.5">${players.map(p => `<div class="flex items-center gap-2 bg-black/40 rounded-xl px-2 py-1.5">${avatar(p)}
                <span class="text-xs font-bold text-white flex-1 min-w-0 truncate">${escapeHtml(p.name || 'Player')} ${String(p.uid) === captainOf(event, i) ? CAP_BADGE : ''}</span>
                ${Number.isInteger(p.slot) && labels[p.slot] ? `<span class="text-[9px] font-black text-[#00F296] bg-[#00F296]/10 border border-[#00F296]/30 rounded px-1.5 py-0.5">${labels[p.slot]}</span>` : ''}</div>`).join('')}</div>
        </div>`;
    }).join('');

    const poolHtml = pool.length ? `<div class="bg-[#040E13]/95 border border-amber-500/40 rounded-2xl p-3 space-y-2">
        <h4 class="text-xs font-black text-amber-400 uppercase tracking-wider">Still available (${pool.length})</h4>
        <div class="flex flex-wrap gap-2">${pool.map(p => `<div class="flex items-center gap-1.5 bg-black/60 border border-white/10 rounded-full pl-1 pr-2.5 py-1">${avatar(p).replace('w-8 h-8', 'w-6 h-6')}<span class="text-[11px] font-bold text-white">${escapeHtml(p.name)}</span></div>`).join('')}</div></div>` : '';

    const canFinish = live && (admin || myTeam !== undefined);
    const limit = live && d.deadlineAt ? `<div class="text-[11px] text-center text-white/70 bg-black/40 border border-white/10 rounded-xl py-2 px-3">⏱️ Time limit: <b class="text-white">${new Date(d.deadlineAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</b>. Anyone not picked by then goes on a team at random.</div>` : '';
    return `<div class="space-y-4 pb-12">
        ${banner}${orderStrip}${limit}
        ${live && canPick ? `<button data-action="caps-open-picker" data-event-id="${event.id}" class="w-full bg-[#00F296] text-slate-950 font-black py-3.5 rounded-2xl text-sm shadow-[0_0_15px_rgba(0,242,150,0.4)] flex items-center justify-center gap-2"><i class="fa-solid fa-user-plus pointer-events-none"></i> Add a player</button>` : ''}
        ${teamsHtml}
        ${poolHtml}
        <div class="grid ${(d.picks || []).length ? 'grid-cols-2' : 'grid-cols-1'} gap-2">
            ${(d.picks || []).length ? `<button onclick="window.openDraftReplay('${jsArg(event.id)}')" class="bg-black/60 border border-white/20 text-white font-black py-3 rounded-2xl text-xs"><i class="fa-solid fa-play mr-1"></i> Watch the draft</button>` : ''}
            <button onclick="window.openTeamCard('${jsArg(event.id)}')" class="bg-black/60 border border-white/20 text-white font-black py-3 rounded-2xl text-xs"><i class="fa-solid fa-camera mr-1"></i> Team card</button>
        </div>
        ${share}
        ${canFinish ? `<button data-action="caps-build-lineup" data-event-id="${event.id}" class="w-full ${pool.length ? 'bg-black/60 text-white border border-white/20' : 'bg-amber-400 text-slate-950'} font-black py-3 rounded-2xl text-xs flex items-center justify-center gap-2"><i class="fa-solid fa-shirt pointer-events-none"></i> Build line up${pool.length && admin ? ' now' : ''}</button>` : ''}
        ${admin && live ? `<button data-action="caps-cancel" data-event-id="${event.id}" class="w-full text-white/40 hover:text-red-300 text-[11px] py-1">Stop Caps mode (keeps the teams)</button>` : ''}
    </div>`;
}

// ---------------------------------------------------------------- picking
window.openCapsPicker = function(eventId, chosenTeam) {
    const event = findEvent(eventId); if (!event) return;
    let team = myPickTeam(event);
    if (team === null) { toast("It's not your turn.", 'error'); return; }
    const count = event.teamsCount || 3;
    const names = window.getTeamNames(event), colors = window.getTeamColors(event);
    const pool = draftPool(event, event.teamAssignments);
    // Open pick + admin who isn't a captain: choose the team first.
    if (team === 'any') team = Number.isInteger(chosenTeam) ? chosenTeam : null;
    let m = document.getElementById('assign-picker-modal');
    if (!m) { m = document.createElement('div'); m.id = 'assign-picker-modal'; m.className = 'fixed inset-0 z-[190] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm pointer-events-auto'; document.body.appendChild(m); }
    const teamChooser = team === null ? `<div class="space-y-2"><p class="text-[11px] text-white/60">Pick for which team?</p>${Array.from({ length: count }, (_, i) => `
        <button onclick="window.openCapsPicker('${eventId}', ${i})" class="w-full flex items-center gap-2 bg-black/50 border border-white/15 rounded-xl p-2.5 text-xs font-bold"><span class="w-3 h-3 rounded-full" style="background:${colors[i]}"></span>${escapeHtml(names[i])}</button>`).join('')}</div>` : '';
    m.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-5 space-y-3 shadow-2xl text-white pointer-events-auto">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h4 class="text-xs font-black uppercase">${team === null ? 'Add a player' : `Pick for ${escapeHtml(names[team])}`}</h4>
                <button onclick="document.getElementById('assign-picker-modal').remove()" class="text-white/50 hover:text-white text-lg"><i class="fa-solid fa-xmark"></i></button>
            </div>
            ${teamChooser || `<div class="space-y-2 max-h-[60vh] overflow-y-auto pr-1">${pool.map(p => `
                <button onclick="window.capsPick('${jsArg(eventId)}', ${team}, '${jsArg(String(p.uid))}')" class="w-full flex items-center gap-3 p-2.5 bg-black/40 hover:bg-black border border-white/10 rounded-xl text-left transition">
                    <img src="${escapeHtml(resolvePlayerAvatar(p, event.attendees))}" class="w-9 h-9 rounded-full object-cover border border-white/20" onerror="this.src='${AV_FALLBACK}'">
                    <div class="min-w-0"><div class="text-xs font-bold text-white truncate">${escapeHtml(p.name)}</div><div class="text-[10px] text-white/50">${escapeHtml(p.isHostGuest ? 'Guest' : (p.position || 'Player'))}</div></div>
                </button>`).join('') || '<p class="text-xs text-white/50 text-center py-4">Everyone has been picked.</p>'}</div>`}
        </div>`;
};

window.capsPick = async function(eventId, team, uid) {
    const event = findEvent(eventId); if (!event) return;
    document.getElementById('assign-picker-modal')?.remove();
    let why = '';
    const res = await mutateEvent(eventId, (draft) => {
        const d = draft.capsDraft;
        if (!d || d.status !== 'live') { why = 'Caps mode is over.'; return false; }
        const ta = draft.teamAssignments || {};
        const ev = { ...draft, id: eventId };
        if (d.mode === 'turns') {
            const t = turnTeamOf(ev, d, ta);
            if (t !== team) { why = "Someone picked first. It's not your turn anymore."; return false; }
            if (captainOf(ev, t) !== meUid() && !isTeamAdmin(ev)) { why = "It's not your turn."; return false; }
        } else if (captainOf(ev, team) !== meUid() && !isTeamAdmin(ev)) { why = 'You can only pick for your own team.'; return false; }
        if (teamList(ta, team).length >= teamCap(ev)) { why = 'That team is full.'; return false; }
        const p = draftPool(ev, ta).find(x => String(x.uid) === String(uid));
        if (!p) { why = 'That player was just picked by someone else.'; return false; }
        const owedTeam = d.mode === 'turns' ? (d.priority || []).find(t => teamList(ta, t).length < teamCap(ev)) : undefined;
        ta[team] = [...teamList(ta, team), playerRecord(p)];
        draft.teamAssignments = ta;
        const pickNo = (d.picks || []).length + 1;
        ta[team][ta[team].length - 1].pickNo = pickNo;   // pick order is kept (used later for the stars)
        d.picks = [...(d.picks || []), { no: pickNo, team, uid: String(uid), name: p.name || 'Player', by: meUid(), at: Date.now() }];
        if (d.mode === 'turns' && owedTeam === team) {
            const owedIdx = d.priority.indexOf(team);
            d.priority = d.priority.filter((_, k) => k !== owedIdx);   // make-up pick: the normal order stays where it was
            const next = turnTeamOf(ev, d, ta);
            d.turnTeam = next === null ? null : next;
        } else if (d.mode === 'turns') {
            const pos = (d.order || []).indexOf(team);
            d.turnIdx = (pos + 1) % d.order.length;
            const next = turnTeamOf(ev, d, ta);
            d.turnTeam = next === null ? null : next;
        }
    });
    if (!res.ok) return;
    if (res.aborted) { toast(why || "Couldn't pick that player.", 'error'); return; }
    window.teamAssignments[eventId] = res.event.teamAssignments;
    window.openTeamMakingModal(eventId);
    window.openCapsPosition(eventId, team, uid);
};

// ---------------------------------------------------------------- "Pick position" (only their side of the pitch)
window.openCapsPosition = function(eventId, team, uid) {
    const event = findEvent(eventId); if (!event) return;
    const players = teamList(event.teamAssignments, team);
    const who = players.find(p => String(p.uid) === String(uid)); if (!who) return;
    const labels = slotLabels(event, team);
    const takenBy = {};
    players.forEach(p => { if (Number.isInteger(p.slot) && String(p.uid) !== String(uid)) takenBy[p.slot] = p; });
    if (labels.every((_, i) => takenBy[i])) return;   // pitch full: they start on the bench
    const color = window.getTeamColors(event)[team], accent = window.teamAccent(color);
    const rows = [...formationRows(event, team)].reverse();
    let idx = 0;
    const spot = (i, label) => {
        const p = takenBy[i];
        if (p) return `<div class="flex-1 max-w-[6rem] h-10 bg-black/80 border-2 rounded-full px-1.5 flex items-center gap-1 opacity-70" style="border-color:${accent}">
            <img src="${escapeHtml(resolvePlayerAvatar(p, event.attendees))}" class="w-6 h-6 rounded-full object-cover" onerror="this.src='${AV_FALLBACK}'"><span class="text-[8px] font-black text-white truncate">${escapeHtml(p.name)}</span></div>`;
        return `<button onclick="window.capsSetSlot('${jsArg(eventId)}', ${team}, '${jsArg(String(uid))}', ${i})" class="flex-1 max-w-[6rem] h-10 bg-black/60 hover:bg-[#00F296]/25 border-2 border-dashed rounded-full text-[10px] font-black text-white transition" style="border-color:${accent}">${label}</button>`;
    };
    let rowsHtml = '';
    rows.forEach(n => { let r = ''; for (let c = 0; c < n; c++) { r += spot(idx, labels[idx]); idx++; } rowsHtml += `<div class="flex justify-center gap-2 mb-2.5">${r}</div>`; });
    rowsHtml += `<div class="flex justify-center mt-1">${spot(idx, 'GK')}</div>`;
    let m = document.getElementById('assign-picker-modal');
    if (!m) { m = document.createElement('div'); m.id = 'assign-picker-modal'; m.className = 'fixed inset-0 z-[190] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm pointer-events-auto'; document.body.appendChild(m); }
    m.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-4 space-y-3 shadow-2xl text-white pointer-events-auto">
            <div class="text-center"><div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">Pick position</div>
                <div class="text-sm font-black">${escapeHtml(who.name || 'Player')}</div></div>
            <div class="relative border-2 rounded-2xl p-3 bg-[#03140C] overflow-hidden" style="background-image:url('img/TeamBuildField.png');background-size:cover;background-position:center;border-color:${accent}">
                <div class="absolute inset-0 bg-black/50 pointer-events-none"></div><div class="relative z-10 py-1">${rowsHtml}</div></div>
            <button onclick="window.capsSetSlot('${jsArg(eventId)}', ${team}, '${jsArg(String(uid))}', -1)" class="w-full bg-black/60 border border-white/20 text-white font-bold py-2.5 rounded-xl text-xs">Skip (any open spot)</button>
        </div>`;
};

window.capsSetSlot = async function(eventId, team, uid, slot) {
    document.getElementById('assign-picker-modal')?.remove();
    const event = findEvent(eventId); if (!event) return;
    const total = slotLabels(event, team).length;
    const res = await mutateEvent(eventId, (draft) => {
        const ta = draft.teamAssignments || {};
        const list = teamList(ta, team);
        const p = list.find(x => String(x.uid) === String(uid)); if (!p) return false;
        const used = new Set(list.filter(x => x !== p && Number.isInteger(x.slot)).map(x => x.slot));
        let s = slot;
        if (s < 0 || used.has(s)) {
            const open = Array.from({ length: total }, (_, i) => i).filter(i => !used.has(i));
            if (!open.length) return false;
            s = open[Math.floor(Math.random() * open.length)];
        }
        p.slot = s;
        ta[team] = list;
        draft.teamAssignments = ta;
    });
    if (res.ok && !res.aborted) { window.teamAssignments[eventId] = res.event.teamAssignments; window.openTeamMakingModal(eventId); }
};

// ---------------------------------------------------------------- Build line up / stop
window.capsBuildLineup = async function(eventId) {
    const event = findEvent(eventId); if (!event) return;
    const pool = draftPool(event, event.teamAssignments);
    if (pool.length && !isTeamAdmin(event)) { toast('Wait until everyone has been picked.', 'error'); return; }
    if (pool.length && !confirm(`${pool.length} player(s) haven't been picked yet. Build the line ups anyway?`)) return;
    const count = event.teamsCount || 3;
    const res = await mutateEvent(eventId, (draft) => {
        const ta = draft.teamAssignments || {};
        for (let i = 0; i < count; i++) {
            const list = teamList(ta, i);
            const total = slotLabels({ ...draft, id: eventId }, i).length;
            const spots = new Array(total).fill(null);
            const rest = [];
            list.forEach(p => { if (Number.isInteger(p.slot) && p.slot < total && !spots[p.slot]) spots[p.slot] = p; else rest.push(p); });
            shuffled(rest).forEach(p => { const k = spots.indexOf(null); if (k !== -1) spots[k] = p; else spots.push(p); });
            // Spots nobody filled are dropped (the pitch fills from the front); extra players go to the bench.
            ta[i] = spots.filter(Boolean).map(p => { const c = { ...p }; delete c.slot; return c; });
        }
        draft.teamAssignments = ta;
        if (draft.capsDraft) { draft.capsDraft.status = 'done'; draft.capsDraft.turnTeam = null; draft.capsDraft.doneAt = Date.now(); }
    });
    if (res.ok && !res.aborted) {
        window.teamAssignments[eventId] = res.event.teamAssignments;
        window.activeTeamTab = 0;
        window.openTeamMakingModal(eventId);
        toast('Line ups built! ⚽');
    }
};

window.capsCancel = async function(eventId) {
    const event = findEvent(eventId); if (!event || !isTeamAdmin(event)) return;
    if (!confirm('Stop Caps mode? The players already picked stay on their teams.')) return;
    const res = await mutateEvent(eventId, (draft) => { draft.capsDraft = null; });
    if (res.ok) { window.activeTeamTab = 0; window.openTeamMakingModal(eventId); }
};

document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action^="caps-"]');
    if (!btn) return;
    const id = btn.getAttribute('data-event-id');
    const a = btn.getAttribute('data-action');
    if (a === 'caps-open-picker') window.openCapsPicker(id);
    else if (a === 'caps-build-lineup') window.capsBuildLineup(id);
    else if (a === 'caps-cancel') window.capsCancel(id);
    else if (a === 'caps-copy-link') {
        const link = capsLink(id);
        if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) navigator.share({ title: 'FutNet Caps mode', text: 'Captains: pick your team on FutNet 🧢', url: link }).catch(() => {});
        else navigator.clipboard?.writeText(link).then(() => toast('Link copied!'), () => toast(link));
    }
});

/** Opens the team builder on Caps mode (used by the captains link). */
window.openCapsMode = function(eventId) {
    window.activeTeamTab = -1;
    window.openTeamMakingModal(eventId);
};

/** Live: when the game changes (a captain picked), redraw the open team builder for everyone watching. */
window.refreshTeamBuilderLive = function() {
    const modal = document.getElementById('standalone-team-builder-modal');
    const id = window.activeModalEventId;
    if (!modal || !id) return;
    if (modal.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;   // don't wipe what they're typing
    const ev = (window.eventsList || []).find(x => x.id === id);
    if (!ev) return;
    const key = JSON.stringify([ev.teamAssignments, ev.teamCaptains, ev.capsDraft, ev.teamNames, ev.teamColors, ev.teamFormations]);
    if (key === window._teamBuilderKey) return;
    window._teamBuilderKey = key;
    const y = modal.scrollTop;
    window.openTeamMakingModal(id);
    modal.scrollTop = y;
};
