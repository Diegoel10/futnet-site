// js/game-profile/modal-core.js: Complete updated file with standalone event page routing, browser back button support, and robust deletion/editing
import { db, appId } from '../firebase-config.js';
import { doc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { mutateEvent, pruneTeamsForUid, safeAvatar, escapeHtml } from './event-store.js';
import { joinHooks, refundHooks, creditGame, refundAllowed, feeCents, costCents, costSummary, policyText, hydrateBalances, refundEveryoneForGame, dollars, plusOneExtraCents, myBalanceCents, myLeaveRefund, paymentMethodsHtml } from '../credits.js';
import { mayTakeSpot, startMsOf, freeSpotsOf, offerEligible, claimMinutesOf, waitingUids } from '../money-rules.js';
import { renderAdminTab } from './admin-tab.js';
import { gameStatusCardHtml } from '../game-status.js';
import { renderRosterTab } from './roster-tab.js';
import { renderStatsTab } from './stats-tab.js';
import { renderCommentsTab } from './comments-tab.js';
import { renderTeamToolTab } from './team-tool.js';
import './team-tool.js';
import { resultsBannerHtml } from './results.js';
import { renderLiveTab, adminLiveCardHtml, gameLiveBannerHtml, liveOf, isLive } from '../livestream.js';


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
    setTimeout(() => { try { hydrateBalances(); } catch (e) {} }, 0);
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
    // On the roster = in the list. The organizer who left the game sees "Join" again (not Leave / Manage Guests).
    const isConfirmed = isConfirmedAttendee;
    const allowPlusOnes = event.allowPlusOnes || false;

    // ---- 1. You: "Are you in?" / "You're in!" / waitlist (same look as the iPhone app)
    const myAvatar = safeAvatar(window.userProfile?.avatar) || safeAvatar(window.currentUser?.photoURL) || resolveAvatar({ uid: userId, name: window.userProfile?.firstName || 'Me' });
    const myCircle = (ring, badge) => `<div class="relative w-[76px] h-[76px] mx-auto">
            <img src="${escapeHtml(myAvatar)}" class="w-full h-full rounded-full object-cover bg-black" style="${ring}" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
            ${badge ? `<span class="gi-badge absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-black flex items-center justify-center text-[20px] leading-none">${badge}</span>` : ''}
        </div>`;
    const realGoing = attendeesArr.reduce((n, a) => n + 1 + (Array.isArray(a.guests) ? a.guests.length : 0), 0);
    const spotsLeft = Math.max(0, maxCapacity - realGoing);
    const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
    const card = (border, bg, inner) => `<div class="rounded-[22px] p-4 shadow-xl text-center space-y-3" style="border:2px solid ${border};background:${bg}">${inner}</div>`;
    const DARK = 'rgba(4,14,19,.95)';
    // Play the "You're in" animation only right after joining (not every time the page opens).
    window._giWasIn = window._giWasIn || {};
    const wasIn = window._giWasIn[event.id];
    window._giWasIn[event.id] = !!isConfirmed;
    const justJoined = isConfirmed && wasIn === false;
    if (justJoined) giInjectCss();

    let rsvpButtonHtml = '';
    const waitingEntry = !isConfirmed && userId ? (Array.isArray(event.waitingList) ? event.waitingList : []).find(w => String(w.uid) === userId) : null;
    if (waitingEntry) {
        const nowMs = Date.now(), startMs = startMsOf(event);
        const eligible = offerEligible(event, nowMs, startMs).includes(userId);
        const pos = waitingUids(event).indexOf(userId) + 1;
        const exp = event.spotOffer && event.spotOffer.expiresAt;
        const paid = creditGame(event);
        const claimTxt = claimMinutesOf(event) === 60 ? '1 hour' : claimMinutesOf(event) + ' min';
        rsvpButtonHtml = card(eligible ? '#00F296' : '#FACC15', DARK, `
            ${myCircle(`border:3px solid ${eligible ? '#00F296' : '#FACC15'}`, eligible ? '⭐' : '⏳')}
            ${eligible ? `<div class="text-lg font-black">🎉 A spot opened up for you!</div>
                <div class="text-[12px] text-white/80">${event.spotOffer && event.spotOffer.lastCall ? '<b class="text-amber-300">Last call: the first person to confirm gets it.</b>' : (exp ? `Confirm within <b class="text-[#00F296]" data-countdown="${Number(exp)}">--:--</b>. If you don't, it goes to the next person too (first to confirm wins).` : 'Confirm now to take the spot.')}</div>
                <button onclick="openJoinGameModal('${event.id}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3.5 rounded-2xl text-xs uppercase tracking-wider shadow-lg">${paid ? 'Confirm my spot & pay' : 'Confirm my spot'}</button>`
            : `<div class="text-xl font-black">You're ${ordinal(pos || 1)} on the waitlist</div>
                <div class="text-[12px] text-white/75">${waitingEntry.autoJoin ? (paid ? "When a spot opens you'll be put in automatically (if you have the funds in your credit)." : "When a spot opens you'll be put in automatically.") : `When a spot opens we'll ask you, and you'll have ${claimTxt} to confirm.`}</div>`}
            <label class="flex items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-2xl p-3 cursor-pointer text-left">
                <span><span class="block text-xs font-bold text-white">Put me in automatically</span>
                <span class="block text-[10px] text-white/55">${paid ? 'Must have the funds in your credit.' : 'No need to confirm.'}</span></span>
                <input type="checkbox" ${waitingEntry.autoJoin ? 'checked' : ''} onchange="setWaitlistAuto('${event.id}', this.checked)" class="w-5 h-5 accent-[#00F296] shrink-0">
            </label>
            <button onclick="handleRSVPAction('${event.id}', 'cancel')" class="w-full text-red-400 font-black py-3 rounded-2xl text-xs border-2 border-red-500/60 uppercase tracking-wider">Leave waitlist</button>`);
    } else if (isConfirmed) {
        const mine = attendeesArr.find(a => String(a.uid) === userId) || {};
        const guests = Array.isArray(mine.guests) ? mine.guests : [];
        const when = [event.date ? (window.fmtGameDate || String)(event.date) : '', event.time || ''].filter(Boolean).join(' · ');
        const confetti = justJoined ? Array.from({ length: 14 }, (_, i) => {
            const a = i / 14 * 2 * Math.PI;
            return `<span class="gi-conf" style="--x:${Math.round(Math.cos(a) * 120)}px;--y:${Math.round(Math.sin(a) * 70)}px;animation-delay:${(i % 4) * 30}ms">${['⚽', '🎉', '✨'][i % 3]}</span>`;
        }).join('') : '';
        rsvpButtonHtml = card('rgba(0,242,150,.7)', `linear-gradient(to bottom, rgba(0,242,150,.16), ${DARK})`, `
            <div class="relative h-[90px] flex items-center justify-center ${justJoined ? 'gi-pop' : ''}">${confetti}${myCircle('border:3px solid #00F296;box-shadow:0 0 16px rgba(0,242,150,.7)', '<i class="fa-solid fa-circle-check text-[#00F296] text-[22px]"></i>')}</div>
            <div class="space-y-0.5">
                <div class="text-[22px] font-black">You're in! ⚽</div>
                ${when ? `<div class="text-[12px] font-semibold text-white/65">See you ${escapeHtml(when)}</div>` : ''}
                ${guests.length ? `<div class="text-[12px] font-bold text-[#00F296]">+ ${guests.map(g => escapeHtml(g.name || 'Guest')).join(', ')}</div>` : ''}
            </div>
            <div class="grid ${allowPlusOnes ? 'grid-cols-2' : 'grid-cols-1'} gap-2.5">
                <button onclick="handleRSVPAction('${event.id}', 'cancel')" class="bg-red-500/20 text-red-400 font-black py-3 rounded-2xl text-xs border-2 border-red-500/70 uppercase tracking-wider">Cancel</button>
                ${allowPlusOnes ? `<button onclick="openManageGuestsModal('${event.id}')" class="bg-[#00B4AE]/30 text-[#00F296] font-black py-3 rounded-2xl text-xs border-2 border-[#00B4AE] uppercase tracking-wider flex items-center justify-center gap-1.5">
                    <i class="fa-solid ${guests.length ? 'fa-user-group' : 'fa-user-plus'}"></i> ${guests.length ? 'Manage guests' : 'Bring guests'}</button>` : ''}
            </div>`);
    } else if (userId && ((event.joinRequests || []).some(r => String(r.uid) === userId) || communityRequestPending(event.communityId) === true)) {
        // Asked to join (this game, or the community): don't offer "Join" again.
        const toGame = (event.joinRequests || []).some(r => String(r.uid) === userId);
        rsvpButtonHtml = card('#FACC15', DARK, `
            ${myCircle('border:3px dashed rgba(250,204,21,.8)', '⏳')}
            <div class="space-y-0.5">
                <div class="text-[22px] font-black">Request pending ⏳</div>
                <div class="text-[12px] font-semibold text-white/65">${toGame ? 'The organizer has to approve you. You\'ll be added to the roster when they do.' : 'You asked to join the community. You can join this game once an admin approves you.'}</div>
            </div>
            <button onclick="openJoinGameModal('${event.id}')" class="w-full bg-black/50 text-amber-200 font-black py-3 rounded-2xl text-xs border-2 border-amber-400/50 uppercase tracking-wider">See my request</button>`);
    } else {
        // Not known yet if I asked to join this community: check once, then redraw.
        if (event.communityId && userId && !(window.myCommunityRoles || {})[event.communityId] && event.openToNonMembers !== true
            && communityRequestPending(event.communityId) === null) {
            checkCommunityRequest(event.communityId).then(p => { if (p && window.activeModalEventId === event.id && window.renderEventDetailModalContent) window.renderEventDetailModalContent(); });
        }
        const toWaitlist = isFull || (userId && !mayTakeSpot(event, userId, Date.now(), startMsOf(event)));
        rsvpButtonHtml = card('rgba(0,180,174,.5)', DARK, `
            ${myCircle('border:3px dashed rgba(255,255,255,.35)', '')}
            <div class="space-y-0.5">
                <div class="text-[22px] font-black">${toWaitlist ? "Game's full 😬" : 'Are you in? ⚽'}</div>
                <div class="text-[12px] font-semibold text-white/65">${toWaitlist ? 'Join the waitlist. If a spot opens, it can be yours.' : `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left · ${displayPrice}`}</div>
            </div>
            <button onclick="openJoinGameModal('${event.id}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3.5 rounded-2xl text-xs uppercase tracking-wider shadow-[0_0_14px_rgba(0,242,150,.5)] flex items-center justify-center gap-2">
                <i class="fa-solid ${toWaitlist ? 'fa-hourglass-half' : 'fa-user-plus'}"></i> ${toWaitlist ? 'Join waitlist (free)' : 'Join game'}
            </button>`);
    }

    // ---- 2. The game at a glance
    const box = 'bg-[#040E13]/95 border-2 border-[#00B4AE]/40 rounded-[22px] shadow-xl';
    const fact = (icon, title, value, warn) => `<div class="flex items-center gap-2.5 min-w-0">
            <span class="w-[30px] h-[30px] rounded-[9px] bg-[#00F296]/10 text-[#00F296] flex items-center justify-center text-sm shrink-0"><i class="fa-solid ${icon}"></i></span>
            <div class="min-w-0"><div class="text-[8px] font-black text-white/50">${title}</div><div class="text-[13px] font-bold truncate ${warn ? 'text-yellow-300' : 'text-white'}">${value}</div></div></div>`;
    const chip = (t) => `<span class="text-[11px] font-bold text-[#00F296] bg-[#00F296]/10 rounded-full px-2.5 py-1">${escapeHtml(t)}</span>`;
    const factsHtml = `<div class="${box} p-3.5 space-y-3 text-left">
            <div class="grid grid-cols-2 gap-2">${fact('fa-calendar', 'DATE', event.date ? escapeHtml((window.fmtGameDate || String)(event.date)) : 'TBD')}${fact('fa-clock', 'TIME', escapeHtml(event.time || 'TBD'))}</div>
            <div class="h-px bg-white/10"></div>
            <div class="grid grid-cols-2 gap-2">${fact('fa-circle-dollar-to-slot', 'PRICE', displayPrice)}${fact('fa-users', 'SPOTS', spotsLeft > 0 ? `${spotsLeft} left of ${maxCapacity}` : 'Full · waitlist open', spotsLeft > 0 && spotsLeft <= 3)}</div>
            <div class="flex flex-wrap justify-center gap-1.5">${chip(event.format || '7v7')}${chip(teamsCountNum + (teamsCountNum === 1 ? ' team' : ' teams'))}${allowPlusOnes ? chip(`Guests allowed (up to ${Math.max(1, Number(event.plusOneLimit) || 1)})`) : ''}</div>
        </div>`;

    // ---- 3. Who's going (tap = Roster tab)
    const faces = attendeesArr.slice(0, 6).map((a, i) => `<img src="${escapeHtml(resolveAvatar(a))}" class="w-[30px] h-[30px] rounded-full object-cover border-2 border-[#040E13] bg-black ${i ? '-ml-2.5' : ''}" onerror="this.style.visibility='hidden'">`).join('');
    const goingHtml = `<button onclick="switchModalTab('roster')" class="${box} w-full px-3.5 py-2.5 flex items-center gap-2.5 text-left">
            <span class="flex">${faces}</span>
            <span class="text-[13px] font-bold text-white flex-1">${realGoing ? realGoing + ' going' : 'Be the first one in!'}</span>
            ${realGoing > 6 ? `<span class="text-xs font-bold text-white/50">+${realGoing - 6}</span>` : ''}
            <span class="text-[11px] font-bold text-[#00F296]">Roster <i class="fa-solid fa-chevron-right text-[10px]"></i></span>
        </button>`;

    // ---- 4. Details + rules: closed until tapped, so the page stays short
    const section = (icon, title, text) => `<details class="${box} p-3.5 group">
            <summary class="flex items-center gap-2.5 text-[11px] font-black text-white cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <i class="fa-solid ${icon} text-[#00F296] text-[15px]"></i><span class="flex-1">${title}</span>
                <i class="fa-solid fa-chevron-down text-[10px] text-[#00F296] transition group-open:rotate-180"></i></summary>
            <p class="text-[13px] text-white/90 leading-relaxed font-medium pt-2 whitespace-pre-line">${text}</p>
        </details>`;
    const refund = creditGame(event);
    const rulesText = escapeHtml(event.rules || 'Standard fair play rules apply. Be punctual and respectful.') + (refund ? '\n\n↩️ Refund policy: ' + escapeHtml(policyText(event)) : '');

    return `
        <div class="space-y-3.5 font-sans text-white">
            ${gameStatusCardHtml(event)}
            ${rsvpButtonHtml}
            ${creditGame(event) ? (() => {
                const meUid = window.currentUser ? String(window.currentUser.uid) : '';
                const isOrg = meUid && String(event.organizerId) === meUid;
                const mineAtt = attendeesArr.find(a => String(a.uid) === meUid);
                const paidCents = (mineAtt && mineAtt.creditPaidCents) || 0;
                const member = !!(window.myCommunityRoles || {})[event.communityId];
                return `
            <div class="bg-amber-500/10 border-2 border-amber-400/40 rounded-[22px] p-4 space-y-2 shadow-xl text-left">
                <div class="text-[10px] font-black uppercase tracking-wider text-amber-300"><i class="fa-solid fa-wallet mr-1"></i> Must pay to be confirmed</div>
                <div class="text-xs text-white/90">Cost: <b>${escapeHtml(costSummary(event))}</b> (taken from your community credit)</div>
                ${paidCents > 0 ? `<div class="flex items-center gap-2 bg-emerald-500/15 border border-[#00F296]/50 rounded-xl px-3 py-2 text-xs font-bold text-[#00F296]"><i class="fa-solid fa-circle-check"></i> You paid ${dollars(paidCents)} with credit${(mineAtt.guests || []).length ? ` (you + ${(mineAtt.guests || []).length} guest${(mineAtt.guests || []).length > 1 ? 's' : ''})` : ''}</div>` : ''}
                ${(!isOrg && member) ? `<div class="flex items-center justify-between bg-emerald-500/10 border border-[#00F296]/40 rounded-xl px-3 py-2">
                    <span class="text-[11px] font-bold text-white/80">Your credit</span>
                    <b class="text-base font-black text-[#00F296]" data-credit-balance="${escapeHtml(event.communityId)}">${window.myLiveBalance && window.myLiveBalance(event.communityId) !== null ? dollars(window.myLiveBalance(event.communityId)) : '...'}</b>
                </div>` : ''}
                ${!isOrg ? `<button onclick="openPayDetails('${escapeHtml(event.id)}')" class="w-full bg-black/50 border border-amber-400/40 text-amber-200 font-bold py-2 rounded-xl text-[11px]"><i class="fa-solid fa-money-bill-transfer mr-1"></i> How to add credit</button>` : ''}
            </div>`;
            })() : ''}
            ${factsHtml}
            ${goingHtml}
            ${section('fa-file-lines', 'GAME DETAILS', escapeHtml(event.description || 'Standard game. Come ready to play, have fun and respect the squad. 💪⚽'))}
            ${section('fa-list-check', refund ? 'RULES & REFUND POLICY' : 'RULES', rulesText)}
            ${window.creatorAdminsHtml
                ? window.creatorAdminsHtml({ creator: { uid: organizerId, name: organizerName, avatar: finalHostAvatar }, admins: window.communityAdminsList ? window.communityAdminsList(event.communityId) : [], cid: event.communityId || '' })
                : ''}
        </div>
    `;
};

