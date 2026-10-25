// js/position-picker.js: favorite position on a soccer field (tap a spot instead of a dropdown),
// and "Finish your profile" (position + photo required, nickname optional) for anyone missing them.
//
// Saved on the profile and the player directory:
//   positionSpot  = 'CAM'            (exact spot)
//   position2Spot = 'LW' or ''       (optional "also plays")
//   position      = 'Midfielder'     (group, same values as before, so everything else keeps working)
import { db, appId } from './firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// x / y in % of the field (own goal at the bottom).
export const POSITION_SPOTS = [
    { k: 'ST', label: 'Striker', group: 'Forward', x: 50, y: 12 },
    { k: 'LW', label: 'Left wing', group: 'Forward', x: 16, y: 22 },
    { k: 'RW', label: 'Right wing', group: 'Forward', x: 84, y: 22 },
    { k: 'CAM', label: 'Attacking mid', group: 'Midfielder', x: 50, y: 33 },
    { k: 'CM', label: 'Central mid', group: 'Midfielder', x: 50, y: 47 },
    { k: 'CDM', label: 'Defensive mid', group: 'Midfielder', x: 50, y: 60 },
    { k: 'LB', label: 'Left back', group: 'Defender', x: 16, y: 70 },
    { k: 'CB', label: 'Center back', group: 'Defender', x: 50, y: 74 },
    { k: 'RB', label: 'Right back', group: 'Defender', x: 84, y: 70 },
    { k: 'GK', label: 'Goalkeeper', group: 'Goalkeeper', x: 50, y: 90 }
];
const spotOf = (k) => POSITION_SPOTS.find(s => s.k === k) || null;
export const positionGroupOf = (k) => (spotOf(k) || {}).group || '';
export const positionLabelOf = (k) => { const s = spotOf(k); return s ? `${s.k} · ${s.label}` : ''; };
window.positionLabelOf = positionLabelOf;

const PP = {};   // prefix -> { spot, spot2, mode }

/** The field. `prefix` keeps several pickers apart; values are read with readPositionPicker(prefix). */
export function positionPickerHtml(prefix, spot = '', spot2 = '') {
    PP[prefix] = { spot: spotOf(spot) ? spot : '', spot2: spotOf(spot2) && spot2 !== spot ? spot2 : '', mode: 'main' };
    return `<div id="${prefix}-pp" class="space-y-2">${pickerInner(prefix)}</div>`;
}
window.positionPickerHtml = positionPickerHtml;

function pickerInner(prefix) {
    const st = PP[prefix];
    const line = 'absolute border-white/35';
    const spots = POSITION_SPOTS.map(s => {
        const main = st.spot === s.k, second = st.spot2 === s.k;
        const cls = main ? 'bg-[#00F296] text-slate-950 border-white scale-110 shadow-[0_0_14px_rgba(0,242,150,0.8)]'
            : second ? 'bg-amber-300 text-slate-950 border-white'
            : 'bg-black/55 text-white border-white/60 hover:bg-black/80';
        return `<button type="button" onclick="ppTap('${prefix}','${s.k}')" aria-label="${s.label}"
            class="absolute -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-full border-2 text-[10px] font-black transition ${cls}"
            style="left:${s.x}%;top:${s.y}%">${s.k}</button>`;
    }).join('');
    const chosen = st.spot ? spotOf(st.spot) : null;
    return `
        <div class="relative w-full max-w-[300px] mx-auto rounded-2xl overflow-hidden border-2 border-white/30 select-none"
             style="aspect-ratio:3/4;background:repeating-linear-gradient(0deg,#0f7a3a 0 12.5%,#11873f 12.5% 25%)">
            <div class="${line} border-2 inset-2 rounded-md" style="position:absolute"></div>
            <div class="${line} border-t-2 left-2 right-2" style="top:50%"></div>
            <div class="${line} border-2 rounded-full" style="width:28%;aspect-ratio:1;left:36%;top:calc(50% - 10.5%)"></div>
            <div class="${line} border-2 border-t-0" style="left:22%;right:22%;top:8px;height:15%"></div>
            <div class="${line} border-2 border-b-0" style="left:22%;right:22%;bottom:8px;height:15%"></div>
            ${spots}
        </div>
        <div class="text-center min-h-[34px]">
            ${chosen ? `<div class="text-sm font-black text-[#00F296]">${chosen.k} · ${chosen.label}</div>` : '<div class="text-xs font-bold text-white/60">Tap your favorite position</div>'}
            ${st.spot2 ? `<div class="text-[11px] font-bold text-amber-300">Also plays: ${positionLabelOf(st.spot2)}</div>` : ''}
        </div>
        ${st.spot ? `<div class="flex justify-center">
            <button type="button" onclick="ppMode('${prefix}')" class="text-[11px] font-bold px-3 py-1.5 rounded-full border ${st.mode === 'second' ? 'border-amber-300 text-amber-300' : 'border-white/25 text-white/70'}">
                ${st.mode === 'second' ? 'Tap a second spot (or tap here to stop)' : (st.spot2 ? 'Change "also plays"' : '+ Also plays (optional)')}</button></div>` : ''}`;
}

