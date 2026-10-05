// js/auth.js: Robust social auth with fully configured Apple and Google redirect handlers
import './profile.js';
import './home.js';
import './legal-modal.js';
import { auth, db, appId } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    sendPasswordResetEmail,
    signInWithRedirect,
    signInWithPopup,
    getRedirectResult,
    GoogleAuthProvider, 
    FacebookAuthProvider, 
    TwitterAuthProvider,
    OAuthProvider,
    getAuth,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Loading screen helpers: show "Loading profile..." instead of flashing the login page
window.showAuthLoading = function(message) {
    const loading = document.getElementById('loading-screen');
    const authBox = document.getElementById('auth-container');
    const status = document.getElementById('loading-status');
    if (status && message) status.textContent = message;
    if (authBox) authBox.classList.add('hidden');
    if (loading) loading.classList.remove('hidden');
};
window.hideAuthLoading = function() {
    const loading = document.getElementById('loading-screen');
    const authBox = document.getElementById('auth-container');
    if (loading) loading.classList.add('hidden');
    if (authBox) authBox.classList.remove('hidden');
};

window.selectedSignupAvatarUrl = 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';

// Shrinks any picture to a small square JPEG (about 15-30 KB) so it is safe to store and fast to load
window.shrinkImageToSquare = function(source, size = 300, quality = 0.75) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            let sw = img.width, sh = img.height, sx = 0, sy = 0;
            if (sw > sh) { sx = (sw - sh) / 2; sw = sh; } else { sy = (sh - sw) / 2; sh = sw; }
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = source;
    });
};

window.handleSignupAvatarSelection = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            window.selectedSignupAvatarUrl = await window.shrinkImageToSquare(e.target.result);
        } catch (err) {
            console.warn("Could not shrink the picture, using original:", err);
            window.selectedSignupAvatarUrl = e.target.result;
        }
        const previewImg = document.getElementById('signup-avatar-preview');
        if (previewImg) {
            previewImg.src = window.selectedSignupAvatarUrl;
        }
    };
    reader.readAsDataURL(file);
};

window.showSignupScreen = function() {
    const loginView = document.getElementById('view-login');
    const signupView = document.getElementById('view-signup');
    if (loginView) loginView.classList.add('hidden');
    if (signupView) signupView.classList.remove('hidden');
    
    const signupForm = document.querySelector('#view-signup form');
    if (signupForm && !document.getElementById('signup-avatar-preview')) {
        const avatarWrapper = document.createElement('div');
        avatarWrapper.className = 'flex flex-col items-center justify-center space-y-1.5 pb-2 border-b border-slate-100 mb-2';
        avatarWrapper.innerHTML = `
            <div class="relative group cursor-pointer" onclick="document.getElementById('signup-avatar-input').click()">
                <img id="signup-avatar-preview" src="${window.selectedSignupAvatarUrl}" class="w-16 h-16 rounded-full object-cover bg-slate-100 border-2 border-slate-300 group-hover:border-brand shadow-sm transition">
                <div class="absolute inset-0 bg-slate-950/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition text-white text-xs font-bold">
                    <i class="fa-solid fa-camera"></i>
                </div>
            </div>
            <input type="file" id="signup-avatar-input" accept="image/*" class="hidden" onchange="handleSignupAvatarSelection(event)">
            <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Choose Profile Picture</span>
        `;
        signupForm.insertBefore(avatarWrapper, signupForm.firstChild);
    }
};

window.showLoginScreen = function() {
    const loginView = document.getElementById('view-login');
    const signupView = document.getElementById('view-signup');
    if (signupView) signupView.classList.add('hidden');
    if (loginView) loginView.classList.remove('hidden');
};

