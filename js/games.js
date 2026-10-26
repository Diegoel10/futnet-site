// js/games.js: Manages date navigation, live Firestore listeners with connection timeout fallback and seamless RSVP mapping
import { db, appId } from './firebase-config.js';
import { doc, getDoc, collection, getDocs, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { escapeHtml, jsArg } from './game-profile/event-store.js';
import { gameBadgesHtml } from './game-status.js';

window.selectedDateStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

let eventsUnsubscribe = null;
let directoryUnsubscribe = null;
let initialLoadResolved = false;

// 🛑 Stop active listeners upon logout to prevent permission errors
window.stopAllLiveListeners = function() {
    if (eventsUnsubscribe) {
        eventsUnsubscribe();
        eventsUnsubscribe = null;
    }
    if (directoryUnsubscribe) {
        directoryUnsubscribe();
        directoryUnsubscribe = null;
    }
};

function formatTimeTo12Hour(timeStr) {
    if (!timeStr) return '';
    if (timeStr.toUpperCase().includes('AM') || timeStr.toUpperCase().includes('PM')) {
        return timeStr.toUpperCase();
    }
    if (!timeStr.includes(':')) return timeStr;

    const [hourStr, minuteStr] = timeStr.split(':');
    let hour = parseInt(hourStr, 10);
    if (isNaN(hour)) return timeStr;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    hour = hour ? hour : 12;
    return `${hour}:${minuteStr} ${ampm}`;
}

window.initEventsLiveListener = function() {
    if (eventsUnsubscribe) eventsUnsubscribe();

    const eventsRef = collection(db, 'artifacts', appId, 'eventsList');

    const loadTimeout = setTimeout(() => {
        if (!initialLoadResolved) {
            initialLoadResolved = true;
            window.eventsList = window.eventsList || [];
            if (window.renderDateTabs) window.renderDateTabs();
            if (window.renderEvents) window.renderEvents();
            const splash = document.getElementById('loading-screen') || document.querySelector('.loading-screen');
            if (splash) splash.style.display = 'none';
        }
    }, 2000);

    eventsUnsubscribe = onSnapshot(eventsRef, (snapshot) => {
        initialLoadResolved = true;
        clearTimeout(loadTimeout);
        const list = [];
        window.eventDocIds = {};
        snapshot.forEach(docSnap => {
            const evData = docSnap.data();
            if (!evData.id) evData.id = docSnap.id;
            // Map the exact Firestore document ID to the event ID for precise deletion tracking
            window.eventDocIds[evData.id] = docSnap.id;
            if (!evData.attendees) evData.attendees = [];
            if (!evData.waitingList) evData.waitingList = [];
            if (!evData.declinedList) evData.declinedList = [];
            list.push(evData);
        });
        window.eventsList = list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        if (window.renderDateTabs) window.renderDateTabs();
        if (window.renderEvents) window.renderEvents();
        if (window.refreshCommunityGamesTab) window.refreshCommunityGamesTab();

        if (window.activeModalEventId && window.renderEventDetailModalContent) {
            window.renderEventDetailModalContent();
        }
        // Team builder open (e.g. a captains draft): show other people's picks live.
        if (window.refreshTeamBuilderLive) window.refreshTeamBuilderLive();

        const splash = document.getElementById('loading-screen') || document.querySelector('.loading-screen');
        if (splash) splash.style.display = 'none';
    }, (error) => {
        initialLoadResolved = true;
        clearTimeout(loadTimeout);
        if (error.code !== 'permission-denied') {
            console.error("Error listening to events collection:", error);
        }
        window.eventsList = window.eventsList || [];
        if (window.renderEvents) window.renderEvents();
        const splash = document.getElementById('loading-screen') || document.querySelector('.loading-screen');
        if (splash) splash.style.display = 'none';
    });
};

window.initDirectoryLiveListener = function() {
    if (directoryUnsubscribe) directoryUnsubscribe();

    const dirRef = collection(db, 'artifacts', appId, 'directory');

    directoryUnsubscribe = onSnapshot(dirRef, (snapshot) => {
        window.directoryList = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (!data.uid) data.uid = docSnap.id;
            window.directoryList.push(data);
        });
    }, (err) => {
        if (err.code !== 'permission-denied') {
            console.error("Error listening to global directory:", err);
        }
    });
};

