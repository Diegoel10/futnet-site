// js/games.js: Manages date navigation, live Firestore listeners for individual event docs, and event copying
import { db, appId } from './firebase-config.js';
import { doc, getDoc, collection, getDocs, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.selectedDateStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

let eventsUnsubscribe = null;
let directoryUnsubscribe = null;

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

    eventsUnsubscribe = onSnapshot(eventsRef, (snapshot) => {
        const list = [];
        snapshot.forEach(docSnap => {
            const evData = docSnap.data();
            if (!evData.id) evData.id = docSnap.id;
            if (!evData.attendees) evData.attendees = [];
            if (!evData.waitingList) evData.waitingList = [];
            if (!evData.declinedList) evData.declinedList = [];
            list.push(evData);
        });
        window.eventsList = list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        if (window.renderDateTabs) window.renderDateTabs();
        if (window.renderEvents) window.renderEvents();

        if (window.activeModalEventId && window.renderEventDetailModalContent) {
            window.renderEventDetailModalContent();
        }
    }, (error) => {
        if (error.code !== 'permission-denied') {
            console.error("Error listening to events collection:", error);
        }
        window.eventsList = [];
        if (window.renderEvents) window.renderEvents();
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

window.renderEvents = function() {
    const grid = document.getElementById('events-grid');
    if (!grid) return;

    const filtered = (window.eventsList || [])
        .filter(ev => {
            const evDateClean = (ev.date || "").substring(0, 10);
            return evDateClean === window.selectedDateStr;
        })
        .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full bg-[#040E13]/80 border border-emerald-500/30 rounded-3xl p-10 text-center space-y-3 shadow-xl backdrop-blur-md">
                <div class="w-16 h-16 bg-black/40 rounded-full flex items-center justify-center mx-auto text-white/50 text-2xl border border-white/10">
                    <i class="fa-solid fa-sportscourt"></i>
                </div>
                <h3 class="text-base font-black text-white">No games scheduled for this date</h3>
                <p class="text-white/70 text-xs">Be the first to organize a match for this day!</p>
                <button onclick="if(window.resetCreateGameForm) window.resetCreateGameForm(); switchTab('create-event')" class="mt-2 inline-flex items-center gap-2 bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black px-5 py-2.5 rounded-xl text-xs shadow-md">
                    <i class="fa-solid fa-plus"></i> Create Game
                </button>
            </div>
        `;
        return;
    }

    const defaultAvatar = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';

    grid.innerHTML = filtered.map(ev => {
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

        let rawPrice = 0.0;
        if (ev.price !== undefined && ev.price !== null) {
            rawPrice = parseFloat(ev.price) || 0.0;
        } else if (ev.fee !== undefined && ev.fee !== null) {
            const cleaned = String(ev.fee).replace('$', '').trim();
            rawPrice = parseFloat(cleaned) || 0.0;
        }
        const displayPrice = rawPrice > 0 ? `$${rawPrice.toFixed(2)}` : "Free";
        const formattedTime = formatTimeTo12Hour(ev.time);

        const communityName = ev.communityName || "";
        const communityThumbnail = ev.communityThumbnail || "";
        const hostAvatar = (ev.organizerAvatar && ev.organizerAvatar.trim() !== '') ? ev.organizerAvatar : ((ev.hostAvatar && ev.hostAvatar.trim() !== '') ? ev.hostAvatar : defaultAvatar);
        const hostName = ev.organizer || ev.hostName || 'Organizer';

        return `
            <div onclick="openEventDetails('${ev.id}')" class="relative bg-[#010A0F]/90 rounded-2xl overflow-hidden shadow-xl border-[1.6px] border-emerald-500/60 hover:border-emerald-400 transition cursor-pointer p-4 space-y-3">
                
                ${communityThumbnail ? `
                    <div class="absolute inset-0 z-0 opacity-20">
                        <img src="${communityThumbnail}" class="w-full h-full object-cover">
                    </div>
                ` : ''}

                <div class="relative z-10 space-y-3">
                    ${communityName ? `
                        <div class="flex justify-center">
                            <div class="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-black/60 border border-[#00F296]/50 text-[#00F296] text-[10px] font-black">
                                <i class="fa-solid fa-shield"></i>
                                <span>${communityName} Community</span>
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

                    ${ev.title ? `<h3 class="text-base font-bold text-white tracking-tight line-clamp-1">${ev.title}</h3>` : ''}

                    <div class="space-y-1.5 text-[11px] font-medium text-white/90">
                        <div class="flex items-center space-x-2">
                            <i class="fa-solid fa-calendar text-[#00F296] w-3.5"></i>
                            <span>${ev.date || ''}</span>
                        </div>
                        <div class="flex items-center space-x-2">
                            <i class="fa-solid fa-clock text-[#00F296] w-3.5"></i>
                            <span>${formattedTime}</span>
                        </div>
                        <div class="flex items-center space-x-2">
                            <i class="fa-solid fa-location-dot text-[#00F296] w-3.5"></i>
                            <span class="truncate">${ev.location || ''}</span>
                        </div>
                    </div>

                    <div class="border-t border-white/10 pt-2.5 flex items-center justify-between">
                        <div onclick="event.stopPropagation(); window.switchTab('profile');" class="flex items-center space-x-2 cursor-pointer group">
                            <img src="${hostAvatar}" class="w-6 h-6 rounded-full object-cover border border-[#00F296]/60 shadow-sm">
                            <div>
                                <div class="text-[7px] font-bold text-white/60 uppercase leading-none">BY</div>
                                <div class="text-[10px] font-bold text-white group-hover:text-[#00F296] transition">${hostName}</div>
                            </div>
                        </div>

                        <div class="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl text-[10px] font-bold border ${isFull ? 'bg-red-500/30 border-red-500 text-red-200' : 'bg-[#00F296]/30 border-[#00F296] text-white'}">
                            <i class="fa-solid ${isFull ? 'fa-user-xmark' : 'fa-user-check'}"></i>
                            <span>${isFull ? 'Full' : `${currentGoing} /${maxCapacity} Going`}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
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