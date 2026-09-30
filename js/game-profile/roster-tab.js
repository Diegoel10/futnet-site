// js/game-profile/roster-tab.js: Roster tab with segmented sub-tabs for Confirmed, Waitlist, and Not Going
export function renderRosterTab(event) {
    const attendees = Array.isArray(event.attendees) ? event.attendees : [];
    
    // Maintain active sub-tab state globally per modal session
    window.activeRosterSubTab = window.activeRosterSubTab !== undefined ? window.activeRosterSubTab : 0;

    const confirmedList = attendees.filter(a => (a.status || 'confirmed') === 'confirmed');
    const waitlistList = attendees.filter(a => a.status === 'waitlist');
    const declinedList = attendees.filter(a => a.status === 'cancelled' || a.status === 'not_going');

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

    let totalConfirmedHeads = 0;
    confirmedList.forEach(att => {
        totalConfirmedHeads += 1;
        if (att.guests && Array.isArray(att.guests)) {
            totalConfirmedHeads += att.guests.length;
        }
    });

    let totalWaitlistHeads = 0;
    waitlistList.forEach(w => {
        totalWaitlistHeads += 1;
        if (w.guests && Array.isArray(w.guests)) {
            totalWaitlistHeads += w.guests.length;
        }
    });

    let totalNotGoingHeads = 0;
    declinedList.forEach(d => {
        totalNotGoingHeads += 1;
        if (d.guests && Array.isArray(d.guests)) {
            totalNotGoingHeads += d.guests.length;
        }
    });

    const resolveDirectoryUser = (uid) => {
        if (!window.directoryList || !uid) return null;
        return window.directoryList.find(u => u.uid === uid);
    };

    // Determine current active list based on sub-tab index
    const currentList = window.activeRosterSubTab === 0 ? confirmedList : (window.activeRosterSubTab === 1 ? waitlistList : declinedList);

    return `
        <div class="space-y-4 font-sans text-white">
            <!-- Team Building Tool Banner -->
            <div class="bg-[#040E13]/95 border border-[#00B4AE]/60 rounded-[22px] p-4 flex items-center justify-between shadow-[0_0_20px_rgba(0,180,174,0.2)]">
                <div class="flex items-center gap-3">
                    <i class="fa-solid fa-shuffle text-[#00F296] text-lg"></i>
                    <div>
                        <div class="text-[9px] font-black text-[#00F296] uppercase tracking-wider">TEAM BUILDER TOOL</div>
                        <p class="text-[11px] text-white/70">Format: ${event.format || '11v11'} • Teams: ${event.teamsCount || 3}</p>
                    </div>
                </div>
                <button onclick="openTeamMakingModal('${event.id}')" class="bg-[#00F296] hover:opacity-90 text-slate-950 font-black px-3.5 py-2 rounded-xl text-xs shadow-[0_0_15px_rgba(0,242,150,0.4)] transition">
                    Build Teams
                </button>
            </div>

            <!-- Roster Container with 3 Sub-Tabs -->
            <div class="bg-[#040E13]/95 border border-[#00B4AE]/60 rounded-[22px] p-4 space-y-4 shadow-[0_0_20px_rgba(0,180,174,0.2)]">
                <!-- Sub-tab Bar -->
                <div class="grid grid-cols-3 gap-2 bg-black/40 p-1.5 rounded-xl border border-white/10">
                    <button onclick="switchRosterSubTab(0)" class="py-2 px-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition ${window.activeRosterSubTab === 0 ? 'bg-[#00F296]/25 text-[#00F296] border border-[#00F296]/50 shadow' : 'text-white/60 hover:text-white'}">
                        Confirmed (${totalConfirmedHeads})
                    </button>
                    <button onclick="switchRosterSubTab(1)" class="py-2 px-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition ${window.activeRosterSubTab === 1 ? 'bg-amber-400/25 text-amber-300 border border-amber-400/50 shadow' : 'text-white/60 hover:text-white'}">
                        Waitlist (${totalWaitlistHeads})
                    </button>
                    <button onclick="switchRosterSubTab(2)" class="py-2 px-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition ${window.activeRosterSubTab === 2 ? 'bg-red-500/25 text-red-400 border border-red-500/50 shadow' : 'text-white/60 hover:text-white'}">
                        Not Going (${totalNotGoingHeads})
                    </button>
                </div>

                <!-- Sub-tab Content List -->
                <div class="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
                    ${currentList.length === 0 ? `
                        <div class="text-center text-xs text-white/40 py-8">
                            ${window.activeRosterSubTab === 0 ? 'No confirmed players on the roster yet.' : (window.activeRosterSubTab === 1 ? 'Waitlist is empty.' : 'No declined responses.')}
                        </div>
                    ` : ''}

                    ${currentList.map(att => {
                        const isPaid = att.paid === 'Paid';
                        const dirUser = resolveDirectoryUser(att.uid);

                        const safeAvatar = att.avatar || att.photoURL || att.profilePicture || att.userAvatar || dirUser?.avatar || dirUser?.photoURL || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
                        const rawName = att.name || att.firstName || att.displayName || att.fullName || dirUser?.name || dirUser?.firstName || dirUser?.displayName || 'Player';
                        const safeName = rawName.replace(/'/g, "\\'");
                        const isOrganizer = att.uid === event.organizerId;

                        let guestsHtml = '';
                        if (att.guests && att.guests.length > 0) {
                            guestsHtml = att.guests.map((g, gIdx) => `
                                <div class="flex items-center justify-between text-xs bg-black/30 p-2 rounded-xl border border-white/5 ml-8">
                                    <div class="flex items-center gap-2.5">
                                        <div class="w-6 h-6 rounded-full bg-emerald-500/20 text-[#00F296] font-black flex items-center justify-center text-[10px] border border-emerald-500/40">
                                            ${(g.name || 'G').charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <span class="text-white/90 font-bold">${g.name || 'Guest'}</span>
                                            <span class="text-[9px] text-[#00F296] block">guest of ${rawName}</span>
                                        </div>
                                    </div>
                                    <span class="text-[9px] font-bold px-2 py-0.5 rounded-full bg-black/40 text-white/60 border border-white/10">${g.paid || 'Unpaid'}</span>
                                </div>
                            `).join('');
                        }

                        const statusBadgeClass = window.activeRosterSubTab === 0 
                            ? (isPaid ? 'bg-emerald-500/20 text-[#00F296] border-emerald-500/40' : 'bg-black/40 text-white/70 border-white/15')
                            : (window.activeRosterSubTab === 1 ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-red-500/20 text-red-300 border-red-500/40');
                        
                        const statusLabel = window.activeRosterSubTab === 0 ? (att.paid || 'Unpaid') : (window.activeRosterSubTab === 1 ? 'Waitlist' : 'Declined');

                        return `
                            <div class="bg-black/40 border border-white/10 p-3 rounded-2xl space-y-2">
                                <div class="flex items-center justify-between">
                                    <div class="flex items-center gap-3 cursor-pointer group" onclick="openPlayerProfileModal('${att.uid || ''}', '${safeName}', '${safeAvatar}')">
                                        <img src="${safeAvatar}" class="w-9 h-9 rounded-full object-cover border border-emerald-500/40 group-hover:scale-105 transition">
                                        <div>
                                            <div class="flex items-center gap-1.5 flex-wrap">
                                                <span class="text-xs font-bold text-white group-hover:text-[#00F296] transition">${rawName}</span>${isOrganizer ? '<span class="text-[8px] bg-[#00F296]/20 text-[#00F296] px-2 py-0.5 rounded font-black border border-[#00F296]/40">Organizer</span>' : ''}
                                            </div>
                                            ${att.guests && att.guests.length > 0 ? `<span class="text-[9px] text-[#00F296] font-bold mt-0.5 block">+${att.guests.length} Plus One(s)</span>` : ''}
                                        </div>
                                    </div>
                                    <span class="text-[10px] font-bold px-2.5 py-1 rounded-full border ${statusBadgeClass}">
                                        ${statusLabel}
                                    </span>
                                </div>
                                ${guestsHtml}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
};

window.switchRosterSubTab = function(subIndex) {
    window.activeRosterSubTab = subIndex;
    if (typeof window.renderEventDetailModalContent === 'function') {
        window.renderEventDetailModalContent();
    }
};

window.openPlayerProfileModal = function(uid, name, avatar) {
    if (!uid || uid === window.currentUser?.uid) return;

    let modal = document.getElementById('player-profile-popup');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'player-profile-popup';
        modal.className = 'fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm';
        document.body.appendChild(modal);
    }

    const initialChar = (name || 'U').charAt(0).toUpperCase();

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-xs w-full p-6 space-y-4 shadow-2xl text-white text-center animate-in fade-in zoom-in duration-200">
            <div class="flex justify-end">
                <button onclick="document.getElementById('player-profile-popup').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="flex flex-col items-center space-y-2">
                <img src="${avatar}" class="w-20 h-20 rounded-full object-cover border-4 border-[#00F296] shadow-md" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                <h3 class="text-base font-black text-white">${name}</h3>
            </div>
            <div class="space-y-2 pt-2">
                <button onclick="sendDirectMessageFromRoster('${uid}', '${name.replace(/'/g, "\\'")}', '${avatar}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3 rounded-xl text-xs shadow transition flex items-center justify-center gap-2">
                    <i class="fa-solid fa-comments"></i> Send Message
                </button>
                <button onclick="sendFriendRequestFromRoster('${uid}')" class="w-full bg-black/60 hover:bg-black text-white font-bold py-3 rounded-xl text-xs border border-white/20 transition flex items-center justify-center gap-2">
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