window.renderDateTabs = function() {
    const container = document.getElementById('date-tabs-container');
    if (!container) return;
    const dates = [];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const todayObj = new Date();

    for (let i = 0; i < 6; i++) {
        const d = new Date();
        d.setDate(todayObj.getDate() + i);

        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dateString = `${yyyy}-${mm}-${dd}`;

        const dayName = dayNames[d.getDay()];
        const dayNum = d.getDate();

        let label = `${dayName} ${dayNum}`;
        if (i === 0) label = `Today`;
        else if (i === 1) label = `Tomorrow`;

        dates.push({ date: dateString, label: label });
    }

    container.innerHTML = dates.map(d => `
        <button onclick="selectDateTab('${d.date}')" class="px-4 py-2 rounded-full text-xs font-bold shrink-0 transition ${window.selectedDateStr === d.date ? 'bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 shadow-[0_0_12px_rgba(0,242,150,0.4)]' : 'bg-black/30 text-white hover:text-white/90 border border-white/20'}">
            ${d.label}
        </button>
    `).join('');
};

window.selectDateTab = function(dateStr) {
    window.selectedDateStr = dateStr;
    const parts = dateStr.split('-');
    const formattedDate = new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const titleEl = document.getElementById('selected-date-title');
    if (titleEl) titleEl.innerText = `Games for ${formattedDate}`;

    window.renderDateTabs();
    if (window.renderEvents) window.renderEvents();
};

window.copyEvent = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    if (typeof window.resetCreateGameForm === 'function') {
        window.resetCreateGameForm();
    }

    window.pendingCopiedEvent = event;
    window.activeModalEventId = null;

    if (typeof window.switchTab === 'function') {
        window.switchTab('create-event');
    }

    if (typeof window.showToast === 'function') {
        window.showToast("Game details copied! Please select a future date.");
    }
};

// Games tab: "Upcoming" (pick a day) or "Previous" (games that already happened, newest first).
window.gamesView = window.gamesView || 'upcoming';
window.setGamesView = function(view) {
    window.gamesView = view === 'previous' ? 'previous' : 'upcoming';
    if (window.renderEvents) window.renderEvents();
};

function paintGamesViewToggle() {
    const prev = window.gamesView === 'previous';
    document.querySelectorAll('#games-view-toggle [data-view]').forEach(b => {
        const on = b.dataset.view === window.gamesView;
        b.className = 'flex-1 py-2 rounded-xl text-xs font-black transition ' +
            (on ? 'bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950' : 'text-white/70 hover:text-white');
    });
    document.getElementById('date-tabs-container')?.classList.toggle('hidden', prev);
}

function renderPreviousGames(grid) {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const titleEl = document.getElementById('selected-date-title');
    if (titleEl) titleEl.innerText = 'Previous games';
    const past = (window.eventsList || [])
        .filter(ev => ev.date && (String(ev.date).slice(0, 10) < today || ev.isSessionEnded === true))
        .sort((a, b) => (String(b.date).slice(0, 10) + (b.time || '')).localeCompare(String(a.date).slice(0, 10) + (a.time || '')))
        .slice(0, 60);
    if (!past.length) {
        grid.innerHTML = `<div class="col-span-full bg-[#040E13]/90 border border-emerald-500/40 rounded-[28px] p-8 text-center text-white/70 text-xs font-medium">No previous games yet.</div>`;
        return;
    }
    // Group by day so each block has its date on top.
    let lastDay = '';
    grid.innerHTML = past.map(ev => {
        const day = String(ev.date).slice(0, 10);
        let head = '';
        if (day !== lastDay) {
            lastDay = day;
            const [y, m, dd] = day.split('-').map(Number);
            const label = new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
            head = `<div class="col-span-full text-[11px] font-black uppercase tracking-wider text-[#00F296] pt-2">${label}</div>`;
        }
        return head + window.renderEventCardHtml(ev);
    }).join('');
}

