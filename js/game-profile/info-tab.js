// js/game-profile/info-tab.js: Match Info tab renderer matching iOS app UI and RSVP rules
export function renderInfoTab(event) {
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

    // Check user RSVP status
    const userId = window.currentUser ? String(window.currentUser.uid) : '';
    const isConfirmed = userId && attendeesArr.some(a => String(a.uid) === userId);
    const waitingListArr = Array.isArray(event.waitingList) ? event.waitingList : [];
    const isWaitlisted = userId && waitingListArr.some(w => String(w.uid) === userId);
    const allowPlusOnes = event.allowPlusOnes || false;

    // RSVP Button logic:
    // 1. Not in confirmed list -> Join Game! (Green)
    // 2. Already in confirmed list -> Leave Game / Cancel RSVP (Red) [Plus Manage Guests if enabled]
    // 3. Game full -> Join Waitlist! (Yellow)
    let rsvpButtonHtml = '';
    if (isConfirmed) {
        if (allowPlusOnes) {
            rsvpButtonHtml = `
                <div class="grid grid-cols-2 gap-2.5">
                    <button onclick="handleRSVPAction('${event.id}', 'cancel')" class="bg-red-500/25 hover:bg-red-500/35 text-red-400 font-black py-3.5 rounded-xl text-xs border-2 border-red-500/50 shadow transition uppercase tracking-wider flex items-center justify-center gap-2">
                        <i class="fa-solid fa-user-xmark"></i> Cancel RSVP
                    </button>
                    <button onclick="openManageGuestsModal('${event.id}')" class="bg-teal-500/25 hover:bg-teal-500/35 text-[#00F296] font-black py-3.5 rounded-xl text-xs border-2 border-teal-500/50 shadow transition uppercase tracking-wider flex items-center justify-center gap-2">
                        <i class="fa-solid fa-users-gear"></i> Manage Guests
                    </button>
                </div>
            `;
        } else {
            rsvpButtonHtml = `
                <button onclick="handleRSVPAction('${event.id}', 'cancel')" class="w-full bg-red-500/25 hover:bg-red-500/35 text-red-400 font-black py-3.5 rounded-xl text-xs border-2 border-red-500/50 shadow-lg uppercase tracking-wider transition flex items-center justify-center gap-2">
                    <i class="fa-solid fa-user-xmark"></i> Leave Game / Cancel RSVP
                </button>
            `;
        }
    } else if (isFull) {
        rsvpButtonHtml = `
            <button onclick="openJoinGameModal('${event.id}')" class="w-full bg-amber-400 hover:opacity-95 text-slate-950 font-black py-3.5 rounded-xl text-xs shadow-lg uppercase tracking-wider transition flex items-center justify-center gap-2">
                <i class="fa-solid fa-hourglass-half"></i> Join Waitlist!
            </button>
        `;
    } else {
        rsvpButtonHtml = `
            <button onclick="openJoinGameModal('${event.id}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3.5 rounded-xl text-xs shadow-lg uppercase tracking-wider transition flex items-center justify-center gap-2">
                <i class="fa-solid fa-person-badge-plus text-sm"></i> Join Game!
            </button>
        `;
    }

    return `
        <div class="space-y-4 font-sans text-white">
            
            <!-- 1. Organizer Card -->
            <div class="bg-[#040E13]/95 border-2 border-[#00B4AE]/60 rounded-[22px] p-4 flex items-center justify-between shadow-[0_0_20px_rgba(0,180,174,0.2)]">
                <div class="flex items-center gap-3">
                    <img src="${finalHostAvatar}" class="w-11 h-11 rounded-full object-cover border-2 border-[#00F296]/60 shadow-md" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                    <div>
                        <span class="text-[9px] font-black text-white/50 uppercase tracking-wider block">ORGANIZER</span>
                        <span class="text-sm font-black text-white">${organizerName}</span>
                    </div>
                </div>
                <span class="px-3 py-1 bg-[#00F296]/15 text-[#00F296] font-black text-[10px] rounded-full border-2 border-[#00F296]/40">Organizer</span>
            </div>

            <!-- 2. Date & Time -->
            <div class="bg-[#040E13]/95 border-2 border-[#00B4AE]/60 rounded-[22px] px-4 py-3.5 grid grid-cols-2 gap-2 shadow-xl text-left">
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

            <!-- 3. Format, Fee & Teams Row -->
            <div class="bg-[#040E13]/95 border-2 border-[#00B4AE]/60 rounded-[22px] p-4 grid grid-cols-3 gap-2 shadow-[0_0_20px_rgba(0,180,174,0.2)] text-center">
                <div class="space-y-0.5 border-r border-white/10 pr-2">
                    <span class="text-[9px] font-black text-white/50 uppercase tracking-wider block">Format</span>
                    <span class="text-xs font-bold text-white">${event.format || '7v7'}</span>
                </div>
                <div class="space-y-0.5 border-r border-white/10 px-2">
                    <span class="text-[9px] font-black text-white/50 uppercase tracking-wider block">Entry Fee</span>
                    <span class="text-xs font-bold text-white">${displayPrice}</span>
                </div>
                <div class="space-y-0.5 pl-2">
                    <span class="text-[9px] font-black text-white/50 uppercase tracking-wider block">Teams</span>
                    <span class="text-xs font-bold text-white">${teamsCountNum} Teams</span>
                </div>
            </div>

            <!-- 4. RSVP Action Button -->
            <div class="pt-1">
                ${rsvpButtonHtml}
            </div>

            <!-- 5. Expandable Game Details Card -->
            <div class="bg-[#040E13]/95 border-2 border-[#00B4AE]/60 rounded-[22px] p-4 space-y-2 shadow-[0_0_20px_rgba(0,180,174,0.2)]">
                <div class="flex items-center gap-2.5 text-xs font-black text-white">
                    <i class="fa-solid fa-file-lines text-[#00F296]"></i> Game Details
                </div>
                <p class="text-xs text-white/80 leading-relaxed font-medium pl-6">${event.description || 'Standard game. Come ready to play, have fun and respect the squad. 💪⚽'}</p>
            </div>

            <!-- 6. Expandable Rules Card -->
            <div class="bg-[#040E13]/95 border-2 border-[#00B4AE]/60 rounded-[22px] p-4 space-y-2 shadow-[0_0_20px_rgba(0,180,174,0.2)]">
                <div class="flex items-center gap-2.5 text-xs font-black text-white">
                    <i class="fa-solid fa-list-check text-[#00F296]"></i> Rules
                </div>
                <p class="text-xs text-white/80 leading-relaxed font-medium pl-6">${event.rules || 'Standard fair play rules apply. Be punctual and respectful.'}</p>
            </div>
        </div>
    `;
};

