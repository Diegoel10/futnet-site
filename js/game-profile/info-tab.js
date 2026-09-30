// js/game-profile/info-tab.js: Renders the core game info summary tab matching the mobile app
export function renderInfoTab(event) {
    const organizerName = event.organizer || event.hostName || 'Organizer';
    const organizerAvatar = event.organizerAvatar || event.hostAvatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
    const organizerId = event.organizerId;

    const currentUid = window.currentUser?.uid;
    const attendees = Array.isArray(event.attendees) ? event.attendees : [];
    const hasJoined = attendees.some(a => a.uid === currentUid && (a.status === 'confirmed' || !a.status));
    const allowPlusOnes = event.allowPlusOnes === true || event.allowPlusOnes === 'yes';

    const formatVal = event.format || '7v7';
    const feeVal = event.fee !== undefined ? event.fee : 'Free';
    const teamsVal = event.teamsCount ? `${event.teamsCount} Teams` : '3 Teams';
    const descText = event.description || "Standard game. Come ready to play, have fun and respect the squad. 💪⚽";
    const rulesText = event.rules || "Standard fair play rules apply. Be punctual and respectful.";

    return `
        <div class="space-y-4">
            <!-- 1. Organizer Card -->
            <div class="bg-[#040E13]/95 border border-emerald-500/40 rounded-[18px] p-4 flex items-center justify-between shadow-lg">
                <div onclick="openPlayerProfileModal('${organizerId}', '${organizerName.replace(/'/g, "\\'")}', '${organizerAvatar}')" class="flex items-center gap-3 cursor-pointer group">
                    <img src="${organizerAvatar}" class="w-11 h-11 rounded-full object-cover border-[1.5px] border-[#00F296] shadow-md group-hover:scale-105 transition">
                    <div>
                        <div class="text-[8px] font-black uppercase text-white/50 tracking-wider">ORGANIZER</div>
                        <h4 class="text-sm font-black text-white group-hover:text-[#00F296] transition mt-0.5">${organizerName}</h4>
                    </div>
                </div>
                <span class="text-[10px] font-bold px-3 py-1.5 rounded-full bg-[#00F296]/15 text-[#00F296] border border-[#00F296]/40">Organizer</span>
            </div>

            <!-- 2. Date, Time & Location Box -->
            <div class="bg-[#040E13]/95 border border-emerald-500/40 rounded-[18px] p-4 flex items-center justify-between gap-4 shadow-lg">
                <div class="space-y-3 flex-1">
                    <div class="space-y-0.5">
                        <span class="text-[8px] font-black text-white/55 uppercase tracking-wider flex items-center gap-1">
                            <i class="fa-solid fa-calendar text-[#00F296] text-[10px]"></i> Date
                        </span>
                        <p class="text-xs font-bold text-white">${event.date || 'TBD'}</p>
                    </div>
                    <div class="space-y-0.5">
                        <span class="text-[8px] font-black text-white/55 uppercase tracking-wider flex items-center gap-1">
                            <i class="fa-solid fa-clock text-[#00F296] text-[10px]"></i> Time
                        </span>
                        <p class="text-xs font-bold text-white">${event.time || 'TBD'}</p>
                    </div>
                </div>

                <div class="w-[1px] h-14 bg-white/15"></div>

                <div class="space-y-1 flex-[1.5]">
                    <span class="text-[8px] font-black text-white/55 uppercase tracking-wider flex items-center gap-1">
                        <i class="fa-solid fa-location-dot text-[#00F296] text-[10px]"></i> Park & Location
                    </span>
                    <p class="text-xs font-bold text-white leading-snug line-clamp-2">${event.location || 'Location TBD'}</p>
                </div>

                <button onclick="window.open('https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location || '')}', '_blank')" class="bg-[#00F296] hover:opacity-90 text-slate-950 font-black px-3.5 py-3 rounded-xl text-xs shadow-md transition flex flex-col items-center justify-center gap-1 shrink-0">
                    <i class="fa-solid fa-location-arrow text-sm"></i>
                    <span class="text-[9px] uppercase">Navigate</span>
                </button>
            </div>

            <!-- 3. Format, Fee & Teams Row -->
            <div class="bg-[#040E13]/95 border border-emerald-500/40 rounded-[18px] p-4 grid grid-cols-3 gap-2 shadow-lg text-center">
                <div class="space-y-0.5 border-r border-white/10 pr-2">
                    <span class="text-[8px] font-black text-white/55 uppercase tracking-wider">Format</span>
                    <p class="text-xs font-bold text-white">${formatVal}</p>
                </div>
                <div class="space-y-0.5 border-r border-white/10 px-2">
                    <span class="text-[8px] font-black text-white/55 uppercase tracking-wider">Entry Fee</span>
                    <p class="text-xs font-bold text-white">${feeVal}</p>
                </div>
                <div class="space-y-0.5 pl-2">
                    <span class="text-[8px] font-black text-white/55 uppercase tracking-wider">Teams</span>
                    <p class="text-xs font-bold text-white">${teamsVal}</p>
                </div>
            </div>

            <!-- 4. Dynamic Action Button (Cancel RSVP / Manage Guests vs Join Game Roster) -->
            ${hasJoined ? `
                ${allowPlusOnes ? `
                    <div class="flex gap-3">
                        <button onclick="handleCancelRsvp('${event.id}')" class="flex-1 bg-red-500/25 hover:bg-red-500/40 border border-red-500 text-red-300 font-black py-3.5 rounded-2xl transition text-xs uppercase shadow-lg">
                            Cancel RSVP
                        </button>
                        <button onclick="handleManageGuests('${event.id}')" class="flex-1 bg-[#00B4AE]/30 hover:bg-[#00B4AE]/50 border border-[#00B4AE] text-[#00F296] font-black py-3.5 rounded-2xl transition text-xs uppercase shadow-lg">
                            Manage Guests
                        </button>
                    </div>
                ` : `
                    <button onclick="handleCancelRsvp('${event.id}')" class="w-full bg-red-500/25 hover:bg-red-500/40 border border-red-500 text-red-300 font-black py-3.5 rounded-2xl transition text-xs uppercase shadow-lg">
                        Leave Game / Cancel RSVP
                    </button>
                `}
            ` : `
                <button onclick="handleJoinGame('${event.id}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3.5 rounded-2xl transition text-xs uppercase tracking-wider shadow-[0_4px_15px_rgba(0,242,150,0.3)] flex items-center justify-center space-x-2">
                    <i class="fa-solid fa-user-plus"></i>
                    <span>Join Game Roster</span>
                </button>
            `}

            <!-- 5. Expandable Game Details Card -->
            <div class="bg-[#040E13]/95 border border-emerald-500/40 rounded-[18px] p-4 shadow-lg space-y-2">
                <div class="flex items-center justify-between cursor-pointer" onclick="toggleSection('game-details-content', 'game-details-chevron')">
                    <div class="flex items-center space-x-2.5">
                        <i class="fa-solid fa-file-lines text-[#00F296] text-sm"></i>
                        <span class="text-xs font-black text-white tracking-wider uppercase">Game Details</span>
                    </div>
                    <i id="game-details-chevron" class="fa-solid fa-chevron-down text-white/50 text-xs transition-transform"></i>
                </div>
                <div id="game-details-content" class="text-xs text-white/80 font-medium pt-2 leading-relaxed border-t border-white/10">
                    ${descText}
                </div>
            </div>

            <!-- 6. Expandable Rules Card -->
            <div class="bg-[#040E13]/95 border border-emerald-500/40 rounded-[18px] p-4 shadow-lg space-y-2">
                <div class="flex items-center justify-between cursor-pointer" onclick="toggleSection('game-rules-content', 'game-rules-chevron')">
                    <div class="flex items-center space-x-2.5">
                        <i class="fa-solid fa-list-check text-[#00F296] text-sm"></i>
                        <span class="text-xs font-black text-white tracking-wider uppercase">Rules & Guidelines</span>
                    </div>
                    <i id="game-rules-chevron" class="fa-solid fa-chevron-down text-white/50 text-xs transition-transform"></i>
                </div>
                <div id="game-rules-content" class="text-xs text-white/80 font-medium pt-2 leading-relaxed border-t border-white/10">
                    ${rulesText}
                </div>
            </div>
        </div>
    `;
};

window.toggleSection = function(contentId, chevronId) {
    const content = document.getElementById(contentId);
    const chevron = document.getElementById(chevronId);
    if (content && chevron) {
        content.classList.toggle('hidden');
        chevron.classList.toggle('rotate-180');
    }
};

window.handleJoinGame = function(eventId) {
    if (!window.currentUser) {
        window.showToast("Please sign in to join games", "error");
        return;
    }
    if (typeof window.executeJoinGameModal === 'function') {
        window.executeJoinGameModal(eventId);
    } else {
        window.showToast("Successfully joined roster!");
    }
};

window.handleCancelRsvp = function(eventId) {
    if (confirm("Are you sure you want to cancel your RSVP for this game?")) {
        if (typeof window.executeCancelRsvpAction === 'function') {
            window.executeCancelRsvpAction(eventId);
        } else {
            window.showToast("RSVP cancelled successfully.");
        }
    }
};