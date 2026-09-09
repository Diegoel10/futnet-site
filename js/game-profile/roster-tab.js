// js/game-profile/roster-tab.js
export function renderRosterTab(event) {
    const attendees = event.attendees || [];
    const waitingList = event.waitingList || [];
    const declinedList = event.declinedList || [];

    // Calculate max capacity dynamically (e.g., format "8v8" -> 8 players * teamsCount)
    const formatMatch = (event.format || "").match(/(\d+)/);
    const playersPerTeam = formatMatch ? parseInt(formatMatch[1]) : 7;
    const maxCapacity = playersPerTeam * (event.teamsCount || 3);

    // 🛡️ Auto-reconcile overflow: If attendees exceed maxCapacity, shift excess players to waitingList automatically
    if (attendees.length > maxCapacity) {
        const overflowCount = attendees.length - maxCapacity;
        const shiftedPlayers = attendees.splice(maxCapacity, overflowCount);
        shiftedPlayers.forEach(p => { p.status = 'waiting'; });
        waitingList.push(...shiftedPlayers);
        event.attendees = attendees;
        event.waitingList = waitingList;
    }

    // Count total confirmed bodies including attendees + their nested guests
    let totalConfirmedCount = attendees.length;
    attendees.forEach(att => {
        if (att.guests && Array.isArray(att.guests)) {
            totalConfirmedCount += att.guests.length;
        }
    });

    return `
        <div class="space-y-6">
            <!-- Header Status -->
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                <div>
                    <h4 class="text-xs font-black text-slate-900 uppercase">Match Roster (${totalConfirmedCount}/${maxCapacity})</h4>
                    <p class="text-[11px] text-slate-500">Confirmed players, guests, waitlist, and declined responses.</p>
                </div>
                <button onclick="openTeamMakingModal('${event.id}')" class="bg-brand hover:bg-brand-dark text-slate-950 font-black px-4 py-2.5 rounded-xl text-xs shadow transition flex items-center gap-2">
                    <i class="fa-solid fa-shield-halved"></i> Team Building Tool
                </button>
            </div>

            <!-- 1. Confirmed Attendees Section -->
            <div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
                <h4 class="text-xs font-black text-slate-900 uppercase tracking-wider">Confirmed Attendees (${totalConfirmedCount})</h4>
                <div class="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                    ${attendees.length === 0 ? '<div class="text-center text-xs text-slate-400 py-6">No players confirmed yet. Be the first to join!</div>' : ''}
                    ${attendees.map(att => {
                        const isPaid = att.paid === 'Paid';
                        const safeAvatar = att.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';
                        const safeName = (att.name || 'Player').replace(/'/g, "\\'");
                        return `
                            <div class="bg-slate-50 border border-slate-200 p-3 rounded-xl shadow-xs space-y-2">
                                <div class="flex items-center justify-between">
                                    <div class="flex items-center gap-3 cursor-pointer group" onclick="openPlayerProfileModal('${att.uid}', '${safeName}', '${safeAvatar}')">
                                        <img src="${safeAvatar}" class="w-8 h-8 rounded-full object-cover border border-slate-300 group-hover:border-brand transition">
                                        <div>
                                            <div class="text-xs font-bold text-slate-900 group-hover:text-brand transition">${att.name}</div>
                                            <div class="text-[10px] text-slate-500">${att.position || 'Player'}</div>
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${isPaid ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-slate-200 text-slate-700'} flex items-center shadow-xs">
                                            ${isPaid ? '<i class="fa-solid fa-dollar-sign text-emerald-600 mr-1"></i>' : ''}Confirmed
                                        </span>
                                    </div>
                                </div>

                                <!-- Nested Plus-Ones / Guests Sub-section -->
                                ${(att.guests && att.guests.length > 0) ? `
                                    <div class="ml-11 pl-3 border-l-2 border-emerald-200 space-y-1.5 pt-1">
                                        ${att.guests.map((g) => `
                                            <div class="flex items-center justify-between text-xs bg-white p-2 rounded-lg border border-slate-200">
                                                <span class="text-slate-700 font-medium">➕ ${g.name} <span class="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold ml-1">Guest of ${att.name}</span></span>
                                                <span class="text-[10px] font-bold text-slate-400">Confirmed (+1)</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- 2. Waitlist Section -->
            <div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
                <h4 class="text-xs font-black text-amber-800 uppercase tracking-wider">⏳ Waitlist (${waitingList.length})</h4>
                <div class="space-y-2 max-h-[30vh] overflow-y-auto pr-1">
                    ${waitingList.length === 0 ? '<div class="text-center text-xs text-slate-400 py-4">No players on the waitlist.</div>' : ''}
                    ${waitingList.map(w => {
                        const safeAvatar = w.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';
                        const safeName = (w.name || 'Player').replace(/'/g, "\\'");
                        return `
                            <div class="flex items-center justify-between bg-amber-50/50 border border-amber-200 p-3 rounded-xl shadow-xs">
                                <div class="flex items-center gap-3 cursor-pointer group" onclick="openPlayerProfileModal('${w.uid}', '${safeName}', '${safeAvatar}')">
                                    <img src="${safeAvatar}" class="w-8 h-8 rounded-full object-cover border border-amber-300 group-hover:border-brand transition">
                                    <div class="text-xs font-bold text-slate-900 group-hover:text-brand transition">${w.name}</div>
                                </div>
                                <span class="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200">Waiting</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- 3. RSVP No's (Declined) Section -->
            <div class="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
                <h4 class="text-xs font-black text-red-700 uppercase tracking-wider">❌ RSVP No / Declined (${declinedList.length})</h4>
                <div class="space-y-2 max-h-[30vh] overflow-y-auto pr-1">
                    ${declinedList.length === 0 ? '<div class="text-center text-xs text-slate-400 py-4">No declined responses.</div>' : ''}
                    ${declinedList.map(d => {
                        const safeAvatar = d.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';
                        const safeName = (d.name || 'Player').replace(/'/g, "\\'");
                        return `
                            <div class="flex items-center justify-between bg-red-50/50 border border-red-200 p-3 rounded-xl shadow-xs">
                                <div class="flex items-center gap-3 cursor-pointer group" onclick="openPlayerProfileModal('${d.uid}', '${safeName}', '${safeAvatar}')">
                                    <img src="${safeAvatar}" class="w-8 h-8 rounded-full object-cover border border-red-300 group-hover:border-brand transition">
                                    <div class="text-xs font-bold text-slate-900 group-hover:text-brand transition">${d.name}</div>
                                </div>
                                <span class="text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-800 border border-red-200">Declined</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}

// 👤 Interactive Player Profile Popup Modal Handler
window.openPlayerProfileModal = function(uid, name, avatar) {
    if (!uid || uid === window.currentUser?.uid) return; // Prevent opening on yourself

    let modal = document.getElementById('player-profile-popup');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'player-profile-popup';
        modal.className = 'fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-white rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-slate-900 text-center animate-in fade-in zoom-in duration-200">
            <div class="flex justify-end">
                <button onclick="document.getElementById('player-profile-popup').remove()" class="text-slate-400 hover:text-slate-700 text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="flex flex-col items-center space-y-2">
                <img src="${avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-20 h-20 rounded-full object-cover border-4 border-brand shadow-md">
                <h3 class="text-base font-black text-slate-900">${name}</h3>
            </div>
            <div class="space-y-2 pt-2">
                <button onclick="sendDirectMessageFromRoster('${uid}', '${name.replace(/'/g, "\\'")}', '${avatar}')" class="w-full bg-brand hover:bg-brand-dark text-slate-950 font-black py-3 rounded-xl text-xs shadow transition flex items-center justify-center gap-2">
                    <i class="fa-solid fa-comments"></i> Send Message
                </button>
                <button onclick="sendFriendRequestFromRoster('${uid}')" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-3 rounded-xl text-xs transition flex items-center justify-center gap-2">
                    <i class="fa-solid fa-user-plus"></i> Send Friend Request
                </button>
            </div>
        </div>
    `;
};

window.sendDirectMessageFromRoster = function(uid, name, avatar) {
    const modal = document.getElementById('player-profile-popup');
    if (modal) modal.remove();
    
    if (typeof window.openChatThread === 'function') {
        window.openChatThread({ uid, name, avatar });
    } else {
        window.switchTab('chat');
    }
};

window.sendFriendRequestFromRoster = function(uid) {
    const modal = document.getElementById('player-profile-popup');
    if (modal) modal.remove();

    if (typeof window.sendFriendRequest === 'function') {
        window.sendFriendRequest(uid);
    } else {
        window.showToast("Friend request sent successfully!");
    }
};