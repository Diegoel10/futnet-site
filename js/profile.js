// js/profile.js: Compact profile tab layout with optional blank nickname default
import { db, appId } from './firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import './sign-in-details.js';
import './owner-tools.js';

window.renderProfileTab = function() {
    const container = document.getElementById('tab-profile');
    if (!container || !window.userProfile) return;

    const p = window.userProfile;
    const fullName = `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Player';
    const nickname = p.nickname || '';
    const position = p.position || 'Forward';
    const dob = p.dob || '2000-01-01';
    const gender = p.gender || 'Male';
    const avatarUrl = p.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';

    container.innerHTML = `
        <div class="relative min-h-screen bg-[#01060A] text-white pb-24 overflow-y-auto">
            <!-- Compact Stadium Header Banner -->
            <div class="relative h-[210px] w-full overflow-hidden bg-gradient-to-b from-[#031422] via-[#020b12] to-[#01060A] border-b border-[#00B4AE]/20">
                <div class="absolute inset-0 opacity-25 bg-[radial-gradient(#00F296_1px,transparent_1px)] [background-size:16px_16px]"></div>

                <!-- Top Header: Title Only -->
                <div class="relative z-10 px-5 pt-4 flex items-center justify-between">
                    <h1 class="text-2xl font-black text-white tracking-wide">Profile</h1>
                </div>

                <!-- Avatar & Name Header -->
                <div class="absolute bottom-4 left-5 right-5 z-10 flex items-center gap-3.5">
                    <div class="relative">
                        <img src="${avatarUrl}" class="w-16 h-16 rounded-full object-cover border-2 border-[#00B4AE] shadow-[0_0_15px_rgba(0,180,174,0.5)]">
                        <button onclick="openEditProfileModal()" class="absolute bottom-0 right-0 bg-black/80 p-1.5 rounded-full border border-[#00B4AE] text-white hover:bg-black transition">
                            <i class="fa-solid fa-camera text-[9px]"></i>
                        </button>
                    </div>
                    <div class="space-y-0.5">
                        <div class="flex items-center gap-2">
                            <h2 class="text-base font-black text-white">${fullName}</h2>
                        </div>
                        ${nickname ? `<p class="text-xs text-white/80 font-medium">${nickname}</p>` : ''}
                    </div>
                </div>
            </div>

            <!-- Main Content Container (Shifted Up) -->
            <div class="px-5 space-y-3 -mt-2 relative z-20">
                <!-- Nickname / Birthday / Gender -->
                <div class="grid grid-cols-3 gap-2">
                    <div class="bg-[#07141E]/85 border border-[#00B4AE]/40 rounded-2xl p-2.5 space-y-1 shadow-lg backdrop-blur-md min-w-0">
                        <div class="w-6 h-6 rounded-lg bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]"><i class="fa-solid fa-id-badge text-[10px]"></i></div>
                        <div class="text-[8px] font-black text-white/60 uppercase tracking-wider">Nickname</div>
                        <div class="text-[11px] font-bold text-white truncate">${nickname || '—'}</div>
                    </div>
                    <div class="bg-[#07141E]/85 border border-[#00B4AE]/40 rounded-2xl p-2.5 space-y-1 shadow-lg backdrop-blur-md min-w-0">
                        <div class="w-6 h-6 rounded-lg bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]"><i class="fa-solid fa-cake-candles text-[10px]"></i></div>
                        <div class="text-[8px] font-black text-white/60 uppercase tracking-wider">Birthday</div>
                        <div class="text-[11px] font-bold text-white truncate">${p.dob || '—'}</div>
                    </div>
                    <div class="bg-[#07141E]/85 border border-[#00B4AE]/40 rounded-2xl p-2.5 space-y-1 shadow-lg backdrop-blur-md min-w-0">
                        <div class="w-6 h-6 rounded-lg bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]"><i class="fa-solid fa-venus-mars text-[10px]"></i></div>
                        <div class="text-[8px] font-black text-white/60 uppercase tracking-wider">Gender</div>
                        <div class="text-[11px] font-bold text-white truncate">${gender}</div>
                    </div>
                </div>

                <!-- My position: the soccer field. Tap a shirt and it saves right away. -->
                <div class="bg-[#07141E]/85 border border-[#00B4AE]/40 rounded-2xl p-3 space-y-2 shadow-lg">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-xl bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]"><i class="fa-solid fa-shirt text-xs"></i></div>
                        <div>
                            <div class="text-[9px] font-black text-[#00B4AE] uppercase tracking-wider">My Position</div>
                            <div class="text-[11px] text-white/60">Tap a shirt to change it. It saves right away.</div>
                        </div>
                    </div>
                    ${window.positionPickerHtml ? window.positionPickerHtml('pf', p.positionSpot || '', p.position2Spot || '') : `<div class="text-xs font-bold text-white">${position}</div>`}
                </div>

                <!-- My Stats (js/player-stats.js) -->
                <div class="bg-[#07141E]/85 border border-[#00B4AE]/40 rounded-2xl p-3 space-y-3 shadow-lg">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-xl bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]"><i class="fa-solid fa-chart-simple text-xs"></i></div>
                        <div class="text-[9px] font-black text-[#00B4AE] uppercase tracking-wider">My Stats</div>
                    </div>
                    <div id="profile-stats-box"></div>
                </div>

                <!-- My Games Button -->
                <button onclick="toggleProfileEventsSection()" class="w-full bg-[#07141E]/90 hover:bg-[#07141E] border border-[#00B4AE]/40 rounded-2xl p-3 flex items-center justify-between shadow-lg transition">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-xl bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]">
                            <i class="fa-solid fa-futbol text-xs"></i>
                        </div>
                        <div class="text-left">
                            <div class="text-[9px] font-black text-[#00B4AE] uppercase tracking-wider">My Games</div>
                            <div class="text-xs font-bold text-white">View upcoming & previous matches.</div>
                        </div>
                    </div>
                    <i id="profile-events-chevron" class="fa-solid fa-chevron-right text-[#00B4AE] text-xs"></i>
                </button>

                <!-- Collapsible Events Container with Tabs -->
                <div id="profile-events-container" class="hidden space-y-3 bg-[#040E13] border border-white/10 rounded-2xl p-4 shadow-xl">
                    <div class="bg-black/40 border border-white/10 p-1 rounded-xl flex items-center gap-1">
                        <button onclick="switchProfileEventsTab('upcoming')" id="profile-tab-upcoming" class="flex-1 py-2 rounded-lg text-xs font-black transition bg-[#00F296] text-slate-950 shadow">Upcoming</button>
                        <button onclick="switchProfileEventsTab('previous')" id="profile-tab-previous" class="flex-1 py-2 rounded-lg text-xs font-black transition text-white/60 hover:text-white">Previous</button>
                    </div>
                    <div id="profile-events-list-content" class="space-y-2.5 max-h-64 overflow-y-auto pr-1"></div>
                </div>

                <!-- Account Settings Section Header -->
                <div class="pt-1">
                    <h3 class="text-[10px] font-black text-white/50 uppercase tracking-wider">Account Settings</h3>
                </div>

                <!-- Edit Profile Details Button -->
                <button onclick="openEditProfileModal()" class="w-full bg-[#07141E]/90 hover:bg-[#07141E] border border-[#00B4AE]/40 rounded-2xl p-3 flex items-center justify-between shadow-lg transition">
                    <div class="flex items-center gap-3">
                        <div class="w-7 h-7 rounded-xl bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]">
                            <i class="fa-solid fa-pen-to-square text-xs"></i>
                        </div>
                        <span class="text-xs font-bold text-white">Edit Profile Details</span>
                    </div>
                    <i class="fa-solid fa-chevron-right text-[#00B4AE]/70 text-xs"></i>
                </button>

                <!-- Sign-in details: Google / Apple / Email & password -->
                <button onclick="openSignInDetails()" class="w-full bg-[#07141E]/90 hover:bg-[#07141E] border border-[#00B4AE]/40 rounded-2xl p-3 flex items-center justify-between shadow-lg transition">
                    <div class="flex items-center gap-3">
                        <div class="w-7 h-7 rounded-xl bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]">
                            <i class="fa-solid fa-key text-xs"></i>
                        </div>
                        <span class="text-xs font-bold text-white">Sign-in details</span>
                    </div>
                    <i class="fa-solid fa-chevron-right text-[#00B4AE]/70 text-xs"></i>
                </button>

                <div id="owner-tools-slot"></div>

                <!-- Log Out Button -->
                <button id="real-logout-btn" class="w-full bg-[#260A0A]/90 hover:bg-[#260A0A] border border-orange-500/40 rounded-2xl p-3 flex items-center justify-between shadow-lg transition">
                    <div class="flex items-center gap-3">
                        <div class="w-7 h-7 rounded-xl bg-orange-500/20 flex items-center justify-center text-orange-400">
                            <i class="fa-solid fa-right-from-bracket text-xs"></i>
                        </div>
                        <span class="text-xs font-bold text-orange-400">Log Out</span>
                    </div>
                    <i class="fa-solid fa-chevron-right text-orange-400/50 text-xs"></i>
                </button>

                <!-- Delete Profile Button -->
                <button onclick="confirmDeleteAccountPrompt()" class="w-full bg-[#260A0A]/90 hover:bg-[#260A0A] border border-red-500/40 rounded-2xl p-3 flex items-center justify-between shadow-lg transition">
                    <div class="flex items-center gap-3">
                        <div class="w-7 h-7 rounded-xl bg-red-500/20 flex items-center justify-center text-red-400">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </div>
                        <span class="text-xs font-bold text-red-400">Delete Profile</span>
                    </div>
                    <i class="fa-solid fa-chevron-right text-red-400/50 text-xs"></i>
                </button>
            </div>
        </div>
    `;

    setTimeout(() => {
        if (window.renderOwnerTools) window.renderOwnerTools();
        if (window.mountPlayerStats && window.currentUser) window.mountPlayerStats('profile-stats-box', window.currentUser.uid);
        const logoutBtn = document.getElementById('real-logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', window.handleLogout);
        }
    }, 50);
};

window.profileEventsTabState = 'upcoming';

window.toggleProfileEventsSection = function() {
    const container = document.getElementById('profile-events-container');
    const chevron = document.getElementById('profile-events-chevron');
    if (!container) return;

    container.classList.toggle('hidden');
    if (chevron) {
        chevron.classList.toggle('fa-chevron-right');
        chevron.classList.toggle('fa-chevron-down');
    }

    if (!container.classList.contains('hidden')) {
        renderProfileEventsList();
    }
};

window.switchProfileEventsTab = function(tabName) {
    window.profileEventsTabState = tabName;
    const upBtn = document.getElementById('profile-tab-upcoming');
    const prevBtn = document.getElementById('profile-tab-previous');
    if (!upBtn || !prevBtn) return;

    if (tabName === 'upcoming') {
        upBtn.className = "flex-1 py-2 rounded-lg text-xs font-black transition bg-[#00F296] text-slate-950 shadow";
        prevBtn.className = "flex-1 py-2 rounded-lg text-xs font-black transition text-white/60 hover:text-white";
    } else {
        prevBtn.className = "flex-1 py-2 rounded-lg text-xs font-black transition bg-[#00F296] text-slate-950 shadow";
        upBtn.className = "flex-1 py-2 rounded-lg text-xs font-black transition text-white/60 hover:text-white";
    }

    renderProfileEventsList();
};

window.renderProfileEventsList = function() {
    const contentContainer = document.getElementById('profile-events-list-content');
    if (!contentContainer) return;

    const userUid = window.currentUser?.uid;
    const allEvents = window.eventsList || [];

    const userEvents = allEvents.filter(ev => {
        const isOrganizer = ev.organizerId === userUid;
        const isAttendee = (ev.attendees || []).some(a => a.uid === userUid);
        return isOrganizer || isAttendee;
    });

    const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

    const filteredEvents = userEvents.filter(ev => {
        const eventDate = (ev.date || "").substring(0, 10);
        if (window.profileEventsTabState === 'upcoming') {
            return eventDate >= todayStr && !ev.isSessionEnded;
        } else {
            return eventDate < todayStr || ev.isSessionEnded;
        }
    });

    if (filteredEvents.length === 0) {
        contentContainer.innerHTML = `<div class="text-center text-xs text-white/40 py-6">No ${window.profileEventsTabState} games found.</div>`;
        return;
    }

    contentContainer.innerHTML = filteredEvents.map(ev => `
        <div onclick="openEventDetails('${ev.id}')" class="bg-black/50 border border-white/10 hover:border-[#00F296] rounded-xl p-3 cursor-pointer transition flex items-center justify-between">
            <div class="space-y-1 truncate pr-2">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-black text-white truncate">${ev.title || 'Soccer Match'}</span>
                    <span class="text-[9px] px-2 py-0.5 rounded-full font-bold bg-[#00F296]/20 text-[#00F296]">${ev.format || '7v7'}</span>
                </div>
                <p class="text-[10px] text-white/60 flex items-center gap-1"><i class="fa-solid fa-calendar text-[#00F296]"></i> ${ev.date || 'TBD'} • ${ev.time || ''}</p>
            </div>
            ${window.profileEventsTabState === 'previous' ? '<span class="text-[9px] px-2 py-0.5 rounded-full font-bold bg-white/10 text-white/70 shrink-0 mr-2"><i class="fa-solid fa-flag-checkered"></i> Game ended</span>' : ''}
            <button class="bg-black/80 hover:bg-black text-white font-bold px-3 py-1.5 rounded-lg text-xs border border-white/10 shrink-0">View</button>
        </div>
    `).join('');
};

window.openEditProfileModal = function() {
    const p = window.userProfile || {};
    let modal = document.getElementById('edit-profile-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'edit-profile-modal';
        modal.className = 'fixed inset-0 z-[200] flex items-start sm:items-center justify-center bg-black/80 p-4 backdrop-blur-md overflow-y-auto';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-[#040E13] border border-[#00B4AE]/50 rounded-3xl max-w-md w-full p-6 text-white shadow-2xl space-y-4 max-h-[95vh] overflow-y-auto" onclick="event.stopPropagation()">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
                <h3 class="text-sm font-black uppercase text-white">Edit Profile Details</h3>
                <button onclick="document.getElementById('edit-profile-modal').remove()" class="text-white/50 hover:text-white text-lg font-bold"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <form onsubmit="handleSaveProfile(event)" class="space-y-4 text-xs">
                <div>
                    <label class="block font-black uppercase text-[10px] tracking-wider text-white/60 mb-1">Profile Picture</label>
                    <div class="flex items-center gap-3">
                        <img id="edit-avatar-preview" src="${p.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-14 h-14 rounded-full object-cover border-2 border-[#00B4AE] shadow-sm">
                        <input type="file" id="edit-avatar-file" accept="image/*" onchange="previewProfileImage(event)" class="w-full bg-black/60 border border-white/20 rounded-xl px-3 py-2 text-white text-xs cursor-pointer file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-[#00F296] file:text-slate-950">
                    </div>
                    <input type="hidden" id="edit-avatar" value="${p.avatar || ''}">
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-black uppercase text-[10px] tracking-wider text-white/60 mb-1">First Name</label>
                        <input type="text" id="edit-firstname" value="${p.firstName || ''}" required class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white">
                    </div>
                    <div>
                        <label class="block font-black uppercase text-[10px] tracking-wider text-white/60 mb-1">Last Name</label>
                        <input type="text" id="edit-lastname" value="${p.lastName || ''}" required class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white">
                    </div>
                </div>

                <div>
                    <label class="block font-black uppercase text-[10px] tracking-wider text-white/60 mb-1">Nickname (Optional)</label>
                    <input type="text" id="edit-nickname" value="${p.nickname || ''}" placeholder="Optional, leave blank if none" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white">
                </div>

                <div class="grid grid-cols-1 gap-3">
                    <div>
                        <label class="block font-black uppercase text-[10px] tracking-wider text-white/60 mb-1">Birthday</label>
                        <input type="date" id="edit-dob" value="${p.dob || ''}" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white">
                    </div>
                </div>

                <div>
                    <label class="block font-black uppercase text-[10px] tracking-wider text-white/60 mb-1">Gender</label>
                    <select id="edit-gender" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white">
                        <option value="Male" ${p.gender === 'Male' ? 'selected' : ''}>Male</option>
                        <option value="Female" ${p.gender === 'Female' ? 'selected' : ''}>Female</option>
                        <option value="Other" ${p.gender === 'Other' ? 'selected' : ''}>Other</option>
                    </select>
                </div>

                <div class="pt-3 flex gap-2">
                    <button type="button" onclick="document.getElementById('edit-profile-modal').remove()" class="flex-1 bg-black/60 text-white py-3 rounded-xl font-bold border border-white/20">Cancel</button>
                    <button type="submit" class="flex-1 bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl uppercase tracking-wider shadow">Save Changes</button>
                </div>
            </form>
        </div>
    `;
};

