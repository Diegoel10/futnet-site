// js/themes.js: app themes (Settings > Theme). A theme = a background photo + colors picked from that photo.
// Saved on the player's own profile (users/{uid}/profile/data.theme) so it follows them to any browser,
// and in this browser (localStorage) so the right background shows before sign-in finishes.
// The background swap itself lives in index.html (no flash on load); this file adds the color swap,
// the Settings picker (with a sample game preview) and the saving.
import { db, appId } from './firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// accent  = buttons, highlights (FutNet green)       accent2 = borders, labels (FutNet teal)
// card    = card background (FutNet dark navy)       panel   = slightly lighter boxes      deep = darkest areas
export const THEMES = {
    classic: {
        name: 'Classic Night', note: 'The original FutNet stadium', thumb: 'img/theme-classic-thumb.jpg', photo: 'img/GamesBackground.png',
        pal: { accent: '#00F296', accent2: '#00B4AE', card: '#040E13', panel: '#07141E', deep: '#01060A' }, swap: false,
    },
    cage: {
        name: 'Night Cage', note: 'Floodlights, rain and a packed cage', thumb: 'img/theme-cage-thumb.jpg', photo: 'img/theme-cage.jpg',
        // floodlight white-blue, cold steel blue, night navy
        pal: { accent: '#A6DCFF', accent2: '#4C7BD9', card: '#07101F', panel: '#0B1628', deep: '#04070F' }, swap: true,
    },
    favela: {
        name: 'Favela Court', note: 'Rooftop court at dusk, Brazil colors', thumb: 'img/theme-favela-thumb.jpg', photo: 'img/theme-favela.jpg',
        // Brazil yellow, court blue, dusk violet-navy
        pal: { accent: '#FFC23D', accent2: '#2F6BD8', card: '#14121F', panel: '#1C1828', deep: '#0C0A14' }, swap: true,
    },
    tokyo: {
        name: 'Tokyo Rooftop', note: 'Daytime cage above the city', thumb: 'img/theme-tokyo-thumb.jpg', photo: 'img/theme-tokyo.jpg',
        // banner red, sky blue, deep sky navy
        pal: { accent: '#FF4D5E', accent2: '#3E9BFF', card: '#0D1B33', panel: '#13264A', deep: '#081226' }, swap: true,
    },
};
const KEY = 'futnet_theme';
const current = () => { const k = document.documentElement.getAttribute('data-futtheme'); return THEMES[k] ? k : 'classic'; };

// ---- color swap: rewrites the app's brand colors wherever they're used as Tailwind classes ----
// Which of the app's colors becomes which theme color.
const HEX_ROLE = {
    '#00F296': 'accent', '#22E6C8': 'accent', '#00E08F': 'accent', '#6ee7a0': 'accent',
    '#00B4AE': 'accent2', '#8DCDD2': 'accent2',
    '#040E13': 'card', '#07141E': 'panel', '#01060A': 'deep', '#090d16': 'deep', '#0f1523': 'deep',
};
const NAMED_ROLE = { 'emerald-300': 'accent', 'emerald-400': 'accent', 'emerald-500': 'accent', 'teal-300': 'accent2', 'teal-400': 'accent2', 'teal-500': 'accent2' };
const OPACITIES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
const PROPS = [['text', 'color'], ['bg', 'background-color'], ['border', 'border-color'], ['accent', 'accent-color'], ['fill', 'fill'], ['stroke', 'stroke'], ['decoration', 'text-decoration-color']];
function rulesFor(root, cls, to) {
    const out = [];
    PROPS.forEach(([p, css]) => {
        out.push(`${root} [class~="${p}-${cls}"],${root} [class~="hover:${p}-${cls}"]:hover{${css}:${to}!important}`);
        OPACITIES.forEach(o => out.push(`${root} [class~="${p}-${cls}/${o}"],${root} [class~="hover:${p}-${cls}/${o}"]:hover{${css}:color-mix(in srgb,${to} ${o}%,transparent)!important}`));
    });
    out.push(`${root} [class~="from-${cls}"]{--tw-gradient-from:${to}!important;--tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-to,transparent)!important}`);
    out.push(`${root} [class~="to-${cls}"]{--tw-gradient-to:${to}!important}`);
    out.push(`${root} [class~="ring-${cls}"]{--tw-ring-color:${to}!important}`);
    out.push(`${root} [class~="shadow-${cls}"]{--tw-shadow-color:${to}!important}`);
    return out;
}
function colorCss(theme, pal) {
    const root = `html[data-futtheme="${theme}"]`;
    const out = [];
    Object.entries(HEX_ROLE).forEach(([hex, role]) => {
        [...new Set([hex.toUpperCase(), hex.toLowerCase()])].forEach(h => out.push(...rulesFor(root, `[${h}]`, pal[role])));
    });
    Object.entries(NAMED_ROLE).forEach(([name, role]) => out.push(...rulesFor(root, name, pal[role])));
    return out.join('\n');
}
(function injectColors() {
    const css = Object.entries(THEMES).filter(([, t]) => t.swap).map(([k, t]) => colorCss(k, t.pal)).join('\n');
    const s = document.createElement('style');
    s.id = 'futnet-theme-colors';
    s.textContent = css;
    document.head.appendChild(s);
})();

