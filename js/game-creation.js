// js/game-creation.js: Handles game creation with individual Firestore document storage to avoid 1MB limits
import { db, appId } from './firebase-config.js';
import { collection, doc, setDoc, addDoc, query, where, getDocs, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let cachedParks = [];
let isParksLoaded = false;

async function preloadParks() {
    if (isParksLoaded) return;
    try {
        const snap = await getDocs(collection(db, 'artifacts', appId, 'global', 'parks', 'list'));
        const cloudList = snap.docs.map(d => d.data());
        const defaults = [
            { name: "Cypress Park", address: "1300 Coral Springs Dr, Coral Springs, FL 33071", city: "Coral Springs", state: "FL" },
            { name: "Firefighters Park", address: "2500 N Rock Island Rd, Margate, FL 33063", city: "Margate", state: "FL" },
            { name: "Pine Trails Park", address: "10555 Trails End Rd, Parkland, FL 33076", city: "Parkland", state: "FL" },
            { name: "Tradition Park", address: "2100 Lyons Rd, Coconut Creek, FL 33063", city: "Coconut Creek", state: "FL" },
            { name: "South County Regional Park", address: "11200 Glades Rd, Boca Raton, FL 33434", city: "Boca Raton", state: "FL" }
        ];
        cachedParks = [...cloudList];
        defaults.forEach(def => {
            if (!cachedParks.some(p => p.name.toLowerCase() === def.name.toLowerCase())) {
                cachedParks.push(def);
            }
        });
        isParksLoaded = true;
    } catch (e) {
        cachedParks = [
            { name: "Cypress Park", address: "1300 Coral Springs Dr, Coral Springs, FL 33071", city: "Coral Springs", state: "FL" },
            { name: "Firefighters Park", address: "2500 N Rock Island Rd, Margate, FL 33063", city: "Margate", state: "FL" },
            { name: "Pine Trails Park", address: "10555 Trails End Rd, Parkland, FL 33076", city: "Parkland", state: "FL" },
            { name: "Tradition Park", address: "2100 Lyons Rd, Coconut Creek, FL 33063", city: "Coconut Creek", state: "FL" }
        ];
    }
}
preloadParks();

window.handleParkSearchInput = async function(val) {
    await preloadParks();
    const parkNameInput = document.getElementById('ce-parkname');
    if (parkNameInput) parkNameInput.value = val;

    let dropdown = document.getElementById('park-suggestions-dropdown');
    const searchInput = document.getElementById('ce-park-search');
    if (!searchInput) return;

    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'park-suggestions-dropdown';
        dropdown.className = 'absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-[200] max-h-48 overflow-y-auto divide-y divide-slate-100 hidden';
        const wrapper = searchInput.closest('.relative') || searchInput.parentElement;
        if (wrapper) {
            wrapper.style.position = 'relative';
            wrapper.appendChild(dropdown);
        }
    }

    const queryVal = val.toLowerCase().trim();
    if (queryVal.length < 1) {
        dropdown.classList.add('hidden');
        return;
    }

    const matches = cachedParks.filter(p => 
        p.name.toLowerCase().includes(queryVal) || 
        (p.city && p.city.toLowerCase().includes(queryVal)) || 
        (p.address && p.address.toLowerCase().includes(queryVal))
    );

    if (matches.length > 0) {
        dropdown.innerHTML = matches.map(park => `
            <div onclick="selectCloudPark('${(park.name || '').replace(/'/g, "\\'")}', '${(park.city || '').replace(/'/g, "\\'")}', '${(park.state || 'FL').replace(/'/g, "\\'")}')" class="p-3 hover:bg-slate-50 cursor-pointer transition text-xs text-left">
                <div class="font-bold text-slate-900">${park.name}</div>
                <div class="text-[10px] text-slate-500">${park.address || `${park.city}, ${park.state}`}</div>
            </div>
        `).join('');
        dropdown.classList.remove('hidden');
    } else {
        dropdown.innerHTML = `<div class="p-3 text-xs text-slate-400">Custom location (will save automatically to database)</div>`;
        dropdown.classList.remove('hidden');
    }
};

export function setupCloudParksAutocomplete() {
    preloadParks();
}

window.selectCloudPark = function(name, city, state) {
    const searchInput = document.getElementById('ce-park-search');
    const parkNameInput = document.getElementById('ce-parkname');
    const cityInput = document.getElementById('ce-city');
    const stateInput = document.getElementById('ce-state');

    if (searchInput) searchInput.value = name;
    if (parkNameInput) parkNameInput.value = name;
    if (cityInput) cityInput.value = city || '';
    if (stateInput) stateInput.value = state || 'FL';

    const dropdown = document.getElementById('park-suggestions-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
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
            cachedParks.push({ name: parkName, city: cityName, state: stateName || 'FL' });
        }
    } catch (err) {
        console.error("Error saving park to database:", err);
    }
}