window.handleEmailAuth = async function(event) {
    event.preventDefault();
    const emailInput = document.getElementById('auth-email');
    const passInput = document.getElementById('auth-password');
    const errorBox = document.getElementById('login-error-msg');
    
    if (!emailInput || !passInput) return;
    const email = emailInput.value.trim();
    const password = passInput.value;
    
    if (errorBox) errorBox.classList.add('hidden');

    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.showAuthLoading('Loading profile...');
        if (typeof window.showToast === 'function') window.showToast("Signed in successfully!");
    } catch (err) {
        console.error("Login error:", err);
        if (errorBox) {
            errorBox.textContent = err.message || "Wrong email or password";
            errorBox.classList.remove('hidden');
        }
    }
};

window.handleForgotPassword = async function() {
    const email = (document.getElementById('auth-email')?.value || '').trim();
    const box = document.getElementById('login-error-msg');
    const show = (text, ok) => {
        if (!box) return;
        box.textContent = text;
        box.classList.remove('hidden');
        box.classList.toggle('text-red-400', !ok);
        box.classList.toggle('bg-red-950/40', !ok);
        box.classList.toggle('border-red-500/30', !ok);
        box.classList.toggle('text-[#00F296]', ok);
        box.classList.toggle('bg-emerald-950/40', ok);
        box.classList.toggle('border-emerald-500/30', ok);
    };
    if (!email) { show('Type your email in the box above first, then tap Forgot password again.', false); return; }
    try {
        await sendPasswordResetEmail(auth, email);
        show('If an account exists for ' + email + ', a reset link is on its way. Check your inbox and spam folder.', true);
    } catch (err) {
        console.error('Reset error:', err);
        if (err && err.code === 'auth/invalid-email') show('That email does not look right. Please check it.', false);
        else if (err && err.code === 'auth/too-many-requests') show('Too many tries. Please wait a few minutes and try again.', false);
        else show('If an account exists for ' + email + ', a reset link is on its way. Check your inbox and spam folder.', true);
    }
};

window.signInInstead = function() {
    const email = (document.getElementById('reg-email')?.value || '').trim();
    window.showLoginScreen();
    const le = document.getElementById('auth-email');
    if (le && email) le.value = email;
};

window.resetFromSignup = function() {
    window.signInInstead();
    window.handleForgotPassword();
};

window.handleUnifiedRegistration = async function(event) {
    event.preventDefault();
    const firstName = document.getElementById('reg-firstname')?.value.trim() || '';
    const lastName = document.getElementById('reg-lastname')?.value.trim() || '';
    const nickname = document.getElementById('reg-nickname')?.value.trim() || '';
    const email = document.getElementById('reg-email')?.value.trim() || '';
    const password = document.getElementById('reg-password')?.value || '';
    const confirmPass = document.getElementById('reg-confirm')?.value || '';
    const gender = document.getElementById('reg-gender')?.value || 'Male';
    const dob = document.getElementById('reg-dob')?.value || '1995-01-01';
    const position = document.getElementById('reg-position')?.value || 'Forward';
    const errorBox = document.getElementById('signup-error-msg');
    
    if (errorBox) errorBox.classList.add('hidden');

    if (password !== confirmPass) {
        if (errorBox) {
            errorBox.textContent = "Passwords do not match!";
            errorBox.classList.remove('hidden');
        }
        return;
    }

    try {
        const creds = await createUserWithEmailAndPassword(auth, email, password);
        const user = creds.user;

        const profileData = {
            uid: user.uid,
            firstName,
            lastName,
            nickname,
            email,
            gender,
            dob,
            position,
            avatar: window.selectedSignupAvatarUrl || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg',
            termsAccepted: false,
            createdAt: new Date().toISOString()
        };

        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'), profileData);

        await setDoc(doc(db, 'artifacts', appId, 'directory', user.uid), {
            uid: user.uid,
            name: `${firstName} ${lastName}`.trim(),
            nickname,
            avatar: profileData.avatar,
            position
        }, { merge: true });

        window.userProfile = profileData;
        if (typeof window.showToast === 'function') window.showToast("Account created successfully!");
        
        if (typeof window.switchTab === 'function' && !window.deepLinkEventId) {
            window.switchTab('events');
        }
        if (typeof window.checkAndShowLegalModal === 'function') {
            window.checkAndShowLegalModal();
        }
    } catch (err) {
        console.error("Registration error:", err);
        if (err && err.code === 'auth/email-already-in-use' && errorBox) {
            errorBox.innerHTML = 'This email already has an account.<div class="mt-2 flex items-center justify-center gap-3">' +
                '<button type="button" onclick="resetFromSignup()" class="underline font-bold text-[#8DCDD2]">Forgot password?</button>' +
                '<button type="button" onclick="signInInstead()" class="underline font-bold text-white">Sign in instead</button></div>';
            errorBox.classList.remove('hidden');
        } else if (errorBox) {
            errorBox.textContent = err.message || "Failed to create account.";
            errorBox.classList.remove('hidden');
        }
    }
};