export function applyTheme(key) {
    const k = THEMES[key] ? key : 'classic';
    if (k === 'classic') document.documentElement.removeAttribute('data-futtheme');
    else document.documentElement.setAttribute('data-futtheme', k);
    try { localStorage.setItem(KEY, k); } catch (e) { /* private mode */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEMES[k].pal.deep);
}
window.applyFutnetTheme = applyTheme;

// After sign-in, the profile's saved theme wins (so a new browser gets it too).
(function followProfile() {
    let tries = 0;
    const t = setInterval(() => {
        tries++;
        const p = window.userProfile;
        if (p && typeof p.theme === 'string') { if (p.theme !== current()) applyTheme(p.theme); clearInterval(t); }
        else if (tries > 60) clearInterval(t);
    }, 500);
})();

window.pickTheme = async function (key) {
    applyTheme(key);
    document.querySelectorAll('[data-theme-pick]').forEach(b => {
        const on = b.getAttribute('data-theme-pick') === key;
        b.style.outline = on ? '3px solid #ffffff' : '1px solid rgba(255,255,255,.18)';
        const c = b.querySelector('[data-check]'); if (c) c.style.display = on ? 'flex' : 'none';
    });
    const pv = document.getElementById('theme-preview'); if (pv) pv.outerHTML = previewHtml(key);
    if (window.userProfile) window.userProfile.theme = key;
    const uid = window.currentUser?.uid; if (!uid) return;
    try {
        await setDoc(doc(db, 'artifacts', appId, 'users', uid, 'profile', 'data'), { theme: key }, { merge: true });
        if (window.showToast) window.showToast(`Theme: ${THEMES[key].name}`);
    } catch (e) {
        if (window.showToast) window.showToast("Saved on this device only (couldn't reach your profile).", 'error');
    }
};

/** A sample game card on the theme's photo, drawn with the theme's own colors (so it shows exactly how games will look). */
function previewHtml(key) {
    const t = THEMES[key] || THEMES.classic, p = t.pal;
    const mix = (c, pct) => `color-mix(in srgb,${c} ${pct}%,transparent)`;
    return `<div id="theme-preview" style="position:relative;border-radius:14px;overflow:hidden;height:210px;background:${p.deep} url('${t.photo}') center 65%/cover no-repeat">
        <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.35))"></div>
        <div style="position:absolute;left:12px;right:12px;bottom:12px;padding:12px;border-radius:16px;background:${mix(p.card, 92)};border:1px solid ${mix(p.accent2, 45)};color:#fff;font-family:inherit">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                <div style="min-width:0">
                    <div style="font-size:14px;font-weight:900;line-height:1.2">Thursday Night Soccer</div>
                    <div style="font-size:11px;color:rgba(255,255,255,.7);margin-top:2px">Thu 8:00 PM · Firefighters Park</div>
                </div>
                <span style="font-size:9px;font-weight:900;letter-spacing:.5px;padding:3px 8px;border-radius:999px;background:${mix(p.accent, 18)};color:${p.accent};border:1px solid ${mix(p.accent, 45)}">8V8</span>
            </div>
            <div style="height:6px;border-radius:9px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:10px"><div style="height:100%;width:88%;background:${p.accent}"></div></div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:9px;font-size:11px">
                <span style="color:${p.accent2};font-weight:800">21/24 going</span>
                <span style="font-size:11px;font-weight:900;padding:6px 14px;border-radius:10px;background:${p.accent};color:#06100C">Join</span>
            </div>
        </div>
        <div style="position:absolute;top:10px;left:12px;font-size:10px;font-weight:900;letter-spacing:.6px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6)">PREVIEW · ${t.name.toUpperCase()}</div>
    </div>`;
}

/** The picker shown in Settings. */
window.themePickerHtml = function () {
    const cur = current();
    return `<div class="bg-[#07141E]/90 border border-[#00B4AE]/40 rounded-2xl p-3 space-y-2">
        <div class="text-[10px] font-black text-[#00B4AE] uppercase tracking-wider">Theme</div>
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px">
            ${Object.entries(THEMES).map(([k, t]) => `<button type="button" data-theme-pick="${k}" onclick="pickTheme('${k}')" title="${t.note}" aria-label="${t.name}"
                style="position:relative;display:block;width:100%;aspect-ratio:9/14;padding:0;border:0;border-radius:10px;overflow:hidden;cursor:pointer;background:#000;outline:${k === cur ? '3px solid #ffffff' : '1px solid rgba(255,255,255,.18)'};outline-offset:-1px">
                <img src="${t.thumb}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
                <span style="position:absolute;left:0;right:0;bottom:0;padding:5px;font-size:9px;font-weight:900;line-height:1.15;color:#fff;text-align:left;background:linear-gradient(transparent,rgba(0,0,0,.85))">${t.name}</span>
                <span style="position:absolute;left:5px;top:5px;display:flex;gap:3px"><i style="width:9px;height:9px;border-radius:50%;background:${t.pal.accent};border:1px solid rgba(0,0,0,.4)"></i><i style="width:9px;height:9px;border-radius:50%;background:${t.pal.accent2};border:1px solid rgba(0,0,0,.4)"></i></span>
                <span data-check style="position:absolute;top:5px;right:5px;width:18px;height:18px;border-radius:50%;background:#fff;color:#000;font-size:10px;font-weight:900;display:${k === cur ? 'flex' : 'none'};align-items:center;justify-content:center">✓</span>
            </button>`).join('')}
        </div>
        ${previewHtml(cur)}
        <p class="text-[11px] text-white/50">Changes the background, buttons and card colors. Only you see your theme.</p>
    </div>`;
};