window.toggleAdvancedSettings = function() {
    const container = document.getElementById('advanced-settings-container');
    const chevron = document.getElementById('advanced-settings-chevron');
    if (!container) return;

    container.classList.toggle('hidden');
    if (chevron) {
        chevron.classList.toggle('fa-chevron-down');
        chevron.classList.toggle('fa-chevron-up');
    }
};

window.togglePlusOneLimit = function(allow) {
    const limitContainer = document.getElementById('plus-one-limit-box');
    if (!limitContainer) return;

    if (allow === 'yes') {
        limitContainer.classList.remove('hidden');
    } else {
        limitContainer.classList.add('hidden');
    }
};

window.handleCreateEvent = async function(e) {
    e.preventDefault();
    if (!window.currentUser || !window.userProfile) {
        window.showToast("You must be logged in to create a game", "error");
        return;
    }

    const title = document.getElementById('ce-title').value.trim();
    const visibility = document.getElementById('ce-visibility').value;
    const date = document.getElementById('ce-date').value;
    const rawTime = document.getElementById('ce-time').value;
    
    let time = rawTime;
    if (rawTime && rawTime.includes(':')) {
        const [hStr, mStr] = rawTime.split(':');
        let h = parseInt(hStr, 10);
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        h = h ? h : 12;
        time = `${h}:${mStr} ${ampm}`;
    }

    const parkname = document.getElementById('ce-parkname').value.trim();
    const city = document.getElementById('ce-city').value.trim();
    const state = document.getElementById('ce-state').value.trim();
    const teamsCount = parseInt(document.getElementById('ce-teams-count').value, 10) || 3;
    const format = document.getElementById('ce-format').value;
    const fee = document.getElementById('ce-fee').value.trim();

    await saveParkToCloudIfNeeded(parkname, city, state);

    const description = document.getElementById('ce-description')?.value.trim() || '';
    const rules = document.getElementById('ce-rules')?.value.trim() || '';
    const allowPlusOnes = document.getElementById('ce-allow-plus-ones')?.value === 'yes';
    const plusOneLimit = allowPlusOnes ? (parseInt(document.getElementById('ce-plus-one-limit')?.value, 10) || 1) : 0;

    const locationStr = `${parkname} (${city}, ${state})`;
    const editEventIdInput = document.getElementById('ce-edit-event-id');
    const isEditing = editEventIdInput && editEventIdInput.value;

    let eventId = isEditing ? editEventIdInput.value : ('evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));

    const organizerName = `${window.userProfile.firstName || ''} ${window.userProfile.lastName || ''}`.trim();
    const organizerAvatar = window.userProfile.avatar || window.userProfile.photoURL || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';

    let attendees = isEditing && window.editingAttendees ? window.editingAttendees : [{
        uid: window.currentUser.uid,
        name: organizerName,
        avatar: organizerAvatar,
        role: 'Organizer',
        status: 'confirmed',
        paid: 'Free',
        guests: []
    }];

    const newEvent = {
        id: eventId,
        title,
        visibility,
        date,
        time,
        location: locationStr,
        description,
        rules,
        teamsCount,
        format,
        fee,
        allowPlusOnes,
        plusOneLimit,
        organizerId: window.currentUser.uid,
        organizer: organizerName,
        organizerAvatar: organizerAvatar,
        attendees: attendees,
        waitingList: isEditing && window.editingWaitingList ? window.editingWaitingList : [],
        declinedList: isEditing && window.editingDeclinedList ? window.editingDeclinedList : [],
        comments: isEditing && window.editingComments ? window.editingComments : [],
        matches: isEditing && window.editingMatches ? window.editingMatches : [],
        isSessionEnded: false,
        createdAt: new Date().toISOString()
    };

    if (editEventIdInput) editEventIdInput.remove();

    try {
        // Save to individual event document instead of packing into one giant array document
        const eventDocRef = doc(db, 'artifacts', appId, 'eventsList', eventId);
        await setDoc(eventDocRef, newEvent);

        window.showToast(isEditing ? "⚽ Game updated successfully!" : "⚽ Game published successfully!");
        window.switchTab('events');
    } catch (err) {
        console.error("Error saving event:", err);
        window.showToast("Failed to save game", "error");
    }
};