window.handleSocialAuth = async function(providerName) {
    let provider;
    if (providerName === 'google') {
        provider = new GoogleAuthProvider();
    } else if (providerName === 'facebook') {
        provider = new FacebookAuthProvider();
    } else if (providerName === 'apple') {
        provider = new OAuthProvider('apple.com');
        provider.addScope('email');
        provider.addScope('name');
        provider.setCustomParameters({
            // Ensures Apple requests and returns proper credential payloads
            locale: 'en'
        });
    } else if (providerName === 'x') {
        provider = new TwitterAuthProvider();
    } else {
        return;
    }

    try {
        // Popup is the most reliable option: signInWithRedirect is blocked by modern browsers
        // when the site (futnet.site) and the Firebase auth domain (firebaseapp.com) are different.
        const result = await signInWithPopup(auth, provider);
        try {
            const tr = result._tokenResponse || {};
            let first = tr.firstName || '', last = tr.lastName || '';
            if (!first && tr.fullName) { const p = String(tr.fullName).trim().split(' '); first = p[0] || ''; last = p.slice(1).join(' '); }
            if (!first && result.user && result.user.displayName) { const p = result.user.displayName.trim().split(' '); first = p[0] || ''; last = p.slice(1).join(' '); }
            window._socialName = { first, last };
        } catch (e) { /* the name prompt will ask instead */ }
        window.showAuthLoading('Loading profile...');
        // onAuthStateChanged takes it from here (creates the profile if needed and opens the app)
    } catch (err) {
        console.error("Social auth error:", err.code, err.message);
        window.hideAuthLoading();
        if (err.code === 'auth/popup-blocked') {
            try { await signInWithRedirect(auth, provider); return; } catch (e2) { err = e2; }
        }
        if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
        if (err.code === 'auth/account-exists-with-different-credential') {
            if (typeof window.showToast === 'function') window.showToast("This email already has an account with a different sign-in method. Use that method instead.", "error");
            return;
        }
        if (err.code === 'auth/unauthorized-domain') {
            if (typeof window.showToast === 'function') window.showToast("This website address is not authorized in Firebase (Authentication > Settings > Authorized domains).", "error");
            return;
        }
        if (typeof window.showToast === 'function') window.showToast(err.message || "Social sign-in failed", "error");
    }
};

