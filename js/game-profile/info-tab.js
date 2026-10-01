// js/game-profile/info-tab.js: Compact frosted glass layout with resized navigation pills and tighter spacing
export function renderInfoTab(event) {
    const organizerName = event.organizer || event.hostName || 'Organizer';
    const organizerId = event.organizerId;
    const defaultAvatar = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';

    // Prioritize active user profile or directory match over default badge for the organizer avatar
    const dirMatch = (window.directoryList || []).find(u => String(u.uid) === String(organizerId));
    const organizerAvatar = dirMatch?.avatar || window.userProfile?.avatar || event.organizerAvatar || event.hostAvatar || defaultAvatar;

    const currentUid = window.currentUser?.uid;
    const attendees = Array.isArray(event.attendees) ? event.attendees : [];
    const hasJoined = attendees.some(a => a.uid === currentUid && (a.status === 'confirmed' || !a.status));
    const allowPlusOnes = event.allowPlusOnes === true || event.allowPlusOnes === 'yes';

    const formatVal = event.format || '11v11';
    const feeVal = event.fee !== undefined ? event.fee : '$6';
    const teamsVal = event.teamsCount ? `${event.teamsCount} Teams` : '3 Teams';
    const descText = event.description || "Test";
    const rulesText = event.rules || "Test";

    return `
        <div class="space-y-3 font-sans text-white pt-1">
            <!-- 1. Organizer Card -->
            <div class="bg-[#040E13]/95 border border-[#00B4AE]/60 rounded-[20px] p-3.5 flex items-center justify-between shadow-[0_0_20px_rgba(0,180,174,0.2)]">
                <div onclick="openPlayerProfileModal('${organizerId}', '${organizerName.replace(/'/g, "\\'")}', '${organizerAvatar}')" class="flex items-center gap-3 cursor-pointer group">
                    <img src="${organizerAvatar}" class="w-10 h-10 rounded-full object-cover border-2 border-[#00F296] shadow-md group-hover:scale-105 transition">
                    <div>
                        <div class="text-[8px] font-black uppercase text-white/50 tracking-wider">ORGANIZER</div>
                        <h4 class="text-xs font-black text-white group-hover:text-[#00F296] transition mt-0.5">${organizerName}</h4>
                    </div>
                </div>
                <span class="text-[9px] font-bold px-3 py-1 rounded-full bg-[#00F296]/15 text-[#00F296] border border-[#00F296]/50 shadow-[0_0_12px_rgba(0,242,150,0.3)]">Organizer</span>
            </div>

            <!-- 2. Date, Time & Location Box -->
            <div class="bg-[#040E13]/95 border border-[#00B4AE]/60 rounded-[20px] p-3.5 flex items-center justify-between gap-3 shadow-[0_0_20px_rgba(0,180,174,0.2)]">
                <div class="space-y-2.5 flex-1">
                    <div class="space-y-0.5">
                        <span class="text-[8px] font-black text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                            <i class="fa-solid fa-calendar text-[#00F296] text-[9px]"></i> Date
                        </span>
                        <p class="text-[11px] font-black text-white tracking-wide">${event.date || '2026-09-30'}</p>
                    </div>
                    <div class="space-y-0.5">
                        <span class="text-[8px] font-black text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                            <i class="fa-solid fa-clock text-[#00F296] text-[9px]"></i> Time
                        </span>
                        <p class="text-[11px] font-black text-white tracking-wide">${event.time || '8:00 PM'}</p>
                    </div>
                </div>

                <div class="w-[1px] h-12 bg-white/15"></div>

                <div class="space-y-1 flex-[1.6]">
                    <span class="text-[8px] font-black text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                        <i class="fa-solid fa-location-dot text-[#00F296] text-[9px]"></i> Park & Location
                    </span>
                    <p class="text-[11px] font-black text-white leading-snug">${event.location || 'George Gerber Park (Coconut Creek, Florida)'}</p>
                </div>

                <button onclick="window.open('https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location || '')}', '_blank')" class="bg-[#00F296] hover:opacity-90 text-slate-950 font-black px-3.5 py-3 rounded-xl text-xs shadow-[0_0_15px_rgba(0,242,150,0.4)] transition flex flex-col items-center justify-center gap-0.5 shrink-0">
                    <i class="fa-solid fa-location-arrow text-xs"></i>
                    <span class="text-[7px] uppercase font-black tracking-wider">Navigate</span>
                </button>
            </div>

            <!-- 3. Format, Fee & Teams Split Row -->
            <div class="bg-[#040E13]/95 border border-[#00B4AE]/60 rounded-[20px] p-3.5 grid grid-cols-3 gap-2 shadow-[0_0_20px_rgba(0,180,174,0.2)] text-center">
                <div class="space-y-1 border-r border-white/15 pr-1">
                    <span class="text-[8px] font-black text-white/50 uppercase tracking-wider">Format</span>
                    <p class="text-[11px] font-black text-white">${formatVal}</p>
                </div>
                <div class="space-y-1 border-r border-white/15 px-1">
                    <span class="text-[8px] font-black text-white/50 uppercase tracking-wider">Entry Fee</span>
                    <p class="text-[11px] font-black text-white">${feeVal}</p>
                </div>
                <div class="space-y-1 pl-1">
                    <span class="text-[8px] font-black text-white/50 uppercase tracking-wider">Teams</span>
                    <p class="text-[11px] font-black text-white">${teamsVal}</p>
                </div>
            </div>

            <!-- 4. Dynamic Action Button -->
            ${hasJoined ? `
                ${allowPlusOnes ? `
                    <div class="flex gap-2.5">
                        <button onclick="handleCancelRsvp('${event.id}')" class="flex-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500 text-red-400 font-black py-3 rounded-xl transition text-[11px] uppercase tracking-wider shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                            Cancel RSVP
                        </button>
                        <button onclick="handleManageGuests('${event.id}')" class="flex-1 bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3 rounded-xl transition text-[11px] uppercase tracking-wider shadow-[0_4px_15px_rgba(0,242,150,0.3)]">
                            Manage Guests
                        </button>
                    </div>
                ` : `
                    <button onclick="handleCancelRsvp('${event.id}')" class="w-full bg-red-500/20 hover:bg-red-500/30 border border-red-500 text-red-400 font-black py-3 rounded-xl transition text-[11px] uppercase tracking-wider shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                        Cancel RSVP
                    </button>
                `}
            ` : `
                <button onclick="handleJoinGame('${event.id}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3.5 rounded-xl transition text-[11px] uppercase tracking-wider shadow-[0_4px_15px_rgba(0,242,150,0.3)] flex items-center justify-center space-x-2">
                    <i class="fa-solid fa-user-plus text-xs"></i>
                    <span>Join Game Roster</span>
                </button>
            `}

            <!-- 5. Expandable Game Details Card -->
            <div class="bg-[#040E13]/95 border border-[#00B4AE]/60 rounded-[20px] p-3.5 shadow-[0_0_20px_rgba(0,180,174,0.2)] space-y-2">
                <div class="flex items-center justify-between cursor-pointer" onclick="toggleSection('game-details-content', 'game-details-chevron')">
                    <div class="flex items-center space-x-2">
                        <i class="fa-solid fa-file-lines text-[#00F296] text-xs"></i>
                        <span class="text-[11px] font-black text-white tracking-wider uppercase">Game Details</span>
                    </div>
                    <i id="game-details-chevron" class="fa-solid fa-chevron-down text-white/50 text-xs transition-transform"></i>
                </div>
                <div id="game-details-content" class="text-[11px] text-white/80 font-medium pt-2 leading-relaxed border-t border-white/15">
                    ${descText}
                </div>
            </div>

            <!-- 6. Expandable Rules Card -->
            <div class="bg-[#040E13]/95 border border-[#00B4AE]/60 rounded-[20px] p-3.5 shadow-[0_0_20px_rgba(0,180,174,0.2)] space-y-2">
                <div class="flex items-center justify-between cursor-pointer" onclick="toggleSection('game-rules-content', 'game-rules-chevron')">
                    <div class="flex items-center space-x-2">
                        <i class="fa-solid fa-list-check text-[#00F296] text-xs"></i>
                        <span class="text-[11px] font-black text-white tracking-wider uppercase">Rules & Guidelines</span>
                    </div>
                    <i id="game-rules-chevron" class="fa-solid fa-chevron-down text-white/50 text-xs transition-transform"></i>
                </div>
                <div id="game-rules-content" class="text-[11px] text-white/80 font-medium pt-2 leading-relaxed border-t border-white/15">
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
    if (typeof window.openJoinGameModal === 'function') {
        window.openJoinGameModal(eventId);
    } else {
        window.showToast("Successfully joined roster!");
    }
};

window.handleCancelRsvp = function(eventId) {
    if (confirm("Are you sure you want to cancel your RSVP for this game?")) {
        if (typeof window.handleRSVPAction === 'function') {
            window.handleRSVPAction(eventId, 'cancel');
        } else {
            window.showToast("RSVP cancelled successfully.");
        }
    }
};