// Quick helper modal for managing guests when already joined
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
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 class="text-xs font-black uppercase text-white">Manage Your Guests</h3>
                <button onclick="document.getElementById('manage-guests-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <p class="text-[11px] text-white/60">You can bring up to ${maxGuests} guest(s). Edit names or add new ones.</p>
            
            <div id="manage-guests-list-inputs" class="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                ${guests.map((g, idx) => `
                    <div class="flex items-center gap-2">
                        <input type="text" id="manage-guest-input-${idx}" value="${g.name || ''}" class="flex-1 bg-black border border-teal-500/50 rounded-xl px-3 py-2 text-white text-xs font-medium" placeholder="Guest name...">
                        <button onclick="window.removeGuestInputRow(${idx})" class="text-red-400 hover:text-red-300 px-2 py-1"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `).join('')}
            </div>

            <button onclick="window.addNewGuestInputRow('${eventId}')" class="w-full bg-black/60 hover:bg-black text-[#00F296] font-bold py-2.5 rounded-xl text-xs border border-[#00F296]/40 transition flex items-center justify-center gap-2">
                <i class="fa-solid fa-plus"></i> Add Another Guest
            </button>

            <button onclick="window.saveManagedGuests('${eventId}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3 rounded-xl text-xs shadow uppercase tracking-wider transition">
                Save Changes
            </button>
        </div>
    `;
};

window.addNewGuestInputRow = function(eventId) {
    const container = document.getElementById('manage-guests-list-inputs');
    if (!container) return;
    const idx = container.children.length;
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2';
    div.innerHTML = `
        <input type="text" id="manage-guest-input-${idx}" value="" class="flex-1 bg-black border border-teal-500/50 rounded-xl px-3 py-2 text-white text-xs font-medium" placeholder="Guest name...">
        <button onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-300 px-2 py-1"><i class="fa-solid fa-trash"></i></button>
    `;
    container.appendChild(div);
};

window.saveManagedGuests = async function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event || !window.currentUser) return;

    const inputs = document.querySelectorAll('[id^="manage-guest-input-"]');
    const newGuests = [];
    inputs.forEach(inp => {
        const val = inp.value.trim();
        if (val) {
            newGuests.push({ name: val, paid: 'Unpaid' });
        }
    });

    event.attendees = (event.attendees || []).map(att => {
        if (String(att.uid) === String(window.currentUser.uid)) {
            return { ...att, guests: newGuests };
        }
        return att;
    });

    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), { attendees: event.attendees }, { merge: true });
        window.showToast("Guests updated successfully!");
        document.getElementById('manage-guests-modal')?.remove();
        window.renderEventDetailModalContent();
    } catch (e) {
        window.showToast("Failed to update guests", "error");
    }
};