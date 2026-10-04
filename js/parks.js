// js/parks.js: shared park list (artifacts/{appId}/global/parks/list).
// Suggests parks while typing, and saves a new one the first time somebody creates a game there.
import { db, appId } from './firebase-config.js';
import { collection, getDocs, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { escapeHtml as esc } from './game-profile/event-store.js';

const DEFAULTS = [
    { name: "Cypress Park", address: "1300 Coral Springs Dr, Coral Springs, FL 33071", city: "Coral Springs", state: "FL" },
    { name: "Firefighters Park", address: "2500 N Rock Island Rd, Margate, FL 33063", city: "Margate", state: "FL" },
    { name: "Pine Trails Park", address: "10555 Trails End Rd, Parkland, FL 33076", city: "Parkland", state: "FL" },
    { name: "Tradition Park", address: "2100 Lyons Rd, Coconut Creek, FL 33063", city: "Coconut Creek", state: "FL" },
    { name: "South County Regional Park", address: "11200 Glades Rd, Boca Raton, FL 33434", city: "Boca Raton", state: "FL" }
];

let parks = [];
let loaded = false;
let loading = null;

const key = (name, city) => `${String(name).toLowerCase().trim()}|${String(city || '').toLowerCase().trim()}`;
const slug = (name, city) => key(name, city).replace(/[^a-z0-9|]+/g, '-').replace(/\|/g, '__').replace(/^-+|-+$/g, '').slice(0, 120);

export async function loadParks() {
    if (loaded) return parks;
    if (!loading) {
        loading = (async () => {
            let cloud = [];
            try {
                const snap = await getDocs(collection(db, 'artifacts', appId, 'global', 'parks', 'list'));
                cloud = snap.docs.map(d => d.data()).filter(p => p && p.name);
            } catch (e) { /* offline or no access: use the built-in list */ }
            parks = [...cloud];
            DEFAULTS.forEach(def => { if (!parks.some(p => p.name.toLowerCase() === def.name.toLowerCase())) parks.push(def); });
            loaded = true;
            return parks;
        })();
    }
    return loading;
}

export function searchParks(text) {
    const q = String(text || '').toLowerCase().trim();
    if (!q) return [];
    return parks.filter(p =>
        p.name.toLowerCase().includes(q) || (p.city && p.city.toLowerCase().includes(q)) || (p.address && p.address.toLowerCase().includes(q))
    ).slice(0, 8);
}

/** Saves the park if it is not in the list yet, so the next person gets it as a suggestion. */
export async function saveParkIfNew(name, city, state) {
    name = String(name || '').trim(); city = String(city || '').trim(); state = String(state || 'FL').trim() || 'FL';
    if (!name) return;
    await loadParks();
    if (parks.some(p => key(p.name, p.city) === key(name, city))) return;
    const rec = { name, city, state, address: `${city}${city ? ', ' : ''}${state}`, addedBy: window.currentUser?.uid || '', createdAt: serverTimestamp() };
    parks.push({ name, city, state, address: rec.address });
    try { await setDoc(doc(db, 'artifacts', appId, 'global', 'parks', 'list', slug(name, city)), rec); }
    catch (e) { console.warn('Could not save the new park:', e); }
}

/**
 * Turns a text input into a park picker. When a suggestion is chosen it fills the city / state inputs.
 * ids = { input, city, state }
 */
export function attachParkPicker(ids) {
    const input = document.getElementById(ids.input);
    if (!input || input.dataset.parkPicker) return;
    input.dataset.parkPicker = '1';
    input.setAttribute('autocomplete', 'off');
    const wrap = input.parentElement; wrap.style.position = 'relative';
    const box = document.createElement('div');
    box.className = 'absolute left-0 right-0 top-full mt-1 bg-[#040E13] border border-emerald-500/40 rounded-xl shadow-2xl z-[200] max-h-48 overflow-y-auto divide-y divide-white/10 hidden';
    wrap.appendChild(box);
    loadParks();

    const render = () => {
        const q = input.value;
        if (!q.trim()) { box.classList.add('hidden'); return; }
        const hits = searchParks(q);
        box.innerHTML = hits.length ? hits.map((p, i) => `
            <div data-i="${i}" class="p-3 hover:bg-black/60 cursor-pointer text-xs text-left">
                <div class="font-bold text-white">${esc(p.name)}</div>
                <div class="text-[10px] text-white/60">${esc(p.address || `${p.city}, ${p.state}`)}</div>
            </div>`).join('') : `<div class="p-3 text-xs text-white/50">New location. It will be saved for the next game.</div>`;
        box.classList.remove('hidden');
        box.querySelectorAll('[data-i]').forEach(el => {
            el.onmousedown = el.ontouchstart = (e) => {
                e.preventDefault();
                const p = hits[Number(el.getAttribute('data-i'))];
                input.value = p.name;
                const c = document.getElementById(ids.city); if (c) c.value = p.city || '';
                const s = document.getElementById(ids.state); if (s) s.value = p.state || 'FL';
                box.classList.add('hidden');
            };
        });
    };
    input.addEventListener('input', async () => { await loadParks(); render(); });
    input.addEventListener('focus', async () => { await loadParks(); render(); });
    input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150));
}