window.previewProfileImage = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const TARGET_SIZE = 300;
            canvas.width = TARGET_SIZE;
            canvas.height = TARGET_SIZE;
            const ctx = canvas.getContext('2d');

            let sourceWidth = img.width;
            let sourceHeight = img.height;
            let startX = 0;
            let startY = 0;

            if (sourceWidth > sourceHeight) {
                startX = (sourceWidth - sourceHeight) / 2;
                sourceWidth = sourceHeight;
            } else {
                startY = (sourceHeight - sourceWidth) / 2;
                sourceHeight = sourceWidth;
            }

            ctx.drawImage(img, startX, startY, sourceWidth, sourceHeight, 0, 0, TARGET_SIZE, TARGET_SIZE);
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.75);

            document.getElementById('edit-avatar').value = compressedBase64;
            document.getElementById('edit-avatar-preview').src = compressedBase64;
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

// Profile page field: saves the position the moment a shirt is tapped.
let pfTimer = null;
window.pfOnChange = function () {
    clearTimeout(pfTimer);
    pfTimer = setTimeout(async () => {
        const user = window.currentUser; if (!user || !window.readPositionPicker) return;
        const pick = window.readPositionPicker('pf'); if (!pick.spot) return;
        const fields = { positionSpot: pick.spot, position2Spot: pick.spot2, position: pick.group };
        try {
            await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'), fields, { merge: true });
            await setDoc(doc(db, 'artifacts', appId, 'directory', user.uid), { uid: user.uid, ...fields }, { merge: true });
            window.userProfile = { ...(window.userProfile || {}), ...fields };
            if (Array.isArray(window.directoryList)) window.directoryList.forEach(d => { if (String(d.uid) === String(user.uid)) Object.assign(d, fields); });
            if (window.showToast) window.showToast(`Saved: ${window.positionLabelOf ? window.positionLabelOf(pick.spot) : pick.spot}${pick.spot2 ? ' (also ' + pick.spot2 + ')' : ''}`);
        } catch (e) {
            console.error('position save', e);
            if (window.showToast) window.showToast('Could not save your position. Try again.', 'error');
        }
    }, 400);
};