/** "You're in!" pop + confetti burst (CSS added once). */
function giInjectCss() {
    if (document.getElementById('gi-css')) return;
    const st = document.createElement('style'); st.id = 'gi-css';
    st.textContent = `@keyframes giPop{0%{transform:scale(.4)}60%{transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes giConf{0%{opacity:1;transform:translate(0,0) scale(.4)}100%{opacity:0;transform:translate(var(--x),var(--y)) scale(1.3)}}
@keyframes giBadge{0%,40%{transform:scale(0)}100%{transform:scale(1)}}
.gi-pop>div{animation:giPop .55s cubic-bezier(.3,1.6,.5,1)}
.gi-pop .gi-badge{animation:giBadge .7s ease-out}
.gi-conf{position:absolute;left:50%;top:50%;margin:-11px 0 0 -11px;font-size:18px;pointer-events:none;opacity:0;animation:giConf 1.1s ease-out forwards}`;
    document.head.appendChild(st);
    if (navigator.vibrate) { try { navigator.vibrate([30, 40, 60]); } catch (e) { /* no vibration */ } }
}

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
        modal.className = 'fixed inset-0 z-[210] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-[32px] max-w-sm w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 class="text-xs font-black uppercase tracking-wider text-white">${guests.length ? 'MANAGE YOUR GUESTS' : 'BRING GUESTS'}</h3>
                <button onclick="document.getElementById('manage-guests-modal').remove()" class="w-7 h-7 bg-white/10 rounded-full flex items-center justify-center text-white/70 hover:text-white font-bold"><i class="fa-solid fa-xmark text-xs"></i></button>
            </div>
            <p class="text-[11px] text-white/60 text-center">${guests.length ? `You can bring up to ${maxGuests} guest(s). Edit names or add new ones.` : 'How many guests are you bringing?'}</p>
            ${guests.length ? '' : `<div id="guest-count-pick" class="flex justify-center gap-2">${Array.from({ length: maxGuests }, (_, i) => `<button onclick="pickGuestCount(${i + 1})" class="w-11 h-11 rounded-full border-2 border-[#00F296]/60 text-[#00F296] font-black text-sm hover:bg-[#00F296]/15">${i + 1}</button>`).join('')}</div>`}
            
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

