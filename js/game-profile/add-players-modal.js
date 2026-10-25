// js/game-profile/add-players-modal.js: Dedicated screen with sticky bottom action button and dynamic count matching native app
import { mutateEvent, escapeHtml, safeAvatar } from './event-store.js';
import { db, appId } from '../firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { creditGame } from '../credits.js';

// Best name we have for a person, whatever app created their profile.
const nameOf = (p) => String((p && (p.name || p.displayName || p.fullName ||
    `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.nickname || p.username)) || '').trim();

// Community games: the community's members are always in the list (some profiles have no name saved
// in the player directory, e.g. accounts made in the app; their member card has it).
const _membersCache = {};
async function loadCommunityMembers(cid) {
    if (!cid) return [];
    if (_membersCache[cid]) return _membersCache[cid];
    try {
        const snap = await getDocs(collection(db, 'artifacts', appId, 'communities', String(cid), 'members'));
        _membersCache[cid] = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    } catch (e) { _membersCache[cid] = []; }
    return _membersCache[cid];
}

window.openAddPlayersScreen = async function(eventId) {
    let modal = document.getElementById('add-players-screen-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'add-players-screen-modal';
        // Full screen page (phone and desktop): top bar, scrolling list, button pinned at the bottom
        modal.className = 'fixed inset-0 z-[130] flex flex-col bg-[#040E13] text-white';
        document.body.appendChild(modal);
    }
    const ev = (window.eventsList || []).find(e => e.id === eventId);

    modal.innerHTML = `
        <div class="shrink-0 border-b border-white/10 bg-[#040E13]/95 backdrop-blur" style="padding-top: env(safe-area-inset-top);">
            <div class="max-w-2xl mx-auto w-full flex items-center gap-3 px-4 py-3">
                <button onclick="document.getElementById('add-players-screen-modal').remove()" class="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center shrink-0"><i class="fa-solid fa-arrow-left"></i></button>
                <div class="min-w-0">
                    <h3 class="text-base font-black uppercase tracking-wider truncate">Add Players</h3>
                    <p class="text-[11px] text-white/50 truncate">${escapeHtml((ev && ev.title) || 'Roster')}</p>
                </div>
            </div>
            <div class="max-w-2xl mx-auto w-full px-4 pb-3">
                <div class="relative">
                    <input type="text" id="add-players-search" oninput="filterAddPlayersList('${eventId}')" placeholder="Search registered app users..." class="w-full bg-black/60 border border-teal-500/50 rounded-xl pl-9 pr-3 py-3 text-white text-base sm:text-sm focus:outline-none focus:border-brand placeholder:text-white/30" style="background-color: #000000 !important; color: #ffffff !important;" autocomplete="off">
                    <i class="fa-solid fa-magnifying-glass absolute left-3 top-3.5 text-emerald-400 text-xs"></i>
                </div>
            </div>
        </div>

        <!-- Users list (scrolls) -->
        <div class="flex-1 overflow-y-auto">
            <div id="add-players-list-container" class="max-w-2xl mx-auto w-full px-4 py-3 space-y-2 divide-y divide-white/10"></div>
        </div>

        <!-- Button pinned at the bottom -->
        <div class="shrink-0 border-t border-white/10 bg-[#040E13]" style="padding-bottom: env(safe-area-inset-bottom);">
            <div class="max-w-2xl mx-auto w-full px-4 py-3">
                <button id="submit-batch-add-btn" onclick="submitBatchAddPlayers('${eventId}')" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] hover:opacity-95 text-slate-950 font-black py-3.5 rounded-xl text-xs uppercase tracking-wider shadow-md transition">
                    Add Selected Players (0)
                </button>
            </div>
        </div>
    `;

    renderAddPlayersList(eventId, "");
    if (ev && ev.communityId) {
        await loadCommunityMembers(ev.communityId);
        renderAddPlayersList(eventId, document.getElementById('add-players-search')?.value || "");
    }
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

    const members = (event && event.communityId && _membersCache[event.communityId]) || [];
    const memberUids = new Set(members.map(m => String(m.uid)));
    const pool = [
        ...members,
        ...(window.friendsList || []),
        ...(window.directoryList || [])
    ];
    // People already in this game are still listed (grayed out, can't be picked) so nobody wonders where they went.
    const inGame = new Set(attendees.map(a => String(a.uid)));
    const onWaitlist = new Set((event?.waitingList || []).map(w => String(w.uid)));

    // One entry per person; fill in a missing name/photo from any other copy of them.
    const uniquePoolMap = new Map();
    pool.forEach(p => {
        if (!p || !p.uid) return;
        const key = String(p.uid);
        const prev = uniquePoolMap.get(key);
        const merged = { ...(prev || {}), ...p };
        merged.name = nameOf(p) || (prev && prev.name) || '';
        merged.avatar = (prev && prev.avatar) || p.avatar || p.photoURL || '';
        merged._already = inGame.has(key) ? 'in' : (onWaitlist.has(key) ? 'wait' : '');
        uniquePoolMap.set(key, merged);
    });

    let poolArray = Array.from(uniquePoolMap.values());

    poolArray.sort((a, b) => {
        let scoreA = a._already ? -100000 : 0;   // already in the game: at the bottom
        let scoreB = b._already ? -100000 : 0;

        if (friendUids.has(a.uid)) scoreA += 50;
        if (friendUids.has(b.uid)) scoreB += 50;
        if (memberUids.has(String(a.uid))) scoreA += 30;
        if (memberUids.has(String(b.uid))) scoreB += 30;

        scoreA += (attendanceFrequency[a.uid] || 0) * 10;
        scoreB += (attendanceFrequency[b.uid] || 0) * 10;

        return scoreB - scoreA;
    });

    const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const q = fold(queryStr).trim();
    const filtered = poolArray.filter(p => {
        const name = p.name;
        if (!name) return false;
        if (!q) return true;
        return fold(name).includes(q) || fold(p.nickname).includes(q);
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="text-center text-xs text-white/50 py-4">No other directory users found.</div>`;
        return;
    }

    container.innerHTML = filtered.map(u => {
        const name = u.name;
        if (u._already) {
            const av = safeAvatar(u.avatar || u.photoURL || '') || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
            return `
            <div class="flex items-center justify-between py-2.5 px-3 rounded-xl opacity-45 select-none" title="Already in this game">
                <div class="flex items-center gap-3">
                    <img src="${escapeHtml(av)}" class="w-8 h-8 rounded-full object-cover border border-white/20 grayscale" onerror="this.src='https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg'">
                    <div class="text-xs font-bold text-white">${escapeHtml(name)}</div>
                </div>
                <span class="text-[9px] font-black px-2 py-0.5 rounded border ${u._already === 'in' ? 'text-[#00F296] border-[#00F296]/40' : 'text-amber-300 border-amber-400/40'}">${u._already === 'in' ? 'Already in' : 'On waitlist'}</span>
            </div>`;
        }
        const realAvatar = safeAvatar(u.avatar || u.photoURL || '');   // only a real photo is saved on the roster
        const avatar = realAvatar || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
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
                <input type="checkbox" value="${escapeHtml(u.uid)}" data-name="${escapeHtml(name)}" data-avatar="${escapeHtml(realAvatar)}" onchange="updateSelectedPlayerCounter()" class="add-player-checkbox w-4 h-4 accent-brand cursor-pointer">
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
            const entry = { uid: pl.uid, name: pl.name, position: pl.position, role: 'Player', status: 'confirmed', paid: 'Unpaid', guests: [], addedByAdmin: true, addedBy: String(window.currentUser?.uid || ''), addedByName: String(window.userProfile?.name || [window.userProfile?.firstName, window.userProfile?.lastName].filter(Boolean).join(' ') || 'An admin') };
            if (pl.avatar) entry.avatar = pl.avatar;
            draft.attendees.push(entry);
            draft.waitingList = (draft.waitingList || []).filter(w => String(w.uid) !== String(pl.uid));
            draft.declinedList = (draft.declinedList || []).filter(d => String(d.uid) !== String(pl.uid));
        });
    });
    if (res.ok) {
        const ev = (window.eventsList || []).find(e => e.id === eventId);
        window.showToast(ev && creditGame(ev) ? "Players added! Their credit is charged; anyone without enough shows as Unpaid." : "Players added successfully!");
        const modal = document.getElementById('add-players-screen-modal');
        if (modal) modal.remove();
    }
};