window.handleSaveProfile = async function(e) {
    e.preventDefault();
    if (!window.currentUser) return;

    window.userProfile.firstName = document.getElementById('edit-firstname').value;
    window.userProfile.lastName = document.getElementById('edit-lastname').value;
    window.userProfile.nickname = document.getElementById('edit-nickname').value.trim();
    window.userProfile.avatar = document.getElementById('edit-avatar').value;
    // Favorite position from the soccer field (keeps the old value when nothing was tapped).
    const pick = window.readPositionPicker ? window.readPositionPicker('ep') : { spot: '', spot2: '', group: '' };
    if (pick.spot) {
        window.userProfile.positionSpot = pick.spot;
        window.userProfile.position2Spot = pick.spot2;
        window.userProfile.position = pick.group;
    }
    window.userProfile.dob = document.getElementById('edit-dob').value;
    window.userProfile.gender = document.getElementById('edit-gender').value;

    try {
        await setDoc(doc(db, 'artifacts', appId, 'users', window.currentUser.uid, 'profile', 'data'), window.userProfile);
        
        const fullName = `${window.userProfile.firstName || ''} ${window.userProfile.lastName || ''}`.trim();
        await setDoc(doc(db, 'artifacts', appId, 'directory', window.currentUser.uid), {
            uid: window.currentUser.uid,
            name: fullName,
            nickname: window.userProfile.nickname || '',
            avatar: window.userProfile.avatar || '',
            position: window.userProfile.position || 'Player',
            positionSpot: window.userProfile.positionSpot || '',
            position2Spot: window.userProfile.position2Spot || ''
        }, { merge: true });

        if (typeof window.showToast === 'function') window.showToast("Profile updated successfully!");
        document.getElementById('edit-profile-modal')?.remove();
        window.renderProfileTab();
    } catch (err) {
        console.error("Failed to update profile:", err);
        if (typeof window.showToast === 'function') window.showToast("Failed to update profile", "error");
    }
};

window.confirmDeleteAccountPrompt = function() {
    if (confirm("Are you sure you want to delete your profile? This action is permanent.")) {
        if (typeof window.showToast === 'function') window.showToast("Please contact support to delete your account.", "error");
    }
};

window.handleLogout = async function() {
    try {
        const auth = getAuth();
        await signOut(auth);
        window.currentUser = null;
        window.userProfile = null;
        if (typeof window.showToast === 'function') window.showToast("Logged out successfully.");
        window.location.reload();
    } catch (err) {
        console.error("Error signing out:", err);
        if (typeof window.showToast === 'function') window.showToast("Failed to log out", "error");
    }
};