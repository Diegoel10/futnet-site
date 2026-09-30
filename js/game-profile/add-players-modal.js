// js/game-profile/add-players-modal.js: Dedicated screen for adding players to the roster
import { db, appId } from '../firebase-config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.openAddPlayersScreen = async function(eventId) {
    let modal = document.getElementById('add-players-screen-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'add-players-screen-modal';
        modal.className = 'fixed inset-0 z-[130] flex flex-col justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200';
        document.body.appendChild(modal);
    }

    let directory = window.directoryList || [];
    if (directory.length === 0) {
        try {
            const snap = await getDoc(doc(db, 'artifacts', appId, 'directory', 'data')); // or fetch collection
            // fallback handled by global directory listener
        } catch(e) {}
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border-t border-emerald-500/40 rounded-t-[32px] p-6 space-y-4 max-w-lg w-full mx-auto shadow-2xl text-white max-h-[85vh] overflow-y-auto" onclick="event.stopPropagation()">
            <div class="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-2"></div>
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 class="text-base font-black text-white uppercase tracking-wider">Add Players to Roster</h3>
                <button onclick="document.getElementById('add-players-screen-modal').remove()" class="text-white/50 hover:text-white text-sm font-bold"><i class="fa-solid fa-xmark text-lg"></i></button>
            </div>

            <!-- Search Bar -->
            <div class="relative">
                <input type="text" id="add-players-search" oninput="filterAddPlayersList('${eventId}')" placeholder="Search registered app users..." class="w-full bg-black/60 border border-teal-500/50 rounded-xl pl-9 pr-3 py-2.5 text-white text-xs focus:outline-none focus:border-brand placeholder:text-white/30" style="background-color: #000000 !important; color: #ffffff !important;" autocomplete="off">
                <i class="fa-solid fa-magnifying-glass absolute left-3 top-3 text-emerald-400 text-xs"></i>
            </div>

            <!-- Users Selection List Container -->
            <div id="add-players-list-container" class="space-y-2 max-h-60 overflow-y-auto pr-1 divide-y divide-white/10">
                <!-- Rendered dynamically -->
            </div>

            <button onclick="submitBatchAddPlayers('${eventId}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3 rounded-xl text-xs uppercase tracking-wider shadow-md transition">
                Add Selected Players
            </button>
        </div>
    `;

    renderAddPlayersList(eventId, "");
};

window.renderAddPlayersList = function(eventId, queryStr) {
    const container = document.getElementById('add-players-list-container');
    if (!container) return;

    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    const attendees = event?.attendees || [];
    const existingUids = new Set(attendees.map(a => a.uid));

    const pool = [
        ...(window.directoryList || []),
        ...(window.friendsList || [])
    ];

    const filtered = pool.filter(p => {
        const name = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim();
        if (!name || existingUids.has(p.uid)) return false;
        if (!queryStr) return true;
        return name.toLowerCase().includes(queryStr.toLowerCase());
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="text-center text-xs text-white/50 py-6">No available users found.</div>`;
        return;
    }

    container.innerHTML = filtered.map(u => {
        const name = u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim();
        const avatar = u.avatar || u.photoURL || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
        return `
            <div class="flex items-center justify-between py-2.5 px-2 hover:bg-black/40 rounded-xl cursor-pointer" onclick="toggleAddPlayerSelection(this, '${u.uid}')">
                <div class="flex items-center gap-3">
                    <img src="${avatar}" class="w-8 h-8 rounded-full object-cover border border-emerald-500/40">
                    <span class="text-xs font-bold text-white">${name}</span>
                </div>
                <input type="checkbox" value="${u.uid}" data-name="${name}" data-avatar="${avatar}" class="add-player-checkbox w-4 h-4 accent-brand cursor-pointer">
            </div>
        `;
    }).join('');
};

window.filterAddPlayersList = function(eventId) {
    const input = document.getElementById('add-players-search');
    renderAddPlayersList(eventId, input ? input.value.trim() : "");
};

window.toggleAddPlayerSelection = function(rowEl, uid) {
    const checkbox = rowEl.querySelector('input[type="checkbox"]');
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
    }
};

window.submitBatchAddPlayers = async function(eventId) {
    const checkboxes = document.querySelectorAll('.add-player-checkbox:checked');
    if (checkboxes.length === 0) {
        window.showToast("Please select at least one player to add.", "error");
        return;
    }

    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    let attendees = event.attendees || [];
    checkboxes.forEach(cb => {
        attendees.push({
            uid: cb.value,
            name: cb.getAttribute('data-name'),
            avatar: cb.getAttribute('data-avatar'),
            role: 'Player',
            status: 'confirmed',
            paid: 'Unpaid',
            guests: []
        });
    });

    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), { attendees }, { merge: true });
        window.showToast("Players added successfully!");
        const modal = document.getElementById('add-players-screen-modal');
        if (modal) modal.remove();
    } catch (e) {
        window.showToast("Failed to add players", "error");
    }
};