window.renderEvents = function() {
    const grid = document.getElementById('events-grid');
    if (!grid) return;
    if (window.selectedDateStr) {
        const [y, m, dd] = window.selectedDateStr.split('-').map(Number);
        const titleEl = document.getElementById('selected-date-title');
        const isToday = new Date(y, m - 1, dd).toDateString() === new Date().toDateString();
        if (titleEl) titleEl.innerText = isToday ? 'Games for Today'
            : `Games for ${new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;
    }

    const filtered = (window.eventsList || [])
        .filter(ev => {
            const evDateClean = (ev.date || "").substring(0, 10);
            return evDateClean === window.selectedDateStr;
        })
        .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full bg-[#040E13]/90 border border-emerald-500/40 rounded-[28px] p-8 text-center space-y-3.5 shadow-2xl backdrop-blur-md">
                <div class="w-14 h-14 bg-black/60 rounded-full flex items-center justify-center mx-auto text-[#00F296] text-xl border border-emerald-500/30 shadow-[0_0_15px_rgba(0,242,150,0.2)]">
                    <i class="fa-solid fa-calendar-xmark"></i>
                </div>
                <h3 class="text-sm font-black text-white uppercase tracking-wider">No games scheduled for this date</h3>
                <p class="text-white/70 text-xs font-medium">Be the first to organize a match for this day!</p>
                <button onclick="if(window.resetCreateGameForm) window.resetCreateGameForm(); switchTab('create-event')" class="mt-2 inline-flex items-center gap-2 bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black px-5 py-3 rounded-xl text-xs shadow-[0_0_15px_rgba(0,242,150,0.4)] transition">
                    <i class="fa-solid fa-plus"></i> Create Game
                </button>
            </div>
        `;
        return;
    }

    grid.innerHTML = filtered.map(ev => window.renderEventCardHtml(ev)).join('');
};

