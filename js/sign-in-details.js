// js/sign-in-details.js: Profile → "Sign-in details": how you sign in (Google / Apple / Email & password),
// set a password if you only use Google or Apple, connect Google, or get a password reset email.
import {
    getAuth, linkWithCredential, linkWithPopup, reauthenticateWithPopup, EmailAuthProvider,
    GoogleAuthProvider, OAuthProvider, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

const esc = (t) => String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isHiddenApple = (mail) => /privaterelay\.appleid\.com$/i.test(mail || '');

function methodsOf(user) {
    const ids = (user?.providerData || []).map(p => p.providerId);
    return { google: ids.includes('google.com'), apple: ids.includes('apple.com'), password: ids.includes('password') };
}

function row(icon, label, on, extra = '') {
    return `<div class="flex items-center gap-3 bg-black/40 border border-white/10 rounded-xl px-3 py-2.5">
        <div class="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-base">${icon}</div>
        <div class="flex-1 min-w-0"><div class="text-sm font-bold text-white">${label}</div>${extra}</div>
        ${on ? '<span class="text-[11px] font-black text-[#00F296]">✓ ON</span>' : '<span class="text-[11px] font-bold text-white/40">Not set up</span>'}
    </div>`;
}

window.openSignInDetails = function () {
    const user = getAuth().currentUser;
    if (!user) return;
    document.getElementById('signin-details-modal')?.remove();
    const m = methodsOf(user);
    const mail = user.email || '';
    const canPassword = !!mail && !isHiddenApple(mail);

    const wrap = document.createElement('div');
    wrap.id = 'signin-details-modal';
    wrap.className = 'fixed inset-0 z-[200] bg-black/85 flex items-start sm:items-center justify-center p-4 overflow-y-auto';
    wrap.innerHTML = `
        <div class="w-full max-w-sm bg-[#040E13] border border-[#00B4AE]/50 rounded-2xl p-5 space-y-3 text-white font-sans my-auto">
            <div class="flex items-center justify-between">
                <div class="text-lg font-black">Sign-in details</div>
                <button type="button" id="sid-close" class="text-white/60 text-xl leading-none" aria-label="Close">&times;</button>
            </div>
            <p class="text-xs text-white/60">You can sign in to FutNet with any method that's on. They all open this same account.</p>
            ${mail ? `<div class="text-xs text-white/70">Email: <b class="text-white">${esc(isHiddenApple(mail) ? 'Hidden by Apple' : mail)}</b></div>` : ''}
            <div class="space-y-2">
                ${row('<i class="fa-brands fa-google" style="color:#4285F4"></i>', 'Google', m.google)}
                ${row('<i class="fa-brands fa-apple text-white"></i>', 'Apple', m.apple)}
                ${row('<i class="fa-solid fa-envelope text-[#00F296]"></i>', 'Email & password', m.password)}
            </div>
            <div id="sid-msg" class="hidden text-xs rounded-lg px-3 py-2"></div>
            ${!m.password && canPassword ? `
                <div class="space-y-2 pt-1">
                    <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296]">Set a password (optional)</div>
                    <input id="sid-pass" type="password" autocomplete="new-password" placeholder="New password (at least 6 characters)" class="w-full bg-black/50 border border-teal-500/50 rounded-xl px-3 py-2.5 text-white text-base">
                    <input id="sid-pass2" type="password" autocomplete="new-password" placeholder="Type it again" class="w-full bg-black/50 border border-teal-500/50 rounded-xl px-3 py-2.5 text-white text-base">
                    <button type="button" id="sid-setpass" class="w-full bg-[#00F296] text-black font-black rounded-xl py-3">Save password</button>
                    <p class="text-[10px] text-white/50">Then you can also sign in with ${esc(mail)} and this password.</p>
                </div>` : ''}
            ${m.password ? `<button type="button" id="sid-reset" class="w-full bg-white/10 border border-white/20 text-white font-bold rounded-xl py-2.5 text-sm">Change password (we email you a link)</button>` : ''}
            ${!m.google ? `<button type="button" id="sid-google" class="w-full bg-white text-black font-black rounded-xl py-2.5 text-sm">Connect Google</button>` : ''}
        </div>`;
    document.body.appendChild(wrap);

    const msg = (text, ok) => {
        const b = wrap.querySelector('#sid-msg');
        b.textContent = text;
        b.className = 'text-xs rounded-lg px-3 py-2 ' + (ok ? 'bg-emerald-950/60 text-[#00F296]' : 'bg-red-950/60 text-red-300');
    };
    wrap.querySelector('#sid-close').onclick = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });

    // Firebase asks people to have signed in recently before adding a password: confirm with Google/Apple first.
    async function confirmIdentity() {
        const p = m.google ? new GoogleAuthProvider() : m.apple ? new OAuthProvider('apple.com') : null;
        if (!p) throw Object.assign(new Error('Sign out and back in, then try again.'), { code: 'needs-signin' });
        await reauthenticateWithPopup(getAuth().currentUser, p);
    }

    wrap.querySelector('#sid-setpass')?.addEventListener('click', async (e) => {
        const a = wrap.querySelector('#sid-pass').value, b = wrap.querySelector('#sid-pass2').value;
        if (a.length < 6) return msg('Password needs at least 6 characters.', false);
        if (a !== b) return msg("The two passwords don't match.", false);
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Saving...';
        const add = () => linkWithCredential(getAuth().currentUser, EmailAuthProvider.credential(mail, a));
        try {
            try { await add(); }
            catch (err) {
                if (err.code !== 'auth/requires-recent-login') throw err;
                await confirmIdentity();
                await add();
            }
            if (window.showToast) window.showToast('Password saved! You can now also sign in with your email.');
            window.openSignInDetails();   // redraw with "Email & password ✓ ON"
        } catch (err) {
            btn.disabled = false; btn.textContent = 'Save password';
            msg(err.code === 'auth/weak-password' ? 'That password is too weak. Try a longer one.'
                : err.code === 'auth/popup-closed-by-user' ? 'Confirm with Google or Apple to finish.'
                : err.code === 'auth/provider-already-linked' ? 'You already have a password.'
                : (err.message || "Couldn't save the password. Try again."), false);
        }
    });

    wrap.querySelector('#sid-reset')?.addEventListener('click', async () => {
        try { await sendPasswordResetEmail(getAuth(), mail); } catch (e) { /* same message either way */ }
        msg(`We sent a link to ${mail}. Open it to choose a new password.`, true);
    });

    wrap.querySelector('#sid-google')?.addEventListener('click', async () => {
        try {
            await linkWithPopup(getAuth().currentUser, new GoogleAuthProvider());
            if (window.showToast) window.showToast('Google connected!');
            window.openSignInDetails();
        } catch (err) {
            msg(err.code === 'auth/credential-already-in-use'
                ? 'That Google account already belongs to a different FutNet account.'
                : err.code === 'auth/popup-closed-by-user' ? 'Google was closed before finishing.'
                : (err.message || "Couldn't connect Google."), false);
        }
    });
};