// Bring guests: pick how many, then type their names.
window.pickGuestCount = function (n) {
    const list = document.getElementById('manage-guests-list-inputs'); if (!list) return;
    list.innerHTML = '';
    for (let i = 0; i < n; i++) window.addNewGuestInputRow();
    document.getElementById('guest-count-pick')?.remove();
    const p = list.parentElement.querySelector('p'); if (p) p.textContent = n === 1 ? "Your guest's name" : "Your guests' names";
    list.querySelector('input')?.focus();
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
    const mine0 = (event.attendees || []).find(a => String(a.uid) === myUid) || {};
    const isOrg = String(event.organizerId) === myUid;
    // Paid outside the app (cash / Zelle): the server takes only the new guests from their credit.
    const cashPlayer = !isOrg && mine0.paid === 'Paid' && !(mine0.creditPaidCents > 0);
    // Must-pay games: added guests are paid from credit, removed guests follow the refund policy.
    const credit = creditGame(event) && !isOrg && !cashPlayer;
    // The organizer plays free: ask if their new guests come out of their credit (Cancel = guests free).
    const perGuest = costCents(event, 1) - costCents(event, 0);
    const addingNow = newGuests.length - (mine0.guests || []).length;
    let orgPays = false;
    if (creditGame(event) && isOrg && addingNow > 0) {
        orgPays = confirm(`Pay ${dollars(addingNow * perGuest)} for your guest${addingNow === 1 ? '' : 's'} from your credit?\n\nOK = take it from my credit\nCancel = my guest${addingNow === 1 ? ' plays' : 's play'} free`);
    }
    const orgMode = creditGame(event) && isOrg && (orgPays || (addingNow < 0 && (mine0.guestCreditCents || 0) > 0));
    let short = 0, have = 0, need = 0, noRoom = 0, charged = 0, refunded = 0;
    const hooks = (credit || orgMode) ? (() => {
        const j = joinHooks(event, myUid), r = refundHooks(event, myUid);
        return {
            read: async (tx) => ({ ...(await j.read(tx)), refund: 0 }),
            write: async (tx, draft, ctx) => { if (ctx.charge) await j.write(tx, draft, ctx); else if (ctx.refund) await r.write(tx, draft, ctx); }
        };
    })() : undefined;
    const res = await mutateEvent(eventId, (draft, ctx) => {
        short = 0; noRoom = 0; charged = 0; refunded = 0;
        if (ctx) { ctx.charge = 0; ctx.refund = 0; }
        const me = (draft.attendees || []).find(att => String(att.uid) === myUid);
        if (!me) return false;
        const old = me.guests || [];
        const next = newGuests.map((g, i) => (old[i] && old[i].name === g.name) ? old[i] : g);
        const added = next.length - old.length;
        if (added > 0) {
            const free = capacityOfDraft(draft) - (draft.attendees || []).reduce((n, a) => n + 1 + ((a.guests || []).length), 0);
            if (added > free) { noRoom = Math.max(0, free); return false; }
        }
        if (orgMode && ctx) {
            const gc = me.guestCreditCents || 0;
            if (added > 0 && orgPays) {
                const cost = added * perGuest;
                if (ctx.balance < cost) { short = cost; have = ctx.balance; need = cost; return false; }
                ctx.charge = cost; ctx.chargeNote = 'Guest fee'; charged = cost;
                me.guestCreditCents = gc + cost;
                next.forEach((g, i) => { if (i >= old.length) g.paid = 'Credit'; });
            } else if (added < 0 && gc > 0) {
                const back = myLeaveRefund(draft, Math.min(gc, -added * perGuest)).now;
                if (back > 0) { ctx.refund = back; ctx.note = 'Guest removed'; refunded = back; }
                me.guestCreditCents = gc - back;
            }
        } else if (creditGame(draft) && isOrg && added > 0) {
            next.forEach((g, i) => { if (i >= old.length) g.paid = 'Free'; });
        }
        if (credit && ctx) {
            const paid = me.creditPaidCents || 0;
            const cost = costCents(draft, next.length);
            if (cost > paid) {
                if (ctx.balance < cost - paid) { short = cost - paid; have = ctx.balance; need = cost - paid; return false; }
                ctx.charge = cost - paid; charged = ctx.charge;
                me.creditPaidCents = cost; me.paid = 'Credit'; me.creditCommunityId = draft.communityId;
            } else if (cost < paid) {
                const back = myLeaveRefund(draft, paid - cost).now;
                if (back > 0) { ctx.refund = back; ctx.note = 'Guest removed'; refunded = back; }
                me.creditPaidCents = paid - back;   // what was not refunded still counts as paid
            }
            next.forEach(g => { g.paid = 'Credit'; });
        }
        me.guests = next;
        pruneTeamsForUid(draft, myUid, { keepHost: true, keepGuests: me.guests.length });
    }, hooks);
    if (res.ok && res.aborted && short > 0) { window.showMustPayModal(event, need, have); return; }
    if (res.ok && res.aborted && noRoom >= 0 && newGuests.length > ((event.attendees || []).find(a => String(a.uid) === myUid)?.guests || []).length) {
        window.showToast(noRoom ? `Only ${noRoom} spot(s) left. Remove a guest and try again.` : 'The game is full. No room for more guests.', 'error');
        return;
    }
    if (res.ok && !res.aborted) {
        window.showToast(charged ? `Guests updated! ${dollars(charged)} was taken from your credit.` : refunded ? `Guests updated! ${dollars(refunded)} was returned to your credit.`
            : (cashPlayer && creditGame(event) && addingNow > 0) ? `Guests updated! ${dollars(addingNow * perGuest)} will be taken from your credit.` : "Guests updated successfully!");
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
    if (event.communityId && window.recordCommunityView) window.recordCommunityView(event.communityId, 'game', event.id, event.title || 'Game');   // analytics
    
    window.teamNames = window.teamNames || {};
    window.teamNames[event.id] = event.teamNames || {};
    
    window.teamAssignments = window.teamAssignments || {};
    window.teamAssignments[event.id] = event.teamAssignments || {};

    const isCreator = window.currentUser && (event.organizerId === window.currentUser.uid || (event.communityId && (window.myCommunityRoles || {})[event.communityId] === 'admin'));
    window.activeModalTab = isCreator ? 'admin' : (isLive(event) ? 'live' : 'info');   // players land on the stream while it's live
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
    offerCommunityJoin(event);
};

// A signed-in person who is not in the community opens a members-only community game:
// ask if they would like to join the community. (Games open to non-members, and anyone already on the game, are left alone.)
const _askedCommunity = new Set();
async function offerCommunityJoin(ev) {
    try {
        if (!ev || !ev.communityId || !window.currentUser || ev.openToNonMembers === true) return;
        const uid = String(window.currentUser.uid);
        if (String(ev.organizerId) === uid) return;
        if ((ev.attendees || []).some(a => String(a.uid) === uid)) return;
        if ((ev.waitingList || []).some(a => String(a.uid) === uid)) return;
        if ((ev.joinRequests || []).some(r => String(r.uid) === uid)) return;
        const key = String(ev.communityId);
        if (_askedCommunity.has(key)) return;
        const isMember = window.isCommunityMember ? await window.isCommunityMember(ev.communityId) : true;
        if (isMember || window.activeModalEventId !== ev.id) return;
        _askedCommunity.add(key);
        const c = (window.communitiesCache || {})[ev.communityId] || {};
        const name = escapeHtml(ev.communityName || c.name || 'this community');
        const needsApproval = c.requireApproval !== false;
        let m = document.getElementById('community-offer-modal');
        if (!m) { m = document.createElement('div'); m.id = 'community-offer-modal'; m.className = 'fixed inset-0 z-[205] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md'; document.body.appendChild(m); }
        m.innerHTML = `
            <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white text-center">
                <div class="w-14 h-14 mx-auto rounded-full bg-black/50 border border-emerald-500/30 flex items-center justify-center text-[#00F296] text-xl"><i class="fa-solid fa-people-group"></i></div>
                <p class="text-sm font-black">This game is for members of ${name}.</p>
                <p class="text-xs text-white/70">Do you want to join the community?${needsApproval ? ' An admin will review your request.' : ''}</p>
                <button onclick="requestJoinCommunity('${escapeHtml(String(ev.communityId))}'); document.getElementById('community-offer-modal')?.remove();" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-xs uppercase tracking-wider">${needsApproval ? 'Request to join' : 'Join'} community</button>
                <button onclick="document.getElementById('community-offer-modal')?.remove()" class="w-full bg-black/60 text-white/80 font-bold py-3 rounded-xl text-xs border border-white/20">Not now</button>
            </div>`;
    } catch (e) { console.error(e); }
}

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
    const isCreator = window.currentUser && (event.organizerId === window.currentUser.uid || (event.communityId && (window.myCommunityRoles || {})[event.communityId] === 'admin'));
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

            ${resultsBannerHtml(event)}
            ${gameLiveBannerHtml(event, tab)}

            <!-- Navigation Tabs Bar -->
            <div class="bg-black/40 border-2 border-emerald-500/30 p-1.5 rounded-2xl flex items-center space-x-1 overflow-x-auto shadow-md backdrop-blur-md">
                ${isCreator ? `<button onclick="switchModalTab('admin')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === 'admin' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}"><i class="fa-solid fa-gear mr-1"></i> Admin</button>` : ''}
                ${liveOf(event) ? `<button onclick="switchModalTab('live')" class="flex-1 py-2 px-3 rounded-xl text-xs font-black transition whitespace-nowrap ${tab === 'live' ? 'bg-red-600 text-white shadow' : 'text-red-300 hover:text-white'}">${isLive(event) ? '🔴 Live' : '▶ Replay'}</button>` : ''}
                <button onclick="switchModalTab('info')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === 'info' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">Game Info</button>
                <button onclick="switchModalTab('roster')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === 'roster' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">${rosterDisplayLabel}</button>
                <button onclick="switchModalTab('stats')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === 'stats' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">Game Stats</button>
                <button onclick="switchModalTab('comments')" class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition whitespace-nowrap ${tab === 'comments' ? 'bg-[#00F296] text-slate-950 shadow' : 'text-white/70 hover:text-white'}">Comments (${commentsCount})</button>
            </div>

            <!-- Tab Content View -->
            <div class="bg-[#040E13]/95 border-2 border-emerald-500/40 rounded-3xl p-4 sm:p-6 shadow-2xl backdrop-blur-md">
                ${tab === 'admin' && isCreator ? adminLiveCardHtml(event) + renderAdminTab(event) : ''}
                ${tab === 'live' ? renderLiveTab(event, isCreator) : ''}
                ${tab === 'info' ? window.renderInfoTab(event) : ''}
                ${tab === 'roster' ? renderRosterTab(event) : ''}
                ${tab === 'stats' ? renderStatsTab(event) : ''}
                ${tab === 'comments' ? renderCommentsTab(event) : ''}
            </div>
        </div>
    `;
};

async function communityDoc(cid) {
    const cached = (window.communitiesCache || {})[cid];
    if (cached && cached.paymentMethods !== undefined) return cached;
    try { const snap = await getDoc(doc(db, 'artifacts', appId, 'communities', String(cid))); return snap.exists() ? { id: cid, ...snap.data() } : (cached || {}); }
    catch (e) { return cached || {}; }
}

/** "Please send funds" screen: what you need, what you have, and how to pay the admin. */
window.showMustPayModal = async function(ev, needed, have) {
    const who = ev.organizer || ev.hostName || 'your admin';
    const short = Math.max(needed - have, 0);
    let m = document.getElementById('must-pay-modal');
    if (!m) { m = document.createElement('div'); m.id = 'must-pay-modal'; m.className = 'fixed inset-0 z-[210] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md'; document.body.appendChild(m); }
    const render = (methods) => `
        <div class="bg-[#040E13] border border-amber-400/50 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white max-h-[92vh] overflow-y-auto">
            <div class="flex justify-between items-center border-b border-white/10 pb-3">
                <h3 class="text-xs font-black uppercase text-amber-300"><i class="fa-solid fa-wallet mr-1"></i> ${short > 0 ? 'Please send funds' : 'Add credit'}</h3>
                <button onclick="document.getElementById('must-pay-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="grid grid-cols-2 gap-2 text-center">
                <div class="bg-black/50 border border-white/10 rounded-xl p-3"><div class="text-[10px] font-black uppercase text-white/50">Game costs</div><div class="text-xl font-black text-white">${dollars(needed)}</div></div>
                <div class="bg-black/50 border border-white/10 rounded-xl p-3"><div class="text-[10px] font-black uppercase text-white/50">Your credit</div><div class="text-xl font-black ${have >= needed ? 'text-[#00F296]' : 'text-red-300'}">${dollars(have)}</div></div>
            </div>
            <p class="text-xs text-white/85 leading-relaxed">${short > 0
                ? `This is a must-pay game and you don't have enough credit yet. Send at least <b class="text-amber-300">${dollars(short)}</b> to <b>${escapeHtml(who)}</b>, then come back and join.`
                : `✅ Your credit covers this game. To add more, send money to <b>${escapeHtml(who)}</b>:`}</p>
            ${methods}
            <button onclick="document.getElementById('must-pay-modal').remove()" class="w-full bg-black/60 text-white font-bold py-3 rounded-xl text-xs border border-white/20">OK</button>
        </div>`;
    m.innerHTML = render('<p class="text-[11px] text-white/50">Loading payment details...</p>');
    const c = await communityDoc(ev.communityId);
    if (document.getElementById('must-pay-modal') === m) m.innerHTML = render(paymentMethodsHtml(c, short, who));
};

window.openPayDetails = async function(eventId) {
    const ev = (window.eventsList || []).find(e => e.id === eventId); if (!ev) return;
    const have = await myBalanceCents(String(ev.communityId));
    window.showMustPayModal(ev, feeCents(ev), have);
};

// Live countdowns ("Confirm within 12:34") on any screen
if (!window._futnetCountdown) {
    window._futnetCountdown = setInterval(() => {
        document.querySelectorAll('[data-countdown]').forEach(el => {
            const left = Math.max(0, Math.floor((Number(el.getAttribute('data-countdown')) - Date.now()) / 1000));
            const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), sec = left % 60;
            el.textContent = h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
        });
    }, 1000);
}

window.showCommunityOnlyModal = function(ev, checked = false) {
    const c = (window.communitiesCache || {})[ev.communityId] || {};
    const name = escapeHtml(ev.communityName || c.name || 'this');
    const cid = String(ev.communityId || '');
    const needsApproval = c.requireApproval !== false;
    const pending = communityRequestPending(cid) === true;
    let m = document.getElementById('community-only-modal');
    if (!m) { m = document.createElement('div'); m.id = 'community-only-modal'; m.className = 'fixed inset-0 z-[205] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md'; document.body.appendChild(m); }
    m.innerHTML = `
        <div class="bg-[#040E13] border ${pending ? 'border-amber-400/60' : 'border-emerald-500/40'} rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white text-center">
            <div class="flex justify-end"><button onclick="document.getElementById('community-only-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button></div>
            ${pending ? `
            <div class="w-14 h-14 mx-auto rounded-full bg-black/50 border border-amber-400/50 flex items-center justify-center text-amber-300 text-xl -mt-4"><i class="fa-solid fa-hourglass-half"></i></div>
            <p class="text-base font-black">Request pending ⏳</p>
            <p class="text-xs text-white/70">You asked to join ${name} Community. An admin will review it, and you'll get a notification when you're in. Then you can join this game.</p>
            <button onclick="document.getElementById('community-only-modal').remove()" class="w-full bg-black/60 text-white font-bold py-3 rounded-xl text-xs border border-white/20">OK</button>
            <button onclick="cancelJoinRequest('${escapeHtml(cid)}')" class="w-full text-red-400 font-bold text-xs py-1">Cancel my request</button>` : `
            <div class="w-14 h-14 mx-auto rounded-full bg-black/50 border border-emerald-500/30 flex items-center justify-center text-[#00F296] text-xl -mt-4"><i class="fa-solid fa-lock"></i></div>
            <p class="text-sm font-black">This is a community game only.</p>
            <button onclick="requestJoinCommunity('${escapeHtml(cid)}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-xs uppercase tracking-wider">${needsApproval ? 'Request to join' : 'Join'} ${name} Community</button>`}
        </div>`;
    // Not checked yet (or a while ago): look it up, then show the right box.
    if (!checked && communityRequestPending(cid) === null) checkCommunityRequest(cid).then(() => {
        if (document.getElementById('community-only-modal')) window.showCommunityOnlyModal(ev, true);   // once only
    });
};

// ---- Did I already ask to join this community? (requests/{me} exists) Remembered for a minute.
window._pendingCommRequests = window._pendingCommRequests || {};
/** true / false, or null when not known (yet). */
function communityRequestPending(cid) {
    if (!cid || (window.myCommunityRoles || {})[cid]) return false;   // already a member
    const r = window._pendingCommRequests[cid];
    return r && Date.now() - r.at < 60000 ? r.pending : null;
}
const _reqChecks = {};
function checkCommunityRequest(cid) {
    if (!cid || !window.currentUser) return Promise.resolve(false);
    if (!_reqChecks[cid]) {
        _reqChecks[cid] = getDoc(doc(db, 'artifacts', appId, 'communities', cid, 'requests', String(window.currentUser.uid)))
            .then(s => s.exists())
            .catch(() => false)
            .finally(() => { setTimeout(() => { delete _reqChecks[cid]; }, 1000); });
    }
    // Always store the answer (even when an earlier lookup is reused).
    return _reqChecks[cid].then(v => { window._pendingCommRequests[cid] = { pending: v, at: Date.now() }; return v; });
}

// ---- "I accept" step: game rules (when the organizer asked for it) + the refund policy (must-pay games)
window._acceptedRules = window._acceptedRules || {};
const needsAcceptance = (ev) => !!ev && !!ev.communityId && (creditGame(ev) || ev.requireAcceptance === true);

window.showAcceptRulesModal = function(eventId) {
    const ev = (window.eventsList || []).find(e => e.id === eventId); if (!ev) return;
    const showRules = ev.requireAcceptance === true;
    const showRefund = creditGame(ev);
    let m = document.getElementById('accept-rules-modal');
    if (!m) { m = document.createElement('div'); m.id = 'accept-rules-modal'; m.className = 'fixed inset-0 z-[215] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md'; document.body.appendChild(m); }
    m.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center border-b border-white/10 pb-3">
                <h3 class="text-xs font-black uppercase">${showRules && showRefund ? 'Rules & refund policy' : (showRefund ? 'Refund policy' : 'Game rules')}</h3>
                <button onclick="document.getElementById('accept-rules-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="text-sm font-black">${escapeHtml(ev.title || 'Community game')}</div>
            ${showRules ? `<div class="bg-black/40 border border-white/10 rounded-xl p-3">
                <div class="text-[10px] font-black uppercase tracking-wider text-amber-300 mb-1"><i class="fa-solid fa-scroll mr-1"></i> Rules</div>
                <p class="text-xs text-white/85 whitespace-pre-line leading-relaxed">${escapeHtml(ev.rules || 'Standard fair play rules apply. Be punctual and respectful.')}</p>
            </div>` : ''}
            ${showRefund ? `<div class="bg-black/40 border border-white/10 rounded-xl p-3">
                <div class="text-[10px] font-black uppercase tracking-wider text-amber-300 mb-1"><i class="fa-solid fa-rotate-left mr-1"></i> Refund policy</div>
                <p class="text-xs text-white/85 leading-relaxed">${escapeHtml(policyText(ev))}</p>
            </div>` : ''}
            <label class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl p-3 cursor-pointer">
                <input id="accept-rules-check" type="checkbox" class="w-5 h-5 accent-[#00F296] shrink-0">
                <span class="text-xs font-bold text-white">I accept</span>
            </label>
            <button onclick="acceptRulesAndContinue('${escapeHtml(String(eventId))}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-xs uppercase tracking-wider">Continue</button>
        </div>`;
};