window.ppTap = (prefix, k) => {
    const st = PP[prefix]; if (!st) return;
    if (st.mode === 'second') {
        st.spot2 = (k === st.spot || st.spot2 === k) ? '' : k;   // tap again (or the main spot) to clear it
        st.mode = 'main';
    } else {
        st.spot = k;
        if (st.spot2 === k) st.spot2 = '';
    }
    const box = document.getElementById(`${prefix}-pp`); if (box) box.innerHTML = pickerInner(prefix);
    if (typeof window[`${prefix}OnChange`] === 'function') window[`${prefix}OnChange`]();
};
window.ppMode = (prefix) => {
    const st = PP[prefix]; if (!st) return;
    st.mode = st.mode === 'second' ? 'main' : 'second';
    const box = document.getElementById(`${prefix}-pp`); if (box) box.innerHTML = pickerInner(prefix);
};
export function readPositionPicker(prefix) {
    const st = PP[prefix] || {};
    return { spot: st.spot || '', spot2: st.spot2 || '', group: positionGroupOf(st.spot) };
}
window.readPositionPicker = readPositionPicker;

// ---- "Finish your profile": shown once to anyone without a favorite spot or a real photo.
// Position and photo are required (no Skip); nickname is optional.
const realPhoto = (a) => {
    const s = String(a || '').trim();
    return !!s && !/person-circle\.svg|dicebear\.com|ui-avatars\.com/i.test(s);
};
export function needsFinishProfile(p) {
    return !!p && (!spotOf(p.positionSpot) || !realPhoto(p.avatar));
}

