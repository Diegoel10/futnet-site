// js/game-profile/add-players-modal.js: Dedicated screen with sticky bottom action button and dynamic count matching native app
import { mutateEvent, escapeHtml, safeAvatar } from './event-store.js';

window.openAddPlayersScreen = async function(eventId) {
    let modal = document.getElementById('add-players-screen-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'add-players-screen-modal';
        modal.className = 'fixed inset-0 z-[130] flex flex-col justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border-t border-emerald-500/40 rounded-t-[32px] p-6 space-y-4 max-w-lg w-full mx-auto shadow-2xl text-white max-h-[85vh] flex flex-col" onclick="event.stopPropagation()">
            <div class="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-1 shrink-0"></div>
            <div class="flex items-center justify-between border-b border-white/10 pb-3 shrink-0">
                <h3 class="text-base font-black text-white uppercase tracking-wider">Add Players to Roster</h3>
                <button onclick="document.getElementById('add-players-screen-modal').remove()" class="text-white/50 hover:text-white text-sm font-bold"><i class="fa-solid fa-xmark text-lg"></i></button>
            </div>

            <!-- Search Bar -->
            <div class="relative shrink-0">
                <input type="text" id="add-players-search" oninput="filterAddPlayersList('${eventId}')" placeholder="Search registered app users..." class="w-full bg-black/60 border border-teal-500/50 rounded-xl pl-9 pr-3 py-2.5 text-white text-xs focus:outline-none focus:border-brand placeholder:text-white/30" style="background-color: #000000 !important; color: #ffffff !important;" autocomplete="off">
                <i class="fa-solid fa-magnifying-glass absolute left-3 top-3 text-emerald-400 text-xs"></i>
            </div>

            <!-- Users Selection List Container (Scrollable) -->
            <div id="add-players-list-container" class="space-y-2 overflow-y-auto pr-1 flex-1 divide-y divide-white/10 min-h-[200px]">
                <!-- Rendered dynamically -->
            </div>

            <!-- Sticky Bottom Action Button -->
            <div class="pt-2 shrink-0">
                <button id="submit-batch-add-btn" onclick="submitBatchAddPlayers('${eventId}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3.5 rounded-xl text-xs uppercase tracking-wider shadow-md transition">
                    Add Selected Players (0)
                </button>
            </div>
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
        container.innerHTML = `<div class="text-center text-xs text-white/50 py-4">No other directory users found.</div>`;
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
            <div class="flex items-center justify-between py-2.5 px-3 hover:bg-black/50 rounded-xl cursor-pointer transition select-none" onclick="toggleAddPlayerSelection(this, '${escapeHtml(u.uid)}')">
                <div class="flex items-center gap-3">
                    <img src="${escapeHtml(avatar)}" class="w-8 h-8 rounded-full object-cover border border-emerald-500/40" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                    <div>
                        <div class="text-xs font-bold text-white flex items-center gap-2">
                            ${escapeHtml(name)}
                            ${badgeText}
                        </div>
                    </div>
                </div>
                <input type="checkbox" value="${escapeHtml(u.uid)}" data-name="${escapeHtml(name)}" data-avatar="${escapeHtml(avatar)}" onchange="updateSelectedPlayerCounter()" class="add-player-checkbox w-4 h-4 accent-brand cursor-pointer">
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
        updateSelectedPlayerCounter();
    }
};

window.updateSelectedPlayerCounter = function() {
    const checkedCount = document.querySelectorAll('.add-player-checkbox:checked').length;
    const btn = document.getElementById('submit-batch-add-btn');
    if (btn) {
        btn.innerText = `Add Selected Players (${checkedCount})`;
    }
};

window.submitBatchAddPlayers = async function(eventId) {
    const checkboxes = document.querySelectorAll('.add-player-checkbox:checked');
    if (checkboxes.length === 0) {
        window.showToast("Please select at least one player to add.", "error");
        return;
    }

    const picked = Array.from(checkboxes).map(cb => {
        const uid = cb.value;
        const known = (window.directoryList || []).find(u => String(u.uid) === String(uid)) || {};
        return {
            uid,
            name: cb.getAttribute('data-name'),
            avatar: safeAvatar(cb.getAttribute('data-avatar')),
            position: known.position || 'Player'
        };
    });

    const res = await mutateEvent(eventId, (draft) => {
        draft.attendees = Array.isArray(draft.attendees) ? draft.attendees : [];
        picked.forEach(pl => {
            if (draft.attendees.some(a => String(a.uid) === String(pl.uid))) return;
            const entry = { uid: pl.uid, name: pl.name, position: pl.position, role: 'Player', status: 'confirmed', paid: 'Unpaid', guests: [] };
            if (pl.avatar) entry.avatar = pl.avatar;
            draft.attendees.push(entry);
            draft.waitingList = (draft.waitingList || []).filter(w => String(w.uid) !== String(pl.uid));
            draft.declinedList = (draft.declinedList || []).filter(d => String(d.uid) !== String(pl.uid));
        });
    });
    if (res.ok) {
        window.showToast("Players added successfully!");
        const modal = document.getElementById('add-players-screen-modal');
        if (modal) modal.remove();
    }
};
