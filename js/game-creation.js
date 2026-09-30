// js/game-creation.js: Handles 2-step game creation matching the iOS app
import { db, appId } from './firebase-config.js';
import { collection, doc, setDoc, addDoc, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let cachedParks = [];
let isParksLoaded = false;
let currentCreationStep = 1; // 1 = Core Details, 2 = Rules & Description

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
        dropdown.className = 'absolute left-0 right-0 top-full mt-1 bg-[#040E13] border border-emerald-500/40 rounded-xl shadow-2xl z-[200] max-h-48 overflow-y-auto divide-y divide-white/10 hidden';
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
            <div onclick="selectCloudPark('${(park.name || '').replace(/'/g, "\\'")}', '${(park.city || '').replace(/'/g, "\\'")}', '${(park.state || 'FL').replace(/'/g, "\\'")}')" class="p-3 hover:bg-black/60 cursor-pointer transition text-xs text-left">
                <div class="font-bold text-white">${park.name}</div>
                <div class="text-[10px] text-white/60">${park.address || `${park.city},${park.state}`}</div>
            </div>
        `).join('');
        dropdown.classList.remove('hidden');
    } else {
        dropdown.innerHTML = `<div class="p-3 text-xs text-white/50">Custom location (will save automatically)</div>`;
        dropdown.classList.remove('hidden');
    }
};

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

window.resetCreateGameForm = function() {
    currentCreationStep = 1;
    window.renderCreateGameSteps();
};

window.setCreationStep = function(step) {
    if (step === 2) {
        const park = document.getElementById('ce-parkname')?.value.trim();
        const city = document.getElementById('ce-city')?.value.trim();
        if (!park || !city) {
            window.showToast("Please enter park name and city before proceeding.", "error");
            return;
        }
    }
    currentCreationStep = step;
    window.renderCreateGameSteps();
};

window.renderCreateGameSteps = function() {
    const step1El = document.getElementById('create-step-1');
    const step2El = document.getElementById('create-step-2');
    const subtitleEl = document.getElementById('create-step-subtitle');

    if (!step1El || !step2El) return;

    if (currentCreationStep === 1) {
        step1El.classList.remove('hidden');
        step2El.classList.add('hidden');
        if (subtitleEl) subtitleEl.textContent = "Step 1 of 2: Fill out basic match details.";
    } else {
        step1El.classList.add('hidden');
        step2El.classList.remove('hidden');
        if (subtitleEl) subtitleEl.textContent = "Step 2 of 2: Add description, rules, and plus-ones.";
    }
};

window.setVisibilityOption = function(vis) {
    const visInput = document.getElementById('ce-visibility');
    if (visInput) visInput.value = vis;
    
    const pubBtn = document.getElementById('vis-btn-public');
    const privBtn = document.getElementById('vis-btn-private');
    
    if (vis === 'Public') {
        pubBtn.className = "flex-1 flex items-center space-x-2.5 p-3 rounded-2xl transition bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-bold shadow-md";
        privBtn.className = "flex-1 flex items-center space-x-2.5 p-3 rounded-2xl transition bg-black/40 text-white hover:bg-black/60 border border-white/10";
    } else {
        privBtn.className = "flex-1 flex items-center space-x-2.5 p-3 rounded-2xl transition bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-bold shadow-md";
        pubBtn.className = "flex-1 flex items-center space-x-2.5 p-3 rounded-2xl transition bg-black/40 text-white hover:bg-black/60 border border-white/10";
    }
};

window.setPlusOnesOption = function(val) {
    const input = document.getElementById('ce-allow-plus-ones');
    if (input) input.value = val;
    
    const noBtn = document.getElementById('plus-btn-no');
    const yesBtn = document.getElementById('plus-btn-yes');
    const limitBox = document.getElementById('plus-one-limit-box');

    if (val === 'yes') {
        yesBtn.className = "flex-1 py-2.5 rounded-xl text-xs font-bold bg-[#00F296] text-slate-950 shadow";
        noBtn.className = "flex-1 py-2.5 rounded-xl text-xs font-bold bg-black/40 text-white hover:bg-black/60";
        if (limitBox) limitBox.classList.remove('hidden');
    } else {
        noBtn.className = "flex-1 py-2.5 rounded-xl text-xs font-bold bg-[#00F296] text-slate-950 shadow";
        yesBtn.className = "flex-1 py-2.5 rounded-xl text-xs font-bold bg-black/40 text-white hover:bg-black/60";
        if (limitBox) limitBox.classList.add('hidden');
    }
};

window.handleCreateEvent = async function(e) {
    e.preventDefault();
    if (!window.currentUser || !window.userProfile) {
        window.showToast("You must be logged in to create a game", "error");
        return;
    }

    const rawTitle = document.getElementById('ce-title').value.trim();
    const title = rawTitle === "" ? "Soccer pick-up (default)" : rawTitle;
    const visibility = document.getElementById('ce-visibility')?.value || 'Public';
    const date = document.getElementById('ce-date').value;
    
    const rawTime = document.getElementById('ce-time').value.trim();
    let time = rawTime;
    
    if (rawTime.toUpperCase().includes('AM') || rawTime.toUpperCase().includes('PM')) {
        let clean = rawTime.replace(/am/gi, '').replace(/pm/gi, '').trim();
        const upper = rawTime.toUpperCase().includes('PM') ? 'PM' : 'AM';
        time = `${clean} ${upper}`;
    } else if (rawTime && rawTime.includes(':')) {
        const parts = rawTime.split(':');
        let h = parseInt(parts[0], 10);
        const m = (parts[1] || '00').replace(/[^0-9]/g, '');
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        h = h ? h : 12;
        time = `${h}:${m} ${ampm}`;
    }

    const parkname = document.getElementById('ce-parkname').value.trim();
    const city = document.getElementById('ce-city').value.trim();
    const state = document.getElementById('ce-state').value.trim();
    const teamsCount = parseInt(document.getElementById('ce-teams-count').value, 10) || 3;
    const format = document.getElementById('ce-format').value;
    const fee = document.getElementById('ce-fee').value.trim();

    const description = document.getElementById('ce-description')?.value.trim() || '';
    const rules = document.getElementById('ce-rules')?.value.trim() || '';
    const allowPlusOnes = document.getElementById('ce-allow-plus-ones')?.value === 'yes';
    const plusOneLimit = allowPlusOnes ? (parseInt(document.getElementById('ce-plus-one-limit')?.value, 10) || 1) : 0;

    const locationStr = `${parkname} (${city || 'Park'}, ${state || 'FL'})`;
    let eventId = 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    const organizerName = `${window.userProfile.firstName || ''} ${window.userProfile.lastName || ''}`.trim();
    const defaultAvatar = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
    const organizerAvatar = (window.userProfile.avatar && window.userProfile.avatar.trim() !== '') 
        ? window.userProfile.avatar 
        : (window.currentUser.photoURL || defaultAvatar);

    let attendees = [{
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
        hostName: organizerName,
        hostAvatar: organizerAvatar,
        attendees: attendees,
        waitingList: [],
        declinedList: [],
        comments: [],
        matches: [],
        isSessionEnded: false,
        createdAt: new Date().toISOString()
    };

    try {
        const eventDocRef = doc(db, 'artifacts', appId, 'eventsList', eventId);
        await setDoc(eventDocRef, newEvent);

        window.resetCreateGameForm();
        window.showToast("⚽ Game published successfully!");
        window.switchTab('events');
    } catch (err) {
        console.error("Error saving event:", err);
        window.showToast("Failed to save game", "error");
    }
};