window.promptFinishProfileIfNeeded = function () {
    const p = window.userProfile, user = window.currentUser;
    if (!p || !user || p.profileComplete === false || !needsFinishProfile(p)) return false;
    if (document.getElementById('finish-profile-modal')) return true;
    // Another first-time screen is open (terms, name, Google/Apple setup): try again in a moment.
    if (document.getElementById('legal-terms-modal') || document.getElementById('name-prompt-modal') || document.getElementById('profile-setup-modal')) {
        setTimeout(window.promptFinishProfileIfNeeded, 2500);
        return true;
    }
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const first = String(p.firstName || '').trim() || 'there';
    window._fpAvatar = realPhoto(p.avatar) ? p.avatar : '';
    const isNew = !p.positionSpot && !realPhoto(p.avatar) && !p.position;
    const m = document.createElement('div');
    m.id = 'finish-profile-modal';
    m.className = 'fixed inset-0 z-[185] flex items-start sm:items-center justify-center bg-black/90 p-4 backdrop-blur-md overflow-y-auto';
    m.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl text-white my-auto">
            <div class="text-center">
                <h3 class="text-lg font-black">${isNew ? 'Finish your profile' : `Quick check, ${esc(first)} ✅`}</h3>
                <p class="text-xs text-white/60 mt-1">Your photo and position show on rosters, teams and cards.</p>
            </div>
            <div class="flex flex-col items-center gap-1.5">
                <div class="relative cursor-pointer" onclick="document.getElementById('fp-photo-input').click()">
                    <div id="fp-avatar-wrap" class="w-24 h-24 rounded-full overflow-hidden border-2 ${window._fpAvatar ? 'border-[#00F296]' : 'border-dashed border-amber-300'} bg-black flex items-center justify-center">
                        ${window._fpAvatar ? `<img src="${esc(window._fpAvatar)}" class="w-full h-full object-cover">` : '<i class="fa-solid fa-camera text-2xl text-amber-300"></i>'}
                    </div>
                    <div class="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-[#00F296] text-slate-950 flex items-center justify-center text-xs"><i class="fa-solid fa-camera"></i></div>
                </div>
                <input type="file" id="fp-photo-input" accept="image/*" class="hidden" onchange="fpPhoto(event)">
                <span id="fp-photo-hint" class="text-[11px] font-bold ${window._fpAvatar ? 'text-white/50' : 'text-amber-300'}">${window._fpAvatar ? 'Tap to change your photo' : 'Add a profile photo *'}</span>
            </div>
            <div>
                <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-2 text-center">Favorite position *</div>
                ${positionPickerHtml('fp', p.positionSpot || '', p.position2Spot || '')}
            </div>
            <div>
                <label class="block text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">Nickname (optional)</label>
                <input id="fp-nick" value="${esc(p.nickname || '')}" maxlength="24" placeholder="What the guys call you" class="w-full bg-black border border-teal-500/60 rounded-xl px-3 py-2.5 text-white text-base focus:outline-none focus:border-[#00F296]">
            </div>
            <div id="fp-error" class="hidden text-xs text-red-400 font-bold bg-red-950/50 border border-red-500/50 p-2 rounded-xl text-center"></div>
            <button id="fp-save" onclick="saveFinishProfile()" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-sm uppercase tracking-wider">Save</button>
        </div>`;
    document.body.appendChild(m);
    return true;
};

window.fpPhoto = function (event) {
    const file = event.target.files && event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        let url = e.target.result;
        try { url = await window.shrinkImageToSquare(url); } catch (err) { console.warn('Could not shrink the picture:', err); }
        window._fpAvatar = url;
        const wrap = document.getElementById('fp-avatar-wrap');
        if (wrap) { wrap.innerHTML = `<img src="${url}" class="w-full h-full object-cover">`; wrap.className = wrap.className.replace('border-dashed border-amber-300', 'border-[#00F296]'); }
        const hint = document.getElementById('fp-photo-hint');
        if (hint) { hint.textContent = 'Tap to change your photo'; hint.className = 'text-[11px] font-bold text-white/50'; }
    };
    reader.readAsDataURL(file);
};

window.saveFinishProfile = async function () {
    const user = window.currentUser; if (!user) return;
    const err = (msg) => { const b = document.getElementById('fp-error'); if (b) { b.textContent = msg; b.classList.remove('hidden'); } };
    const pos = readPositionPicker('fp');
    if (!window._fpAvatar) return err('Please add a profile photo so your teammates know who you are.');
    if (!pos.spot) return err('Tap your favorite position on the field.');
    const nickname = (document.getElementById('fp-nick')?.value || '').trim();
    const btn = document.getElementById('fp-save'); if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    const fields = { positionSpot: pos.spot, position2Spot: pos.spot2, position: pos.group, avatar: window._fpAvatar, nickname, profileCheckedAt: Date.now() };
    try {
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'), fields, { merge: true });
        await setDoc(doc(db, 'artifacts', appId, 'directory', user.uid),
            { uid: user.uid, positionSpot: pos.spot, position2Spot: pos.spot2, position: pos.group, avatar: window._fpAvatar, nickname }, { merge: true });
        window.userProfile = { ...(window.userProfile || {}), ...fields };
        if (Array.isArray(window.directoryList)) window.directoryList.forEach(d => { if (String(d.uid) === String(user.uid)) Object.assign(d, { avatar: fields.avatar, position: pos.group, positionSpot: pos.spot, nickname }); });
        ['nav-avatar-icon', 'mob-nav-avatar-icon'].forEach(id => { const el = document.getElementById(id); if (el) el.src = fields.avatar; });
        document.getElementById('finish-profile-modal')?.remove();
        if (window.showToast) window.showToast(`Looking good! ${positionLabelOf(pos.spot)} ⚽`);
        if (typeof window.renderProfileTab === 'function') { try { window.renderProfileTab(); } catch (e) { /* not on that screen */ } }
    } catch (e) {
        console.error('Finish profile save failed:', e);
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
        err('Could not save. Check your connection and try again.');
    }
};
