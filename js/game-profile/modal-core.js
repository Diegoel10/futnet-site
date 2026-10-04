// js/game-profile/modal-core.js: Complete updated file with standalone event page routing, browser back button support, and robust deletion/editing
import { db, appId } from '../firebase-config.js';
import { doc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { mutateEvent, pruneTeamsForUid, safeAvatar, escapeHtml } from './event-store.js';
import { joinHooks, refundHooks, creditGame, refundAllowed, feeCents, refundEveryoneForGame, dollars } from '../credits.js';
import { renderAdminTab } from './admin-tab.js';
import { renderRosterTab } from './roster-tab.js';
import { renderStatsTab } from './stats-tab.js';
import { renderCommentsTab } from './comments-tab.js';
import { renderTeamToolTab } from './team-tool.js';
import './team-tool.js';


// Roster entries saved without a real name show up as "Player". Look the name up from the player's
// profile (by uid) and save it, so every screen (site and app) shows the right name and photo.
const _healedEvents = new Set();
async function healUnnamedPlayers(eventId) {
    const ev = (window.eventsList || []).find(e => e.id === eventId);
    if (!ev || _healedEvents.has(eventId)) return;
    const isUnnamed = (a) => a && a.uid && !String(a.uid).includes('_guest_') &&
        (!a.name || !String(a.name).trim() || String(a.name).trim() === 'Player');
    const bad = [...(ev.attendees || []), ...(ev.waitingList || [])].filter(isUnnamed);
    if (!bad.length) return;
    _healedEvents.add(eventId);
    const found = {};
    await Promise.all([...new Set(bad.map(a => a.uid))].map(async uid => {
        try {
            const s = await getDoc(doc(db, 'artifacts', appId, 'directory', String(uid)));
            if (!s.exists()) return;
            const d = s.data();
            const name = (d.name || `${d.firstName || ''} ${d.lastName || ''}`.trim() || '').trim();
            if (name) found[uid] = { name, avatar: safeAvatar(d.avatar) };
        } catch (e) { /* ignore */ }
    }));
    if (!Object.keys(found).length) return;
    await mutateEvent(eventId, (draft) => {
        let changed = false;
        const fix = (a) => {
            if (isUnnamed(a) && found[a.uid]) {
                a.name = found[a.uid].name;
                if (!a.avatar && found[a.uid].avatar) a.avatar = found[a.uid].avatar;
                changed = true;
            }
        };
        (draft.attendees || []).forEach(fix);
        (draft.waitingList || []).forEach(fix);
        Object.values(draft.teamAssignments || {}).forEach(list => {
            if (Array.isArray(list)) list.forEach(p => { if (p && found[p.uid] && (!p.name || p.name === 'Player')) { p.name = found[p.uid].name; changed = true; } });
        });
        return changed ? undefined : false;
    });
}

window.renderInfoTab = function(event) {
    const rawPrice = event.fee !== undefined && event.fee !== null ? String(event.fee).replace('$', '').trim() : '';
    const displayPrice = rawPrice && rawPrice !== '0' && rawPrice.toLowerCase() !== 'free' ? `$${rawPrice}` : 'Free';
    
    const formatMatch = (event.format || "").match(/(\d+)/);
    const perSide = formatMatch ? parseInt(formatMatch[1], 10) : 5;
    let teamsCountNum = 3;
    if (typeof event.teamsCount === 'number') {
        teamsCountNum = event.teamsCount;
    } else if (typeof event.teamsCount === 'string') {
        const parsed = parseInt(event.teamsCount.match(/(\d+)/)?.[1], 10);
        if (!isNaN(parsed)) teamsCountNum = parsed;
    }
    const maxCapacity = perSide * teamsCountNum;

    let currentGoing = 0;
    const attendeesArr = Array.isArray(event.attendees) ? event.attendees : [];
    attendeesArr.forEach(a => {
        const guestArr = Array.isArray(a.guests) ? a.guests : [];
        currentGoing += 1 + guestArr.length;
    });
    if (currentGoing === 0 && attendeesArr.length === 0) currentGoing = 1;

    const isFull = currentGoing >= maxCapacity;
    const organizerName = event.organizer || event.hostName || 'Organizer';
    
    const resolveAvatar = (person) => {
        const initials = () => `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(person?.name || 'Organizer')}`;
        if (!person) return initials();
        const uid = person.uid ? String(person.uid) : '';
        const usable = (u) => typeof u === 'string' && u.trim() !== '';
        
        if (uid && Array.isArray(window.directoryList)) {
            const hit = window.directoryList.find(u => String(u.uid) === uid);
            if (hit && usable(hit.avatar)) return hit.avatar;
            if (hit && usable(hit.photoURL)) return hit.photoURL;
        }
        const own = person.avatar || person.photoURL || person.profilePicture;
        return usable(own) ? own : initials();
    };

    const organizerAvatar = resolveAvatar({ uid: event.organizerId, name: organizerName, avatar: event.organizerAvatar || event.hostAvatar });
    const isMine = window.currentUser && String(event.organizerId) === String(window.currentUser.uid);
    const finalHostAvatar = isMine && window.userProfile?.avatar ? window.userProfile.avatar : organizerAvatar;

    const userId = window.currentUser ? String(window.currentUser.uid || window.currentUser.id || '') : '';
    const organizerId = event.organizerId ? String(event.organizerId) : '';
    const isHost = userId && organizerId && userId === organizerId;
    const isConfirmedAttendee = userId && attendeesArr.some(a => String(a.uid || a.userId || '') === userId);
    const isConfirmed = isHost || isConfirmedAttendee;
    const allowPlusOnes = event.allowPlusOnes || false;

    let rsvpButtonHtml = '';
    if (isConfirmed) {
        if (allowPlusOnes) {
            rsvpButtonHtml = `
                <div class="grid grid-cols-2 gap-2.5">
                    <button onclick="handleRSVPAction('${event.id}', 'cancel')" class="bg-red-500/20 hover:bg-red-500/30 text-red-400 font-black py-3.5 rounded-2xl text-xs border-2 border-red-500/40 shadow transition uppercase tracking-wider flex items-center justify-center gap-2">
                        <i class="fa-solid fa-user-xmark"></i> Leave Game!
                    </button>
                    <button onclick="openManageGuestsModal('${event.id}')" class="bg-[#00F296]/20 hover:bg-[#00F296]/30 text-[#00F296] font-black py-3.5 rounded-2xl text-xs border-2 border-[#00F296]/40 shadow transition uppercase tracking-wider flex items-center justify-center gap-2">
                        <i class="fa-solid fa-users-gear"></i> Manage Guests
                    </button>
                </div>
            `;
        } else {
            rsvpButtonHtml = `
                <button onclick="handleRSVPAction('${event.id}', 'cancel')" class="w-full bg-red-500/20 hover:bg-red-500/30 text-red-400 font-black py-3.5 rounded-2xl text-xs border-2 border-red-500/40 shadow-lg uppercase tracking-wider transition flex items-center justify-center gap-2">
                    <i class="fa-solid fa-user-xmark"></i> Leave Game!
                </button>
            `;
        }
    } else if (isFull) {
        rsvpButtonHtml = `
            <button onclick="openJoinGameModal('${event.id}')" class="w-full bg-amber-400 hover:opacity-95 text-slate-950 font-black py-3.5 rounded-2xl text-xs shadow-lg uppercase tracking-wider transition flex items-center justify-center gap-2">
                <i class="fa-solid fa-hourglass-half"></i> Join Waitlist!
            </button>
        `;
    } else {
        rsvpButtonHtml = `
            <button onclick="openJoinGameModal('${event.id}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3.5 rounded-2xl text-xs shadow-lg uppercase tracking-wider transition flex items-center justify-center gap-2">
                <i class="fa-solid fa-person-badge-plus text-sm"></i> Join Game!
            </button>
        `;
    }

    return `
        <div class="space-y-4 font-sans text-white">
            <div class="bg-[#040E13]/95 border-2 border-[#00B4AE]/40 rounded-[22px] p-4 flex items-center justify-between shadow-xl">
                <div class="flex items-center gap-3">
                    <img src="${finalHostAvatar}" class="w-11 h-11 rounded-full object-cover border-2 border-[#00F296]/60 shadow-md" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                    <div>
                        <span class="text-[9px] font-black text-white/50 uppercase tracking-wider block">ORGANIZER</span>
                        <span class="text-sm font-black text-white">${organizerName}</span>
                    </div>
                </div>
                <span class="px-3.5 py-1.5 bg-[#00F296]/15 text-[#00F296] font-black text-[10px] rounded-full border-2 border-[#00F296]/40">Organizer</span>
            </div>

            <div class="bg-[#040E13]/95 border-2 border-[#00B4AE]/40 rounded-[22px] px-4 py-3.5 grid grid-cols-2 gap-2 shadow-xl text-left">
                <div class="space-y-0.5 border-r border-white/15 pr-2">
                    <div class="flex items-center gap-1.5 text-[9px] font-black text-white/50 uppercase tracking-wider">
                        <i class="fa-solid fa-calendar text-[#00F296]"></i> DATE
                    </div>
                    <div class="text-xs font-bold text-white">${event.date || 'TBD'}</div>
                </div>
                <div class="space-y-0.5 pl-2">
                    <div class="flex items-center gap-1.5 text-[9px] font-black text-white/50 uppercase tracking-wider">
                        <i class="fa-solid fa-clock text-[#00F296]"></i> TIME
                    </div>
                    <div class="text-xs font-bold text-white">${event.time || 'TBD'}</div>
                </div>
            </div>

            <div class="bg-[#040E13]/95 border-2 border-[#00B4AE]/40 rounded-[22px] p-4 grid grid-cols-3 gap-2 shadow-xl text-left">
                <div class="space-y-0.5 border-r border-white/10 pr-2">
                    <span class="text-[9px] font-black text-white/50 uppercase tracking-wider block">FORMAT</span>
                    <span class="text-xs font-bold text-white">${event.format || '7v7'}</span>
                </div>
                <div class="space-y-0.5 border-r border-white/10 px-2">
                    <span class="text-[9px] font-black text-white/50 uppercase tracking-wider block">ENTRY FEE</span>
                    <span class="text-xs font-bold text-white">${displayPrice}</span>
                </div>
                <div class="space-y-0.5 pl-2">
                    <span class="text-[9px] font-black text-white/50 uppercase tracking-wider block">TEAMS</span>
                    <span class="text-xs font-bold text-white">${teamsCountNum} Teams</span>
                </div>
            </div>

            <div class="pt-1">
                ${rsvpButtonHtml}
            </div>

            <div class="bg-[#040E13]/95 border-2 border-[#00B4AE]/40 rounded-[22px] p-4 space-y-2 shadow-xl">
                <div class="flex items-center justify-between text-xs font-black text-white cursor-pointer">
                    <div class="flex items-center gap-2.5">
                        <i class="fa-solid fa-file-lines text-[#00F296]"></i> GAME DETAILS
                    </div>
                    <i class="fa-solid fa-chevron-down text-[10px] text-white/60"></i>
                </div>
                <p class="text-xs text-white/80 leading-relaxed font-medium pl-6 pt-1">${event.description || 'Standard game. Come ready to play, have fun and respect the squad. 💪⚽'}</p>
            </div>

            <div class="bg-[#040E13]/95 border-2 border-[#00B4AE]/40 rounded-[22px] p-4 space-y-2 shadow-xl">
                <div class="flex items-center justify-between text-xs font-black text-white cursor-pointer">
                    <div class="flex items-center gap-2.5">
                        <i class="fa-solid fa-list-check text-[#00F296]"></i> RULES
                    </div>
                    <i class="fa-solid fa-chevron-down text-[10px] text-white/60"></i>
                </div>
                <p class="text-xs text-white/80 leading-relaxed font-medium pl-6 pt-1">${event.rules || 'Standard fair play rules apply. Be punctual and respectful.'}</p>
            </div>
        </div>
    `;
};

window.openManageGuestsModal = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !window.currentUser) return;

    const attendee = (event.attendees || []).find(a => String(a.uid) === String(window.currentUser.uid));
    const guests = attendee && Array.isArray(attendee.guests) ? [...attendee.guests] : [];
    const maxGuests = event.plusOneLimit || 5;

    let modal = document.getElementById('manage-guests-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'manage-guests-modal';
        modal.className = 'fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-[32px] max-w-sm w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 class="text-xs font-black uppercase tracking-wider text-white">MANAGE YOUR GUESTS</h3>
                <button onclick="document.getElementById('manage-guests-modal').remove()" class="w-7 h-7 bg-white/10 rounded-full flex items-center justify-center text-white/70 hover:text-white font-bold"><i class="fa-solid fa-xmark text-xs"></i></button>
            </div>
            <p class="text-[11px] text-white/60 text-center">You can bring up to ${maxGuests} guest(s). Edit names or add new ones.</p>
            
            <div id="manage-guests-list-inputs" class="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                ${guests.map((g, idx) => `
                    <div class="flex items-center gap-2">
                        <input type="text" id="manage-guest-input-${idx}" value="${g.name || ''}" class="flex-1 bg-black border border-teal-500/50 rounded-xl px-3.5 py-2.5 text-white text-xs font-medium" placeholder="Guest name...">
                        <button onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-300 p-2"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `).join('')}
            </div>

            <button onclick="window.addNewGuestInputRow()" class="w-full bg-black/60 hover:bg-black text-[#00F296] font-bold py-2.5 rounded-xl text-xs border border-[#00F296]/40 transition flex items-center justify-center gap-2">
                <i class="fa-solid fa-plus"></i> Add Another Guest
            </button>

            <button onclick="window.saveManagedGuests('${eventId}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3.5 rounded-xl text-xs uppercase tracking-wider shadow-[0_0_15px_rgba(0,242,150,0.4)] transition">
                Save Changes
            </button>
        </div>
    `;
};

window.addNewGuestInputRow = function() {
    const container = document.getElementById('manage-guests-list-inputs');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2';
    div.innerHTML = `
        <input type="text" value="" class="flex-1 bg-black border border-teal-500/50 rounded-xl px-3.5 py-2.5 text-white text-xs font-medium" placeholder="Guest name...">
        <button onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-300 p-2"><i class="fa-solid fa-trash"></i></button>
    `;
    container.appendChild(div);
};

window.saveManagedGuests = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !window.currentUser) return;

    const container = document.getElementById('manage-guests-list-inputs');
    if (!container) return;
    const inputs = container.querySelectorAll('input[type="text"]');
    const newGuests = [];
    inputs.forEach(inp => {
        const val = inp.value.trim();
        if (val) {
            newGuests.push({ name: val, paid: 'Unpaid' });
        }
    });

    const myUid = String(window.currentUser.uid);
    const res = await mutateEvent(eventId, (draft) => {
        const me = (draft.attendees || []).find(att => String(att.uid) === myUid);
        if (!me) return false;
        const old = me.guests || [];
        me.guests = newGuests.map((g, i) => (old[i] && old[i].name === g.name) ? old[i] : g);
        pruneTeamsForUid(draft, myUid, { keepHost: true, keepGuests: me.guests.length });
    });
    if (res.ok && !res.aborted) {
        window.showToast("Guests updated successfully!");
        document.getElementById('manage-guests-modal')?.remove();
        window.renderEventDetailModalContent();
    } else if (res.ok) {
        window.showToast("Join the game first to add guests.", "error");
    }
};

window.openEventDetails = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    window.activeModalEventId = eventId;
    
    window.teamNames = window.teamNames || {};
    window.teamNames[event.id] = event.teamNames || {};
    
    window.teamAssignments = window.teamAssignments || {};
    window.teamAssignments[event.id] = event.teamAssignments || {};

    const isCreator = window.currentUser && event.organizerId === window.currentUser.uid;
    window.activeModalTab = isCreator ? 'admin' : 'info';
    window.adminManagePlayersExpanded = false;
    window.adminMatchResultsExpanded = false;
    window.activeStatsSubTab = 'matches';
    window.activeTeamTab = 0;
    window.expandedLeaderboardTeams = window.expandedLeaderboardTeams || {};
    window.expandedMatchCards = window.expandedMatchCards || {};

    // Push state for browser back button support
    history.pushState({ modalOpen: true, eventId: eventId }, "", `#event-${eventId}`);

    if (typeof window.switchTab === 'function') {
        window.switchTab('event-details-screen');
    }
    window.renderEventDetailModalContent();
    healUnnamedPlayers(eventId);
};

