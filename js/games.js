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
    // If it already has AM or PM, return it cleaned up so it never doubles
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
    
    // Skip setting up listeners if no user is signed in to avoid permission errors
    if (!window.currentUser) return;

    const eventsRef = collection(db, 'artifacts', appId, 'eventsList');
    
    eventsUnsubscribe = onSnapshot(eventsRef, (snapshot) => {
        const list = [];
        snapshot.forEach(docSnap => {
            list.push(docSnap.data());
        });
        window.eventsList = list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        if (window.renderDateTabs) window.renderDateTabs();
        if (window.renderEvents) window.renderEvents();
        
        if (window.activeModalEventId && window.renderEventDetailModalContent) {
            window.renderEventDetailModalContent();
        }
    }, (error) => {
        // Silently handle permission denied on logout/unauthenticated states
        if (error.code !== 'permission-denied') {
            console.error("Error listening to events collection:", error);
        }
        window.eventsList = [];
        if (window.renderEvents) window.renderEvents();
    });
};

window.initDirectoryLiveListener = function() {
    if (directoryUnsubscribe) directoryUnsubscribe();
    
    // Skip setting up listeners if no user is signed in
    if (!window.currentUser) return;

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

    for (let i = 0; i < 8; i++) {
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
        <button onclick="selectDateTab('${d.date}')" class="px-5 py-2.5 rounded-full text-xs font-bold shrink-0 transition ${window.selectedDateStr === d.date ? 'bg-brand text-slate-950 shadow-md' : 'bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200'}">
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

    // Reset form state first, then store the copied event
    if (typeof window.resetCreateGameForm === 'function') {
        window.resetCreateGameForm();
    }

    window.pendingCopiedEvent = event;
    window.activeModalEventId = null; 

    // 1. Switch to create event tab
    if (typeof window.switchTab === 'function') {
        window.switchTab('create-event');
        const createTabEl = document.getElementById('tab-create-event') || document.getElementById('tab-create-game');
        if (!createTabEl) {
            window.switchTab('create-game');
        }
    }

    // 2. If your app has a specific render function for the create tab, call it here:
    if (typeof window.renderCreateEventScreen === 'function') {
        window.renderCreateEventScreen();
    }

    // 3. Populate form fields safely after the DOM updates
    setTimeout(() => {
        if (typeof window.populateCreateFormFromCopy === 'function') {
            window.populateCreateFormFromCopy();
        } else {
            const titleEl = document.getElementById('ce-title');
            const dateEl = document.getElementById('ce-date');
            if (titleEl) titleEl.value = `${event.title} (Copy)`;
            if (dateEl) {
                dateEl.value = '';
                dateEl.focus();
            }
        }
    }, 200);

    if (typeof window.showToast === 'function') {
        window.showToast("Game details copied! Please select a future date.");
    }
};

window.renderEvents = function() {
    const grid = document.getElementById('events-grid');
    if (!grid) return;

    const filtered = (window.eventsList || [])
        .filter(ev => ev.date === window.selectedDateStr)
        .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full bg-white border border-slate-200 rounded-3xl p-10 text-center space-y-3 shadow-sm">
                <div class="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400 text-2xl">
                    <i class="fa-solid fa-futbol"></i>
                </div>
                <h3 class="text-base font-black text-slate-900">No games scheduled for this date</h3>
                <p class="text-slate-500 text-xs">Be the first to organize a match for this day!</p>
                <button onclick="if(window.resetCreateGameForm) window.resetCreateGameForm(); switchTab('create-event')" class="mt-2 inline-flex items-center gap-2 bg-brand text-slate-950 font-black px-5 py-2.5 rounded-xl text-xs shadow">
                    <i class="fa-solid fa-plus"></i> Create Game
                </button>
            </div>
        `;
        return;
    }

    grid.innerHTML = filtered.map(ev => {
        const formatMatch = (ev.format || "").match(/(\d+)/);
        const playersPerTeam = formatMatch ? parseInt(formatMatch[1]) : 7;
        const maxCapacity = playersPerTeam * (ev.teamsCount || 3);
        
        let currentGoing = 0;
        (ev.attendees || []).forEach(a => {
            currentGoing += 1 + (a.guests ? a.guests.length : 0);
        });
        if (currentGoing === 0 && ev.attendees?.length === 0) currentGoing = 1;

        const rawFee = ev.fee !== undefined ? ev.fee : "Free";
        const feeDisplay = (rawFee === "Free" || rawFee === "0" || rawFee === 0 || rawFee === "0.00" || rawFee === "") ? "Free" : `$${parseFloat(rawFee).toFixed(2)}`;
        const formattedTime = formatTimeTo12Hour(ev.time);

        return `
            <div onclick="openEventDetails('${ev.id}')" class="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:border-brand transition flex flex-col cursor-pointer">
                <div class="bg-brand px-6 py-4 text-slate-950">
                    <div class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider mb-1 opacity-90">
                        <span>${ev.format} • ${ev.teamsCount} Teams</span>
                        <span class="text-sm font-black bg-slate-950 text-white px-3 py-1 rounded-lg shadow-sm">${feeDisplay}</span>
                    </div>
                    <h3 class="text-lg font-black tracking-tight">${ev.title}</h3>
                </div>

                <div class="p-6 space-y-4 flex-1 flex flex-col justify-between">
                    <div class="space-y-2 text-xs text-slate-600">
                        <div class="flex items-center gap-2.5"><i class="fa-solid fa-clock text-brand w-4"></i> <span class="font-bold text-slate-800">${formattedTime}</span></div>
                        <div class="flex items-center gap-2.5"><i class="fa-solid fa-location-dot text-brand w-4"></i> <span class="truncate">${ev.location}</span></div>
                    </div>

                    <div class="pt-4 border-t border-slate-100 flex items-center justify-between">
                        <div onclick="event.stopPropagation(); window.switchTab('profile');" class="flex items-center gap-2.5 cursor-pointer group">
                            <img src="${ev.organizerAvatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-8 h-8 rounded-full object-cover border border-slate-200 shadow-sm group-hover:border-brand transition">
                            <div>
                                <div class="text-[10px] font-bold text-slate-400 uppercase leading-none">By</div>
                                <div class="text-xs font-black text-slate-900 group-hover:text-brand transition mt-0.5">${ev.organizer}</div>
                            </div>
                        </div>
                        <span class="text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-xl">${currentGoing} / ${maxCapacity} Going</span>
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