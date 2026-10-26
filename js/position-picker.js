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
export function positionPickerHtml(prefix, spot = '', spot2 = '', side = '', side2 = '', opts = {}) {
    const i1 = idOf(spot, side), i2 = idOf(spot2, side2);
    // opts.readOnly: other players' pages just show it. opts.maxWidth: smaller field so a screen fits.
    PP[prefix] = { spot: i1, spot2: i2 && i2 !== i1 ? i2 : '', mode: 'main', readOnly: !!opts.readOnly, maxWidth: opts.maxWidth || '' };
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
            : shirt('#E53935', '#ffffff', s.k, '#ffffff');
        const glow = main ? 'filter:drop-shadow(0 0 7px rgba(34,230,200,.95));' : second ? 'filter:drop-shadow(0 0 6px rgba(252,211,77,.8));' : '';
        if (st.readOnly) return `<div class="absolute -translate-x-1/2 -translate-y-1/2 w-[15%] aspect-[48/44] ${main ? 'scale-125 z-10' : ''}" style="left:${s.x}%;top:${s.y}%;${glow}">${look}</div>`;
        return `<button type="button" onclick="ppTap('${prefix}','${s.id}')" aria-label="${s.label}${s.side ? (s.side === 'L' ? ' (left)' : ' (right)') : ''}"
            class="absolute -translate-x-1/2 -translate-y-1/2 w-[15%] aspect-[48/44] transition ${main ? 'scale-125 z-10' : 'hover:scale-110'}"
            style="left:${s.x}%;top:${s.y}%;${glow}">${look}</button>`;
    }).join('');
    const chosen = st.spot ? byId(st.spot) : null, chosen2 = st.spot2 ? byId(st.spot2) : null;
    return `
        <div class="relative w-full max-w-[320px] mx-auto rounded-2xl overflow-hidden select-none"
             style="${st.maxWidth ? `max-width:${st.maxWidth};` : ''}border:1.5px solid rgba(0,242,150,.55);box-shadow:0 0 22px rgba(0,242,150,.3);aspect-ratio:4/5;background:#1f5a1a url('img/position_field.jpg') center / cover no-repeat">
            <!-- A real grass field (img/position_field.jpg, cut from the team builder pitch) -->
            ${spots}
        </div>
        ${st.readOnly || !st.spot ? `<div class="text-center min-h-[30px] pt-1">
            ${chosen ? `<div class="text-sm font-black text-[#00F296]">${positionLabelOf(chosen.k, chosen.side)}</div>` : `<div class="text-xs font-semibold text-white/60">${st.readOnly ? 'No position picked yet' : 'Tap your favorite position'}</div>`}
            ${chosen2 ? `<div class="text-[11px] font-bold text-amber-300">Also plays: ${positionLabelOf(chosen2.k, chosen2.side)}</div>` : ''}
        </div>` : `
        <!-- 1st choice / 2nd choice: tap one, then tap a shirt -->
        <div class="grid grid-cols-2 gap-2 max-w-[340px] mx-auto pt-1">
            ${choiceChip(prefix, '1st choice', positionLabelOf(chosen.k, chosen.side), '', '#00F296', st.mode !== 'second', false)}
            ${choiceChip(prefix, '2nd choice', chosen2 ? positionLabelOf(chosen2.k, chosen2.side) : '', st.mode === 'second' ? 'Tap a shirt' : '+ Add (optional)', '#FCD34D', st.mode === 'second', !!chosen2)}
        </div>`}`;
}

