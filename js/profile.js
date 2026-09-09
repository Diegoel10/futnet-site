// js/profile.js: Handles user profile rendering and account controls
import { db, appId } from './firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

window.renderProfileTab = function() {
    const container = document.getElementById('tab-profile');
    if (!container || !window.userProfile) return;

    const p = window.userProfile;
    const email = window.currentUser ? window.currentUser.email : 'No email linked';

    container.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-3xl p-8 shadow-xl space-y-6">
            <div class="flex flex-col sm:flex-row items-center gap-6 border-b border-slate-100 pb-6 text-center sm:text-left">
                <img src="${p.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100'}" class="w-24 h-24 rounded-full object-cover border-4 border-brand shadow-md">
                <div class="space-y-1">
                    <h2 class="text-2xl font-black text-slate-900">${p.firstName} ${p.lastName || ''}</h2>
                    ${p.nickname ? `<div class="inline-block bg-brand/10 border border-brand/30 text-emerald-700 font-bold text-xs px-3 py-0.5 rounded-full">"${p.nickname}"</div>` : ''}
                    <p class="text-slate-500 text-xs">${email}</p>
                </div>
            </div>

            <!-- TOP ROW: Position & Nickname -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1">
                    <span class="text-slate-400 uppercase font-bold text-[10px]">Favorite Position</span>
                    <p class="font-black text-slate-800 text-sm"><i class="fa-solid fa-futbol text-brand mr-1.5"></i> ${p.position || 'Forward'}</p>
                </div>
                <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1">
                    <span class="text-slate-400 uppercase font-bold text-[10px]">Nickname</span>
                    <p class="font-black text-slate-800 text-sm">${p.nickname || 'None set'}</p>
                </div>
            </div>

            <!-- BOTTOM ROW: Birthday & Gender -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1">
                    <span class="text-slate-400 uppercase font-bold text-[10px]">Birthday</span>
                    <p class="font-black text-slate-800 text-sm">${p.dob || 'Not specified'}</p>
                </div>
                <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-1">
                    <span class="text-slate-400 uppercase font-bold text-[10px]">Gender</span>
                    <p class="font-black text-slate-800 text-sm">${p.gender || 'Not specified'}</p>
                </div>
            </div>

            <!-- ⚽ My Events Section Button & Container -->
            <div class="space-y-3 pt-4 border-t border-slate-100">
                <button onclick="toggleProfileEventsSection()" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-900 font-black py-3 px-4 rounded-2xl text-xs flex items-center justify-between transition shadow-sm">
                    <span class="flex items-center gap-2"><i class="fa-solid fa-calendar-days text-brand"></i> My Events</span>
                    <i id="profile-events-chevron" class="fa-solid fa-chevron-down text-slate-500"></i>
                </button>

                <!-- Collapsible Events Container with Tabs -->
                <div id="profile-events-container" class="hidden space-y-3 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                    <!-- Tabs Bar -->
                    <div class="bg-white border border-slate-200 p-1.5 rounded-xl flex items-center gap-1 shadow-sm">
                        <button onclick="switchProfileEventsTab('upcoming')" id="profile-tab-upcoming" class="flex-1 py-2 rounded-lg text-xs font-black transition bg-brand text-slate-950 shadow">Upcoming</button>
                        <button onclick="switchProfileEventsTab('previous')" id="profile-tab-previous" class="flex-1 py-2 rounded-lg text-xs font-black transition text-slate-600 hover:text-slate-900">Previous</button>
                    </div>

                    <!-- Events List Output -->
                    <div id="profile-events-list-content" class="space-y-2.5 max-h-72 overflow-y-auto pr-1"></div>
                </div>
            </div>

            <div class="space-y-3 pt-4 border-t border-slate-100">
                <h3 class="text-xs font-black text-slate-900 uppercase tracking-wider">Account Settings</h3>
                <button onclick="openEditProfileModal()" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-3 rounded-xl transition text-xs flex items-center justify-center gap-2">
                    <i class="fa-solid fa-pen-to-square"></i> Edit Profile Details
                </button>
                <button id="real-logout-btn" class="w-full bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold py-3 rounded-xl transition text-xs flex items-center justify-center gap-2">
                    <i class="fa-solid fa-right-from-bracket"></i> Log Out
                </button>
            </div>
        </div>
    `;

    // Securely attach the event listener after the element renders
    setTimeout(() => {
        const logoutBtn = document.getElementById('real-logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', window.handleLogout);
        }
    }, 50);
};

// 📂 Toggle Profile Events Dropdown
window.profileEventsTabState = 'upcoming';

window.toggleProfileEventsSection = function() {
    const container = document.getElementById('profile-events-container');
    const chevron = document.getElementById('profile-events-chevron');
    if (!container) return;

    container.classList.toggle('hidden');
    if (chevron) {
        chevron.classList.toggle('fa-chevron-down');
        chevron.classList.toggle('fa-chevron-up');
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
        upBtn.className = "flex-1 py-2 rounded-lg text-xs font-black transition bg-brand text-slate-950 shadow";
        prevBtn.className = "flex-1 py-2 rounded-lg text-xs font-black transition text-slate-600 hover:text-slate-900";
    } else {
        prevBtn.className = "flex-1 py-2 rounded-lg text-xs font-black transition bg-brand text-slate-950 shadow";
        upBtn.className = "flex-1 py-2 rounded-lg text-xs font-black transition text-slate-600 hover:text-slate-900";
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

    const todayStr = new Date().toISOString().split('T')[0];

    const filteredEvents = userEvents.filter(ev => {
        const eventDate = ev.date || todayStr;
        if (window.profileEventsTabState === 'upcoming') {
            return eventDate >= todayStr && !ev.isSessionEnded;
        } else {
            return eventDate < todayStr || ev.isSessionEnded;
        }
    });

    if (filteredEvents.length === 0) {
        contentContainer.innerHTML = `<div class="text-center text-xs text-slate-400 py-6">No ${window.profileEventsTabState} games found.</div>`;
        return;
    }

    contentContainer.innerHTML = filteredEvents.map(ev => `
        <div onclick="openEventDetails('${ev.id}')" class="bg-white border border-slate-200 hover:border-brand rounded-xl p-3 cursor-pointer transition shadow-sm flex items-center justify-between">
            <div class="space-y-1 truncate pr-2">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-black text-slate-900 truncate">${ev.title}</span>
                    <span class="text-[9px] px-2 py-0.5 rounded-full font-bold bg-brand/10 text-brand">${ev.format || '7v7'}</span>
                </div>
                <p class="text-[10px] text-slate-500 flex items-center gap-1"><i class="fa-solid fa-calendar text-brand"></i> ${ev.date || 'TBD'} • ${ev.time || ''}</p>
            </div>
            <button class="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-3 py-1.5 rounded-lg text-xs shrink-0">View</button>
        </div>
    `).join('');
};

window.openEditProfileModal = function() {
    const p = window.userProfile;
    const container = document.getElementById('tab-profile');
    if (!container) return;

    container.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-3xl p-8 shadow-xl space-y-6">
            <div class="flex items-center justify-between border-b border-slate-100 pb-4">
                <h2 class="text-xl font-black text-slate-900">Edit Profile</h2>
                <button onclick="renderProfileTab()" class="text-slate-400 hover:text-slate-700 font-bold text-sm"><i class="fa-solid fa-xmark text-xl"></i></button>
            </div>

            <form onsubmit="handleSaveProfile(event)" class="space-y-4 text-xs">
                <div>
                    <label class="block font-semibold text-slate-600 uppercase mb-1">Profile Picture</label>
                    <div class="flex items-center gap-3">
                        <img id="edit-avatar-preview" src="${p.avatar || ''}" class="w-14 h-14 rounded-full object-cover border-2 border-brand shadow-sm">
                        <input type="file" id="edit-avatar-file" accept="image/*" onchange="previewProfileImage(event)" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-900 cursor-pointer file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-brand file:text-slate-950 hover:file:bg-brand-dark">
                    </div>
                    <input type="hidden" id="edit-avatar" value="${p.avatar || ''}">
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-semibold text-slate-600 uppercase mb-1">First Name</label>
                        <input type="text" id="edit-firstname" value="${p.firstName || ''}" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900">
                    </div>
                    <div>
                        <label class="block font-semibold text-slate-600 uppercase mb-1">Last Name</label>
                        <input type="text" id="edit-lastname" value="${p.lastName || ''}" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900">
                    </div>
                </div>

                <div>
                    <label class="block font-semibold text-slate-600 uppercase mb-1">Nickname</label>
                    <input type="text" id="edit-nickname" value="${p.nickname || ''}" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900">
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-semibold text-slate-600 uppercase mb-1">Position</label>
                        <select id="edit-position" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900">
                            <option value="Forward" ${p.position === 'Forward' ? 'selected' : ''}>Forward</option>
                            <option value="Midfielder" ${p.position === 'Midfielder' ? 'selected' : ''}>Midfielder</option>
                            <option value="Defender" ${p.position === 'Defender' ? 'selected' : ''}>Defender</option>
                            <option value="Goalkeeper" ${p.position === 'Goalkeeper' ? 'selected' : ''}>Goalkeeper</option>
                        </select>
                    </div>
                    <div>
                        <label class="block font-semibold text-slate-600 uppercase mb-1">Birthday</label>
                        <input type="date" id="edit-dob" value="${p.dob || ''}" required class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900">
                    </div>
                </div>

                <div class="pt-4 flex gap-3">
                    <button type="button" onclick="renderProfileTab()" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl uppercase">Cancel</button>
                    <button type="submit" class="flex-1 bg-brand hover:bg-brand-dark text-slate-950 font-black py-3 rounded-xl uppercase shadow">Save Changes</button>
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

window.handleSaveProfile = async function(e) {
    e.preventDefault();
    if (!window.currentUser) return;

    window.userProfile.firstName = document.getElementById('edit-firstname').value;
    window.userProfile.lastName = document.getElementById('edit-lastname').value;
    window.userProfile.nickname = document.getElementById('edit-nickname').value;
    window.userProfile.avatar = document.getElementById('edit-avatar').value;
    window.userProfile.position = document.getElementById('edit-position').value;
    window.userProfile.dob = document.getElementById('edit-dob').value;

    try {
        await setDoc(doc(db, 'artifacts', appId, 'users', window.currentUser.uid, 'profile', 'data'), window.userProfile);
        
        const fullName = `${window.userProfile.firstName || ''} ${window.userProfile.lastName || ''}`.trim();
        await setDoc(doc(db, 'artifacts', appId, 'directory', window.currentUser.uid), {
            uid: window.currentUser.uid,
            name: fullName,
            nickname: window.userProfile.nickname || '',
            avatar: window.userProfile.avatar || window.userProfile.photoURL || '',
            position: window.userProfile.position || 'Player'
        }, { merge: true });

        window.showToast("Profile updated successfully!");
        
        const navIcon = document.getElementById('nav-avatar-icon');
        const mobNavIcon = document.getElementById('mob-nav-avatar-icon');
        if (navIcon) navIcon.src = window.userProfile.avatar;
        if (mobNavIcon) mobNavIcon.src = window.userProfile.avatar;
        
        window.renderProfileTab();
    } catch (err) {
        window.showToast("Failed to update profile", "error");
    }
};

window.handleLogout = async function() {
    try {
        const auth = getAuth();
        await signOut(auth);
        window.currentUser = null;
        window.userProfile = null;
        window.showToast("Logged out successfully.");
        window.location.reload();
    } catch (err) {
        console.error("Error signing out:", err);
        window.showToast("Failed to log out", "error");
    }
};