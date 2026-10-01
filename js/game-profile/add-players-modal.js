// js/game-profile/add-players-modal.js: Dedicated screen with smart sorting and manual fallback for private/incognito users
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

            <!-- Manual Add Section for Private/Incognito Users -->
            <div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2">
                <span class="text-[10px] font-bold text-white/60 uppercase">Add Private / Unlisted Player</span>
                <div class="flex gap-2">
                    <input type="text" id="manual-add-player-name" placeholder="Enter player's full name..." class="flex-1 bg-black/80 border border-white/20 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#00F296]">
                    <button onclick="submitManualAddPlayer('${eventId}')" class="bg-[#00F296]/20 hover:bg-[#00F296]/30 text-[#00F296] font-black px-4 py-2 rounded-xl text-xs border border-[#00F296]/50 transition">Add</button>
                </div>
            </div>

            <!-- Users Selection List Container -->
            <div id="add-players-list-container" class="space-y-2 max-h-50 overflow-y-auto pr-1 divide-y divide-white/10">
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

    const attendanceFrequency = {};
    (window.eventsList || []).forEach(ev => {
        (ev.attendees || []).forEach(att => {
            if (att.uid) {
                attendanceFrequency[att.uid] = (attendanceFrequency[att.uid] || 0) + 1;
            }
        });
    });

    const friendUids = new Set((window.friendsList || []).map(f => f.uid));

    const pool = [
        ...(window.directoryList || []),
        ...(window.friendsList || [])
    ];

    const uniquePoolMap = new Map();
    pool.forEach(p => {
        if (p && p.uid && !existingUids.has(p.uid)) {
            uniquePoolMap.set(p.uid, p);
        }
    });

    let poolArray = Array.from(uniquePoolMap.values());

    poolArray.sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;

        if (friendUids.has(a.uid)) scoreA += 50;
        if (friendUids.has(b.uid)) scoreB += 50;

        scoreA += (attendanceFrequency[a.uid] || 0) * 10;
        scoreB += (attendanceFrequency[b.uid] || 0) * 10;

        return scoreB - scoreA;
    });

    const filtered = poolArray.filter(p => {
        const name = p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim();
        if (!name) return false;
        if (!queryStr) return true;
        return name.toLowerCase().includes(queryStr.toLowerCase());
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="text-center text-xs text-white/50 py-4">No other directory users found. Use manual add above.</div>`;
        return;
    }

    container.innerHTML = filtered.map(u => {
        const name = u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim();
        const avatar = u.avatar || u.photoURL || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
        const isFriend = friendUids.has(u.uid);
        const freqCount = attendanceFrequency[u.uid] || 0;

        let badgeText = '';
        if (isFriend) {
            badgeText = '<span class="text-[9px] bg-[#00F296]/20 text-[#00F296] px-2 py-0.5 rounded font-black border border-[#00F296]/40">Friend</span>';
        } else if (freqCount > 1) {
            badgeText = '<span class="text-[9px] bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded font-bold border border-teal-500/40">Frequent</span>';
        }

        return `
            <div class="flex items-center justify-between py-2.5 px-3 hover:bg-black/50 rounded-xl cursor-pointer transition select-none" onclick="toggleAddPlayerSelection(this, '${u.uid}')">
                <div class="flex items-center gap-3">
                    <img src="${avatar}" class="w-8 h-8 rounded-full object-cover border border-emerald-500/40" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                    <div>
                        <div class="text-xs font-bold text-white flex items-center gap-2">
                            ${name}
                            ${badgeText}
                        </div>
                    </div>
                </div>
                <input type="checkbox" value="${u.uid}" data-name="${name}" data-avatar="${avatar}" class="add-player-checkbox w-4 h-4 accent-brand cursor-pointer pointer-events-none">
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
        if (checkbox.checked) {
            rowEl.classList.add('bg-emerald-950/30', 'border', 'border-emerald-500/30');
        } else {
            rowEl.classList.remove('bg-emerald-950/30', 'border', 'border-emerald-500/30');
        }
    }
};

window.submitManualAddPlayer = async function(eventId) {
    const inputEl = document.getElementById('manual-add-player-name');
    if (!inputEl) return;
    const name = inputEl.value.trim();
    if (!name) {
        window.showToast("Please enter a player name.", "error");
        return;
    }

    const event = (window.eventsList || []).find(ev => ev.id === eventId);
    if (!event) return;

    let attendees = Array.isArray(event.attendees) ? event.attendees : [];
    const newUid = 'usr_manual_' + Math.random().toString(36).substring(2, 9);
    
    attendees.push({
        uid: newUid,
        name: name,
        avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`,
        role: 'Player',
        status: 'confirmed',
        paid: 'Unpaid',
        guests: []
    });

    try {
        await setDoc(doc(db, 'artifacts', appId, 'eventsList', eventId), { attendees }, { merge: true });
        window.showToast(`Added ${name} successfully!`);
        inputEl.value = '';
        renderAddPlayersList(eventId, document.getElementById('add-players-search')?.value || '');
    } catch (e) {
        window.showToast("Failed to add player", "error");
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

    let attendees = Array.isArray(event.attendees) ? event.attendees : [];
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