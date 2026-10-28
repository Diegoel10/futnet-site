// js/owner-tools.js: owner-only tools in Profile (only shows for the FutNet owner's account).
// "Sync names & photos": checks every player's public card against their own profile, shows what it
// would change, and fixes names/photos everywhere (rosters, members, friends, chats) when confirmed.
import { auth } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const OWNER_EMAIL_SHA256 = ['0cc4e2724ff40ad5f2b24d4a43d906996652b2d33d242c17c1efb4b7ff90d67b', 'dc33de30406203e7cdf8490b5ef4b5c7f993bdb2989bc3025bc5e4dd6b129378'];
const esc = (t) => String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fn = (name) => httpsCallable(getFunctions(auth.app, 'us-central1'), name, { timeout: 540000 });

async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** True when the signed-in account is the FutNet owner (used for the private FutNet app costs). */
window.isFutnetOwner = async function () {
    const mail = (auth.currentUser?.email || '').trim().toLowerCase();
    if (!mail || !window.crypto?.subtle) return false;
    return OWNER_EMAIL_SHA256.includes(await sha256(mail));
};

// Owner only: any error on the page shows up as a red message, so problems can be reported with a screenshot.
(function watchForOwner() {
    let tries = 0;
    const check = async () => {
        tries++;
        if (auth.currentUser) { window.__futnetOwner = await window.isFutnetOwner(); return; }
        if (tries < 120) setTimeout(check, 1000);
    };
    setTimeout(check, 500);
    let last = 0;
    const show = (msg) => {
        if (!window.__futnetOwner || !window.showToast || Date.now() - last < 3000) return;
        last = Date.now();
        window.showToast('⚠️ (only you see this) ' + String(msg || 'Unknown error').slice(0, 160), 'error');
    };
    window.addEventListener('error', (e) => show(e && (e.message || (e.error && e.error.message))));
    window.addEventListener('unhandledrejection', (e) => show(e && e.reason && (e.reason.message || e.reason)));
})();

/** Shows the owner tools button inside #owner-tools-slot (profile page) when this is the owner. */
window.renderOwnerTools = async function () {
    const slot = document.getElementById('owner-tools-slot');
    const mail = (auth.currentUser?.email || '').trim().toLowerCase();
    if (!slot || !mail || !window.crypto?.subtle) return;
    if (!OWNER_EMAIL_SHA256.includes(await sha256(mail))) return;
    slot.innerHTML = `
        <button onclick="openNameSync()" class="w-full bg-[#1A1405]/90 border border-amber-400/40 rounded-2xl p-3 flex items-center justify-between shadow-lg transition">
            <div class="flex items-center gap-3">
                <div class="w-7 h-7 rounded-xl bg-amber-400/20 flex items-center justify-center text-amber-300"><i class="fa-solid fa-wand-magic-sparkles text-xs"></i></div>
                <span class="text-xs font-bold text-amber-200">Owner: Sync names &amp; photos</span>
            </div>
            <i class="fa-solid fa-chevron-right text-amber-300/60 text-xs"></i>
        </button>
        <button id="owner-people-btn" onclick="buildPeopleListNow()" class="mt-2 w-full bg-[#1A1405]/90 border border-amber-400/40 rounded-2xl p-3 flex items-center justify-between shadow-lg transition">
            <div class="flex items-center gap-3">
                <div class="w-7 h-7 rounded-xl bg-amber-400/20 flex items-center justify-center text-amber-300"><i class="fa-solid fa-bolt text-xs"></i></div>
                <span class="text-xs font-bold text-amber-200">Owner: Speed up (rebuild the light player list)</span>
            </div>
            <i class="fa-solid fa-chevron-right text-amber-300/60 text-xs"></i>
        </button>`;
};

/** Builds people/{uid} (player cards without chats) for everyone. Safe to run again any time. */
window.buildPeopleListNow = async function () {
    const btn = document.getElementById('owner-people-btn');
    const label = btn?.querySelector('span');
    if (label) label.textContent = 'Working… (can take a minute)';
    try {
        const r = await fn('buildPeopleList')({});
        if (label) label.textContent = `Done ✅ ${(r.data && r.data.count) || 0} players. Reload the page.`;
    } catch (e) {
        if (label) label.textContent = 'Could not run it: ' + (e.message || e);
    }
};