window.acceptRulesAndContinue = function(eventId) {
    if (!document.getElementById('accept-rules-check')?.checked) { window.showToast('Please tick "I accept" to continue.', 'error'); return; }
    window._acceptedRules[eventId] = Date.now();
    document.getElementById('accept-rules-modal')?.remove();
    const pj = window._pendingJoin;
    window._pendingJoin = null;
    if (pj && pj.eventId === eventId) window.confirmJoinGameWithGuests(eventId, pj.guests);
    else window.openJoinGameModal(eventId);
};

/** Last step of joining: the "I accept" screen when the game needs it, then save. */
window.finishJoin = function(eventId, guests) {
    const ev = (window.eventsList || []).find(e => e.id === eventId);
    if (ev && needsAcceptance(ev) && window.currentUser && !window._acceptedRules[eventId]) {
        const uid0 = String(window.currentUser.uid);
        const mine0 = [...(ev.attendees || []), ...(ev.waitingList || [])].find(a => String(a.uid) === uid0);
        if (String(ev.organizerId) !== uid0 && !(mine0 && mine0.acceptedRules)) {
            window._pendingJoin = { eventId, guests: guests || [] };
            window.showAcceptRulesModal(eventId);
            return;
        }
    }
    // Going on the waitlist: "ask me first" or "put me in automatically"?
    if (ev && window.currentUser && joinsWaitlist(ev) && window._waitAuto[eventId] === undefined) {
        window.showWaitlistChoice(eventId, guests || []);
        return;
    }
    window.confirmJoinGameWithGuests(eventId, guests || []);
};

