// js/profile.js: Profile tab matching exact dark theme UI layout with robust FontAwesome icons
import { db, appId } from './firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

window.renderProfileTab = function() {
    const container = document.getElementById('tab-profile');
    if (!container || !window.userProfile) return;

    const p = window.userProfile;
    const fullName = `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Player';
    const nickname = p.nickname || 'El Capi';
    const position = p.position || 'Forward';
    const dob = p.dob || '2000-01-01';
    const gender = p.gender || 'Male';
    const avatarUrl = p.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100';

    container.innerHTML = `
        <div class="relative min-h-screen bg-[#01060A] text-white pb-24 overflow-y-auto">
            <!-- Stadium Background Header Banner -->
            <div class="relative h-[300px] w-full overflow-hidden">
                <img src="img/stadium-bg.png" class="absolute inset-0 w-full h-full object-cover opacity-60" onerror="this.src='https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800'">
                <div class="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-[#01060A]"></div>

                <!-- Top Header: Title Only -->
                <div class="relative z-10 px-6 pt-12 flex items-center justify-between">
                    <h1 class="text-3xl font-black text-white tracking-wide">Profile</h1>
                </div>

                <!-- Avatar & Name Header -->
                <div class="absolute bottom-6 left-6 right-6 z-10 flex items-center gap-4">
                    <div class="relative">
                        <img src="${avatarUrl}" class="w-20 h-20 rounded-full object-cover border-2 border-[#00B4AE] shadow-[0_0_15px_rgba(0,180,174,0.5)]">
                        <button onclick="openEditProfileModal()" class="absolute bottom-0 right-0 bg-black/80 p-1.5 rounded-full border border-[#00B4AE] text-white hover:bg-black transition">
                            <i class="fa-solid fa-camera text-[10px]"></i>
                        </button>
                    </div>
                    <div class="space-y-1">
                        <div class="flex items-center gap-2">
                            <h2 class="text-lg font-black text-white">${fullName}</h2>
                        </div>
                        <p class="text-xs text-white/80 font-medium">${nickname}</p>
                    </div>
                </div>
            </div>

            <!-- Main Content Container -->
            <div class="px-5 space-y-4 -mt-2 relative z-20">
                <!-- 2x2 Info Grid Cards -->
                <div class="grid grid-cols-2 gap-3.5">
                    <div class="bg-[#07141E]/85 border border-[#00B4AE]/40 rounded-2xl p-3.5 space-y-2 shadow-lg backdrop-blur-md">
                        <div class="w-8 h-8 rounded-xl bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]">
                            <i class="fa-solid fa-shield text-xs"></i>
                        </div>
                        <div>
                            <div class="text-[9px] font-black text-white/60 uppercase tracking-wider">Favorite Position</div>
                            <div class="text-xs font-bold text-white truncate">${position}</div>
                        </div>
                    </div>

                    <div class="bg-[#07141E]/85 border border-[#00B4AE]/40 rounded-2xl p-3.5 space-y-2 shadow-lg backdrop-blur-md">
                        <div class="w-8 h-8 rounded-xl bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]">
                            <i class="fa-solid fa-id-badge text-xs"></i>
                        </div>
                        <div>
                            <div class="text-[9px] font-black text-white/60 uppercase tracking-wider">Nickname</div>
                            <div class="text-xs font-bold text-white truncate">${nickname}</div>
                        </div>
                    </div>

                    <div class="bg-[#07141E]/85 border border-[#00B4AE]/40 rounded-2xl p-3.5 space-y-2 shadow-lg backdrop-blur-md">
                        <div class="w-8 h-8 rounded-xl bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]">
                            <i class="fa-solid fa-cake-candles text-xs"></i>
                        </div>
                        <div>
                            <div class="text-[9px] font-black text-white/60 uppercase tracking-wider">Birthday</div>
                            <div class="text-xs font-bold text-white truncate">${dob}</div>
                        </div>
                    </div>

                    <div class="bg-[#07141E]/85 border border-[#00B4AE]/40 rounded-2xl p-3.5 space-y-2 shadow-lg backdrop-blur-md">
                        <div class="w-8 h-8 rounded-xl bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]">
                            <i class="fa-solid fa-venus-mars text-xs"></i>
                        </div>
                        <div>
                            <div class="text-[9px] font-black text-white/60 uppercase tracking-wider">Gender</div>
                            <div class="text-xs font-bold text-white truncate">${gender}</div>
                        </div>
                    </div>
                </div>

                <!-- My Games Button -->
                <button onclick="toggleProfileEventsSection()" class="w-full bg-[#07141E]/90 hover:bg-[#07141E] border border-[#00B4AE]/40 rounded-2xl p-3.5 flex items-center justify-between shadow-lg transition">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]">
                            <i class="fa-solid fa-futbol text-sm"></i>
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
                <div class="pt-2">
                    <h3 class="text-[10px] font-black text-white/50 uppercase tracking-wider">Account Settings</h3>
                </div>

                <!-- Edit Profile Details Button -->
                <button onclick="openEditProfileModal()" class="w-full bg-[#07141E]/90 hover:bg-[#07141E] border border-[#00B4AE]/40 rounded-2xl p-3.5 flex items-center justify-between shadow-lg transition">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-xl bg-[#00B4AE]/20 flex items-center justify-center text-[#00B4AE]">
                            <i class="fa-solid fa-pen-to-square text-xs"></i>
                        </div>
                        <span class="text-xs font-bold text-white">Edit Profile Details</span>
                    </div>
                    <i class="fa-solid fa-chevron-right text-[#00B4AE]/70 text-xs"></i>
                </button>

                <!-- Log Out Button -->
                <button id="real-logout-btn" class="w-full bg-[#260A0A]/90 hover:bg-[#260A0A] border border-orange-500/40 rounded-2xl p-3.5 flex items-center justify-between shadow-lg transition">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-xl bg-orange-500/20 flex items-center justify-center text-orange-400">
                            <i class="fa-solid fa-right-from-bracket text-xs"></i>
                        </div>
                        <span class="text-xs font-bold text-orange-400">Log Out</span>
                    </div>
                    <i class="fa-solid fa-chevron-right text-orange-400/50 text-xs"></i>
                </button>

                <!-- Delete Profile Button -->
                <button onclick="confirmDeleteAccountPrompt()" class="w-full bg-[#260A0A]/90 hover:bg-[#260A0A] border border-red-500/40 rounded-2xl p-3.5 flex items-center justify-between shadow-lg transition">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-xl bg-red-500/20 flex items-center justify-center text-red-400">
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

    const todayStr = new Date().toISOString().split('T')[0];

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
        modal.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md overflow-y-auto';
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
                    <label class="block font-black uppercase text-[10px] tracking-wider text-white/60 mb-1">Nickname</label>
                    <input type="text" id="edit-nickname" value="${p.nickname || ''}" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white">
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-black uppercase text-[10px] tracking-wider text-white/60 mb-1">Position</label>
                        <select id="edit-position" class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white">
                            <option value="Forward" ${p.position === 'Forward' ? 'selected' : ''}>Forward</option>
                            <option value="Midfielder" ${p.position === 'Midfielder' ? 'selected' : ''}>Midfielder</option>
                            <option value="Defender" ${p.position === 'Defender' ? 'selected' : ''}>Defender</option>
                            <option value="Goalkeeper" ${p.position === 'Goalkeeper' ? 'selected' : ''}>Goalkeeper</option>
                        </select>
                    </div>
                    <div>
                        <label class="block font-black uppercase text-[10px] tracking-wider text-white/60 mb-1">Birthday</label>
                        <input type="date" id="edit-dob" value="${p.dob || ''}" required class="w-full bg-black/80 border border-white/20 rounded-xl px-3 py-2.5 font-bold text-white">
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

window.handleSaveProfile = async function(e) {
    e.preventDefault();
    if (!window.currentUser) return;

    window.userProfile.firstName = document.getElementById('edit-firstname').value;
    window.userProfile.lastName = document.getElementById('edit-lastname').value;
    window.userProfile.nickname = document.getElementById('edit-nickname').value;
    window.userProfile.avatar = document.getElementById('edit-avatar').value;
    window.userProfile.position = document.getElementById('edit-position').value;
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
            position: window.userProfile.position || 'Player'
        }, { merge: true });

        if (typeof window.showToast === 'function') window.showToast("Profile updated successfully!");
        document.getElementById('edit-profile-modal')?.remove();
        window.renderProfileTab();
    } catch (err) {
        console.error("Failed to save profile:", err);
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