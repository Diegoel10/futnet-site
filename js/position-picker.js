// js/position-picker.js: favorite position on a soccer field (tap a spot instead of a dropdown),
// and "Finish your profile" (position + photo required, nickname optional) for anyone missing them.
//
// Saved on the profile and the player directory:
//   positionSpot  = 'CAM'            (exact spot)
//   position2Spot = 'LW' or ''       (optional "also plays")
//   position      = 'Midfielder'     (group, same values as before, so everything else keeps working)
import { db, appId } from './firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// 4-4-2 with a defensive and an attacking mid (like the picture): x / y in % of the field, own goal at the bottom.
// CB and CF have two shirts each: same position, but left or right side is saved too (positionSide 'L' / 'R').
export const POSITION_SPOTS = [
    { id: 'CF_L', k: 'CF', side: 'L', label: 'Striker', group: 'Forward', x: 36, y: 10 },
    { id: 'CF_R', k: 'CF', side: 'R', label: 'Striker', group: 'Forward', x: 64, y: 10 },
    { k: 'AM', label: 'Attacking mid', group: 'Midfielder', x: 50, y: 27 },
    { k: 'LM', label: 'Left mid', group: 'Midfielder', x: 14, y: 40 },
    { k: 'RM', label: 'Right mid', group: 'Midfielder', x: 86, y: 40 },
    { k: 'DM', label: 'Defensive mid', group: 'Midfielder', x: 50, y: 55 },
    { k: 'LB', label: 'Left back', group: 'Defender', x: 14, y: 72 },
    { id: 'CB_L', k: 'CB', side: 'L', label: 'Center back', group: 'Defender', x: 37, y: 72 },
    { id: 'CB_R', k: 'CB', side: 'R', label: 'Center back', group: 'Defender', x: 63, y: 72 },
    { k: 'RB', label: 'Right back', group: 'Defender', x: 86, y: 72 },
    { k: 'GK', label: 'Goalkeeper', group: 'Goalkeeper', x: 50, y: 90 }
];
// Spots saved by the first version of the picker still work.
const ALIAS = { ST: 'CF', CAM: 'AM', CM: 'DM', CDM: 'DM', LW: 'LM', RW: 'RM' };
POSITION_SPOTS.forEach(s => { if (!s.id) s.id = s.k; });
const keyOf = (k) => ALIAS[k] || k;
const spotOf = (k) => POSITION_SPOTS.find(s => s.k === keyOf(k)) || null;
const byId = (id) => POSITION_SPOTS.find(s => s.id === id) || null;
// Saved position (+ side) -> which shirt. No side saved yet: the left one.
const idOf = (k, side) => { const s = spotOf(k); if (!s) return ''; const two = POSITION_SPOTS.filter(x => x.k === s.k); return two.length > 1 ? (two.find(x => x.side === side) || two[0]).id : s.id; };
const sideWord = (side) => (side === 'L' ? 'left side' : side === 'R' ? 'right side' : '');
export const positionGroupOf = (k) => (spotOf(k) || {}).group || '';
export const positionLabelOf = (k, side = '') => { const s = spotOf(k); if (!s) return ''; const w = s.side || POSITION_SPOTS.filter(x => x.k === s.k).length > 1 ? sideWord(side) : ''; return `${s.k} · ${s.label}${w ? ' · ' + w : ''}`; };
window.positionLabelOf = positionLabelOf;

// A soccer shirt with the position on it.
const shirt = (fill, stroke, text, textColor) => `
    <svg viewBox="0 0 48 44" class="w-full h-full drop-shadow-[0_2px_3px_rgba(0,0,0,.5)]">
        <path d="M15 3 L24 7 L33 3 L46 11 L40 20 L35 17 L35 42 L13 42 L13 17 L8 20 L2 11 Z" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
        <text x="24" y="31" text-anchor="middle" font-size="11" font-weight="900" font-family="system-ui,sans-serif" fill="${textColor}">${text}</text>
    </svg>`;

const PP = {};   // prefix -> { spot, spot2, mode }