function choiceChip(prefix, title, value, placeholder, color, active, canClear) {
    const second = title.startsWith('2');
    return `<div onclick="ppChoice('${prefix}', ${second})" class="relative cursor-pointer rounded-xl px-2.5 py-1.5 text-left min-h-[44px] transition"
        style="border:${active ? 1.5 : 1}px solid ${active ? color : 'rgba(255,255,255,.15)'};background:${active ? color + '24' : 'rgba(0,0,0,.35)'}">
        <div class="text-[9px] font-black uppercase tracking-wider" style="color:${color}">${title}</div>
        <div class="text-[11px] font-bold truncate ${value ? 'text-white' : 'text-white/50'} pr-4">${value || placeholder}</div>
        ${canClear ? `<button type="button" onclick="event.stopPropagation(); ppClearSecond('${prefix}')" aria-label="Remove 2nd choice" class="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/50"><i class="fa-solid fa-circle-xmark"></i></button>` : ''}
    </div>`;
}
window.ppChoice = (prefix, second) => {
    const st = PP[prefix]; if (!st) return;
    st.mode = second ? 'second' : 'main';
    const box = document.getElementById(`${prefix}-pp`); if (box) box.innerHTML = pickerInner(prefix);
};
window.ppClearSecond = (prefix) => {
    const st = PP[prefix]; if (!st) return;
    st.spot2 = ''; st.mode = 'main';
    const box = document.getElementById(`${prefix}-pp`); if (box) box.innerHTML = pickerInner(prefix);
    if (typeof window[`${prefix}OnChange`] === 'function') window[`${prefix}OnChange`]();
};

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
    // No real photo yet: use the one from their Google / Facebook sign-in (Apple doesn't share a photo).
    const provPhoto = window.bigProviderPhoto ? window.bigProviderPhoto(user.photoURL) : (user.photoURL || '');
    window._fpAvatar = realPhoto(p.avatar) ? p.avatar : (realPhoto(provPhoto) ? provPhoto : '');
    const isNew = !p.positionSpot && !realPhoto(p.avatar) && !p.position;
    const step2 = !!window._fpStep2; window._fpStep2 = false;
    window._fpFoot = p.foot || '';
    const m = document.createElement('div');
    m.id = 'finish-profile-modal';
    m.className = 'fixed inset-0 z-[185] flex items-start sm:items-center justify-center px-4 py-3 overflow-y-auto';
    // Stadium lights at the top + soft teal glow (pictures the site already has)
    m.style.background = "radial-gradient(ellipse at 50% 45%, rgba(34,230,200,.14), transparent 60%), linear-gradient(to bottom, rgba(3,10,18,.55), #030A12 260px), url('img/Background_Login.jpg') top center / cover no-repeat, #030A12";
    const sec = (t, opt) => `<div class="flex items-center gap-2.5 px-6"><span class="flex-1 h-px bg-[#22E6C8]/60"></span>
        <span class="text-[13px] font-black tracking-wider text-[#22E6C8] whitespace-nowrap">${t}${opt ? '<span class="font-semibold opacity-75"> (OPTIONAL)</span>' : ''}</span><span class="flex-1 h-px bg-[#22E6C8]/60"></span></div>`;
    const quick = !(isNew || step2);
    m.innerHTML = `
        <div class="max-w-sm w-full space-y-2.5 text-white my-auto">
            <div class="text-center space-y-1">
                <img src="img/FutNetLogo.png" alt="FutNet" class="h-9 mx-auto object-contain" onerror="this.style.display='none'">
                ${step2 ? '<div class="text-[10px] font-black uppercase tracking-widest text-[#22E6C8]/85">Step 2 of 2</div>' : ''}
                <h3 class="text-[23px] leading-tight font-black italic" style="text-shadow:0 0 14px rgba(34,230,200,.35)">${quick ? `QUICK <span class="text-[#22E6C8]">CHECK ✅</span>` : `FINISH YOUR <span class="text-[#22E6C8]">PROFILE</span>`}</h3>
            </div>
            <div class="flex items-center gap-3.5">
                <div class="relative cursor-pointer shrink-0" onclick="document.getElementById('fp-photo-input').click()">
                    <div id="fp-avatar-wrap" class="w-[62px] h-[62px] rounded-full overflow-hidden border-2 border-[#22E6C8] bg-[#0b1620] flex items-center justify-center shadow-[0_0_14px_rgba(34,230,200,.55)]">
                        ${window._fpAvatar ? `<img src="${esc(window._fpAvatar)}" class="w-full h-full object-cover">` : '<i class="fa-solid fa-camera text-2xl text-white/40"></i>'}
                    </div>
                    <div class="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#22E6C8] text-slate-950 flex items-center justify-center text-[11px]"><i class="fa-solid fa-camera"></i></div>
                </div>
                <input type="file" id="fp-photo-input" accept="image/*" class="hidden" onchange="fpPhoto(event)">
                <div class="flex-1 min-w-0 space-y-1">
                    <div id="fp-photo-hint">${window._fpAvatar ? '<div class="text-[13px] font-black text-[#22E6C8]">NICKNAME</div>' : '<div class="text-[13px] font-black text-[#22E6C8]">PROFILE PHOTO</div><div class="text-xs text-white/65">Tap the circle to add one</div>'}</div>
                    <input id="fp-nick" value="${esc(p.nickname || '')}" maxlength="24" placeholder="Nickname (optional)" class="w-full bg-black/40 border border-[#22E6C8]/55 rounded-2xl px-3.5 py-2 text-white text-base placeholder:italic placeholder:text-white/35 focus:outline-none focus:border-[#22E6C8]">
                </div>
            </div>
            ${sec('FAVORITE POSITION', false)}
            ${positionPickerHtml('fp', p.positionSpot || '', p.position2Spot || '', p.positionSide || '', p.position2Side || '', { maxWidth: 'max(150px, min(320px, calc((100dvh - 500px) * 0.8)))' })}
            ${sec('STRONG FOOT', true)}
            <div id="fp-foot">${fpFootButtons(window._fpFoot)}</div>
            <div id="fp-error" class="hidden text-xs text-red-400 font-bold bg-red-950/50 border border-red-500/50 p-2 rounded-xl text-center"></div>
            <button id="fp-save" onclick="saveFinishProfile()" class="w-full h-12 rounded-2xl bg-gradient-to-r from-[#22E6C8] to-[#00D9F2] text-slate-950 font-black italic text-[17px] tracking-wide shadow-[0_0_18px_rgba(34,230,200,.5)] flex items-center justify-center gap-2"><i class="fa-solid fa-floppy-disk"></i> SAVE PROFILE</button>
        </div>`;
    document.body.appendChild(m);
    return true;
};

