// js/games.js: Manages game publishing, date navigation, live Firestore listeners, and event copying
import { db, appId } from './firebase-config.js';
import { doc, setDoc, getDoc, collection, addDoc, getDocs, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.selectedDateStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

let eventsUnsubscribe = null;

window.initEventsLiveListener = function() {
    if (eventsUnsubscribe) eventsUnsubscribe();
    const docRef = doc(db, 'artifacts', appId, 'global', 'events');
    
    eventsUnsubscribe = onSnapshot(docRef, (docSnap) => {
        window.eventsList = docSnap.exists() ? (docSnap.data().list || []) : [];
        if (window.renderDateTabs) window.renderDateTabs();
        if (window.renderEvents) window.renderEvents();
        
        if (window.activeModalEventId && window.renderEventDetailModalContent) {
            window.renderEventDetailModalContent();
        }
    }, (error) => {
        console.error("Error listening to events:", error);
        window.eventsList = [];
        if (window.renderEvents) window.renderEvents();
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

async function saveParkToCloudIfNeeded(parkName, cityName, stateName) {
    if (!parkName || !cityName) return;
    try {
        const parksRef = collection(db, 'artifacts', appId, 'global', 'parks', 'list');
        const q = query(parksRef, where("name", "==", parkName));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            await addDoc(parksRef, {
                name: parkName,
                city: cityName,
                state: stateName || 'FL',
                address: `${parkName}, ${cityName}, ${stateName || 'FL'}`,
                createdAt: Date.now()
            });
        }
    } catch (err) {
        console.error("Error saving park:", err);
    }
}

window.handleCreateEvent = async function(e) {
    e.preventDefault();
    
    const parkName = document.getElementById('ce-parkname').value.trim();
    const cityName = document.getElementById('ce-city').value.trim();
    const stateName = document.getElementById('ce-state').value.trim();

    await saveParkToCloudIfNeeded(parkName, cityName, stateName);
    const feeVal = document.getElementById('ce-fee').value.trim();
    const editingEventId = document.getElementById('ce-edit-event-id')?.value;

    const newEvent = {
        id: editingEventId || ('evt_' + Date.now()),
        title: document.getElementById('ce-title').value,
        visibility: document.getElementById('ce-visibility').value,
        date: document.getElementById('ce-date').value,
        time: document.getElementById('ce-time').value,
        location: `${parkName} (${cityName}, ${stateName})`,
        description: document.getElementById('ce-description').value || 'Friendly match.',
        rules: document.getElementById('ce-rules').value || 'Standard fair play rules.',
        format: document.getElementById('ce-format').value,
        teamsCount: parseInt(document.getElementById('ce-teams-count').value),
        fee: feeVal || "Free",
        organizer: window.editingOrganizerName || `${window.userProfile.firstName} ${window.userProfile.lastName}`,
        organizerAvatar: window.editingOrganizerAvatar || window.userProfile.avatar,
        organizerId: window.editingOrganizerId || window.userProfile.uid,
        attendees: window.editingAttendees || [{ uid: window.userProfile.uid, name: `${window.userProfile.firstName} ${window.userProfile.lastName}`, avatar: window.userProfile.avatar, role: 'Organizer', status: 'confirmed', paid: 'Unpaid' }],
        waitingList: [],
        declinedList: [],
        invitedList: [],
        comments: window.editingComments || [],
        typingUsers: [],
        matches: window.editingMatches || []
    };
    
    // Clear editing states
    window.editingOrganizerName = null;
    window.editingOrganizerAvatar = null;
    window.editingOrganizerId = null;
    window.editingAttendees = null;
    window.editingComments = null;
    window.editingMatches = null;

    try {
        const docRef = doc(db, 'artifacts', appId, 'global', 'events');
        const docSnap = await getDoc(docRef);
        let currentList = docSnap.exists() ? (docSnap.data().list || []) : [];
        
        if (editingEventId) {
            currentList = currentList.map(ev => ev.id === editingEventId ? newEvent : ev);
        } else {
            currentList.unshift(newEvent);
        }

        await setDoc(docRef, { list: currentList });
        window.eventsList = currentList;
    } catch (err) {
        window.eventsList = window.eventsList || [];
        window.eventsList.unshift(newEvent);
        await setDoc(doc(db, 'artifacts', appId, 'global', 'events'), { list: window.eventsList });
    }

    window.showToast(editingEventId ? "Game updated successfully!" : "Game successfully created & published!");
    window.switchTab('events');
};

// Copy Event feature: loads event data into creation form with a mandatory new date
window.copyEvent = function(eventId) {
    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    window.switchTab('create-event');
    
    setTimeout(() => {
        document.getElementById('ce-title').value = `${event.title} (Copy)`;
        document.getElementById('ce-visibility').value = event.visibility || 'Public';
        document.getElementById('ce-date').value = ''; // Mandatory date to fill
        document.getElementById('ce-time').value = event.time || '20:00';
        
        // Parse location back out
        const locParts = event.location.match(/^(.*?)\s*\((.*?),\s*(.*?)\)$/);
        if (locParts) {
            document.getElementById('ce-park-search').value = locParts[1];
            document.getElementById('ce-parkname').value = locParts[1];
            document.getElementById('ce-city').value = locParts[2];
            document.getElementById('ce-state').value = locParts[3];
        } else {
            document.getElementById('ce-parkname').value = event.location;
        }

        document.getElementById('ce-description').value = event.description || '';
        document.getElementById('ce-rules').value = event.rules || '';
        document.getElementById('ce-teams-count').value = event.teamsCount || 3;
        document.getElementById('ce-format').value = event.format || '7v7';
        document.getElementById('ce-fee').value = event.fee || 'Free';

        // Keep original organizer data for cloning
        window.editingOrganizerName = event.organizer;
        window.editingOrganizerAvatar = event.organizerAvatar;
        window.editingOrganizerId = event.organizerId;
    }, 100);
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
                <button onclick="switchTab('create-event')" class="mt-2 inline-flex items-center gap-2 bg-brand text-slate-950 font-black px-5 py-2.5 rounded-xl text-xs shadow">
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
        const currentGoing = ev.attendees?.length || 1;

        const rawFee = ev.fee !== undefined ? ev.fee : "Free";
        const feeDisplay = (rawFee === "Free" || rawFee === "0" || rawFee === 0 || rawFee === "0.00" || rawFee === "") ? "Free" : `$${parseFloat(rawFee).toFixed(2)}`;

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
                        <div class="flex items-center gap-2.5"><i class="fa-solid fa-clock text-brand w-4"></i> <span class="font-bold text-slate-800">${ev.time}</span></div>
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

setTimeout(() => {
    if (window.initEventsLiveListener) window.initEventsLiveListener();
}, 500);