window.openNameSync = function () {
    document.getElementById('name-sync-modal')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'name-sync-modal';
    wrap.className = 'fixed inset-0 z-[200] bg-black/85 flex items-start justify-center p-4 overflow-y-auto';
    wrap.innerHTML = `
        <div class="w-full max-w-md bg-[#040E13] border border-amber-400/50 rounded-2xl p-5 space-y-3 text-white font-sans my-4">
            <div class="flex items-center justify-between">
                <div class="text-lg font-black">Sync names &amp; photos</div>
                <button type="button" id="ns-close" class="text-white/60 text-xl leading-none">&times;</button>
            </div>
            <p class="text-xs text-white/70">Step 1 only checks and shows what would change. Nothing is changed until you tap Apply.</p>
            <button type="button" id="ns-check" class="w-full bg-amber-400 text-black font-black rounded-xl py-3">1. Check everyone</button>
            <div id="ns-out" class="space-y-3 text-sm"></div>
        </div>`;
    document.body.appendChild(wrap);
    const out = wrap.querySelector('#ns-out');
    wrap.querySelector('#ns-close').onclick = () => wrap.remove();

    const section = (title, rows) => rows.length ? `<div><div class="text-[10px] font-black uppercase tracking-wider text-amber-300 mb-1">${title}</div>
        <div class="space-y-1 max-h-56 overflow-y-auto">${rows.join('')}</div></div>` : '';
    const line = (html) => `<div class="bg-black/40 rounded-lg px-3 py-2 text-xs">${html}</div>`;

    async function run(dryRun) {
        out.innerHTML = `<div class="text-xs text-white/60">${dryRun ? 'Checking' : 'Fixing'} every player… this can take a minute.</div>`;
        try {
            const r = (await fn('syncAllNames')({ dryRun })).data;
            const fixes = r.fixed.map(f => line(`<b>${esc(f.from)}</b> → <b class="text-[#00F296]">${esc(f.to)}</b>`));
            const dups = r.duplicates.map(l => line(`<b>${esc(l[0].name)}</b> is used by ${l.length} accounts`));
            const orphans = r.orphans.map(o => line(`${esc(o.name)} <span class="text-white/40">(no login account)</span>`));
            out.innerHTML = `
                <div class="text-xs text-white/70">${r.cards} players checked.${dryRun ? '' : ` Done: ${r.fixed.length} names fixed, ${r.updated} rosters/lists updated.`}</div>
                ${section(dryRun ? 'Names that will be fixed (from their own profile)' : 'Names fixed', fixes)}
                ${!fixes.length ? line('All names already match their profiles.') : ''}
                ${dryRun ? `<button type="button" id="ns-apply" class="w-full bg-[#00F296] text-black font-black rounded-xl py-3">2. Apply: fix names everywhere</button>
                    <p class="text-[10px] text-white/50">Also refreshes every roster, member list, friends list and chat with each player's current name and photo.</p>` : ''}
                ${section('Same name on more than one account', dups)}
                ${section('Players with no login account (show up in searches)', orphans)}
                ${orphans.length ? `<button type="button" id="ns-orphans" class="w-full bg-red-500/20 border border-red-400/60 text-red-200 font-bold rounded-xl py-2.5 text-sm">Remove these ${orphans.length} leftover cards</button>` : ''}`;
            out.querySelector('#ns-apply')?.addEventListener('click', () => run(false));
            out.querySelector('#ns-orphans')?.addEventListener('click', async (e) => {
                if (!confirm(`Remove ${r.orphans.length} player cards that have no login account? Real accounts are never removed.`)) return;
                e.currentTarget.disabled = true;
                const res = (await fn('removeOrphanCards')({ uids: r.orphans.map(o => o.uid) })).data;
                if (window.showToast) window.showToast(`Removed ${res.removed} leftover cards.`);
                run(true);
            });
        } catch (err) {
            out.innerHTML = line(`<span class="text-red-300">${esc(err.message || 'Something went wrong.')}</span>`);
        }
    }
    wrap.querySelector('#ns-check').onclick = () => run(true);
};