window._waitAuto = window._waitAuto || {};

/** Joining the waitlist: what should happen when a spot opens? */
window.showWaitlistChoice = async function(eventId, guests) {
    const ev = (window.eventsList || []).find(e => e.id === eventId); if (!ev) return;
    const pays = creditGame(ev);
    const cost = costCents(ev, (guests || []).length);
    const mins = claimMinutesOf(ev);
    let m = document.getElementById('wait-choice-modal');
    if (!m) { m = document.createElement('div'); m.id = 'wait-choice-modal'; m.className = 'fixed inset-0 z-[216] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md'; document.body.appendChild(m); }
    window._waitChoiceGuests = guests || [];
    m.innerHTML = `
        <div class="bg-[#040E13] border border-amber-400/50 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="flex justify-between items-center border-b border-white/10 pb-3">
                <h3 class="text-xs font-black uppercase text-amber-300"><i class="fa-solid fa-hourglass-half mr-1"></i> Join the waitlist</h3>
                <button onclick="document.getElementById('wait-choice-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <p class="text-sm font-black">If a spot opens up for me:</p>
            <label class="flex gap-3 items-start bg-black/40 border border-white/10 rounded-2xl p-3 cursor-pointer has-[:checked]:border-[#00F296]">
                <input type="radio" name="wait-choice" value="ask" checked class="mt-1 w-4 h-4 accent-[#00F296] shrink-0">
                <span><span class="block text-xs font-bold">Ask me if I'm still available <span class="text-[10px] text-[#00F296]">(default)</span></span>
                <span class="block text-[11px] text-white/60">You'll get a notification and have ${mins === 60 ? '1 hour' : mins + ' minutes'} to confirm${pays ? ' and pay' : ''}.</span></span>
            </label>
            <label class="flex gap-3 items-start bg-black/40 border border-white/10 rounded-2xl p-3 cursor-pointer has-[:checked]:border-[#00F296]">
                <input type="radio" name="wait-choice" value="auto" class="mt-1 w-4 h-4 accent-[#00F296] shrink-0">
                <span><span class="block text-xs font-bold">Put me in automatically</span>
                <span class="block text-[11px] text-white/60">${pays ? `You're added the moment a spot opens and <b>${dollars(cost)}</b> is taken from your credit. You must have the funds, otherwise we'll ask you instead.` : "You're added the moment a spot opens. We'll let you know."}</span>
                <span id="wait-choice-funds" class="block text-[11px] text-amber-300 mt-1"></span></span>
            </label>
            <button onclick="confirmWaitlistChoice('${escapeHtml(String(eventId))}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-xs uppercase tracking-wider">Join waitlist</button>
        </div>`;
    if (pays) {
        const have = await myBalanceCents(String(ev.communityId));
        const el = document.getElementById('wait-choice-funds');
        if (el) el.textContent = have >= cost ? `Your credit: ${dollars(have)} ✓` : `Your credit is ${dollars(have)}. Add ${dollars(cost - have)} so this can work.`;
    }
};

window.confirmWaitlistChoice = function(eventId) {
    const pick = document.querySelector('input[name="wait-choice"]:checked')?.value || 'ask';
    window._waitAuto[eventId] = pick === 'auto';
    document.getElementById('wait-choice-modal')?.remove();
    window.finishJoin(eventId, window._waitChoiceGuests || []);
};

/** Waitlisted player switches between "ask me" and "put me in automatically". */
window.setWaitlistAuto = async function(eventId, on) {
    const uid = String(window.currentUser?.uid || '');
    const res = await mutateEvent(eventId, (draft) => {
        const w = (draft.waitingList || []).find(x => String(x.uid) === uid);
        if (!w) return false;
        if (on) w.autoJoin = true; else delete w.autoJoin;
    });
    if (res.ok && !res.aborted) {
        window.showToast(on ? "You'll be added automatically when a spot opens." : "We'll ask you first when a spot opens.");
        window.renderEventDetailModalContent();
    }
};

const capacityOfDraft = (ev) => {
    const perSide = parseInt(String(ev.format || '7v7').match(/(\d+)/)?.[1], 10) || 7;
    let teams = 3;
    if (typeof ev.teamsCount === 'number') teams = ev.teamsCount;
    else if (ev.teamsCount) teams = parseInt(String(ev.teamsCount).match(/(\d+)/)?.[1], 10) || 3;
    return perSide * teams;
};
const nowStart = (ev) => [Date.now(), startMsOf(ev)];
/** True when joining right now puts this person on the waitlist (game full, or the open spot is offered to the waitlist). */
const joinsWaitlist = (ev) => { const [n, st] = nowStart(ev); return !mayTakeSpot(ev, String(window.currentUser?.uid || ''), n, st); };