/** The field. `prefix` keeps several pickers apart; values are read with readPositionPicker(prefix). */
export function positionPickerHtml(prefix, spot = '', spot2 = '', side = '', side2 = '') {
    const i1 = idOf(spot, side), i2 = idOf(spot2, side2);
    PP[prefix] = { spot: i1, spot2: i2 && i2 !== i1 ? i2 : '', mode: 'main' };
    return `<div id="${prefix}-pp" class="space-y-2">${pickerInner(prefix)}</div>`;
}
window.positionPickerHtml = positionPickerHtml;

function pickerInner(prefix) {
    const st = PP[prefix];
    const L = 'position:absolute;border:2px solid rgba(255,255,255,.75)';
    const spots = POSITION_SPOTS.map(s => {
        const main = st.spot === s.id, second = st.spot2 === s.id;
        const look = main ? shirt('#00F296', '#ffffff', s.k, '#04130d')
            : second ? shirt('#FCD34D', '#ffffff', s.k, '#1f1300')
            : shirt('#c2410c', '#fdba74', s.k, '#ffffff');
        return `<button type="button" onclick="ppTap('${prefix}','${s.id}')" aria-label="${s.label}${s.side ? (s.side === 'L' ? ' (left)' : ' (right)') : ''}"
            class="absolute -translate-x-1/2 -translate-y-1/2 w-12 h-11 transition ${main ? 'scale-125 z-10' : 'hover:scale-110'}"
            style="left:${s.x}%;top:${s.y}%">${look}</button>`;
    }).join('');
    const chosen = st.spot ? byId(st.spot) : null, chosen2 = st.spot2 ? byId(st.spot2) : null;
    return `
        <div class="relative w-full max-w-[320px] mx-auto rounded-2xl overflow-hidden select-none"
             style="aspect-ratio:4/5;background:repeating-linear-gradient(0deg,#3f8f2f 0 10%,#47a034 10% 20%)">
            <div style="${L};inset:3% 4%"></div>
            <div style="${L};left:4%;right:4%;top:50%;border-width:2px 0 0 0"></div>
            <div style="${L};width:24%;aspect-ratio:1;left:38%;top:50%;transform:translateY(-50%);border-radius:9999px"></div>
            <div style="${L};left:25%;right:25%;top:3%;height:16%;border-top:0"></div>
            <div style="${L};left:38%;right:38%;top:3%;height:6%;border-top:0"></div>
            <div style="${L};left:25%;right:25%;bottom:3%;height:16%;border-bottom:0"></div>
            <div style="${L};left:38%;right:38%;bottom:3%;height:6%;border-bottom:0"></div>
            <div style="position:absolute;left:43%;right:43%;top:0;height:3%;background:repeating-linear-gradient(90deg,#fff 0 2px,transparent 2px 5px);opacity:.7"></div>
            <div style="position:absolute;left:43%;right:43%;bottom:0;height:3%;background:repeating-linear-gradient(90deg,#fff 0 2px,transparent 2px 5px);opacity:.7"></div>
            ${spots}
        </div>
        <div class="text-center min-h-[34px]">
            ${chosen ? `<div class="text-sm font-black text-[#00F296]">${positionLabelOf(chosen.k, chosen.side)}</div>` : '<div class="text-xs font-bold text-white/60">Tap your favorite position</div>'}
            ${chosen2 ? `<div class="text-[11px] font-bold text-amber-300">Also plays: ${positionLabelOf(chosen2.k, chosen2.side)}</div>` : ''}
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
    const a = byId(st.spot), b = byId(st.spot2);
    return { spot: a ? a.k : '', side: (a && a.side) || '', spot2: b ? b.k : '', side2: (b && b.side) || '', group: a ? a.group : '' };
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
    const step2 = !!window._fpStep2; window._fpStep2 = false;
    window._fpFoot = p.foot || '';
    const m = document.createElement('div');
    m.id = 'finish-profile-modal';
    m.className = 'fixed inset-0 z-[185] flex items-start sm:items-center justify-center bg-black/90 p-4 backdrop-blur-md overflow-y-auto';
    m.innerHTML = `
        <div class="bg-[#040E13] border border-emerald-500/40 rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl text-white my-auto">
            <div class="text-center">
                ${step2 ? '<div class="text-[10px] font-black uppercase tracking-widest text-[#00F296]/80 mb-1">Step 2 of 2</div>' : ''}
                <h3 class="text-lg font-black">${isNew || step2 ? 'Finish your profile' : `Quick check, ${esc(first)} ✅`}</h3>
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
                ${positionPickerHtml('fp', p.positionSpot || '', p.position2Spot || '', p.positionSide || '', p.position2Side || '')}
            </div>
            <div>
                <label class="block text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1">Nickname (optional)</label>
                <input id="fp-nick" value="${esc(p.nickname || '')}" maxlength="24" placeholder="What the guys call you" class="w-full bg-black border border-teal-500/60 rounded-xl px-3 py-2.5 text-white text-base focus:outline-none focus:border-[#00F296]">
            </div>
            <div>
                <div class="text-[10px] font-black uppercase tracking-wider text-[#00F296] mb-1 text-center">Strong foot (optional)</div>
                <div id="fp-foot" class="grid grid-cols-3 gap-2">${fpFootButtons(window._fpFoot)}</div>
            </div>
            <div id="fp-error" class="hidden text-xs text-red-400 font-bold bg-red-950/50 border border-red-500/50 p-2 rounded-xl text-center"></div>
            <button id="fp-save" onclick="saveFinishProfile()" class="w-full bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-3 rounded-xl text-sm uppercase tracking-wider">Save</button>
        </div>`;
    document.body.appendChild(m);
    return true;
};

function fpFootButtons(cur) {
    return [['right', 'Right 🦶'], ['left', '🦶 Left'], ['both', 'Both']].map(([k, label]) =>
        `<button type="button" onclick="fpFoot('${k}')" class="py-2 rounded-xl text-xs font-black border ${cur === k ? 'bg-[#00F296] text-slate-950 border-[#00F296]' : 'bg-black text-white/70 border-teal-500/40'}">${label}</button>`).join('');
}
// Tap to pick, tap the same one again to clear it.
window.fpFoot = function (k) {
    window._fpFoot = window._fpFoot === k ? '' : k;
    const box = document.getElementById('fp-foot'); if (box) box.innerHTML = fpFootButtons(window._fpFoot);
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
    const fields = { positionSpot: pos.spot, positionSide: pos.side, position2Spot: pos.spot2, position2Side: pos.side2, position: pos.group, avatar: window._fpAvatar, nickname, foot: window._fpFoot || '', profileCheckedAt: Date.now() };
    try {
        await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'), fields, { merge: true });
        await setDoc(doc(db, 'artifacts', appId, 'directory', user.uid),
            { uid: user.uid, positionSpot: pos.spot, positionSide: pos.side, position2Spot: pos.spot2, position2Side: pos.side2, position: pos.group, avatar: window._fpAvatar, nickname, foot: window._fpFoot || '' }, { merge: true });
        window.userProfile = { ...(window.userProfile || {}), ...fields };
        if (Array.isArray(window.directoryList)) window.directoryList.forEach(d => { if (String(d.uid) === String(user.uid)) Object.assign(d, { avatar: fields.avatar, position: pos.group, positionSpot: pos.spot, nickname }); });
        ['nav-avatar-icon', 'mob-nav-avatar-icon'].forEach(id => { const el = document.getElementById(id); if (el) el.src = fields.avatar; });
        document.getElementById('finish-profile-modal')?.remove();
        if (window.showToast) window.showToast(`Looking good! ${positionLabelOf(pos.spot, pos.side)} ⚽`);
        if (typeof window.renderProfileTab === 'function') { try { window.renderProfileTab(); } catch (e) { /* not on that screen */ } }
    } catch (e) {
        console.error('Finish profile save failed:', e);
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
        err('Could not save. Check your connection and try again.');
    }
};
