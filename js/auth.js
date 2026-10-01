// js/auth.js: Robust social auth with fully configured Apple and Google redirect handlers
import './profile.js';
import './home.js';
import './legal-modal.js';
import { auth, db, appId } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
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

window.handleSignupAvatarSelection = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        window.selectedSignupAvatarUrl = e.target.result;
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
        
        if (typeof window.switchTab === 'function') {
            window.switchTab('events');
        }
        if (typeof window.checkAndShowLegalModal === 'function') {
            window.checkAndShowLegalModal();
        }
    } catch (err) {
        console.error("Registration error:", err);
        if (errorBox) {
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
        await signInWithPopup(auth, provider);
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
        const docSnap = await getDoc(profileRef);
        if (docSnap.exists()) return docSnap.data();

        // Email/password sign-ups save their own profile in handleUnifiedRegistration
        if (user.providerData?.[0]?.providerId === 'password') return null;

        const nameParts = (user.displayName || "Player").split(" ");
        const firstName = nameParts[0] || "Player";
        const lastName = nameParts.slice(1).join(" ") || "";
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

onAuthStateChanged(auth, async (user) => {
    if (user) {
        window.currentUser = user;
        try {
            const profile = await window.ensureUserProfile(user);
            if (profile) window.userProfile = profile;
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