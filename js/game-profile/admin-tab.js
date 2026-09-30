// js/game-profile/admin-tab.js: Clean, modular admin tab implementation with working Edit/Copy, profile pictures, and match records
import { db, appId } from '../firebase-config.js';
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.adminAccordionState = window.adminAccordionState || {
    manageEvent: false,
    managePlayers: false,
    manageMatches: true
};

window.toggleAdminSection = function(sectionKey) {
    window.adminAccordionState[sectionKey] = !window.adminAccordionState[sectionKey];
    if (typeof window.renderEventDetailModalContent === 'function') {
        window.renderEventDetailModalContent();
    }
};

export function renderAdminTab(event) {
    const isSessionEnded = event.isSessionEnded || false;
    const attendees = Array.isArray(event.attendees) ? event.attendees : [];
    const waitingList = Array.isArray(event.waitingList) ? event.waitingList : [];
    const matches = Array.isArray(event.matches) ? event.matches : [];
    const states = window.adminAccordionState;

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

    let totalConfirmedPeople = attendees.length;
    attendees.forEach(att => {
        if (att.guests && Array.isArray(att.guests)) {
            totalConfirmedPeople += att.guests.length;
        }
    });

    const eventChevron = states.manageEvent ? 'fa-chevron-up' : 'fa-chevron-down';
    const playersChevron = states.managePlayers ? 'fa-chevron-up' : 'fa-chevron-down';
    const matchesChevron = states.manageMatches ? 'fa-chevron-up' : 'fa-chevron-down';

    const eventBodyClass = states.manageEvent ? 'space-y-3 pt-3 border-t border-white/10' : 'hidden';
    const playersBodyClass = states.managePlayers ? 'space-y-4 pt-3 border-t border-white/10' : 'hidden';
    const matchesBodyClass = states.manageMatches ? 'space-y-3 pt-3 border-t border-white/10' : 'hidden';

    const attendeesHtml = attendees.length === 0 
        ? '<div class="text-center text-xs text-white/40 py-4">No players confirmed yet.</div>'
        : attendees.map(att => {
            let attAvatar = att.avatar || att.photoURL || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
            const isOrg = att.uid === event.organizerId;
            const paidStatus = att.paid || 'Unpaid';
            const safeName = (att.name || 'Player').replace(/'/g, "\\'");
            const orgBadge = isOrg ? '<span class="text-[8px] bg-[#00F296]/20 text-[#00F296] px-2 py-0.5 rounded font-black border border-[#00F296]/40">Organizer</span>' : '';

            let guestsHtml = '';
            if (att.guests && att.guests.length > 0) {
                guestsHtml = att.guests.map((g, gIdx) => `
                    <div class="flex items-center justify-between text-xs bg-black/30 p-2 rounded-lg border border-white/5">
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
                <div class="bg-black/40 border border-white/10 p-3 rounded-xl space-y-2">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3 overflow-hidden">
                            <img src="${attAvatar}" class="w-8 h-8 rounded-full object-cover bg-black border border-white/20 shrink-0">
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

    const matchesListHtml = matches.length === 0 
        ? '<div class="text-center text-xs text-white/40 py-3">No match results recorded yet.</div>'
        : matches.map((m, mIdx) => {
            const teamA = m.teamA || "Team 1";
            const teamB = m.teamB || "Team 2";
            const t1Goals = Array.isArray(m.team1Goals) ? m.team1Goals : [];
            const t2Goals = Array.isArray(m.team2Goals) ? m.team2Goals : [];

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
                        <span class="bg-[#00F296]/20 text-[#00F296] px-3.5 py-1 rounded-full border border-[#00F296]/40 text-xs tracking-wider font-mono">${t1Goals.length} - ${t2Goals.length}</span>
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

    return `
        <div class="space-y-4">
            <!-- SECTION 1: MANAGE EVENT -->
            <div class="bg-[#040E13]/95 border border-emerald-500/40 rounded-[18px] p-4 shadow-lg space-y-3">
                <div onclick="toggleAdminSection('manageEvent')" class="flex items-center justify-between cursor-pointer">
                    <div>
                        <h4 class="text-xs font-black text-[#00F296] uppercase tracking-wider">MANAGE EVENT</h4>
                        <p class="text-[10px] text-white/50">Modify title, time, rules, or venue.</p>
                    </div>
                    <i class="fa-solid ${eventChevron} text-white/60 text-xs"></i>
                </div>

                <div class="${eventBodyClass}">
                    <div class="flex flex-wrap gap-2">
                        <button onclick="openEditEventForm('${event.id}')" class="bg-[#00F296] hover:opacity-90 text-slate-950 font-black px-3.5 py-2 rounded-xl text-xs shadow-md transition">Edit Game</button>
                        <button onclick="copyEvent('${event.id}')" class="bg-black/60 hover:bg-black text-white font-bold px-3.5 py-2 rounded-xl text-xs border border-white/20 transition flex items-center gap-1.5">
                            <i class="fa-solid fa-copy text-[10px]"></i> Copy Event
                        </button>
                        <button onclick="confirmCancelGame('${event.id}')" class="bg-red-500/20 hover:bg-red-500/30 text-red-400 font-bold px-3 py-2 rounded-xl text-xs border border-red-500/40 transition">Cancel Game</button>
                    </div>
                </div>
            </div>

            <!-- SECTION 2: MANAGE PLAYERS -->
            <div class="bg-[#040E13]/95 border border-emerald-500/40 rounded-[18px] p-4 shadow-lg space-y-3">
                <div onclick="toggleAdminSection('managePlayers')" class="flex items-center justify-between cursor-pointer">
                    <div>
                        <h4 class="text-xs font-black text-[#00B4AE] uppercase tracking-wider">MANAGE PLAYERS</h4>
                        <p class="text-[10px] text-white/50">Add players or manage roster attendance.</p>
                    </div>
                    <i class="fa-solid ${playersChevron} text-white/60 text-xs"></i>
                </div>

                <div class="${playersBodyClass}">
                    <button onclick="openAddPlayersScreen('${event.id}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3 rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2">
                        <i class="fa-solid fa-user-plus"></i> Add Players
                    </button>

                    <div class="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                        <h5 class="text-[11px] font-black text-white/75 uppercase tracking-wider">Confirmed Attendees (${totalConfirmedPeople})</h5>
                        ${attendeesHtml}
                    </div>

                    ${waitlistHtml}
                </div>
            </div>

            <!-- SECTION 3: MANAGE MATCHES -->
            <div class="bg-[#040E13]/95 border border-emerald-500/40 rounded-[18px] p-4 shadow-lg space-y-3">
                <div onclick="toggleAdminSection('manageMatches')" class="flex items-center justify-between cursor-pointer">
                    <div>
                        <h4 class="text-xs font-black text-[#00F296] uppercase tracking-wider">MANAGE MATCHES</h4>
                        <p class="text-[10px] text-white/50">Start live matches and record scores.</p>
                    </div>
                    <div class="flex items-center gap-3">
                        <button onclick="event.stopPropagation(); toggleSessionEnded('${event.id}')" class="px-2.5 py-1 rounded-lg text-[10px] font-black ${isSessionEnded ? 'bg-amber-400 text-slate-950 shadow' : 'bg-black/60 text-white/70 border border-white/15'}">${isSessionEnded ? 'Session Ended' : 'End Session'}</button>
                        <i class="fa-solid ${matchesChevron} text-white/60 text-xs"></i>
                    </div>
                </div>

                <div class="${matchesBodyClass}">
                    <button onclick="openStartMatchScreen('${event.id}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3 rounded-xl text-xs shadow-md transition flex items-center justify-center gap-2">
                        <i class="fa-solid fa-play"></i> Start Match
                    </button>

                    <div class="space-y-3 pt-1">
                        ${matchesListHtml}
                    </div>
                </div>
            </div>
        </div>
    `;
};

window.populateEventFormFields = function(event, isCopy = false) {
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
    const plusOneLimitEl = document.getElementById('ce-plus-one-limit');

    if (titleEl) titleEl.value = event.title || '';
    if (visibilityEl) visibilityEl.value = event.visibility || 'Public';
    if (dateEl) dateEl.value = isCopy ? '' : (event.date || '');
    
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

    const allowPlus = event.allowPlusOnes ? 'yes' : 'no';
    if (typeof window.setPlusOnesOption === 'function') {
        window.setPlusOnesOption(allowPlus);
    }
    if (plusOneLimitEl) plusOneLimitEl.value = event.plusOneLimit || 1;
};

window.openEditEventForm = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    if (typeof window.switchTab === 'function') {
        window.switchTab('create-event');
    }

    setTimeout(() => {
        window.populateEventFormFields(event, false);
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
    }, 150);
};

window.copyEvent = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    if (typeof window.switchTab === 'function') {
        window.switchTab('create-event');
    }

    setTimeout(() => {
        window.populateEventFormFields(event, true);
        const formEl = document.querySelector('#tab-create-event form') || document.querySelector('#create-event-form');
        if (formEl) {
            const hiddenId = document.getElementById('ce-edit-event-id');
            if (hiddenId) hiddenId.remove();
        }
        if (typeof window.showToast === 'function') {
            window.showToast("Match details copied! Select a new date.", "info");
        }
    }, 150);
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
    window.showToast("Edit match modal coming online!");
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