// js/themes.js: app themes (Settings > Theme). A theme = a background photo + colors picked from that photo.
// Saved on the player's own profile (users/{uid}/profile/data.theme) so it follows them to any browser,
// and in this browser (localStorage) so the right background shows before sign-in finishes.
// The background swap itself lives in index.html (no flash on load); this file adds the color swap,
// the Settings picker (with a sample game preview) and the saving.
import { db, appId } from './firebase-config.js';
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
// No theme picked yet = Tokyo Rooftop (the default since Nov 2026; index.html applies it before the page draws).

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
        name: 'Favela Night', note: 'Rooftop court at dusk, Brazil colors', thumb: 'img/theme-favela-thumb.jpg', photo: 'img/theme-favela.jpg',
        // Brazil yellow, court blue, dusk violet-navy
        pal: { accent: '#FFC23D', accent2: '#2F6BD8', card: '#14121F', panel: '#1C1828', deep: '#0C0A14' }, swap: true,
    },
    faveladay: {
        name: 'Favela Day', note: 'Daytime cage under Christ the Redeemer', thumb: 'img/theme-favela-day-thumb.jpg', photo: 'img/theme-favela-day.jpg',
        // Brazil yellow, Brazil green, deep sea navy
        pal: { accent: '#FFD23F', accent2: '#1FAF5A', card: '#0E1A24', panel: '#14222E', deep: '#08121A' }, swap: true,
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
// ⚡ Real class selectors (".bg-\[\#00F296\]"), NOT attribute ones ('[class~="bg-[#00F296]"]').
//   The browser looks class selectors up by name in an instant; attribute ones it had to try on EVERY element,
//   ~30,000 of them, on every redraw: that made game pages take seconds on phones (Roster / Stats tabs).
const esc = (c) => (window.CSS && CSS.escape) ? CSS.escape(c) : c.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
const sel = (root, c) => `${root} .${esc(c)}`;
const hov = (root, c) => `${root} .${esc('hover:' + c)}:hover`;
function rulesFor(root, cls, to) {
    const out = [];
    PROPS.forEach(([p, css]) => {
        out.push(`${sel(root, `${p}-${cls}`)},${hov(root, `${p}-${cls}`)}{${css}:${to}!important}`);
        OPACITIES.forEach(o => out.push(`${sel(root, `${p}-${cls}/${o}`)},${hov(root, `${p}-${cls}/${o}`)}{${css}:color-mix(in srgb,${to} ${o}%,transparent)!important}`));
    });
    out.push(`${sel(root, `from-${cls}`)}{--tw-gradient-from:${to}!important;--tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-to,transparent)!important}`);
    out.push(`${sel(root, `to-${cls}`)}{--tw-gradient-to:${to}!important}`);
    out.push(`${sel(root, `ring-${cls}`)}{--tw-ring-color:${to}!important}`);
    out.push(`${sel(root, `shadow-${cls}`)}{--tw-shadow-color:${to}!important}`);
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
        await setDoc(doc(db, 'artifacts', appId, 'users', uid, 'profile', 'data'), { theme: key, themeAt: Date.now(), themeFrom: 'web' }, { merge: true });   // themeAt / themeFrom: for the manager's 🎨 Themes tab
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

// ---------------------------------------------------------------- 🎨 the one-time "Now you can pick your theme" screen
// Same rules as the apps (ThemeIntro.swift / ThemeIntro.kt):
//   • Returning players (account made before Nov 15, 2026): shows the next time they open futnet.site.
//   • New players: shows on their 5th visit (a visit = a new browser session).
//   • ONCE per player, ever: saved on the profile (users/{uid}/profile/data.themeIntro) so the apps skip it too, and in this browser.
//   • Returning players who already picked a theme don't see it.
const INTRO_SEEN = 'futnet_theme_intro_seen', VISITS = 'futnet_visits';
const CUTOFF = Date.UTC(2026, 10, 15);
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };
(function themeIntroWatch() {
    let tries = 0;
    const t = setInterval(() => {
        tries++;
        const u = window.currentUser, p = window.userProfile;
        if (tries > 120) { clearInterval(t); return; }
        if (!u || !u.uid || !p) return;
        clearInterval(t);
        maybeShowIntro(u).catch(() => {});
    }, 500);
})();
async function maybeShowIntro(u) {
    if (ls.get(INTRO_SEEN)) return;
    let visits = +(ls.get(VISITS) || 0);
    try { if (!sessionStorage.getItem('futnet_visit')) { sessionStorage.setItem('futnet_visit', '1'); visits++; ls.set(VISITS, String(visits)); } } catch (e) { /* ignore */ }
    const created = Date.parse((u.metadata && u.metadata.creationTime) || '') || Date.now();
    const returning = created < CUTOFF;
    if (!returning && visits < 5) return;
    const ref = doc(db, 'artifacts', appId, 'users', u.uid, 'profile', 'data');
    const d = (await getDoc(ref)).data() || {};
    const markSeen = () => { ls.set(INTRO_SEEN, '1'); setDoc(ref, { themeIntro: serverTimestamp() }, { merge: true }).catch(() => {}); };
    if (d.themeIntro) { ls.set(INTRO_SEEN, '1'); return; }
    if (returning && typeof d.theme === 'string') { markSeen(); return; }   // already picked one
    setTimeout(() => { if (ls.get(INTRO_SEEN)) return; markSeen(); window.openThemeIntro(); }, 2000);
}
/** The screen itself (also handy for testing: openThemeIntro() in the console). */
window.openThemeIntro = function () {
    document.getElementById('theme-intro')?.remove();
    const keys = ['tokyo', 'faveladay', 'favela', 'cage', 'classic'].filter(k => THEMES[k]), start = Math.max(0, keys.indexOf(current()));
    const el = document.createElement('div');
    el.id = 'theme-intro';
    el.style.cssText = 'position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px 0;color:#fff;font-family:inherit';
    const card = (k) => { const t = THEMES[k], p = t.pal, mix = (c, n) => `color-mix(in srgb,${c} ${n}%,transparent)`; return `
        <div data-ti="${k}" style="flex:0 0 min(72vw,300px);height:min(56vh,430px);scroll-snap-align:center;position:relative;border-radius:28px;overflow:hidden;background:${p.deep} url('${t.photo}') center 60%/cover no-repeat;border:1px solid rgba(255,255,255,.2);transition:border-color .2s">
            <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35),transparent 40%,rgba(0,0,0,.55))"></div>
            <div style="position:absolute;top:18px;left:0;right:0;text-align:center;text-shadow:0 1px 4px rgba(0,0,0,.6)"><div style="font-size:20px;font-weight:900">${t.name}</div><div style="font-size:11px;font-weight:600;opacity:.85">${t.note}</div></div>
            <div style="position:absolute;left:12px;right:12px;bottom:12px;padding:11px;border-radius:15px;background:${mix(p.card, 92)};border:1px solid ${mix(p.accent2, 45)}">
                <div style="display:flex;justify-content:space-between;gap:8px"><div><div style="font-size:13px;font-weight:900">Thursday Night Soccer</div><div style="font-size:10px;opacity:.7">Thu 8:00 PM · Firefighters Park</div></div>
                    <span style="align-self:flex-start;font-size:9px;font-weight:900;padding:3px 7px;border-radius:999px;background:${mix(p.accent, 18)};color:${p.accent}">8V8</span></div>
                <div style="height:5px;border-radius:9px;background:rgba(255,255,255,.12);margin-top:8px;overflow:hidden"><div style="height:100%;width:88%;background:${p.accent}"></div></div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:10px"><span style="color:${p.accent2};font-weight:800">21/24 going</span><span style="font-weight:900;padding:5px 12px;border-radius:9px;background:${p.accent};color:#06100C">Join</span></div>
            </div>
        </div>`; };
    el.innerHTML = `
        <span id="ti-new" style="font-size:11px;font-weight:900;color:#000;padding:4px 10px;border-radius:999px">✨ NEW</span>
        <div style="font-size:24px;font-weight:900;text-align:center;padding:0 24px">Now you can pick your theme</div>
        <div style="font-size:13px;opacity:.65;text-align:center;padding:0 24px">Swipe to see them all. Change it anytime in Settings › Theme.</div>
        <div id="ti-strip" style="display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;width:100%;max-width:720px;padding:6px calc(50% - min(36vw,150px));box-sizing:border-box;scrollbar-width:none">${keys.map(card).join('')}</div>
        <div id="ti-dots" style="display:flex;gap:8px">${keys.map(k => `<button data-dot="${k}" style="height:8px;border-radius:9px;border:0;padding:0;cursor:pointer"></button>`).join('')}</div>
        <button id="ti-use" style="width:min(88vw,420px);border:0;border-radius:18px;padding:16px;font-size:17px;font-weight:900;color:#06100C;cursor:pointer"></button>
        <button id="ti-later" style="background:none;border:0;color:rgba(255,255,255,.6);font-size:14px;font-weight:700;cursor:pointer;padding:6px">Not now</button>`;
    document.body.appendChild(el);
    const strip = el.querySelector('#ti-strip');
    let sel = keys[start];
    const draw = () => {
        const t = THEMES[sel];
        el.querySelector('#ti-new').style.background = t.pal.accent;
        const use = el.querySelector('#ti-use'); use.textContent = `Use ${t.name}`; use.style.background = t.pal.accent;
        el.querySelectorAll('[data-ti]').forEach(c => { c.style.border = c.dataset.ti === sel ? `3px solid ${t.pal.accent}` : '1px solid rgba(255,255,255,.2)'; });
        el.querySelectorAll('[data-dot]').forEach(d => { const on = d.dataset.dot === sel; d.style.width = on ? '22px' : '8px'; d.style.background = on ? t.pal.accent : 'rgba(255,255,255,.25)'; });
    };
    const centerOn = (k, smooth) => { const c = strip.querySelector(`[data-ti="${k}"]`); if (c) strip.scrollTo({ left: c.offsetLeft - (strip.clientWidth - c.clientWidth) / 2, behavior: smooth ? 'smooth' : 'auto' }); };
    strip.addEventListener('scroll', () => {
        const mid = strip.scrollLeft + strip.clientWidth / 2;
        let best = sel, dist = 1e9;
        strip.querySelectorAll('[data-ti]').forEach(c => { const d = Math.abs(c.offsetLeft + c.clientWidth / 2 - mid); if (d < dist) { dist = d; best = c.dataset.ti; } });
        if (best !== sel) { sel = best; draw(); }
    }, { passive: true });
    strip.querySelectorAll('[data-ti]').forEach(c => c.addEventListener('click', () => centerOn(c.dataset.ti, true)));
    el.querySelectorAll('[data-dot]').forEach(d => d.addEventListener('click', () => centerOn(d.dataset.dot, true)));
    el.querySelector('#ti-use').onclick = () => { el.remove(); window.pickTheme(sel); };
    el.querySelector('#ti-later').onclick = () => el.remove();
    draw();
    requestAnimationFrame(() => centerOn(sel, false));
};
