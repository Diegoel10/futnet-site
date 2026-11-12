// js/beta-gate.js: beta mode. When it's on (futnet.site/manager > Settings), only approved people can
// create games, VS matches, tournaments and communities. Everyone else gets a friendly note with a
// "Message FutNet Admin" button. (The server also removes anything created around this.)
import { db, appId } from './firebase-config.js';
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

window.appConfig = window.appConfig || {};
onSnapshot(doc(db, 'artifacts', appId, 'appConfig', 'main'), (s) => { window.appConfig = s.exists() ? s.data() : {}; }, () => {});

/** Can this person create things right now? */
window.canCreate = function () {
    const c = window.appConfig || {};
    if (!c.creatorsOnly) return true;
    const uid = window.currentUser && window.currentUser.uid;
    return !!uid && (c.creators || []).includes(uid);
};
window.showBetaNote = function () {
    document.getElementById('beta-note')?.remove();
    const c = window.appConfig || {};
    const el = document.createElement('div');
    el.id = 'beta-note';
    el.className = 'fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-md sm:p-4';
    el.onclick = (e) => { if (e.target === el) el.remove(); };
    el.innerHTML = `<div class="bg-[#040E13] border border-emerald-500/40 rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-6 text-center space-y-4 text-white">
        <div class="w-14 h-14 mx-auto rounded-full bg-[#00F296]/15 border border-[#00F296]/50 flex items-center justify-center text-2xl">🧪</div>
        <div class="text-lg font-black">FutNet is in beta</div>
        <p class="text-sm text-white/75">For now, only approved organizers can create games, VS matches, tournaments and communities.</p>
        <p class="text-sm text-white/75">Want to organize? Message the admin to get approved.</p>
        ${c.adminUid ? `<button id="beta-msg" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-sm"><i class="fa-solid fa-comment mr-1"></i> Message FutNet Admin</button>` : ''}
        <button onclick="document.getElementById('beta-note').remove()" class="w-full text-white/60 font-bold py-2 text-sm">OK</button>
    </div>`;
    document.body.appendChild(el);
    el.querySelector('#beta-msg')?.addEventListener('click', () => {
        el.remove();
        if (window.openDirectChat) window.openDirectChat(c.adminUid, 'FutNet Admin', '');
    });
};
// Every "create" door checks first.
const DOORS = ['openCreateActionSheet', 'openCreateVs', 'openCreateTourney', 'showCommunityCreation', 'rematchVs', 'openChallenge'];
function guardDoors() {
    DOORS.forEach(name => {
        const f = window[name];
        if (typeof f !== 'function' || f._beta) return;
        const g = function () { if (!window.canCreate()) { window.closeCreateActionSheet && window.closeCreateActionSheet(); window.showBetaNote(); return; } return f.apply(this, arguments); };
        g._beta = true;
        window[name] = g;
    });
    // the "Create game" screen (tab) and its buttons
    const st = window.switchTab;
    if (typeof st === 'function' && !st._beta) {
        const g = function (tab) { if (tab === 'create-event' && !window.canCreate()) { window.showBetaNote(); return; } return st.apply(this, arguments); };
        g._beta = true;
        window.switchTab = g;
    }
}
guardDoors();
setInterval(guardDoors, 2000);   // some of these load later (tournaments, VS)