// Creates the profile + directory entry the first time a social user signs in (works for popup AND redirect)
const profilePromises = new Map();
window.ensureUserProfile = function(user) {
    if (profilePromises.has(user.uid)) return profilePromises.get(user.uid);
    const promise = (async () => {
        const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data');
        // A slow or dropped connection must never look like "no profile": try a few times, and if it still
        // fails, throw so the app asks the person to retry instead of showing an empty placeholder profile.
        let docSnap = null, lastErr = null;
        for (let i = 0; i < 3 && !docSnap; i++) {
            try { docSnap = await getDoc(profileRef); }
            catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 700 * (i + 1))); }
        }
        if (!docSnap) throw lastErr || new Error('Could not reach the profile');
        if (docSnap.exists()) return docSnap.data();

        // No saved profile for this login. Every account has a public "directory" card (name, photo, position);
        // rebuild the profile from it when it exists, so older accounts show their real info.
        try {
            const dirSnap = await getDoc(doc(db, 'artifacts', appId, 'directory', user.uid));
            if (dirSnap.exists()) {
                const d = dirSnap.data();
                const parts = String(d.name || '').trim().split(' ');
                const rebuilt = {
                    uid: user.uid,
                    firstName: parts[0] || '',
                    lastName: parts.slice(1).join(' '),
                    nickname: d.nickname || '',
                    email: user.email || '',
                    position: d.position || 'Forward',
                    avatar: d.avatar || user.photoURL || '',
                    termsAccepted: false,
                    rebuiltFromDirectory: true
                };
                await setDoc(profileRef, rebuilt, { merge: true });
                return rebuilt;
            }
        } catch (e) { console.warn('Directory rebuild skipped:', e.message); }

        // Email/password sign-ups normally save their own profile in handleUnifiedRegistration. If that save never
        // happened (connection dropped, Private Safari...), the account has no profile at all: start an empty one
        // and let the "Create your profile" screen collect the info, instead of showing a made-up profile.
        if (user.providerData?.[0]?.providerId === 'password') {
            const empty = {
                uid: user.uid, firstName: '', lastName: '', nickname: '', email: user.email || '',
                gender: 'Male', dob: '1995-01-01', position: 'Forward',
                avatar: user.photoURL || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg',
                termsAccepted: false, profileComplete: false, createdAt: new Date().toISOString()
            };
            await setDoc(profileRef, empty, { merge: true });
            return empty;
        }

        // Name: the sign-in provider's name; Apple only sends it the very first time, so use what the popup gave us
        const sn = window._socialName || {};
        let first = (sn.first || '').trim(), last = (sn.last || '').trim();
        if (!first) {
            const nameParts = (user.displayName || '').trim().split(' ').filter(Boolean);
            first = nameParts[0] || '';
            last = nameParts.slice(1).join(' ');
        }
        const firstName = first || "Player";
        const lastName = last;
        const profileData = {
            uid: user.uid,
            firstName,
            lastName,
            nickname: "",
            email: user.email || "",
            gender: "Male",
            dob: "1995-01-01",
            position: "Forward",
            avatar: user.photoURL || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg',
            termsAccepted: false,
            profileComplete: false,   // the "Create your profile" screen fills in the rest
            createdAt: new Date().toISOString()
        };
        await setDoc(profileRef, profileData);
        await setDoc(doc(db, 'artifacts', appId, 'directory', user.uid), {
            uid: user.uid,
            name: `${firstName} ${lastName}`.trim(),
            avatar: profileData.avatar,
            position: "Forward"
        }, { merge: true });
        return profileData;
    })();
    profilePromises.set(user.uid, promise);
    promise.catch(() => profilePromises.delete(user.uid));
    return promise;
};

// Only needed for the redirect fallback: report errors (profile creation happens in onAuthStateChanged)
getRedirectResult(auth).catch((error) => {
    console.error("Redirect result error:", error.code, error.message);
    if (typeof window.showToast === 'function') {
        window.showToast("Sign-in incomplete or cancelled.", "error");
    }
});

// One-time cleanup: big photos saved earlier slow down the whole app. Shrink the signed-in user's own photo.
window.shrinkMySavedAvatarIfNeeded = async function(user) {
    try {
        const p = window.userProfile;
        if (!p || typeof p.avatar !== 'string' || !p.avatar.startsWith('data:') || p.avatar.length < 60000) return;
        const small = await window.shrinkImageToSquare(p.avatar);
        if (small.length >= p.avatar.length) return;
        p.avatar = small;
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'), { avatar: small }, { merge: true });
        await setDoc(doc(db, 'artifacts', appId, 'directory', user.uid), { avatar: small }, { merge: true });
    } catch (err) {
        console.warn("Could not shrink saved avatar:", err);
    }
};