function fpFootButtons(cur) {
    return footPill(cur, 'fpFoot');
}
/** One pill split in three (Right | Left | Both); the picked one glows. Shared with the Profile page. */
export function footPill(cur, fn) {
    const cell = ([k, label, icon], i) => `${i ? '<span class="w-px h-6 bg-white/15 shrink-0"></span>' : ''}
        <button type="button" onclick="${fn}('${k}')" class="flex-1 h-11 rounded-full flex items-center justify-center gap-1.5 text-sm font-extrabold italic transition ${cur === k ? 'text-white bg-[#22E6C8]/15 shadow-[0_0_10px_rgba(34,230,200,.55)]' : 'text-white/65'}"
            style="${cur === k ? 'border:1.5px solid #22E6C8' : 'border:1.5px solid transparent'}">${icon}<span>${label}</span></button>`;
    return `<div class="flex items-center p-0.5 rounded-full border border-white/20 bg-black/35 max-w-[340px] mx-auto">${[['right', 'Right', '🦶'], ['left', 'Left', '<span style="display:inline-block;transform:scaleX(-1)">🦶</span>'], ['both', 'Both', '🦶🦶']].map(cell).join('')}</div>`;
}
window.footPill = footPill;
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
        if (hint) hint.innerHTML = '<div class="text-[13px] font-black text-[#22E6C8]">NICKNAME</div>';
    };
    reader.readAsDataURL(file);
};

/** Bounce + glow the part that's missing and show a little bubble next to it for a few seconds. */
function fpNudge(id, msg, where) {
    const el = document.getElementById(id); if (!el) return;
    if (!document.getElementById('fp-nudge-css')) {
        const st = document.createElement('style'); st.id = 'fp-nudge-css';
        st.textContent = `@keyframes fpShake{0%,100%{transform:translateX(0)}15%{transform:translateX(-7px) rotate(-2deg)}30%{transform:translateX(7px) rotate(2deg)}45%{transform:translateX(-5px)}60%{transform:translateX(5px)}75%{transform:translateX(-2px)}}
@keyframes fpRing{0%{box-shadow:0 0 0 0 rgba(252,211,77,.9)}70%{box-shadow:0 0 0 16px rgba(252,211,77,0)}100%{box-shadow:0 0 0 0 rgba(252,211,77,0)}}
@keyframes fpPop{0%{opacity:0;transform:translate(var(--tx),6px) scale(.85)}15%,85%{opacity:1;transform:translate(var(--tx),0) scale(1)}100%{opacity:0;transform:translate(var(--tx),-4px) scale(.95)}}
.fp-nudge{animation:fpShake .55s ease-in-out 2, fpRing 1.1s ease-out 3}
.fp-bubble{position:absolute;z-index:30;white-space:nowrap;pointer-events:none;background:#FCD34D;color:#1f1300;font-weight:900;font-size:13px;padding:7px 12px;border-radius:999px;box-shadow:0 6px 18px rgba(0,0,0,.45);animation:fpPop 3.2s ease forwards}`;
        document.head.appendChild(st);
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('fp-nudge'); void el.offsetWidth; el.classList.add('fp-nudge');
    const host = where === 'right' ? el.parentElement : el; if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.querySelectorAll(':scope > .fp-bubble').forEach(b => b.remove());
    const b = document.createElement('div'); b.className = 'fp-bubble'; b.textContent = msg; b.setAttribute('role', 'alert');
    if (where === 'right') { b.style.left = 'calc(100% + 8px)'; b.style.top = '50%'; b.style.marginTop = '-16px'; b.style.setProperty('--tx', '0px'); }
    else { b.style.left = '50%'; b.style.top = '38%'; b.style.setProperty('--tx', '-50%'); }
    host.appendChild(b);
    setTimeout(() => { b.remove(); el.classList.remove('fp-nudge'); }, 3300);
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* not on iPhone */ } }
}

window.saveFinishProfile = async function () {
    const user = window.currentUser; if (!user) return;
    const err = (msg) => { const b = document.getElementById('fp-error'); if (b) { b.textContent = msg; b.classList.remove('hidden'); } };
    const pos = readPositionPicker('fp');
    document.getElementById('fp-error')?.classList.add('hidden');
    // Missing something: a friendly animation on that part (photo first, then the field).
    if (!window._fpAvatar) return fpNudge('fp-avatar-wrap', 'Please add a profile picture 📸', 'right');
    if (!pos.spot) return fpNudge('fp-pp', 'Tap your position on the field ⚽', 'top');
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
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> SAVE PROFILE'; }
        err('Could not save. Check your connection and try again.');
    }
};