// Join / Join waitlist: clears any half-finished join popups first, shows that it's working, ignores
// double clicks, and never fails silently (a slow or failed check used to make the button look dead).
const JOIN_POPUPS = ['join-guests-modal', 'wait-choice-modal', 'request-join-modal', 'accept-rules-modal', 'must-pay-modal'];
window.openJoinGameModal = async function(eventId, ...rest) {
    if (window._joinOpening) return;
    window._joinOpening = true;
    JOIN_POPUPS.forEach(id => document.getElementById(id)?.remove());
    const btns = [...document.querySelectorAll(`button[onclick^="openJoinGameModal('${String(eventId).replace(/'/g, "\\'")}')"]`)];
    const saved = btns.map(b => b.innerHTML);
    btns.forEach(b => { b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> One moment…'; });
    try {
        await window._openJoinGameModalChecks(eventId, ...rest);
    } catch (err) {
        console.error('join failed to open', err);
        window.showToast("Couldn't open that. Check your connection and try again.", 'error');
    } finally {
        window._joinOpening = false;
        btns.forEach((b, i) => { if (b.isConnected) { b.disabled = false; b.innerHTML = saved[i]; } });
    }
};

window._openJoinGameModalChecks = async function(eventId) {
    const _ev = (window.eventsList || []).find(ev => ev.id === eventId);
    // Suspended from joining games in this community? Show why and stop.
    if (_ev && _ev.communityId && window.currentUser && typeof window.communitySuspension === 'function') {
        const sp = await window.communitySuspension(_ev.communityId);
        if (sp && sp.games) {
            const until = sp.until ? new Date(sp.until).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
            window.showToast(`You are suspended from joining games${until ? ' until ' + until : ''}.${sp.reason ? ' Reason: ' + escapeHtml(sp.reason) : ''}`, 'error');
            return;
        }
    }
    if (_ev && _ev.communityId && window.currentUser) {
        const isOrganizer = String(_ev.organizerId) === String(window.currentUser.uid);
        const isMember = isOrganizer || (window.isCommunityMember ? await window.isCommunityMember(_ev.communityId) : true);
        if (!isMember) {
            if (_ev.openToNonMembers !== true) {
                window.showCommunityOnlyModal(_ev);
                return;
            }
            window.openRequestToJoin(eventId);   // non-members ask, the organizer / an admin approves
            return;
        }
    }
    // Not enough credit for a must-pay game: "please send funds" comes first (joining the waitlist is free).
    if (_ev && creditGame(_ev) && window.currentUser && !joinIsOrganizer(_ev) && !joinsWaitlist(_ev)) {
        const uid = String(window.currentUser.uid);
        const prevPaid = ((_ev.attendees || []).find(a => String(a.uid) === uid) || {}).creditPaidCents || 0;
        const need = feeCents(_ev) - prevPaid;
        if (need > 0) {
            const have = await myBalanceCents(String(_ev.communityId));
            if (have < need) { window.showMustPayModal(_ev, feeCents(_ev), have); return; }
        }
    }
    window._openJoinGameModalCore(eventId);
};

// ---- Non-members: ask to join a community game
window.openRequestToJoin = function(eventId) {
    const ev = (window.eventsList || []).find(e => e.id === eventId); if (!ev) return;
    const uid = String(window.currentUser?.uid || '');
    const pending = (ev.joinRequests || []).some(r => String(r.uid) === uid);
    const who = escapeHtml(ev.organizer || ev.hostName || 'The organizer');
    const mustPay = creditGame(ev);
    let m = document.getElementById('request-join-modal');
    if (!m) { m = document.createElement('div'); m.id = 'request-join-modal'; m.className = 'fixed inset-0 z-[205] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md'; document.body.appendChild(m); }
    m.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white">
            <div class="flex justify-between items-center border-b border-white/10 pb-3">
                <h3 class="text-xs font-black uppercase">${pending ? 'Request sent' : 'Request to join'}</h3>
                <button onclick="document.getElementById('request-join-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="text-sm font-black">${escapeHtml(ev.title || 'Community game')}</div>
            ${mustPay ? `<div class="bg-amber-500/10 border border-amber-400/40 rounded-xl p-3 text-xs text-white/90 leading-relaxed">
                <b class="text-amber-300">This is a must pay event.</b><br>
                Send <b>${escapeHtml(costSummary(ev))}</b> via Zelle, Cash App, Venmo or Apple Pay to <b>${who}</b>. ${who} will have to approve your request.
            </div>` : `<p class="text-xs text-white/70">${who} or a community admin has to approve your request before you are on the roster.</p>`}
            ${pending
                ? `<p class="text-xs text-[#00F296] font-bold text-center">Your request is waiting for approval.</p>
                   <button onclick="document.getElementById('request-join-modal').remove()" class="w-full bg-black/60 text-white font-bold py-3 rounded-xl text-xs border border-white/20">OK</button>`
                : `<button onclick="sendJoinRequest('${eventId}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-xs uppercase tracking-wider">Send request</button>`}
        </div>`;
};

window.sendJoinRequest = async function(eventId) {
    if (!window.currentUser || !window.userProfile) { window.showToast('You must be logged in.', 'error'); return; }
    const uid = String(window.currentUser.uid);
    const p = window.userProfile;
    const name = `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Player';
    const res = await mutateEvent(eventId, (draft) => {
        draft.joinRequests = draft.joinRequests || [];
        if (draft.joinRequests.some(r => String(r.uid) === uid)) return false;
        if ((draft.attendees || []).some(a => String(a.uid) === uid)) return false;
        const r = { uid, name, position: String(p.position || 'Player'), requestedAt: Date.now() };
        if (window._acceptedRules[eventId]) { r.acceptedRules = true; r.acceptedAt = window._acceptedRules[eventId]; }
        const av = safeAvatar(p.avatar || window.currentUser.photoURL || ''); if (av) r.avatar = av;
        draft.joinRequests.push(r);
    });
    if (res.ok) { window.showToast('Request sent! You will be added when it is approved.'); window.openRequestToJoin(eventId); }
};

// ---- Box shown while joining: rules, refund policy, what will be deducted, and the guest/share note
const joinIsOrganizer = (ev) => !!(window.currentUser && String(ev.organizerId) === String(window.currentUser.uid));

function joinInfoHtml(ev, count) {
    const toWaitlist = joinsWaitlist(ev);
    const pays = creditGame(ev) && !joinIsOrganizer(ev) && !toWaitlist;
    const rules = ev.communityId && (ev.requireAcceptance === true || (ev.rules && String(ev.rules).trim()));
    let h = '';
    if (rules) {
        h += `<div class="bg-black/40 border border-white/10 rounded-xl p-3 text-left">
            <div class="text-[10px] font-black uppercase tracking-wider text-amber-300 mb-1"><i class="fa-solid fa-scroll mr-1"></i> Rules</div>
            <p class="text-[11px] text-white/85 whitespace-pre-line leading-relaxed max-h-24 overflow-y-auto">${escapeHtml(ev.rules || 'Standard fair play rules apply. Be punctual and respectful.')}</p>
        </div>`;
    }
    if (creditGame(ev)) {
        h += `<div class="bg-black/40 border border-white/10 rounded-xl p-3 text-left">
            <div class="text-[10px] font-black uppercase tracking-wider text-amber-300 mb-1"><i class="fa-solid fa-rotate-left mr-1"></i> Refund policy</div>
            <p class="text-[11px] text-white/85 leading-relaxed">${escapeHtml(policyText(ev))}</p>
        </div>`;
    }
    if (toWaitlist) {
        h += `<div class="bg-amber-500/10 border border-amber-400/40 rounded-xl p-3 text-left text-[11px] text-white/90 leading-relaxed">
            <i class="fa-solid fa-hourglass-half text-amber-300 mr-1"></i> The game is full, so you'll join the <b>waitlist</b>${creditGame(ev) ? ' (free, nothing is taken from your credit)' : ''}.
            If a spot opens, we'll notify you and you'll have <b>${claimMinutesOf(ev) === 60 ? '1 hour' : claimMinutesOf(ev) + ' minutes'}</b> to confirm${creditGame(ev) ? ' and pay' : ''}.
        </div>`;
    }
    if (pays && !refundAllowed(ev)) {
        h += `<div class="bg-red-500/10 border border-red-400/50 rounded-xl p-3 text-left text-[11px] text-red-200 leading-relaxed">
            <i class="fa-solid fa-triangle-exclamation mr-1"></i> <b>Heads up:</b> it's past the refund cutoff. If you join now and cancel later, ${(() => { const r = myLeaveRefund(ev, costCents(ev, count)); return r.now ? `you only get ${dollars(r.now)} back` : 'you won\'t get your money back'; })()}${ev.refundIfSpotFilled === true ? ' (unless someone takes your spot)' : ''}.
        </div>`;
    }
    if (pays) {
        const cid = String(ev.communityId);
        h += `<div class="bg-emerald-500/10 border border-emerald-400/40 rounded-xl p-3 text-left">
            <p class="text-xs text-white/90 leading-relaxed"><i class="fa-solid fa-wallet text-[#00F296] mr-1"></i>
                <b id="join-deduct-amount" class="text-[#00F296]">${dollars(costCents(ev, count))}</b> will be deducted from your credit balance.</p>
            <p class="text-[10px] text-white/60 mt-1">Your balance: <b id="join-balance" data-cid="${escapeHtml(cid)}">...</b></p>
            <p id="join-short-warning" class="hidden text-[11px] text-red-300 font-bold mt-1">You do not have enough credit. Ask a community admin to add credit first.</p>
        </div>`;
    }
    return h;
}

function joinGuestNoteHtml(ev, count) {
    if (!ev.allowPlusOnes || count < 1) return '';
    const x = plusOneExtraCents(ev);
    const costLine = creditGame(ev)
        ? `There is an additional cost for guests: <b>${dollars(feeCents(ev) + x)}</b> each, taken from your credit.`
        : 'Your guests are welcome to play too.';
    let h = `<div class="bg-amber-500/10 border border-amber-400/40 rounded-xl p-3 text-left text-[11px] text-white/90 leading-relaxed">
        <i class="fa-solid fa-user-plus text-amber-300 mr-1"></i> ${costLine}`;
    if (ev.communityId) {
        const link = `https://futnet.site/#community=${encodeURIComponent(String(ev.communityId))}`;
        h += `<br>Share this community with them so they can join too!
        <div class="flex items-center gap-2 mt-2">
            <input id="join-share-link" readonly value="${escapeHtml(link)}" class="flex-1 min-w-0 bg-black border border-white/20 rounded-lg px-2 py-1.5 text-[10px] text-white/80" onclick="this.select()">
            <button type="button" onclick="window.copyCommunityLinkFromJoin()" id="join-share-btn" class="shrink-0 bg-[#00F296] text-slate-950 font-black text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-lg"><i class="fa-solid fa-copy mr-1"></i>Copy</button>
        </div>`;
    }
    return h + '</div>';
}

window.copyCommunityLinkFromJoin = async function() {
    const input = document.getElementById('join-share-link'); if (!input) return;
    let ok = false;
    try { await navigator.clipboard.writeText(input.value); ok = true; } catch (e) {
        try { input.select(); ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    }
    const btn = document.getElementById('join-share-btn');
    if (ok && btn) { btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i>Copied!'; setTimeout(() => { if (btn) btn.innerHTML = '<i class="fa-solid fa-copy mr-1"></i>Copy'; }, 1500); }
    window.showToast(ok ? 'Link copied! Paste it in a message to your guests.' : 'Could not copy. Press and hold the link to copy it.', ok ? 'success' : 'error');
};

/** Updates the deducted amount / guest note and loads the member's balance. */
async function refreshJoinSummary(eventId) {
    const ev = (window.eventsList || []).find(e => e.id === eventId); if (!ev) return;
    const count = window._currentGuestCount || 0;
    const amt = document.getElementById('join-deduct-amount');
    if (amt) amt.textContent = dollars(costCents(ev, count));
    const note = document.getElementById('join-guest-note');
    if (note) note.innerHTML = joinGuestNoteHtml(ev, count);
    const bal = document.getElementById('join-balance');
    if (bal) {
        if (window._joinBalanceCents === undefined || window._joinBalanceFor !== eventId) {
            window._joinBalanceFor = eventId;
            window._joinBalanceCents = await myBalanceCents(String(ev.communityId));
        }
        bal.textContent = dollars(window._joinBalanceCents);
        const warn = document.getElementById('join-short-warning');
        const alreadyPaid = (((ev.attendees || []).find(a => String(a.uid) === String(window.currentUser?.uid)) || {}).creditPaidCents) || 0;
        if (warn) warn.classList.toggle('hidden', window._joinBalanceCents >= costCents(ev, count) - alreadyPaid);
    }
}

window._openJoinGameModalCore = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    // Joining never asks about guests anymore: after joining, the "Bring guest" button adds them.
    const allowPlusOnes = false;
    const maxGuests = event.plusOneLimit || 3;
    const showInfo = creditGame(event) && !joinIsOrganizer(event);

    // Nothing to show or ask: join straight away
    if (!allowPlusOnes && !showInfo) {
        window.finishJoin(eventId, []);
        return;
    }

    let modal = document.getElementById('join-guests-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'join-guests-modal';
        modal.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md';
        document.body.appendChild(modal);
    }

    window._currentGuestCount = 0;
    window._maxGuestLimit = maxGuests;
    window._activeJoiningEventId = eventId;
    window._joinBalanceCents = undefined;

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white text-center max-h-[92vh] overflow-y-auto">
            <div class="flex justify-between items-center border-b border-white/10 pb-3">
                <h3 class="text-xs font-black uppercase text-white text-left">Joining: ${escapeHtml(event.title || '')}</h3>
                <button onclick="document.getElementById('join-guests-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>

            ${joinInfoHtml(event, 0)}

            ${allowPlusOnes ? `<div class="space-y-3 py-1">
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
            <div id="join-guest-note"></div>` : ''}

            <button type="button" onclick="window.proceedToGuestNamesStep()" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3 rounded-xl text-xs shadow transition uppercase tracking-wider">
                ${allowPlusOnes ? 'Confirm & Continue' : 'Confirm & Join'}
            </button>
        </div>
    `;
    refreshJoinSummary(eventId);
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
    refreshJoinSummary(window._activeJoiningEventId);
};

window.proceedToGuestNamesStep = function() {
    const count = window._currentGuestCount || 0;
    const eventId = window._activeJoiningEventId;
    const modal = document.getElementById('join-guests-modal');

    if (count === 0) {
        if (modal) modal.remove();
        window.finishJoin(eventId, []);
        return;
    }

    if (!modal) return;
    modal.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white text-left max-h-[92vh] overflow-y-auto">
            <div class="flex justify-between items-center border-b border-white/10 pb-3">
                <h3 class="text-xs font-black uppercase text-white">Enter Guest Names (${count})</h3>
                <button onclick="document.getElementById('join-guests-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>

            ${(() => { const _e = (window.eventsList || []).find(x => x.id === eventId); return _e ? joinInfoHtml(_e, count) + joinGuestNoteHtml(_e, count) : ''; })()}

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
    refreshJoinSummary(eventId);
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

    window.finishJoin(eventId, guestsArray);
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
    let creditNeeded = 0;
    let creditHave = 0;
    let chargedCents = 0;

    const res = await mutateEvent(eventId, (draft, ctx) => {
        creditShortBy = 0; creditNeeded = 0; creditHave = 0;
        if (ctx) ctx.charge = 0;
        draft.attendees = draft.attendees || [];
        draft.waitingList = draft.waitingList || [];
        draft.declinedList = (draft.declinedList || []).filter(d => String(d.uid) !== uid);

        const previous = draft.attendees.find(a => String(a.uid) === uid);
        const prevWaiting = draft.waitingList.find(w => String(w.uid) === uid);
        const prevWaitIdx = draft.waitingList.findIndex(w => String(w.uid) === uid);
        // An open spot belongs to the waitlist first (whoever it is offered to), unless you already have a spot.
        const [nowMs, startMs] = [Date.now(), startMsOf(draft)];
        const canTake = !!previous || mayTakeSpot(draft, uid, nowMs, startMs);
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
        if (window._acceptedRules[eventId]) { me.acceptedRules = true; me.acceptedAt = window._acceptedRules[eventId]; }
        else if (previous && previous.acceptedRules) { me.acceptedRules = true; me.acceptedAt = previous.acceptedAt || Date.now(); }
        else if (prevWaiting && prevWaiting.acceptedRules) { me.acceptedRules = true; me.acceptedAt = prevWaiting.acceptedAt || Date.now(); }
        if (prevWaiting && prevWaiting.waitingSince) me.waitingSince = prevWaiting.waitingSince;

        const incoming = 1 + guestsArray.length;
        const maxCapacity = capacityOfDraft(draft);
        const available = canTake ? maxCapacity - confirmedHeads : 0;
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
            me.waitingSince = me.waitingSince || nowMs;
            const autoPick = window._waitAuto[eventId];
            if (autoPick === true || (autoPick === undefined && prevWaiting && prevWaiting.autoJoin === true)) me.autoJoin = true;
            // Already waiting? Keep your place in line.
            if (prevWaitIdx >= 0) draft.waitingList.splice(Math.min(prevWaitIdx, draft.waitingList.length), 0, me);
            else draft.waitingList.push(me);
            outcome = 'full';
        }
        const kept = (draft.attendees.find(a => String(a.uid) === uid)?.guests || []).length;
        if (outcome === 'full') pruneTeamsForUid(draft, uid);
        else pruneTeamsForUid(draft, uid, { keepHost: true, keepGuests: kept });

        if (useCredit && ctx) {
            const mine = draft.attendees.find(a => String(a.uid) === uid);
            const prevPaid = (previous && previous.creditPaidCents) || 0;
            if (mine && mine.role !== 'Organizer' && (outcome === 'in' || outcome === 'partial')) {
                const cost = costCents(draft, (mine.guests || []).length);
                if (prevPaid > 0) { mine.paid = 'Credit'; mine.creditPaidCents = prevPaid; mine.creditCommunityId = draft.communityId; }
                const markGuestsPaid = () => { (mine.guests || []).forEach(g => { g.paid = 'Credit'; }); };
                if (cost - prevPaid <= 0 && prevPaid > 0) markGuestsPaid();
                const extra = cost - prevPaid;
                if (extra > 0) {
                    if (ctx.balance >= extra) {
                        ctx.charge = extra;
                        mine.paid = 'Credit';
                        mine.creditPaidCents = prevPaid + extra;
                        mine.creditCommunityId = draft.communityId;
                        markGuestsPaid();
                    } else {
                        // Must pay to be confirmed: not enough credit means no spot. Nothing is saved.
                        creditShortBy = extra - ctx.balance; creditNeeded = extra; creditHave = ctx.balance;
                        return false;
                    }
                }
            }
            chargedCents = ctx.charge;
        }
    }, useCredit ? joinHooks(_creditEv, uid) : undefined);

    delete window._waitAuto[eventId];
    if (res.ok && res.aborted && creditShortBy > 0) {
        window.showMustPayModal(_creditEv, creditNeeded, creditHave);
        return;
    }
    if (res.ok) {
        if (outcome === 'in' && chargedCents > 0) window.showToast(`Joined! ${dollars(chargedCents)} was taken from your community credit.`);
        else if (outcome === 'in') window.showToast(guestsArray.length > 0 ? "Successfully joined with your guest(s)!" : "Successfully joined game!");
        else if (outcome === 'partial') window.showToast(`Roster capacity reached! Accepted player + ${acceptedCount} guest(s); remaining guest(s) placed on waitlist.`, "info");
        else window.showToast(res.event && (res.event.waitingList || []).some(w => String(w.uid) === uid && w.autoJoin)
            ? "You're on the waitlist. You'll be added automatically when a spot opens." : "You're on the waitlist. We'll notify you as soon as a spot opens up.", "info");
    }
    window.renderEventDetailModalContent();
};

window.cancelGameEvent = async function(eventId) {
    const _evC = (window.eventsList || []).find(e => String(e.id) === String(eventId));
    const _refundTxt = _evC && creditGame(_evC) ? (_evC.refundOnCancel === false ? ' This game is set to NOT refund on cancel, so nobody gets their credit back.' : ' Everyone who paid with community credit gets it back.') : '';
    if (!confirm("Are you sure you want to cancel and delete this game?" + _refundTxt)) return;
    try {
        // Credit refunds are done by the server when the game is deleted (same for the apps).
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
                        <img src="${escapeHtml((window.resolvePlayerAvatar && typeof player === 'object' ? window.resolvePlayerAvatar(player) : safeAvatar(player.avatar)) || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg')}" class="w-8 h-8 rounded-full object-cover border border-white/20 shadow-sm">
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

// "End Event": locks the results, tells everyone who played, and opens the results page.
window.toggleSessionEnded = async function(eventId) {
    const ev = (window.eventsList || []).find(e => e.id === eventId);
    if (ev && !ev.isSessionEnded) {
        if (ev.liveMatchActive) { window.showToast('Save or discard the live match first.', 'error'); return; }
        if (!confirm('End this event? The winner is decided by points (3 for a win, 1 for a draw) and everyone who played gets the results.')) return;
    } else if (ev && !confirm('Reopen this event? You can add more matches, and the results page will be hidden until you end it again.')) {
        return;
    }
    let ended = false;
    const res = await mutateEvent(eventId, (draft) => {
        draft.isSessionEnded = !draft.isSessionEnded;
        ended = draft.isSessionEnded;
        if (ended) draft.sessionEndedAt = Date.now();
    });
    if (res.ok) {
        window.showToast(ended ? "Event ended! Everyone is getting the results 🏆" : "Event reopened.");
        if (ended && window.openSessionResults) window.openSessionResults(eventId);
    }
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

function eventShareLink() {
    const id = window.currentSharedEventId;
    return id ? `https://futnet.site/g/${encodeURIComponent(id)}` : window.location.href;   // short share link
}

window.shareToWhatsApp = function(title, location) {
    const text = encodeURIComponent(`⚽ Check out this soccer game on FutNet: "${title}" at ${location}! Join us!\n${eventShareLink()}`);
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
    toggleShareDropdown();
};

window.shareToTwitter = function(title) {
    const text = encodeURIComponent(`⚽ Playing soccer on FutNet: "${title}". Come join the match!`);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(eventShareLink())}`, '_blank');
    toggleShareDropdown();
};

window.copyEventLink = async function(title) {
    const link = eventShareLink();
    let ok = false;
    try { await navigator.clipboard.writeText(link); ok = true; } catch (e) {
        try {
            const ta = document.createElement('textarea');
            ta.value = link; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            ok = document.execCommand('copy');
            ta.remove();
        } catch (e2) { ok = false; }
    }
    if (!ok) { window.showToast('Could not copy. Long-press the address bar to copy the link.', 'error'); return; }
    // Show it right on the button so nobody has to wonder
    const btn = document.querySelector('#share-dropdown button[onclick^="copyEventLink"]');
    if (btn) {
        const old = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check text-[#00F296] text-base"></i> Link copied!';
        setTimeout(() => { btn.innerHTML = old; toggleShareDropdown(); }, 1200);
    } else toggleShareDropdown();
    window.showToast('Link copied! Paste it anywhere to share this game.');
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
    const onlyWaiting = !_mine && _ev && (_ev.waitingList || []).some(w => String(w.uid) === uid);
    const hadCredit = !!(_ev && _ev.communityId && _mine && _mine.creditPaidCents > 0);

    // Say what happens to the money before leaving.
    if (onlyWaiting) {
        if (!confirm('Leave the waitlist?')) return;
    } else if (hadCredit) {
        const r = myLeaveRefund(_ev, _mine.creditPaidCents);
        const msg = r.now === _mine.creditPaidCents
            ? `Leave the game? ${dollars(r.now)} goes back to your credit.`
            : `Leave the game? It's past the refund cutoff: ${r.now ? `only ${dollars(r.now)} goes back to your credit` : 'you will NOT get your ' + dollars(_mine.creditPaidCents) + ' back'}${r.later ? `. You get ${r.now ? 'the other ' : ''}${dollars(r.later)} back if someone from the waitlist takes your spot` : ''}.`;
        if (!confirm(msg)) return;
    } else if (!confirm('Leave this game?')) return;

    let refunded = 0, forfeited = 0, later = 0;
    const res = await mutateEvent(eventId, (draft, ctx) => {
        refunded = 0; forfeited = 0; later = 0;
        const entry = (draft.attendees || []).find(a => String(a.uid) === uid);
        const paid = ctx ? ((entry && entry.creditPaidCents) || 0) : 0;
        if (ctx) ctx.refund = 0;
        if (paid > 0) {
            const r = myLeaveRefund(draft, paid);
            if (r.now) { ctx.refund = r.now; ctx.note = r.now === paid ? 'You left the game' : 'You left the game (partial refund)'; refunded = r.now; }
            if (r.later) {
                draft.pendingRefunds = draft.pendingRefunds || [];
                draft.pendingRefunds.push({ uid, name: fullName, cents: r.later, cid: entry.creditCommunityId || draft.communityId, at: Date.now() });
                later = r.later;
            }
            forfeited = paid - r.now - r.later;
        }
        draft.attendees = (draft.attendees || []).filter(a => String(a.uid) !== uid);
        draft.waitingList = (draft.waitingList || []).filter(w => String(w.uid) !== uid);
        draft.declinedList = (draft.declinedList || []).filter(d => String(d.uid) !== uid);
        draft.declinedList.push({ uid, name: fullName });
        pruneTeamsForUid(draft, uid);
    }, hadCredit ? refundHooks(_ev, uid) : undefined);
    if (res.ok) {
        if (onlyWaiting) window.showToast("You left the waitlist.");
        else if (refunded > 0 && !forfeited && !later) window.showToast(`You left the game. ${dollars(refunded)} was returned to your credit.`);
        else if (refunded > 0 || later > 0) window.showToast(`You left the game.${refunded ? ` ${dollars(refunded)} was returned to your credit.` : ''}${later ? ` ${dollars(later)} comes back if someone takes your spot.` : ''}`, "info");
        else if (forfeited > 0) window.showToast(`You left the game. Your ${dollars(forfeited)} was not refunded (${policyText(_ev)}).`, "info");
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
        const who = (draft.attendees || []).find(a => String(a.uid) === String(uid)) || (draft.waitingList || []).find(w => String(w.uid) === String(uid));
        draft.attendees = (draft.attendees || []).filter(a => String(a.uid) !== String(uid));
        draft.waitingList = (draft.waitingList || []).filter(w => String(w.uid) !== String(uid));
        pruneTeamsForUid(draft, uid);
        // Removed by the organizer = Not Going (they show in that list, and can join again).
        draft.declinedList = (draft.declinedList || []).filter(d => String(d.uid) !== String(uid));
        if (who) draft.declinedList.push({ uid: String(uid), name: who.name || 'Player', removedByAdmin: true });
    }, hadCredit ? refundHooks(_ev, uid) : undefined);
    if (res.ok) window.showToast(refunded > 0 ? `Player removed. ${dollars(refunded)} was returned to their credit.` : "Player removed from roster.");
};