window.handleLogout = async function() {
    try {
        const activeAuth = auth || getAuth();
        await signOut(activeAuth);
        window.currentUser = null;
        window.userProfile = null;
        if (typeof window.showToast === 'function') window.showToast("Logged out successfully.");
        window.location.reload();
    } catch (err) {
        console.error("Error signing out:", err);
        if (typeof window.showToast === 'function') window.showToast("Failed to log out", "error");
    }
};

// Apple (and sometimes Google) sign-in can come back without a name. Ask for it once so the player
// does not show up as "Player" on rosters and in communities.
window.promptForNameIfNeeded = function() {
    const p = window.userProfile; const user = window.currentUser;
    if (!p || !user || document.getElementById('name-prompt-modal')) return;
    const f = String(p.firstName || '').trim();
    const missing = !f || f.toLowerCase() === 'player' || f.toLowerCase().includes('@');
    if (!missing || String(p.name || '').trim() && String(p.name).trim().toLowerCase() !== 'player') return;
    const m = document.createElement('div');
    m.id = 'name-prompt-modal';
    m.className = 'fixed inset-0 z-[500] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md';
    const inp = 'w-full bg-black border border-teal-500/60 rounded-xl px-3 py-3 text-white text-base focus:outline-none focus:border-[#00F296]';
    m.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white">
            <h3 class="text-lg font-black">Welcome to FutNet! 👋</h3>
            <p class="text-xs text-white/70">What is your name? Your teammates will see it on rosters and in communities.</p>
            <div><label class="block text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">First name</label><input id="np-first" autocomplete="given-name" class="${inp}"></div>
            <div><label class="block text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">Last name</label><input id="np-last" autocomplete="family-name" class="${inp}"></div>
            <button id="np-save" onclick="saveMyName()" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-sm uppercase tracking-wider">Save</button>
        </div>`;
    document.body.appendChild(m);
    setTimeout(() => document.getElementById('np-first')?.focus(), 100);
};

window.saveMyName = async function() {
    const first = document.getElementById('np-first')?.value.trim() || '';
    const last = document.getElementById('np-last')?.value.trim() || '';
    if (!first) { if (window.showToast) window.showToast('Please enter your first name.', 'error'); return; }
    const user = window.currentUser; if (!user) return;
    const btn = document.getElementById('np-save'); if (btn) btn.disabled = true;
    const full = `${first} ${last}`.trim();
    try {
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'), { firstName: first, lastName: last, name: full }, { merge: true });
        await setDoc(doc(db, 'artifacts', appId, 'directory', user.uid), { uid: user.uid, name: full }, { merge: true });
        window.userProfile = { ...(window.userProfile || {}), firstName: first, lastName: last, name: full };
        if (Array.isArray(window.directoryList)) window.directoryList.forEach(d => { if (String(d.uid) === String(user.uid)) d.name = full; });
        document.getElementById('name-prompt-modal')?.remove();
        if (window.showToast) window.showToast(`Nice to meet you, ${first}!`);
    } catch (e) {
        console.error(e);
        if (btn) btn.disabled = false;
        if (window.showToast) window.showToast('Could not save your name. Try again.', 'error');
    }
};


// ---------------------------------------------------------------------------------------------
// "Create your profile" screen for people who signed in with Apple or Google for the first time.
// Whatever the provider shared (name, email, photo) is filled in; they add birthday, gender, position.
// Apple: email is optional (many people hide it). The screen cannot be skipped until it is saved.
// ---------------------------------------------------------------------------------------------
window.promptProfileSetupIfNeeded = function() {
    const p = window.userProfile; const user = window.currentUser;
    if (!p || !user || p.profileComplete !== false) return false;
    if (document.getElementById('profile-setup-modal')) return true;

    const isApple = (user.providerData || []).some(x => x.providerId === 'apple.com');
    const clean = (s) => { const t = String(s || '').trim(); return (!t || t.toLowerCase() === 'player' || t.includes('@')) ? '' : t; };
    const sn = window._socialName || {};
    const first = clean(p.firstName) || clean(sn.first);
    const last = clean(p.lastName) || clean(sn.last);
    let email = String(p.email || user.email || '').trim();
    if (/privaterelay\.appleid\.com$/i.test(email)) email = '';   // Apple's made-up address: leave it blank
    const photo = (p.avatar && !/person-circle\.svg$/.test(p.avatar)) ? p.avatar : '';
    window._profileSetupAvatar = photo;

    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const inp = 'w-full bg-black border border-teal-500/60 rounded-xl px-3 py-2.5 text-white text-base focus:outline-none focus:border-[#00F296]';
    const lab = 'block text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1';
    const initial = esc((first || 'F').charAt(0).toUpperCase());

    const m = document.createElement('div');
    m.id = 'profile-setup-modal';
    m.className = 'fixed inset-0 z-[190] flex items-start sm:items-center justify-center bg-black/90 p-4 backdrop-blur-md overflow-y-auto';
    m.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-white my-auto">
            <div class="text-center">
                <h3 class="text-lg font-black">Create your profile</h3>
                <p class="text-xs text-white/60 mt-1">Check your info and fill in the rest. Your teammates will see it.</p>
            </div>
            <div class="flex flex-col items-center gap-1.5">
                <div class="relative cursor-pointer" onclick="document.getElementById('ps-photo-input').click()">
                    <div id="ps-avatar-wrap" class="w-20 h-20 rounded-full overflow-hidden border-2 border-[#00F296] bg-black flex items-center justify-center text-2xl font-black text-[#00F296]">
                        ${photo ? `<img id="ps-avatar-img" src="${esc(photo)}" class="w-full h-full object-cover">` : `<span id="ps-avatar-initial">${initial}</span>`}
                    </div>
                    <div class="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#00F296] text-slate-950 flex items-center justify-center text-xs"><i class="fa-solid fa-camera"></i></div>
                </div>
                <input type="file" id="ps-photo-input" accept="image/*" class="hidden" onchange="handleProfileSetupPhoto(event)">
                <span class="text-[10px] font-bold text-white/50 uppercase tracking-wider">Profile picture</span>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div><label class="${lab}">First name *</label><input id="ps-first" autocomplete="given-name" value="${esc(first)}" class="${inp}"></div>
                <div><label class="${lab}">Last name</label><input id="ps-last" autocomplete="family-name" value="${esc(last)}" class="${inp}"></div>
            </div>
            <div><label class="${lab}">Nickname (optional)</label><input id="ps-nick" placeholder="e.g. El Capi" value="${esc(p.nickname || '')}" class="${inp}"></div>
            <div><label class="${lab}">Email ${isApple ? '(optional)' : ''}</label><input id="ps-email" type="email" autocomplete="email" value="${esc(email)}" placeholder="${isApple ? 'Optional' : ''}" class="${inp}"></div>
            <div class="grid grid-cols-2 gap-3">
                <div><label class="${lab}">Birthday *</label><input id="ps-dob" type="date" class="${inp}" style="background-color:#000 !important;color:#fff !important;"></div>
                <div><label class="${lab}">Gender</label>
                    <select id="ps-gender" class="${inp}" style="background-color:#000 !important;color:#fff !important;">
                        <option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option>
                    </select></div>
            </div>
            <div><label class="${lab}">Favorite position</label>
                <select id="ps-position" class="${inp}" style="background-color:#000 !important;color:#fff !important;">
                    <option value="Forward">Forward (ST / LW / RW)</option>
                    <option value="Midfielder">Midfielder (CM / CAM / CDM)</option>
                    <option value="Defender">Defender (CB / LB / RB)</option>
                    <option value="Goalkeeper">Goalkeeper (GK)</option>
                </select></div>
            <div id="ps-error" class="hidden text-xs text-red-400 font-bold bg-red-950/50 border border-red-500/50 p-2 rounded-xl text-center"></div>
            <button id="ps-save" onclick="saveProfileSetup()" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-sm uppercase tracking-wider">Save &amp; continue</button>
        </div>`;
    document.body.appendChild(m);
    return true;
};

