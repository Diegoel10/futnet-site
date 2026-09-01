// js/auth.js
import { auth, db, appId } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    signInWithPopup, 
    GoogleAuthProvider, 
    FacebookAuthProvider, 
    TwitterAuthProvider 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Global Avatar State for Sign Up (using a clean default silhouette vector)
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
    document.getElementById('view-login').classList.add('hidden');
    document.getElementById('view-signup').classList.remove('hidden');
    
    // Inject Avatar Picker into signup form if not already present
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
    document.getElementById('view-signup').classList.add('hidden');
    document.getElementById('view-login').classList.remove('hidden');
};

window.handleEmailAuth = async function(event) {
    event.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errorBox = document.getElementById('login-error-msg');
    errorBox.classList.add('hidden');

    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.showToast("Signed in successfully!");
    } catch (err) {
        console.error("Login error:", err);
        errorBox.textContent = err.message || "Wrong email or password";
        errorBox.classList.remove('hidden');
    }
};

window.handleUnifiedRegistration = async function(event) {
    event.preventDefault();
    const firstName = document.getElementById('reg-firstname').value.trim();
    const lastName = document.getElementById('reg-lastname').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirmPass = document.getElementById('reg-confirm').value;
    const gender = document.getElementById('reg-gender').value;
    const dob = document.getElementById('reg-dob').value;
    const position = document.getElementById('reg-position').value;
    const errorBox = document.getElementById('signup-error-msg');
    
    errorBox.classList.add('hidden');

    if (password !== confirmPass) {
        errorBox.textContent = "Passwords do not match!";
        errorBox.classList.remove('hidden');
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
            createdAt: new Date().toISOString()
        };

        // Save profile to user private doc
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'), profileData);

        // Save/merge into global directory for app-wide player lookups
        await setDoc(doc(db, 'artifacts', appId, 'directory', user.uid), {
            uid: user.uid,
            name: `${firstName} ${lastName}`.trim(),
            nickname,
            avatar: profileData.avatar,
            position
        }, { merge: true });

        window.userProfile = profileData;
        window.showToast("Account created successfully!");
        window.location.reload();
    } catch (err) {
        console.error("Registration error:", err);
        errorBox.textContent = err.message || "Failed to create account.";
        errorBox.classList.remove('hidden');
    }
};

window.handleSocialAuth = async function(providerName) {
    let provider;
    if (providerName === 'google') provider = new GoogleAuthProvider();
    else if (providerName === 'facebook') provider = new FacebookAuthProvider();
    else if (providerName === 'x') provider = new TwitterAuthProvider();
    else return;

    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data');
        const docSnap = await getDoc(profileRef);

        if (!docSnap.exists()) {
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
                createdAt: new Date().toISOString()
            };

            await setDoc(profileRef, profileData);
            await setDoc(doc(db, 'artifacts', appId, 'directory', user.uid), {
                uid: user.uid,
                name: `${firstName} ${lastName}`.trim(),
                avatar: profileData.avatar,
                position: "Forward"
            }, { merge: true });
        }

        window.showToast("Signed in successfully!");
    } catch (err) {
        console.error("Social auth error:", err);
        window.showToast(err.message || "Social sign-in failed", "error");
    }
};