// One game card (used by the Games screen and by the community page).
window.renderEventCardHtml = function(ev) {
    const defaultAvatar = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
    {
        const formatMatch = (ev.format || "").match(/(\d+)/);
        const perSide = formatMatch ? parseInt(formatMatch[1], 10) : 5;

        let teamsCountNum = 3;
        if (typeof ev.teamsCount === 'number') {
            teamsCountNum = ev.teamsCount;
        } else if (typeof ev.teamsCount === 'string') {
            const parsed = parseInt(ev.teamsCount.match(/(\d+)/)?.[1], 10);
            if (!isNaN(parsed)) teamsCountNum = parsed;
        }
        const maxCapacity = perSide * teamsCountNum;

        let currentGoing = 0;
        const attendeesArr = Array.isArray(ev.attendees) ? ev.attendees : [];
        attendeesArr.forEach(a => {
            const guestArr = Array.isArray(a.guests) ? a.guests : (Array.isArray(a.plusOnesList) ? a.plusOnesList : []);
            const plusOneInt = typeof a.plusOnes === 'number' ? a.plusOnes : 0;
            currentGoing += 1 + Math.max(guestArr.length, plusOneInt);
        });
        if (currentGoing === 0 && attendeesArr.length === 0) currentGoing = 1;

        const isFull = currentGoing >= maxCapacity;
        // Past games show "Game ended" instead of the head count.
        const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
        const myUid = window.currentUser ? String(window.currentUser.uid) : '';
        const myState = !myUid ? 'out'
            : attendeesArr.some(a => String(a.uid) === myUid && (a.status || 'confirmed') === 'confirmed') ? 'in'
            : (Array.isArray(ev.waitingList) ? ev.waitingList : []).some(w => String(w.uid) === myUid) ? 'waiting' : 'out';
        const isOver = ev.isSessionEnded === true || (!!ev.date && String(ev.date).slice(0, 10) < todayStr);

        let rawPrice = 0.0;
        if (ev.price !== undefined && ev.price !== null) {
            rawPrice = parseFloat(ev.price) || 0.0;
        } else if (ev.fee !== undefined && ev.fee !== null) {
            const cleaned = String(ev.fee).replace('$', '').trim();
            rawPrice = parseFloat(cleaned) || 0.0;
        }
        const displayPrice = rawPrice > 0 ? `$${rawPrice.toFixed(2)}` : "Free";
        const formattedTime = formatTimeTo12Hour(ev.time);

        const _comm = (window.communitiesCache || {})[ev.communityId] || null;
        const communityName = ev.communityName || _comm?.name || "";
        const communityThumbnail = ev.communityThumbnail || _comm?.thumbnail || "";
        
        const dirMatch = (window.directoryList || []).find(u => String(u.uid) === String(ev.organizerId));
        const isMine = window.currentUser && String(ev.organizerId) === String(window.currentUser.uid);
        const hostAvatar = dirMatch?.avatar || (isMine ? window.userProfile?.avatar : '') || ev.organizerAvatar || ev.hostAvatar || defaultAvatar;
        const hostName = ev.organizer || ev.hostName || 'Organizer';

        return `
            <div id="event-card-${ev.id}" onclick="openEventDetails('${ev.id}')" class="relative bg-[#010A0F]/90 rounded-2xl overflow-hidden shadow-xl border-[1.6px] border-emerald-500/60 hover:border-emerald-400 transition cursor-pointer p-4 space-y-3">
                
                ${communityThumbnail ? `
                    <div class="absolute inset-0 z-0 opacity-20">
                        <img src="${escapeHtml(communityThumbnail)}" class="w-full h-full object-cover">
                    </div>
                ` : ''}

                <div class="relative z-10 space-y-3">
                    ${communityName ? `
                        <div class="flex justify-center">
                            <div class="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-black/60 border border-[#00F296]/50 text-[#00F296] text-[10px] font-black">
                                <i class="fa-solid fa-shield"></i>
                                <span>${escapeHtml(communityName)} Community</span>
                            </div>
                        </div>
                    ` : ''}

                    <div class="flex items-center justify-between">
                        <div class="flex items-center space-x-1.5 bg-black/50 px-2.5 py-1 rounded-xl border border-[#00B4AE]/80 text-white text-[10px] font-bold">
                            <i class="fa-solid fa-users text-[10px]"></i>
                            <span>${ev.format || '7v7'} • ${teamsCountNum} Teams</span>
                        </div>

                        <div class="flex items-center space-x-1 bg-black/50 px-2.5 py-1 rounded-xl border ${displayPrice === 'Free' ? 'border-[#00B4AE]/80' : 'border-[#00F296]/80'} text-white text-[10px] font-bold">
                            <i class="fa-solid ${displayPrice === 'Free' ? 'fa-tag' : 'fa-circle-dollar-to-slot'} text-[10px]"></i>
                            <span>${displayPrice}</span>
                        </div>
                    </div>

                    ${ev.title ? `<h3 class="text-base font-bold text-white tracking-tight line-clamp-1">${escapeHtml(ev.title)}</h3>` : ''}
                    ${gameBadgesHtml(ev)}

                    <div class="space-y-1.5 text-[11px] font-medium text-white/90">
                        <div class="flex items-center space-x-2">
                            <i class="fa-solid fa-calendar text-[#00F296] w-3.5"></i>
                            <span>${(window.fmtGameDate || String)(ev.date || '')}</span>
                        </div>
                        <div class="flex items-center space-x-2">
                            <i class="fa-solid fa-clock text-[#00F296] w-3.5"></i>
                            <span>${formattedTime}</span>
                            ${(ev.liveMatchActive && window.liveMatchInProgress && window.liveMatchInProgress(ev.liveMatchActive)) ? `
                                <span class="ml-auto flex items-center gap-1.5 bg-black/60 border border-[#00F296]/60 px-2 py-0.5 rounded-lg text-[10px] font-black ${ev.liveMatchActive.isRunning ? 'text-[#00F296]' : 'text-amber-400'}">
                                    <span class="w-2 h-2 rounded-full ${ev.liveMatchActive.isRunning ? 'bg-[#00F296] animate-ping' : 'bg-amber-400'} inline-block"></span>
                                    ${ev.liveMatchActive.isRunning ? 'LIVE*' : 'PAUSED'}
                                    <span data-live-clock="${ev.id}" class="font-mono">${window.liveClockText(ev.liveMatchActive)}</span>
                                </span>` : ''}
                        </div>
                        <div class="flex items-center space-x-2">
                            <i class="fa-solid fa-location-dot text-[#00F296] w-3.5"></i>
                            <span class="truncate">${escapeHtml(ev.location || '')}</span>
                        </div>
                    </div>

                    <div class="border-t border-white/10 pt-2.5 flex items-center justify-between">
                        <div onclick="event.stopPropagation(); window.switchTab('profile');" class="flex items-center space-x-2 cursor-pointer group">
                            <img src="${hostAvatar}" class="w-6 h-6 rounded-full object-cover border border-[#00F296]/60 shadow-sm">
                            <div>
                                <div class="text-[7px] font-bold text-white/60 uppercase leading-none">BY</div>
                                <div class="text-[10px] font-bold text-white group-hover:text-[#00F296] transition">${escapeHtml(hostName)}</div>
                            </div>
                        </div>

                        <div class="flex items-center gap-1.5 shrink-0">
                        ${!isOver && myState === 'in' ? `
                        <div class="flex items-center space-x-1 px-2.5 py-1 rounded-xl text-[10px] font-black border bg-[#00F296]/20 border-[#00F296] text-[#00F296]"><i class="fa-solid fa-check"></i><span>You're in</span></div>` : ''}
                        ${!isOver && myState === 'waiting' ? `
                        <div class="flex items-center space-x-1 px-2.5 py-1 rounded-xl text-[10px] font-black border bg-amber-400/20 border-amber-400 text-amber-300"><i class="fa-solid fa-hourglass-half"></i><span>Waitlist</span></div>` : ''}
                        ${!isOver && myState === 'out' && window.currentUser ? `
                        <button onclick="event.stopPropagation(); openEventDetails('${ev.id}'); setTimeout(() => openJoinGameModal('${ev.id}'), 250);" class="px-3 py-1 rounded-xl text-[10px] font-black ${isFull ? 'bg-amber-400 text-slate-950' : 'bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950'}">${isFull ? 'Join waitlist' : 'Join'}</button>` : ''}
                        ${isOver ? `
                        <div class="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl text-[10px] font-bold border bg-white/10 border-white/30 text-white/80">
                            <i class="fa-solid fa-flag-checkered"></i>
                            <span>Game ended</span>
                        </div>` : `
                        <div class="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl text-[10px] font-bold border ${isFull ? 'bg-red-500/30 border-red-500 text-red-200' : 'bg-[#00F296]/30 border-[#00F296] text-white'}">
                            <i class="fa-solid ${isFull ? 'fa-user-xmark' : 'fa-user-check'}"></i>
                            <span>${isFull ? 'Full' : `${currentGoing} /${maxCapacity} Going`}</span>
                        </div>`}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (window.initEventsLiveListener) window.initEventsLiveListener();
        if (window.initDirectoryLiveListener) window.initDirectoryLiveListener();
    });
} else {
    if (window.initEventsLiveListener) window.initEventsLiveListener();
    if (window.initDirectoryLiveListener) window.initDirectoryLiveListener();
}