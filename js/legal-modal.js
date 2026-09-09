// js/legal-modal.js
import { db, appId } from './firebase-config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.checkAndShowLegalModal = async function() {
    if (!window.currentUser) return;

    try {
        const profileRef = doc(db, 'artifacts', appId, 'users', window.currentUser.uid, 'profile', 'data');
        const docSnap = await getDoc(profileRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            // If they haven't accepted terms yet, show the popup
            if (!data.termsAccepted) {
                renderLegalModal();
            }
        }
    } catch (err) {
        console.error("Error checking legal terms status:", err);
    }
};

function renderLegalModal() {
    let modal = document.getElementById('legal-terms-modal');
    if (modal) return; // already open

    modal = document.createElement('div');
    modal.id = 'legal-terms-modal';
    modal.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm';
    
    modal.innerHTML = `
        <div class="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl text-slate-900 border border-slate-200">
            <div class="text-center space-y-2">
                <h3 class="text-lg font-black tracking-tight text-slate-900">Welcome to FutNet! ⚽</h3>
                <p class="text-xs text-slate-500">Please review and accept our policies to continue using the platform.</p>
            </div>

            <div class="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <label class="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" id="accept-terms-checkbox" class="mt-0.5 w-4 h-4 text-brand accent-brand rounded border-slate-300">
                    <span class="text-xs text-slate-700 font-medium">
                        I accept the <a href="/terms.html" target="_blank" class="text-brand font-bold underline">Terms & Conditions</a>.
                    </span>
                </label>

                <label class="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" id="accept-privacy-checkbox" class="mt-0.5 w-4 h-4 text-brand accent-brand rounded border-slate-300">
                    <span class="text-xs text-slate-700 font-medium">
                        I acknowledge the <a href="/privacy.html" target="_blank" class="text-brand font-bold underline">Privacy Policy</a>.
                    </span>
                </label>
            </div>

            <button id="legal-submit-btn" onclick="handleAcceptLegalTerms()" disabled class="w-full bg-slate-200 text-slate-400 font-black py-3 rounded-xl text-xs transition shadow-none cursor-not-allowed">
                Continue to FutNet
            </button>
        </div>
    `;

    document.body.appendChild(modal);

    // Enable button only when both checkboxes are checked
    const termsCb = document.getElementById('accept-terms-checkbox');
    const privacyCb = document.getElementById('accept-privacy-checkbox');
    const submitBtn = document.getElementById('legal-submit-btn');

    function validateCheckboxes() {
        if (termsCb.checked && privacyCb.checked) {
            submitBtn.disabled = false;
            submitBtn.className = "w-full bg-brand hover:bg-brand-dark text-slate-950 font-black py-3 rounded-xl text-xs transition shadow cursor-pointer";
        } else {
            submitBtn.disabled = true;
            submitBtn.className = "w-full bg-slate-200 text-slate-400 font-black py-3 rounded-xl text-xs transition shadow-none cursor-not-allowed";
        }
    }

    termsCb.addEventListener('change', validateCheckboxes);
    privacyCb.addEventListener('change', validateCheckboxes);
}

window.handleAcceptLegalTerms = async function() {
    if (!window.currentUser) return;

    try {
        const profileRef = doc(db, 'artifacts', appId, 'users', window.currentUser.uid, 'profile', 'data');
        await setDoc(profileRef, { termsAccepted: true, termsAcceptedAt: new Date().toISOString() }, { merge: true });

        if (window.userProfile) {
            window.userProfile.termsAccepted = true;
        }

        const modal = document.getElementById('legal-terms-modal');
        if (modal) modal.remove();

        window.showToast("Thank you for accepting!");
    } catch (err) {
        console.error("Error saving terms acceptance:", err);
        window.showToast("Failed to save preference. Please try again.", "error");
    }
};