// Listen to browser back button to close event profile seamlessly
window.addEventListener('popstate', (event) => {
    if (document.getElementById('standalone-team-builder-modal')) {
        document.getElementById('standalone-team-builder-modal')?.remove();
        return;
    }
    if (window.activeModalEventId) {
        window.activeModalEventId = null;
        if (typeof window.switchTab === 'function') {
            window.switchTab('events');
        }
    }
});

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

    window.currentTeamBuildingEvent = event;
    const isCreator = window.currentUser && event.organizerId === window.currentUser.uid;
    const tab = window.activeModalTab;
    const commentsCount = event.comments?.length || 0;

    const formatMatch = (event.format || "").match(/(\d+)/);
    const playersPerTeam = formatMatch ? parseInt(formatMatch[1], 10) : 7;
    
    let teamsCountNum = 3;
    if (typeof event.teamsCount === 'number') {
        teamsCountNum = event.teamsCount;
    } else if (typeof event.teamsCount === 'string') {
        const parsed = parseInt(event.teamsCount.match(/(\d+)/)?.[1], 10);
        if (!isNaN(parsed)) teamsCountNum = parsed;
    }
    const maxCapacity = playersPerTeam * teamsCountNum;
    
    let totalConfirmed = 0;
    (event.attendees || []).forEach(a => {
        totalConfirmed += 1 + (a.guests ? a.guests.length : 0);
    });

    const isFull = totalConfirmed >= maxCapacity;
    const rosterDisplayLabel = isFull ? "Roster (Full)" : `Roster (${totalConfirmed})`;

    const safeTitle = (event.title || 'Soccer Match').replace(/'/g, "\\'");
    const safeDate = (event.date || '').replace(/'/g, "\\'");
    const safeLocation = (event.location || '').replace(/'/g, "\\'");
    const mapsUrl = event.location ? 'https://maps.apple.com/?q=' + encodeURIComponent(event.location) : '';

    container.innerHTML = `
        <div class="space-y-3 text-white relative pt-0 pb-16 pointer-events-auto max-w-4xl mx-auto w-full px-4">
            <!-- Page Header: title, location, navigate + share -->
            <div class="relative z-30 bg-[#040E13]/90 backdrop-blur-md border-2 border-emerald-500/30 px-5 py-3.5 rounded-3xl shadow-lg flex items-center justify-between gap-3">
                <button onclick="closeEventModal()" aria-label="Back" title="Back" class="w-9 h-9 bg-black/60 hover:bg-black text-white rounded-full flex items-center justify-center border border-white/20 transition shadow shrink-0">
                    <i class="fa-solid fa-chevron-left text-xs"></i>
                </button>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2.5">
                        <h2 class="text-base font-black tracking-tight text-white truncate">${event.title}</h2>
                        <span class="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 font-black text-[9px] rounded-full uppercase tracking-wider border border-emerald-500/40 shrink-0">${event.visibility || 'Public'}</span>
                    </div>
                    <p class="text-xs text-white/60 truncate flex items-center gap-1.5 mt-0.5"><i class="fa-solid fa-location-dot text-[#00F296]"></i> ${event.location}</p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    ${mapsUrl ? `
                    <a href="${mapsUrl}" target="_blank" rel="noopener" title="Navigate" aria-label="Navigate" class="w-9 h-9 bg-[#00F296] hover:opacity-90 text-slate-950 rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(0,242,150,0.4)] transition">
                        <i class="fa-solid fa-location-arrow text-xs"></i>
                    </a>` : ''}
                    <div class="relative">
                        <button onclick="toggleShareDropdown()" title="Share Game" aria-label="Share" class="w-9 h-9 bg-[#00F296] hover:opacity-90 text-slate-950 rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(0,242,150,0.4)] transition">
                            <i class="fa-solid fa-share-nodes text-xs"></i>
                        </button>
                        <div id="share-dropdown" class="hidden absolute right-0 top-full mt-2 bg-[#040E13] border border-emerald-500/40 rounded-xl shadow-2xl z-[9999] w-48 py-2 divide-y divide-white/10 text-xs">
                            <button onclick="shareToWhatsApp('${safeTitle}', '${safeLocation}')" class="w-full text-left px-4 py-2.5 hover:bg-black/60 font-bold text-white flex items-center gap-2.5">
                                <i class="fa-brands fa-whatsapp text-emerald-400 text-base"></i> WhatsApp
                            </button>
                            <button onclick="shareToTwitter('${safeTitle}')" class="w-full text-left px-4 py-2.5 hover:bg-black/60 font-bold text-white flex items-center gap-2.5">
                                <i class="fa-brands fa-x-twitter text-white text-base"></i> X (Twitter)
                            </button>
                            <button onclick="copyEventLink('${safeTitle}')" class="w-full text-left px-4 py-2.5 hover:bg-black/60 font-bold text-white flex items-center gap-2.5">
                                <i class="fa-solid fa-link text-[#00F296] text-base"></i> Copy Link
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Navigation Tabs Bar -->
            <div class="bg-black/40 border-2 border-emerald-500/30 p-1.5 rounded-2xl flex items-center space-x-1 overflow-x-auto shadow-md backdrop-blur-md">
                ${isCreator ? `<button onclick="switchModalTab('admin')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === 'admin' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}"><i class="fa-solid fa-gear mr-1"></i> Admin</button>` : ''}
                <button onclick="switchModalTab('info')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === 'info' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">Game Info</button>
                <button onclick="switchModalTab('roster')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === 'roster' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">${rosterDisplayLabel}</button>
                <button onclick="switchModalTab('stats')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === 'stats' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">Game Stats</button>
                <button onclick="switchModalTab('comments')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === 'comments' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">Comments (${commentsCount})</button>
            </div>

            <!-- Tab Content View -->
            <div class="bg-[#040E13]/95 border-2 border-emerald-500/40 rounded-3xl p-4 sm:p-6 shadow-2xl backdrop-blur-md">
                ${tab === 'admin' && isCreator ? renderAdminTab(event) : ''}
                ${tab === 'info' ? window.renderInfoTab(event) : ''}
                ${tab === 'roster' ? renderRosterTab(event) : ''}
                ${tab === 'stats' ? renderStatsTab(event) : ''}
                ${tab === 'comments' ? renderCommentsTab(event) : ''}
            </div>
        </div>
    `;
};

window.openJoinGameModal = function(eventId) {
    const _ev = (window.eventsList || []).find(ev => ev.id === eventId);
    if (_ev && _ev.communityId && _ev.openToNonMembers !== true && window.checkCommunityGameAccess) {
        window.checkCommunityGameAccess(_ev).then(ok => {
            if (ok) window._openJoinGameModalCore(eventId);
            else window.showToast('This game is for community members only. Join the community first.', 'error');
        });
        return;
    }
    window._openJoinGameModalCore(eventId);
};

window._openJoinGameModalCore = function(eventId) {
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
        modal.className = 'fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md';
        document.body.appendChild(modal);
    }

    window._currentGuestCount = 0;
    window._maxGuestLimit = maxGuests;
    window._activeJoiningEventId = eventId;

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 space-y-5 shadow-2xl text-white text-center">
            <div class="flex justify-between items-center border-b border-white/10 pb-3">
                <h3 class="text-xs font-black uppercase text-white">Joining: ${event.title}</h3>
                <button onclick="document.getElementById('join-guests-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="space-y-3 py-2">
                <h4 class="text-sm font-black text-white">Bringing guests?</h4>
                <p class="text-[11px] text-white/60">You can bring up to ${maxGuests} guest(s).</p>
                
                <div class="flex items-center justify-center gap-6 pt-2">
                    <button type="button" onclick="window.updateJoinGuestCount(-1)" class="w-10 h-10 bg-black/60 hover:bg-black text-white font-black rounded-xl text-base transition flex items-center justify-center border border-white/20">
                        <i class="fa-solid fa-minus"></i>
                    </button>
                    <span id="join-guest-count-display" class="text-3xl font-black text-white w-12 text-center">0</span>
                    <button type="button" onclick="window.updateJoinGuestCount(1)" class="w-10 h-10 bg-black/60 hover:bg-black text-white font-black rounded-xl text-base transition flex items-center justify-center border border-white/20">
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </div>
            </div>

            <button type="button" onclick="window.proceedToGuestNamesStep()" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3 rounded-xl text-xs shadow transition uppercase tracking-wider">
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
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white text-left">
            <div class="flex justify-between items-center border-b border-white/10 pb-3">
                <h3 class="text-xs font-black uppercase text-white">Enter Guest Names (${count})</h3>
                <button onclick="document.getElementById('join-guests-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div id="guest-names-inputs-container" class="space-y-3 max-h-52 overflow-y-auto pr-1">
                ${Array.from({ length: count }, (_, i) => `
                    <div>
                        <label class="block text-[10px] font-black uppercase tracking-wider text-white/60 mb-1">Guest #${i + 1} Name</label>
                        <input type="text" id="guest-name-input-${i}" placeholder="Enter full name..." required class="w-full bg-black border border-teal-500/60 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-brand font-medium" style="background-color: #000000 !important; color: #ffffff !important;">
                    </div>
                `).join('')}
            </div>

            <button type="button" onclick="window.submitJoinGameWithGuestNames('${eventId}', ${count})" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3 rounded-xl text-xs shadow transition uppercase tracking-wider text-center">
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
    const uid = String(window.currentUser.uid);
    const profile = window.userProfile;
    const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
    const storedAvatar = safeAvatar(profile.avatar || window.currentUser.photoURL || '');
    let outcome = 'full';
    let acceptedCount = 0;
    // Community credit: the game fee is taken from the player's credit in the same save.
    const _creditEv = (window.eventsList || []).find(e => e.id === eventId);
    const useCredit = creditGame(_creditEv);
    let creditShortBy = 0;
    let chargedCents = 0;

    const res = await mutateEvent(eventId, (draft, ctx) => {
        creditShortBy = 0;
        if (ctx) ctx.charge = 0;
        draft.attendees = draft.attendees || [];
        draft.waitingList = draft.waitingList || [];
        draft.declinedList = (draft.declinedList || []).filter(d => String(d.uid) !== uid);

        const formatMatch = (draft.format || "").match(/(\d+)/);
        const playersPerTeam = formatMatch ? parseInt(formatMatch[1], 10) : 7;
        let teamsCountNum = 3;
        if (typeof draft.teamsCount === 'number') teamsCountNum = draft.teamsCount;
        else if (typeof draft.teamsCount === 'string') {
            const parsed = parseInt(draft.teamsCount.match(/(\d+)/)?.[1], 10);
            if (!isNaN(parsed)) teamsCountNum = parsed;
        }
        const maxCapacity = playersPerTeam * teamsCountNum;

        const previous = draft.attendees.find(a => String(a.uid) === uid);
        const keepRole = previous && previous.role ? previous.role : 'Player';
        draft.attendees = draft.attendees.filter(a => String(a.uid) !== uid);
        draft.waitingList = draft.waitingList.filter(w => String(w.uid) !== uid);

        let confirmedHeads = 0;
        draft.attendees.forEach(a => { confirmedHeads += 1 + (a.guests ? a.guests.length : 0); });

        const me = {
            uid, name: String(fullName || 'Player'), position: String(profile.position || 'Player'),
            role: keepRole, status: 'confirmed', paid: 'Unpaid', guests: []
        };
        if (storedAvatar) me.avatar = storedAvatar;

        const incoming = 1 + guestsArray.length;
        const available = maxCapacity - confirmedHeads;
        if (available >= incoming) {
            me.guests = guestsArray;
            draft.attendees.push(me);
            outcome = 'in';
        } else if (available > 0) {
            let remaining = available - 1;
            const accepted = [], waitlisted = [];
            guestsArray.forEach(g => { if (remaining > 0) { accepted.push(g); remaining--; } else waitlisted.push(g); });
            me.guests = accepted;
            acceptedCount = accepted.length;
            draft.attendees.push(me);
            draft.waitingList.push({ ...me, status: 'waiting', guests: waitlisted });
            outcome = 'partial';
        } else {
            me.status = 'waiting';
            me.guests = guestsArray;
            draft.waitingList.push(me);
            outcome = 'full';
        }
        const kept = (draft.attendees.find(a => String(a.uid) === uid)?.guests || []).length;
        if (outcome === 'full') pruneTeamsForUid(draft, uid);
        else pruneTeamsForUid(draft, uid, { keepHost: true, keepGuests: kept });

        if (useCredit && ctx) {
            const mine = draft.attendees.find(a => String(a.uid) === uid);
            const prevPaid = (previous && previous.creditPaidCents) || 0;
            if (mine && (outcome === 'in' || outcome === 'partial')) {
                const cost = feeCents(draft) * (1 + (mine.guests || []).length);
                if (prevPaid > 0) { mine.paid = 'Credit'; mine.creditPaidCents = prevPaid; mine.creditCommunityId = draft.communityId; }
                const extra = cost - prevPaid;
                if (extra > 0) {
                    if (ctx.balance >= extra) {
                        ctx.charge = extra;
                        mine.paid = 'Credit';
                        mine.creditPaidCents = prevPaid + extra;
                        mine.creditCommunityId = draft.communityId;
                    } else {
                        creditShortBy = extra - ctx.balance;
                    }
                }
            }
            chargedCents = ctx.charge;
        }
    }, useCredit ? joinHooks(_creditEv, uid) : undefined);

    if (res.ok) {
        if (outcome === 'in' && chargedCents > 0) window.showToast(`Joined! ${dollars(chargedCents)} was taken from your community credit.`);
        else if (outcome === 'in') window.showToast(guestsArray.length > 0 ? "Successfully joined with your guest(s)!" : "Successfully joined game!");
        else if (outcome === 'partial') window.showToast(`Roster capacity reached! Accepted player + ${acceptedCount} guest(s); remaining guest(s) placed on waitlist.`, "info");
        else window.showToast("Roster is full. You and your guest(s) were added to the waitlist!", "info");
        if (creditShortBy > 0) window.showToast(`Not enough credit (${dollars(creditShortBy)} short), so you joined as Unpaid. Ask a community admin to add credit, or pay at the game.`, "info");
    }
    window.renderEventDetailModalContent();
};

window.cancelGameEvent = async function(eventId) {
    if (!confirm("Are you sure you want to cancel and delete this game? Anyone who paid with community credit gets it back.")) return;
    try {
        const _evForRefund = (window.eventsList || []).find(e => String(e.id) === String(eventId));
        if (_evForRefund && _evForRefund.communityId) await refundEveryoneForGame(_evForRefund);
        const realDocId = (window.eventDocIds && window.eventDocIds[eventId]) || eventId;
        const eventDocRef = doc(db, 'artifacts', appId, 'eventsList', realDocId);
        
        // 1. Delete document from Firestore
        await deleteDoc(eventDocRef);

        // 2. Remove aggressively from local window.eventsList across all possible ID variations
        window.eventsList = (window.eventsList || []).filter(ev => {
            const evIdStr = String(ev.id);
            const targetStr = String(eventId);
            const docStr = String(realDocId);
            return evIdStr !== targetStr && evIdStr !== docStr;
        });

        // 3. Force immediate DOM cleanup and re-render of the games grid
        if (typeof window.renderEvents === 'function') {
            window.renderEvents();
        } else {
            const card = document.getElementById(`event-card-${eventId}`) || document.getElementById(`event-card-${realDocId}`);
            if (card) card.remove();
        }

        if (window.teamAssignments) delete window.teamAssignments[eventId];
        if (window.currentTeamBuildingEvent) {
            window.currentTeamBuildingEvent = null;
        }
        document.getElementById('standalone-team-builder-modal')?.remove();

        window.showToast("Game cancelled and deleted.");
        
        // 4. Close the details screen
        if (typeof window.closeEventModal === 'function') {
            window.closeEventModal();
        } else if (typeof window.switchTab === 'function') {
            window.switchTab('events');
        }
    } catch (err) {
        console.error("Error cancelling game:", err);
        window.showToast("Failed to cancel game", "error");
    }
};

window.saveEditedEvent = async function(eventId) {
    const titleEl = document.getElementById('ce-title');
    const descEl = document.getElementById('ce-description');
    const rulesEl = document.getElementById('ce-rules');
    const dateEl = document.getElementById('ce-date');
    const timeEl = document.getElementById('ce-time');

    const res = await mutateEvent(eventId, (draft) => {
        if (titleEl) draft.title = titleEl.value.trim();
        if (descEl) draft.description = descEl.value.trim();
        if (rulesEl) draft.rules = rulesEl.value.trim();
        if (dateEl) draft.date = dateEl.value.trim();
        if (timeEl) draft.time = timeEl.value.trim();
    });
    if (res.ok) {
        window.showToast("Event updated successfully!");
        if (typeof window.closeEventModal === 'function') window.closeEventModal();
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
        teamOptionsHtml += `<option value="${escapeHtml(tName)}">${escapeHtml(tName)}</option>`;
    }

    let modal = document.getElementById('new-game-setup-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'new-game-setup-modal';
        modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h4 class="text-sm font-black uppercase text-white">⚽ Setup New Match</h4>
                <button onclick="document.getElementById('new-game-setup-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-3">
                <div>
                    <label class="block text-xs font-bold text-white/70 uppercase mb-1">Team A (Home)</label>
                    <select id="setup-team-a" class="w-full bg-black border border-teal-500/60 rounded-xl p-2.5 text-xs font-bold text-white" style="background-color: #000000 !important; color: #ffffff !important;">
                        ${teamOptionsHtml}
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-white/70 uppercase mb-1">Team B (Away)</label>
                    <select id="setup-team-b" class="w-full bg-black border border-teal-500/60 rounded-xl p-2.5 text-xs font-bold text-white" style="background-color: #000000 !important; color: #ffffff !important;">
                        ${teamOptionsHtml}
                    </select>
                </div>
            </div>
            <div class="flex gap-2 pt-2">
                <button onclick="document.getElementById('new-game-setup-modal').remove()" class="flex-1 bg-black/60 hover:bg-black text-white py-2.5 rounded-xl text-xs font-bold transition border border-white/20">Cancel</button>
                <button onclick="confirmCreateNewGame('${event.id}')" class="flex-1 bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-2.5 rounded-xl text-xs shadow">Start Game</button>
            </div>
        </div>
    `;
};

window.confirmCreateNewGame = async function(eventId) {
    const teamA = document.getElementById('setup-team-a').value;
    const teamB = document.getElementById('setup-team-b').value;

    if (teamA === teamB) {
        window.showToast("Team A and Team B must be different teams!", "error");
        return;
    }

    const modal = document.getElementById('new-game-setup-modal');
    if (modal) modal.remove();

    const res = await mutateEvent(eventId, (draft) => {
        draft.matches = draft.matches || [];
        draft.matches.push({ teamA: teamA, teamB: teamB, team1Goals: [], team2Goals: [], isFinished: false });
    });
    if (res.ok) window.showToast(`Game started between ${teamA} and ${teamB}!`);
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
        picker.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md';
        document.body.appendChild(picker);
    }

    picker.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h4 class="text-sm font-black uppercase text-white">⚽ Goal Scorer (${escapeHtml(targetTeamName)})</h4>
                <button onclick="document.getElementById('goal-picker-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                ${teamPlayers.map(player => `
                    <div data-name="${escapeHtml(player.name || player)}" onclick="selectGoalScorer('${event.id}',${mIndex}, ${teamNum}, this.dataset.name)" class="flex items-center gap-3 p-3 bg-black/40 hover:bg-black border border-white/10 hover:border-emerald-500/50 rounded-2xl cursor-pointer transition shadow-sm">
                        <img src="${escapeHtml(safeAvatar(player.avatar) || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg')}" class="w-8 h-8 rounded-full object-cover border border-white/20 shadow-sm">
                        <span class="text-xs font-bold text-white">${escapeHtml(player.name || player)}</span>
                    </div>
                `).join('')}
            </div>
            <button onclick="document.getElementById('goal-picker-modal').remove()" class="w-full bg-black/60 hover:bg-black text-white py-2.5 rounded-xl text-xs font-bold transition border border-white/20">Cancel</button>
        </div>
    `;
};

window.selectGoalScorer = async function(eventId, mIndex, teamNum, playerName) {
    const picker = document.getElementById('goal-picker-modal');
    if (picker) picker.remove();

    const res = await mutateEvent(eventId, (draft) => {
        draft.matches = draft.matches || [];
        const m = draft.matches[mIndex];
        if (!m) return false;
        const key = teamNum === 1 ? 'team1Goals' : 'team2Goals';
        m[key] = m[key] || [];
        m[key].push(playerName);
    });
    if (res.ok && !res.aborted) window.showToast(`Goal added for ${playerName}!`);
};

window.toggleMatchFinished = async function(eventId, mIndex) {
    let nowFinished = false;
    const res = await mutateEvent(eventId, (draft) => {
        const m = (draft.matches || [])[mIndex];
        if (!m) return false;
        m.isFinished = !m.isFinished;
        nowFinished = m.isFinished;
    });
    if (res.ok && !res.aborted) window.showToast(nowFinished ? "Game marked as finished!" : "Game reopened.");
};

window.toggleSessionEnded = async function(eventId) {
    let ended = false;
    const res = await mutateEvent(eventId, (draft) => {
        draft.isSessionEnded = !draft.isSessionEnded;
        ended = draft.isSessionEnded;
    });
    if (res.ok) window.showToast(ended ? "Session ended successfully!" : "Session reopened.");
};

window.removeTeamGoal = async function(eventId, mIndex, teamNum, gIdx) {
    const res = await mutateEvent(eventId, (draft) => {
        const m = (draft.matches || [])[mIndex];
        if (!m) return false;
        const arr = teamNum === 1 ? m.team1Goals : m.team2Goals;
        if (!arr || gIdx >= arr.length) return false;
        arr.splice(gIdx, 1);
    });
    if (res.ok && !res.aborted) window.showToast("Goal removed.");
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
    const res = await mutateEvent(eventId, (draft) => {
        draft.attendees = (draft.attendees || []).map(a => String(a.uid) === String(uid) ? { ...a, paid: paidStatus } : a);
    });
    if (res.ok) window.showToast("Player payment status updated!");
};

window.assignTeamCaptain = async function(eventId, uid, teamIndexStr) {
    if (teamIndexStr === "") return;
    const teamIndex = parseInt(teamIndexStr);
    const res = await mutateEvent(eventId, (draft) => {
        draft.attendees = (draft.attendees || []).map(a => {
            if (a.captainTeamIndex === teamIndex) return { ...a, isCaptain: false, captainTeamIndex: undefined };
            if (String(a.uid) === String(uid)) return { ...a, isCaptain: true, captainTeamIndex: teamIndex };
            return a;
        });
        draft.teamCaptains = draft.teamCaptains || {};
        draft.teamCaptains[teamIndex] = String(uid);
    });
    if (res.ok) {
        const tName = (window.teamNames[eventId] && window.teamNames[eventId][teamIndex]) || `Team ${teamIndex + 1}`;
        window.showToast(`Captain assigned to ${tName}!`);
        window.renderEventDetailModalContent();
    }
};

window.addNewMatchSession = async function(eventId) {
    const res = await mutateEvent(eventId, (draft) => {
        if (draft.isSessionEnded) return false;
        draft.matches = draft.matches || [];
        draft.matches.push({ team1Goals: [], team2Goals: [], isFinished: false });
    });
    if (res.ok && res.aborted) window.showToast("Session is ended. No more games can be added.", "error");
};

window.removeMatchSession = async function(eventId, mIndex) {
    if (!confirm("Are you sure you want to delete this game session?")) return;
    const res = await mutateEvent(eventId, (draft) => {
        if (!(draft.matches || [])[mIndex]) return false;
        draft.matches.splice(mIndex, 1);
    });
    if (res.ok && !res.aborted) window.showToast("Game session deleted.");
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

function stripBigPhotos(value) {
    if (Array.isArray(value)) return value.app ? value : value.map(stripBigPhotos);
    if (Array.isArray(value)) return value.map(stripBigPhotos);
    if (value && typeof value === 'object') {
        const clean = {};
        Object.keys(value).forEach(key => {
            const v = value[key];
            const isPhotoKey = key === 'avatar' || key === 'photoURL' || key === 'profilePicture' || key === 'image' || key === 'thumbnail';
            
            if (typeof v === 'string' && (v.startsWith('data:') || v.includes('base64') || v.length > 500)) {
                return;
            }
            if (isPhotoKey && typeof v === 'string' && v.length > 200) {
                return;
            }
            if (v === undefined) return;
            clean[key] = stripBigPhotos(v);
        });
        return clean;
    }
    return value;
}

window.stripBigPhotos = stripBigPhotos;

window.closeEventModal = function() {
    window.activeModalEventId = null;
    if (typeof window.switchTab === 'function') {
        window.switchTab('events');
    }
};

window.handleRSVPAction = async function(eventId, action) {
    if (!window.currentUser || action !== 'cancel') return;
    const uid = String(window.currentUser.uid);
    const profile = window.userProfile || {};
    const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'Player';
    const _ev = (window.eventsList || []).find(e => e.id === eventId);
    const _mine = _ev && (_ev.attendees || []).find(a => String(a.uid) === uid);
    const hadCredit = !!(_ev && _ev.communityId && _mine && _mine.creditPaidCents > 0);
    let refunded = 0, forfeited = 0;
    const res = await mutateEvent(eventId, (draft, ctx) => {
        refunded = 0; forfeited = 0;
        const paid = ctx ? ((draft.attendees || []).find(a => String(a.uid) === uid)?.creditPaidCents || 0) : 0;
        if (ctx) ctx.refund = 0;
        if (paid > 0) {
            if (refundAllowed(draft)) { ctx.refund = paid; ctx.note = 'You left the game'; refunded = paid; }
            else forfeited = paid;
        }
        draft.attendees = (draft.attendees || []).filter(a => String(a.uid) !== uid);
        draft.waitingList = (draft.waitingList || []).filter(w => String(w.uid) !== uid);
        draft.declinedList = (draft.declinedList || []).filter(d => String(d.uid) !== uid);
        draft.declinedList.push({ uid, name: fullName });
        pruneTeamsForUid(draft, uid);
    }, hadCredit ? refundHooks(_ev, uid) : undefined);
    if (res.ok) {
        if (refunded > 0) window.showToast(`You left the game. ${dollars(refunded)} was returned to your credit.`);
        else if (forfeited > 0) window.showToast(`You left the game. Your ${dollars(forfeited)} credit was not refunded (${(window.creditTools && window.creditTools.policyText(_ev)) || 'game refund rule'}).`, "info");
        else window.showToast("You have left the game.");
        window.renderEventDetailModalContent();
    }
};

window.removePlayerFromEvent = async function(eventId, uid, tab) {
    if (!confirm("Are you sure you want to remove this player from the roster?")) return;
    const _ev = (window.eventsList || []).find(e => e.id === eventId);
    const _p = _ev && (_ev.attendees || []).find(a => String(a.uid) === String(uid));
    const hadCredit = !!(_ev && _ev.communityId && _p && _p.creditPaidCents > 0);
    let refunded = 0;
    const res = await mutateEvent(eventId, (draft, ctx) => {
        refunded = 0;
        const paid = ctx ? ((draft.attendees || []).find(a => String(a.uid) === String(uid))?.creditPaidCents || 0) : 0;
        if (ctx) ctx.refund = 0;
        if (paid > 0) { ctx.refund = paid; ctx.note = 'Removed from the game by the organizer'; refunded = paid; }
        draft.attendees = (draft.attendees || []).filter(a => String(a.uid) !== String(uid));
        draft.waitingList = (draft.waitingList || []).filter(w => String(w.uid) !== String(uid));
        pruneTeamsForUid(draft, uid);
    }, hadCredit ? refundHooks(_ev, uid) : undefined);
    if (res.ok) window.showToast(refunded > 0 ? `Player removed. ${dollars(refunded)} was returned to their credit.` : "Player removed from roster.");
};