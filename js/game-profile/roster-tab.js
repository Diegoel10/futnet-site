// js/game-profile/roster-tab.js: Roster tab with reliable avatar resolution and directory mapping
import { escapeHtml, jsArg } from './event-store.js';
import { creditGame, costCents, dollars, hydrateWaitBalances } from '../credits.js';
import { waitingUids, offerEligible, startMsOf } from '../money-rules.js';
export function renderRosterTab(event) {
    const attendees = Array.isArray(event.attendees) ? event.attendees : [];
    
    window.activeRosterSubTab = window.activeRosterSubTab !== undefined ? window.activeRosterSubTab : 0;

    const waitingArr = Array.isArray(event.waitingList) ? event.waitingList : [];
    const declinedArr = Array.isArray(event.declinedList) ? event.declinedList : [];
    const dedupeByUid = (list) => {
        const seen = new Set();
        return list.filter(p => {
            const key = String(p.uid || p.name);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };

    const confirmedList = attendees.filter(a => (a.status || 'confirmed') === 'confirmed');
    const waitlistList = dedupeByUid([
        ...waitingArr,
        ...attendees.filter(a => a.status === 'waitlist' || a.status === 'waiting')
    ]);
    const declinedList = dedupeByUid([
        ...declinedArr,
        ...attendees.filter(a => a.status === 'cancelled' || a.status === 'not_going')
    ]);

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

    const resolveAvatar = (att) => window.resolvePlayerAvatar(att);

    const currentList = window.activeRosterSubTab === 0 ? confirmedList : (window.activeRosterSubTab === 1 ? waitlistList : declinedList);

    // Admins (organizer or community admin) see each waitlist player's choice, credit and spot offer.
    const viewer = String(window.currentUser?.uid || '');
    const isAdminViewer = !!viewer && (viewer === String(event.organizerId) || (event.communityId && (window.myCommunityRoles || {})[event.communityId] === 'admin'));
    const waitOrder = waitingUids(event);
    const offeredNow = window.activeRosterSubTab === 1 && isAdminViewer ? offerEligible(event, Date.now(), startMsOf(event)) : [];
    const offerEnds = event.spotOffer && event.spotOffer.expiresAt ? Number(event.spotOffer.expiresAt) : 0;
    const waitInfoHtml = (att) => {
        if (window.activeRosterSubTab !== 1 || !isAdminViewer || !att.uid) return '';
        const uid = String(att.uid);
        const pos = waitOrder.indexOf(uid) + 1;
        const bits = [];
        if (pos) bits.push(`<span class="text-white/70">#${pos} in line</span>`);
        bits.push(att.autoJoin === true ? '<span class="text-[#00F296]">⚡ Put me in automatically</span>' : '<span class="text-amber-200">🙋 Ask me first</span>');
        if (creditGame(event) && !uid.startsWith('usr_')) {
            const need = costCents(event, (att.guests || []).length);
            bits.push(`<span data-wait-balance="${escapeHtml(event.communityId)}|${escapeHtml(uid)}|${need}" class="text-white/50">💳 checking credit…</span>`);
        }
        if (offeredNow.includes(uid)) {
            bits.push(`<span class="text-[#00F296] font-black">🎟️ Spot offered${offerEnds && !(event.spotOffer && event.spotOffer.lastCall) ? ` · until ${new Date(offerEnds).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ' · first to confirm'}</span>`);
        }
        return `<div class="ml-12 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold">${bits.join('')}</div>`;
    };

    const renderAttendeeCard = (att) => {
        const isPaid = att.paid === 'Paid' || att.paid === 'Credit' || att.creditPaidCents > 0;
        const safeAvatar = resolveAvatar(att);
        const rawName = att.name || att.firstName || att.displayName || att.fullName || 'Player';
        const safeName = rawName.replace(/'/g, "\\'");
        const isOrganizer = att.uid === event.organizerId;

        let guestsHtml = '';
        if (att.guests && att.guests.length > 0) {
            guestsHtml = att.guests.map((g) => `
                <div class="flex items-center justify-between text-xs bg-black/30 p-2 rounded-xl border border-white/5 ml-8">
                    <div class="flex items-center gap-2.5">
                        <div class="w-6 h-6 rounded-full bg-emerald-500/20 text-[#00F296] font-black flex items-center justify-center text-[10px] border border-emerald-500/40">
                            ${escapeHtml((g.name || 'G').charAt(0).toUpperCase())}
                        </div>
                        <div>
                            <span class="text-white/90 font-bold">${escapeHtml(g.name || 'Guest')}</span>
                            <span class="text-[9px] text-[#00F296] block">guest of ${escapeHtml(rawName)}</span>
                        </div>
                    </div>
                    <span class="text-[9px] font-bold px-2 py-0.5 rounded-full border ${(g.paid === 'Paid' || g.paid === 'Credit') ? 'bg-emerald-500/20 text-[#00F296] border-emerald-500/40' : 'bg-black/40 text-white/60 border-white/10'}">${(g.paid === 'Paid' || g.paid === 'Credit') ? 'Paid' : escapeHtml(g.paid || 'Unpaid')}</span>
                </div>
            `).join('');
        }

        const statusBadgeClass = window.activeRosterSubTab === 0 
            ? (isPaid ? 'bg-emerald-500/20 text-[#00F296] border-emerald-500/40' : 'bg-black/40 text-white/70 border-white/15')
            : (window.activeRosterSubTab === 1 ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-red-500/20 text-red-300 border-red-500/40');
        
        const statusLabel = window.activeRosterSubTab === 0 ? (isPaid ? 'Paid' : escapeHtml(att.paid || 'Unpaid')) : (window.activeRosterSubTab === 1 ? 'Waitlist' : 'Declined');
        const organizerBadge = isOrganizer ? '<span class="text-[8px] bg-[#00F296]/20 text-[#00F296] px-2 py-0.5 rounded font-black border border-[#00F296]/40">Organizer</span>' : '';
        const attendanceBadge = window.activeRosterSubTab === 0 && att.attendance === 'late' ? '<span class="text-[8px] bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded font-black border border-amber-400/40">Late</span>'
            : window.activeRosterSubTab === 0 && att.attendance === 'noshow' ? '<span class="text-[8px] bg-red-500/20 text-red-300 px-2 py-0.5 rounded font-black border border-red-500/40">No-show</span>'
            : window.activeRosterSubTab === 2 && att.removedByAdmin ? '<span class="text-[8px] bg-white/10 text-white/60 px-2 py-0.5 rounded font-black border border-white/20">Removed</span>' : '';
        const plusOnesBadge = att.guests && att.guests.length > 0 ? `<span class="text-[9px] text-[#00F296] font-bold mt-0.5 block">+${att.guests.length} Plus One(s)</span>` : '';

        return `
            <div class="bg-black/40 border border-white/10 p-3 rounded-2xl space-y-2">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3 cursor-pointer group" onclick="openPlayerProfileModal('${jsArg(att.uid || '')}', '${jsArg(rawName)}', '')">
                        <img src="${escapeHtml(safeAvatar)}" class="w-9 h-9 rounded-full object-cover border border-emerald-500/40 group-hover:scale-105 transition" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                        <div>
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="text-xs font-bold text-white group-hover:text-[#00F296] transition">${escapeHtml(rawName)}</span>
                                ${window.skillBadge ? window.skillBadge(att.uid || '') : ''}
                                ${organizerBadge}
                                ${attendanceBadge}
                            </div>
                            ${plusOnesBadge}
                        </div>
                    </div>
                    <span class="text-[10px] font-bold px-2.5 py-1 rounded-full border ${statusBadgeClass}">
                        ${statusLabel}
                    </span>
                </div>
                ${waitInfoHtml(att)}
                ${guestsHtml}
            </div>
        `;
    };

    const emptyMessage = window.activeRosterSubTab === 0 ? 'No confirmed players on the roster yet.' : (window.activeRosterSubTab === 1 ? 'Waitlist is empty.' : 'No declined responses.');
    const listContentHtml = currentList.length === 0 
        ? `<div class="text-center text-xs text-white/40 py-8">${emptyMessage}</div>`
        : currentList.map(att => renderAttendeeCard(att)).join('');

    if (window.activeRosterSubTab === 1 && isAdminViewer && creditGame(event)) setTimeout(() => { try { hydrateWaitBalances(); } catch (e) {} }, 0);
    return `
        <div class="space-y-4 font-sans text-white">
            ${(() => {
                // "Who wants to be captain?" (the admin asked; shown to players going until Caps mode starts)
                const me = String(window.currentUser?.uid || '');
                const call = event.captainCall && event.captainCall.open && !(event.capsDraft && event.capsDraft.status === 'live');
                if (!call || !me || !(event.attendees || []).some(a => String(a.uid) === me)) return '';
                const yes = (event.captainVolunteers || []).map(String).includes(me);
                const no = (event.captainNo || []).map(String).includes(me);
                const n = (event.captainVolunteers || []).length;
                return `<div class="bg-amber-400/10 border border-amber-400/60 rounded-[22px] p-4 space-y-3">
                    <div class="text-sm font-black text-white">🧢 Want to be a captain?</div>
                    <p class="text-[11px] text-white/70">Captains pick their teams before the game. ${n ? `${n} ${n === 1 ? 'player has' : 'players have'} raised their hand so far.` : 'Be the first to raise your hand!'}</p>
                    <div class="grid grid-cols-2 gap-2">
                        <button onclick="answerCaptainCall('${event.id}', true)" class="py-2.5 rounded-xl text-xs font-black ${yes ? 'bg-amber-400 text-slate-950' : 'bg-black/50 text-white border border-white/20'}">🙋 ${yes ? "I'm in!" : 'Yes, me!'}</button>
                        <button onclick="answerCaptainCall('${event.id}', false)" class="py-2.5 rounded-xl text-xs font-black ${no ? 'bg-white/20 text-white' : 'bg-black/50 text-white/70 border border-white/20'}">No thanks</button>
                    </div>
                </div>`;
            })()}
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
                <div class="space-y-2.5 pr-1">
                    ${listContentHtml}
                </div>
            </div>
        </div>
    `;
};

window.resolvePlayerAvatar = function(person) {
    const initials = () => `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(person?.name || person?.firstName || 'Player')}`;
    if (!person) return initials();
    const uid = person.uid ? String(person.uid) : '';
    const isGenerated = (u) => typeof u === 'string' && u.includes('api.dicebear.com');
    const usable = (u) => typeof u === 'string' && u.trim() !== '';

    if (uid && window.currentUser && uid === String(window.currentUser.uid) && usable(window.userProfile?.avatar)) {
        return window.userProfile.avatar;
    }
    if (uid && Array.isArray(window.directoryList)) {
        const hit = window.directoryList.find(u => String(u.uid) === uid);
        if (hit && usable(hit.avatar)) return hit.avatar;
        if (hit && usable(hit.photoURL)) return hit.photoURL;
    }
    const own = person.avatar || person.photoURL || person.profilePicture;
    if (usable(own) && !isGenerated(own)) return own;
    return usable(own) ? own : initials();
};

window.switchRosterSubTab = function(subIndex) {
    window.activeRosterSubTab = subIndex;
    if (typeof window.renderEventDetailModalContent === 'function') {
        window.renderEventDetailModalContent();
    }
};

// Tap a player on the roster: the same card as in Communities (photo, position, attendance + skill stars,
// Add friend / Message, View stats; Manage for the organizer/admins; Close for everyone).
window.openPlayerProfileModal = function(uid, name, avatar) {
    if (!uid || String(uid).startsWith('manual_')) return;
    const me = window.currentUser?.uid;
    const photo = avatar && avatar.trim() !== '' ? avatar : window.resolvePlayerAvatar({ uid, name });
    window._popupPerson = { uid, name, avatar: photo };
    const eventId = window.activeModalEventId;
    const ev = (window.eventsList || []).find(e => String(e.id) === String(eventId)) || {};
    const canManage = !!me && (ev.organizerId === me || (ev.communityId && (window.myCommunityRoles || {})[ev.communityId] === 'admin'));
    const d = (window.cachedDirectoryList || window.directoryList || []).find(u => String(u.uid) === String(uid)) || {};
    const isOrganizer = uid === ev.organizerId;
    const idOf = (f) => String(typeof f === 'string' ? f : (f && f.uid) || '');
    const isFriend = (window.friendsList || []).some(f => idOf(f) === String(uid));
    const sent = (window.sentRequestsList || []).some(f => idOf(f) === String(uid));
    const theyAsked = (window.receivedRequestsList || []).some(f => idOf(f) === String(uid));
    const row = (k, v) => v ? `<div class="flex justify-between items-center gap-3 text-xs"><span class="text-white/50">${k}</span><span class="font-bold text-white text-right">${v}</span></div>` : '';
    const DARK = 'bg-black/60 hover:bg-black text-white font-bold rounded-xl text-xs border border-white/15 transition flex items-center justify-center gap-2';
    const GREEN = 'bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black rounded-xl text-xs transition flex items-center justify-center gap-2';
    const friendBtn = isFriend ? `<div class="${DARK} flex-1 py-3 opacity-80"><i class="fa-solid fa-user-check text-[#00F296]"></i> Friends</div>`
        : sent ? `<div class="${DARK} flex-1 py-3 opacity-70"><i class="fa-solid fa-clock"></i> Request sent</div>`
        : `<button onclick="rosterCardFriend('${jsArg(uid)}', ${theyAsked})" class="${DARK} flex-1 py-3"><i class="fa-solid fa-user-plus"></i> ${theyAsked ? 'Accept friend' : 'Add friend'}</button>`;

    let modal = document.getElementById('player-profile-popup');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'player-profile-popup';
        modal.className = 'fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm';
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/30 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="text-center space-y-2">
                <img id="player-popup-img" class="w-24 h-24 rounded-full object-cover border-2 border-[#00F296] mx-auto" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                <div id="player-popup-name" class="text-lg font-black"></div>
                <span class="inline-block text-[9px] font-black uppercase tracking-wider rounded-full px-2 py-0.5 ${isOrganizer ? 'bg-[#00F296] text-slate-950' : 'bg-white/10 text-white/80'}">${isOrganizer ? 'Organizer' : 'Player'}</span>
            </div>
            <div class="space-y-2.5 bg-black/40 border border-white/10 rounded-xl p-3">
                ${row('Nickname', escapeHtml(d.nickname || ''))}
                ${row('Position', escapeHtml(d.position || ''))}
                ${window.ratingStars ? row('Attendance', window.ratingStars(uid, 'attendance')) : ''}
                ${window.ratingStars ? row('Skill', window.ratingStars(uid, 'skill')) : ''}
            </div>
            ${uid !== me ? `<div class="flex gap-2">
                ${friendBtn}
                <button onclick="sendDirectMessageFromRoster(window._popupPerson.uid, window._popupPerson.name, window._popupPerson.avatar)" class="${GREEN} flex-1 py-3"><i class="fa-solid fa-comments"></i> Message</button>
            </div>` : ''}
            <button onclick="document.getElementById('player-profile-popup').remove(); openPlayerStatsSheet(window._popupPerson.uid, window._popupPerson.name, window._popupPerson.avatar, '${jsArg(ev.communityId || '')}')" class="${DARK} w-full py-3">
                <i class="fa-solid fa-chart-simple text-[#00F296]"></i> View stats</button>
            <div class="flex gap-2">
                <button onclick="document.getElementById('player-profile-popup').remove()" class="${DARK} flex-1 py-3">Close</button>
                ${canManage && eventId ? `<button onclick="document.getElementById('player-profile-popup').remove(); openPlayerManagementModal('${jsArg(eventId)}', '${jsArg(uid)}', window._popupPerson.name)" class="${GREEN} flex-1 py-3"><i class="fa-solid fa-sliders"></i> Manage</button>` : ''}
            </div>
        </div>`;
    document.getElementById('player-popup-img').src = photo;
    document.getElementById('player-popup-name').textContent = name;
};

window.rosterCardFriend = async function(uid, accept) {
    if (accept && window.acceptFriendRequest) await window.acceptFriendRequest(uid);
    else if (window.sendFriendRequest) await window.sendFriendRequest(uid);
    const p = window._popupPerson;
    setTimeout(() => { if (document.getElementById('player-profile-popup') && p) window.openPlayerProfileModal(p.uid, p.name, p.avatar); }, 600);
};

window.sendDirectMessageFromRoster = function(uid, name, avatar) {
    const modal = document.getElementById('player-profile-popup');
    if (modal) modal.remove();
    // Close the game, go to Messages and open (or start) the chat with this player.
    window.activeModalEventId = null;
    if (typeof window.openDirectChat === 'function') {
        window.openDirectChat(uid, name, avatar);
    } else {
        window.switchTab('chat');
        if (typeof window.startChatWithPlayer === 'function') window.startChatWithPlayer(uid, name, avatar);
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