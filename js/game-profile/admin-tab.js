// js/game-profile/admin-tab.js
import { db, appId } from '../firebase-config.js';
import { collection, getDocs, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export function renderAdminTab(event) {
    const isSessionEnded = event.isSessionEnded || false;
    const attendees = event.attendees || [];
    const waitingList = event.waitingList || [];

    window.teamNames = window.teamNames || {};
    window.teamNames[event.id] = window.teamNames[event.id] || event.teamNames || {};

    const selectedUser = window.selectedDirectoryUserToAdd;
    const neutralAvatar = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';

    let totalConfirmedPeople = attendees.length;
    attendees.forEach(att => {
        if (att.guests && Array.isArray(att.guests)) {
            totalConfirmedPeople += att.guests.length;
        }
    });

    return `
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

            <!-- Manage Roster Players Section (With Add Player Bar Inside) -->
            <div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
                <div onclick="toggleAdminManagePlayers()" class="flex items-center justify-between cursor-pointer">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-users-gear text-brand text-xs"></i>
                        <h4 class="text-xs font-black text-slate-900 uppercase tracking-wider">MANAGE ROSTER PLAYERS</h4>
                    </div>
                    <i class="fa-solid fa-chevron-${window.adminManagePlayersExpanded ? 'up' : 'down'} text-slate-500 text-xs"></i>
                </div>
                
                <div class="${window.adminManagePlayersExpanded ? 'space-y-4 pt-3 border-t border-slate-100' : 'hidden'}">
                    <!-- Add Player Input Bar Inside -->
                    <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                        <label class="block text-[10px] font-black text-slate-600 uppercase tracking-wider">➕ Add App User to Roster</label>
                        <div class="relative flex gap-2">
                            <div class="relative flex-1 flex items-center bg-white border border-slate-300 rounded-xl px-3 py-1.5 focus-within:border-brand">
                                <img id="admin-input-avatar-preview" src="${selectedUser ? selectedUser.avatar : neutralAvatar}" class="w-6 h-6 rounded-full object-cover bg-slate-200 border border-slate-300 mr-2.5 ${selectedUser ? '' : 'opacity-40'}">
                                <input type="text" id="admin-add-player-input" oninput="filterDirectoryAutocomplete(this.value, '${event.id}')" value="${selectedUser ? selectedUser.name : ''}" placeholder="Search registered app users..." autocomplete="off" class="w-full bg-transparent text-xs text-slate-950 focus:outline-none font-medium">
                                <div id="friend-autocomplete-dropdown" class="hidden absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-40 overflow-y-auto divide-y divide-slate-100"></div>
                            </div>
                            <button onclick="addFriendToGameRoster('${event.id}')" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow transition shrink-0">Add Player</button>
                        </div>
                    </div>

                    <!-- Confirmed Roster List -->
                    <div class="space-y-2">
                        <h5 class="text-[11px] font-black text-slate-700 uppercase tracking-wider">Confirmed Attendees (${totalConfirmedPeople})</h5>
                         ${attendees.map(att => {
                            let rawAttAvatar = att.avatar || att.photoURL || att.profilePic || att.image || att.imageUrl;
                            if (rawAttAvatar && rawAttAvatar.includes('unsplash.com/photo-1570295999919')) {
                                rawAttAvatar = null;
                            }
                            const attAvatar = rawAttAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(att.name || 'Player')}`;
                            return `
                                <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 shadow-sm space-y-2">
                                    <div class="flex items-center justify-between">
                                        <div class="flex items-center gap-3 overflow-hidden">
                                            <img src="${attAvatar}" class="w-9 h-9 rounded-full object-cover bg-slate-200 border border-slate-300 shrink-0">
                                            <div class="truncate">
                                                <div class="flex items-center gap-1.5 flex-wrap">
                                                    <span class="text-xs font-bold text-slate-900 truncate">${att.name}</span>
                                                    ${att.uid === event.organizerId ? '<span class="text-[9px] bg-brand/20 text-emerald-800 px-2 py-0.5 rounded font-black">Organizer</span>' : ''}
                                                </div>
                                                <div class="flex items-center gap-2 mt-0.5">
                                                    <span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${att.paid === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}">${att.paid || 'Unpaid'}</span>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <!-- Mobile-Friendly Manage Button Popup Trigger -->
                                        <button onclick="openPlayerManagementModal('${event.id}', '${att.uid}', '${(att.name || 'Player').replace(/'/g, "\\'")}')" class="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-3 py-1.5 rounded-xl text-xs transition shrink-0 flex items-center gap-1 shadow-sm">
                                            <i class="fa-solid fa-sliders text-[10px]"></i> Manage
                                        </button>
                                    </div>

                                    <!-- Nested Plus-Ones / Guests Sub-section with Manage Button -->
                                    ${(att.guests && att.guests.length > 0) ? `
                                        <div class="ml-11 pl-3 border-l-2 border-emerald-200 space-y-1.5 pt-1">
                                            ${att.guests.map((g, gIdx) => `
                                                <div class="flex items-center justify-between text-xs bg-white p-2 rounded-lg border border-slate-200">
                                                    <div>
                                                        <span class="text-slate-700 font-medium">➕ ${g.name}</span>
                                                        <span class="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold ml-1">Guest of ${att.name}</span>
                                                        <div class="mt-0.5"><span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${g.paid === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}">${g.paid || 'Unpaid'}</span></div>
                                                    </div>
                                                    <button onclick="openGuestManagementModal('${event.id}', '${att.uid}', ${gIdx}, '${(g.name || 'Guest').replace(/'/g, "\\'")}')" class="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-2.5 py-1 rounded-xl text-[11px] transition shrink-0 flex items-center gap-1 shadow-sm">
                                                        <i class="fa-solid fa-sliders text-[9px]"></i> Manage
                                                    </button>
                                                </div>
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>

                    <!-- Waitlist Section in Admin Tab -->
                    <div class="space-y-2 pt-2 border-t border-slate-100">
                        <h5 class="text-[11px] font-black text-amber-800 uppercase tracking-wider">⏳ Waitlist (${waitingList.length})</h5>
                        ${waitingList.length === 0 ? '<div class="text-xs text-slate-400 py-2">No players on the waitlist.</div>' : ''}
                        ${waitingList.map(w => `
                            <div class="bg-amber-50/50 p-3 rounded-xl border border-amber-200 shadow-sm flex items-center justify-between">
                                <div class="flex items-center gap-3">
                                    <img src="${w.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-8 h-8 rounded-full object-cover bg-amber-200 border border-amber-300">
                                    <span class="text-xs font-bold text-slate-900">${w.name}</span>
                                </div>
                                <button onclick="removePlayerFromEvent('${event.id}', '${w.uid}')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1 rounded-xl text-xs font-bold">Remove</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <!-- Match Results Section -->
            <div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-4 shadow-sm">
                <div onclick="toggleAdminMatchResults()" class="flex items-center justify-between cursor-pointer">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-futbol text-brand text-xs"></i>
                        <h4 class="text-xs font-black text-slate-900 uppercase tracking-wider">MATCH RESULTS & ADD GAMES</h4>
                    </div>
                    <div class="flex items-center gap-3">
                        <button onclick="event.stopPropagation(); toggleSessionEnded('${event.id}')" class="px-3 py-1.5 rounded-xl text-xs font-black ${isSessionEnded ? 'bg-amber-400 text-slate-950 shadow' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">${isSessionEnded ? 'Session Ended' : 'End Session'}</button>
                        <i class="fa-solid fa-chevron-${window.adminMatchResultsExpanded ? 'up' : 'down'} text-slate-500 text-xs"></i>
                    </div>
                </div>

                <div class="${window.adminMatchResultsExpanded ? 'space-y-4 pt-3 border-t border-slate-100' : 'hidden'}">
                    ${(event.matches || []).map((match, mIndex) => {
                        const tNamesMap = window.teamNames[event.id] || {};
                        let teamA = match.teamAIndex !== undefined ? tNamesMap[match.teamAIndex] : null;
                        if (!teamA) {
                            const foundIdx = Object.keys(tNamesMap).find(k => tNamesMap[k] === match.teamA);
                            teamA = foundIdx !== undefined ? tNamesMap[foundIdx] : (match.teamA || tNamesMap[0] || "Team 1");
                        }

                        let teamB = match.teamBIndex !== undefined ? tNamesMap[match.teamBIndex] : null;
                        if (!teamB) {
                            const foundIdxB = Object.keys(tNamesMap).find(k => tNamesMap[k] === match.teamB);
                            teamB = foundIdxB !== undefined ? tNamesMap[foundIdxB] : (match.teamB || tNamesMap[1] || "Team 2");
                        }

                        const t1Goals = (match.team1Goals || []);
                        const t2Goals = (match.team2Goals || []);
                        const isFinished = match.isFinished || false;
                        
                        const isCardExpanded = window.expandedMatchCards[mIndex] !== undefined ? window.expandedMatchCards[mIndex] : !isFinished;

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

                                <div class="${isCardExpanded ? 'grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2' : 'hidden'}">
                                    <div class="bg-white border border-slate-200 p-3.5 rounded-xl space-y-3 shadow-sm">
                                        <div class="text-xs font-black text-slate-800 uppercase">${teamA} GOALS</div>
                                        <div class="space-y-1.5">
                                            ${t1Goals.map((gName, gIdx) => {
                                                const scorerObj = (attendees || []).find(a => a.name === gName);
                                                let gAvatar = scorerObj?.avatar || scorerObj?.photoURL;
                                                if (gAvatar && gAvatar.includes('unsplash.com/photo-1570295999919')) gAvatar = null;
                                                const finalGoalAvatar = gAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(gName || 'Player')}`;
                                                return `
                                                    <div class="bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-xs font-bold text-slate-800 flex items-center justify-between">
                                                        <div class="flex items-center gap-2">
                                                            <img src="${finalGoalAvatar}" class="w-6 h-6 rounded-full object-cover border border-slate-300">
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
                                                const scorerObj = (attendees || []).find(a => a.name === gName);
                                                let gAvatar = scorerObj?.avatar || scorerObj?.photoURL;
                                                if (gAvatar && gAvatar.includes('unsplash.com/photo-1570295999919')) gAvatar = null;
                                                const finalGoalAvatar = gAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(gName || 'Player')}`;
                                                return `
                                                    <div class="bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg text-xs font-bold text-slate-800 flex items-center justify-between">
                                                        <div class="flex items-center gap-2">
                                                            <img src="${finalGoalAvatar}" class="w-6 h-6 rounded-full object-cover border border-slate-300">
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
    `;
}

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

    modal.innerHTML = `
        <div class="bg-white rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-slate-900 animate-in fade-in zoom-in duration-200">
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <h4 class="text-xs font-black uppercase text-slate-900 truncate">Manage Guest: ${guestName}</h4>
                <button onclick="document.getElementById('guest-management-modal').remove()" class="text-slate-400 hover:text-slate-700 text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="space-y-4">
                <!-- Payment Status Toggle -->
                <div>
                    <label class="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">Payment Status</label>
                    <button onclick="updateGuestPaidStatus('${eventId}', '${attendeeUid}', ${guestIndex}, '${isPaid ? 'Unpaid' : 'Paid'}'); document.getElementById('guest-management-modal').remove();" class="w-full py-3 px-4 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 ${isPaid ? 'bg-emerald-500 text-white shadow-md' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
                        <i class="fa-solid ${isPaid ? 'fa-circle-check text-sm' : 'fa-circle text-slate-400'}"></i>
                        ${isPaid ? 'Mark as Unpaid' : 'Mark as Paid'}
                    </button>
                </div>

                <!-- Remove Guest -->
                <div class="pt-2 border-t border-slate-100">
                    <button onclick="removeGuestFromAttendee('${eventId}', '${attendeeUid}', ${guestIndex}); document.getElementById('guest-management-modal').remove();" class="w-full bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 py-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2">
                        <i class="fa-solid fa-user-minus"></i> Remove Guest
                    </button>
                </div>
            </div>
        </div>
    `;
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
        const eventDocRef = doc(db, 'artifacts', appId, 'eventsList', eventId);
        await setDoc(eventDocRef, event);
        window.showToast("Guest payment status updated!");
        if (typeof window.renderEventDetailModalContent === 'function') {
            window.renderEventDetailModalContent();
        }
    } catch (err) {
        console.error("Error updating guest payment:", err);
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
        const eventDocRef = doc(db, 'artifacts', appId, 'eventsList', eventId);
        await setDoc(eventDocRef, event);
        window.showToast("Guest removed successfully!");
        if (typeof window.renderEventDetailModalContent === 'function') {
            window.renderEventDetailModalContent();
        }
    } catch (err) {
        console.error("Error removing guest:", err);
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

    modal.innerHTML = `
        <div class="bg-white rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-slate-900 animate-in fade-in zoom-in duration-200">
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <h4 class="text-xs font-black uppercase text-slate-900 truncate">Manage: ${playerName}</h4>
                <button onclick="document.getElementById('player-management-modal').remove()" class="text-slate-400 hover:text-slate-700 text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="space-y-4">
                <!-- Payment Status Toggle -->
                <div>
                    <label class="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">Payment Status</label>
                    <button onclick="updatePlayerPaidStatus('${eventId}', '${uid}', '${isPaid ? 'Unpaid' : 'Paid'}'); document.getElementById('player-management-modal').remove();" class="w-full py-3 px-4 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 ${isPaid ? 'bg-emerald-500 text-white shadow-md' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">
                        <i class="fa-solid ${isPaid ? 'fa-circle-check text-sm' : 'fa-circle text-slate-400'}"></i>
                        ${isPaid ? 'Mark as Unpaid' : 'Mark as Paid'}
                    </button>
                </div>

                <!-- Remove from Roster -->
                <div class="pt-2 border-t border-slate-100">
                    <button onclick="removePlayerFromEvent('${eventId}', '${uid}'); document.getElementById('player-management-modal').remove();" class="w-full bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 py-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2">
                        <i class="fa-solid fa-user-minus"></i> Remove from Roster
                    </button>
                </div>
            </div>
        </div>
    `;
};

window._directoryProfileMap = {};
window.selectedDirectoryUserToAdd = null;

window.filterDirectoryAutocomplete = async function(queryStr, eventId) {
    const dropdown = document.getElementById('friend-autocomplete-dropdown');
    if (!dropdown) return;
    const queryText = queryStr.toLowerCase().trim();
    
    if (window.selectedDirectoryUserToAdd && queryText !== window.selectedDirectoryUserToAdd.name.toLowerCase()) {
        window.selectedDirectoryUserToAdd = null;
        const previewImg = document.getElementById('admin-input-avatar-preview');
        if (previewImg) {
            previewImg.src = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
            previewImg.classList.add('opacity-40');
        }
    }

    if (!queryText) {
        dropdown.classList.add('hidden');
        return;
    }

    try {
        const dirRef = collection(db, 'artifacts', appId, 'directory');
        const snap = await getDocs(dirRef);
        window.directoryList = [];
        snap.forEach(docSnap => {
            const data = docSnap.data();
            if (!data.uid) data.uid = docSnap.id;
            window.directoryList.push(data);
        });
    } catch (err) {
        console.error("Error fetching global directory:", err);
    }

    const combinedPool = [
        ...(window.directoryList || []),
        ...(window.friendsList || []),
        ...((window.eventsList || []).flatMap(ev => ev.attendees || []))
    ];

    const seen = new Set();
    const uniqueProfiles = combinedPool.filter(p => {
        const displayName = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim();
        const key = p.uid || displayName;
        if (!displayName || seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const matches = uniqueProfiles.filter(p => {
        const displayName = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim();
        return displayName.toLowerCase().includes(queryText);
    });

    if (matches.length > 0) {
        window._directoryProfileMap = {};
        dropdown.innerHTML = matches.map((f, idx) => {
            const displayName = f.name || `${f.firstName || ''} ${f.lastName || ''}`.trim();
            let rawAvatar = f.avatar || f.photoURL || f.profilePic || f.image || f.imageUrl || f.picture;
            if (rawAvatar && rawAvatar.includes('unsplash.com/photo-1570295999919')) rawAvatar = null;
            
            const avatarUrl = rawAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}`;
            const realUid = f.uid || f.id || ('usr_' + idx + '_' + Date.now());
            
            window._directoryProfileMap[realUid] = {
                name: displayName,
                avatar: avatarUrl,
                uid: realUid,
                position: f.position || 'Player'
            };

            return `
                <div onclick="selectDirectoryProfileById('${realUid}')" class="p-2.5 hover:bg-slate-50 cursor-pointer text-xs flex items-center gap-2">
                    <img src="${avatarUrl}" class="w-6 h-6 rounded-full object-cover bg-slate-200 border border-slate-300">
                    <span class="font-bold text-slate-900">${displayName}</span>
                </div>
            `;
        }).join('');
        dropdown.classList.remove('hidden');
    } else {
        dropdown.innerHTML = `<div class="p-2.5 text-xs text-slate-400">No registered profile found</div>`;
        dropdown.classList.remove('hidden');
    }
};

window.selectDirectoryProfileById = function(userId) {
    const profile = window._directoryProfileMap[userId];
    if (!profile) return;

    const input = document.getElementById('admin-add-player-input');
    if (input) input.value = profile.name;
    
    const previewImg = document.getElementById('admin-input-avatar-preview');
    if (previewImg) {
        previewImg.src = profile.avatar;
        previewImg.classList.remove('opacity-40');
    }
    
    window.selectedDirectoryUserToAdd = {
        uid: profile.uid,
        name: profile.name,
        avatar: profile.avatar,
        position: profile.position || 'Player'
    };

    const dropdown = document.getElementById('friend-autocomplete-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
};

window.addFriendToGameRoster = async function(eventId) {
    const input = document.getElementById('admin-add-player-input');
    const typedName = input ? input.value.trim() : '';
    if (!typedName) return;

    if (!window.selectedDirectoryUserToAdd) {
        window.showToast("Please select a registered app user from the dropdown list.", "error");
        return;
    }

    if (!eventId) {
        console.error("Error: eventId is missing or undefined!");
        window.showToast("Failed to add player: Invalid event ID", "error");
        return;
    }

    try {
        let eventData = null;
        let eventDocRef = doc(db, 'artifacts', appId, 'eventsList', eventId);
        let docSnap = await getDoc(eventDocRef);

        if (docSnap.exists()) {
            eventData = docSnap.data();
        } else {
            const globalRef = doc(db, 'artifacts', appId, 'global', 'events');
            const globalSnap = await getDoc(globalRef);
            if (globalSnap.exists()) {
                const list = globalSnap.data().list || [];
                eventData = list.find(ev => ev.id === eventId);
            }
        }

        if (!eventData) {
            window.showToast("Game event not found", "error");
            return;
        }

        eventData.attendees = eventData.attendees || [];
        eventData.waitingList = eventData.waitingList || [];

        const formatStr = String(eventData.format || "7v7");
        const formatMatch = formatStr.match(/(\d+)/);
        const playersPerTeam = formatMatch ? parseInt(formatMatch[1], 10) : 7;
        const teamsCount = parseInt(eventData.teamsCount, 10) || 3;
        const maxCapacity = playersPerTeam * teamsCount;

        // Calculate actual total heads currently confirmed including guest sub-arrays
        let currentConfirmedHeads = 0;
        eventData.attendees.forEach(a => {
            currentConfirmedHeads += 1 + (a.guests ? a.guests.length : 0);
        });

        const selected = window.selectedDirectoryUserToAdd;
        const fallbackAvatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(selected.name)}`;
        const finalAvatar = selected.avatar && !selected.avatar.includes('dicebear.com/7.x/initials') 
            ? selected.avatar 
            : fallbackAvatar;
        
        const newAttendee = {
            uid: String(selected.uid),
            name: String(selected.name || 'Player'),
            avatar: String(finalAvatar),
            position: String(selected.position || 'Player'),
            role: 'Player',
            status: 'confirmed',
            paid: 'Unpaid',
            guests: []
        };

        const alreadyExists = eventData.attendees.some(a => String(a.uid).trim() === String(newAttendee.uid).trim()) || 
                              eventData.waitingList.some(w => String(w.uid).trim() === String(newAttendee.uid).trim());

        if (alreadyExists) {
            window.showToast("This specific user account is already on the roster or waitlist!", "error");
            return;
        }

        // Use strict head count check instead of row count
        const isFull = currentConfirmedHeads >= maxCapacity;
        if (isFull) {
            newAttendee.status = 'waiting';
            eventData.waitingList.push(newAttendee);
            window.showToast(`${newAttendee.name} added to the waitlist (Roster limit reached)!`, "info");
        } else {
            eventData.attendees.push(newAttendee);
            window.showToast(`${newAttendee.name} added to roster successfully!`);
        }

        await setDoc(eventDocRef, eventData);

        if (window.eventsList) {
            const index = window.eventsList.findIndex(ev => ev.id === eventId);
            if (index !== -1) {
                window.eventsList[index] = eventData;
            }
        }
        window.currentSelectedEvent = eventData;
        
        if (input) input.value = '';
        const previewImg = document.getElementById('admin-input-avatar-preview');
        if (previewImg) {
            previewImg.src = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
            previewImg.classList.add('opacity-40');
        }

        window.selectedDirectoryUserToAdd = null;

        if (typeof window.renderEventDetailModalContent === 'function') {
            window.renderEventDetailModalContent();
        }
    } catch (err) {
        console.error("DETAILED ADD PLAYER ERROR:", err);
        window.showToast("Failed to add player: " + (err.message || "Unknown error"), "error");
    }
};