window.handleProfileSetupPhoto = function(event) {
    const file = event.target.files && event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        let url = e.target.result;
        try { url = await window.shrinkImageToSquare(url); } catch (err) { console.warn('Could not shrink the picture:', err); }
        window._profileSetupAvatar = url;
        const wrap = document.getElementById('ps-avatar-wrap');
        if (wrap) wrap.innerHTML = `<img id="ps-avatar-img" src="${url}" class="w-full h-full object-cover">`;
    };
    reader.readAsDataURL(file);
};

window.saveProfileSetup = async function() {
    const user = window.currentUser; if (!user) return;
    const v = (id) => (document.getElementById(id)?.value || '').trim();
    const err = (msg) => { const b = document.getElementById('ps-error'); if (b) { b.textContent = msg; b.classList.remove('hidden'); } };
    const firstName = v('ps-first'), lastName = v('ps-last'), nickname = v('ps-nick'), email = v('ps-email');
    const dob = v('ps-dob'), gender = v('ps-gender') || 'Male', position = v('ps-position') || 'Forward';
    if (!firstName) return err('Please enter your first name.');
    if (!dob) return err('Please pick your birthday.');
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return err('That email does not look right. Fix it or leave it empty.');
    const avatar = window._profileSetupAvatar || (window.userProfile && window.userProfile.avatar) || 'https://cdn.jsdelivr.net/gh/twbs/icons@1.11.3/icons/person-circle.svg';
    const btn = document.getElementById('ps-save'); if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    const full = `${firstName} ${lastName}`.trim();
    try {
        const fields = { uid: user.uid, firstName, lastName, nickname, email, dob, gender, position, avatar, name: full, profileComplete: true };
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'), fields, { merge: true });
        await setDoc(doc(db, 'artifacts', appId, 'directory', user.uid), { uid: user.uid, name: full, nickname, avatar, position }, { merge: true });
        window.userProfile = { ...(window.userProfile || {}), ...fields };
        if (Array.isArray(window.directoryList)) window.directoryList.forEach(d => { if (String(d.uid) === String(user.uid)) { d.name = full; d.avatar = avatar; d.position = position; } });
        ['nav-avatar-icon', 'mob-nav-avatar-icon'].forEach(id => { const el = document.getElementById(id); if (el) el.src = avatar; });
        document.getElementById('profile-setup-modal')?.remove();
        document.getElementById('name-prompt-modal')?.remove();
        if (window.showToast) window.showToast(`Welcome, ${firstName}! Your profile is ready.`);
        if (typeof window.renderProfileTab === 'function') { try { window.renderProfileTab(); } catch (e) { /* not on that screen */ } }
    } catch (e) {
        console.error('Profile setup save failed:', e);
        if (btn) { btn.disabled = false; btn.textContent = 'Save & continue'; }
        err('Could not save. Check your connection and try again.');
    }
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        window.currentUser = user;
        try {
            const profile = await window.ensureUserProfile(user);
            if (profile) window.userProfile = profile;
            window.shrinkMySavedAvatarIfNeeded(user);
            setTimeout(() => { if (!window.promptProfileSetupIfNeeded()) window.promptForNameIfNeeded(); }, 1200);
        } catch (e) {
            console.warn("Profile fetch deferred or offline:", e.message);
        }

        if (typeof window.initEventsLiveListener === 'function') {
            window.initEventsLiveListener();
        }

        if (typeof window.checkAndShowLegalModal === 'function') {
            window.checkAndShowLegalModal();
        }
    } else {
        window.currentUser = null;
        window.userProfile = null;
    }
});