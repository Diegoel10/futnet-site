// js/spot-offers.js: "Someone cancelled! You're up next" banner, shown on any screen
// when a spot is being offered to you on a game's waitlist (the server also sends a push).
import { offerEligible, startMsOf } from './money-rules.js';

const dismissed = new Set();

function myOffer() {
    const me = window.currentUser && String(window.currentUser.uid);
    if (!me) return null;
    const now = Date.now();
    return (window.eventsList || []).find(ev => {
        if (!ev || !ev.spotOffer || ev.isSessionEnded) return false;
        const key = `${ev.id}_${ev.spotOffer.round || 1}_${ev.spotOffer.startedAt || ''}`;
        if (dismissed.has(key)) return false;
        return offerEligible(ev, now, startMsOf(ev)).includes(me);
    }) || null;
}

function render() {
    const ev = myOffer();
    let el = document.getElementById('spot-offer-banner');
    const onThisGame = ev && window.activeModalEventId === ev.id && !document.getElementById('tab-event-details-screen')?.classList.contains('hidden');
    if (!ev || onThisGame) { el?.remove(); return; }
    if (!el) {
        el = document.createElement('div');
        el.id = 'spot-offer-banner';
        el.className = 'fixed bottom-20 sm:bottom-6 inset-x-3 z-[150] max-w-md mx-auto';
        document.body.appendChild(el);
    }
    const key = `${ev.id}_${ev.spotOffer.round || 1}_${ev.spotOffer.startedAt || ''}`;
    if (el.getAttribute('data-key') === key) return;
    el.setAttribute('data-key', key);
    const exp = ev.spotOffer.expiresAt;
    const esc = (t) => String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    el.innerHTML = `
        <div class="bg-gradient-to-r from-emerald-950 to-teal-950 border-2 border-[#00F296] rounded-2xl p-4 shadow-[0_0_30px_rgba(0,242,150,0.35)] text-white space-y-2">
            <div class="flex items-start justify-between gap-2">
                <div>
                    <div class="text-sm font-black">🎉 Someone cancelled! You're up next</div>
                    <div class="text-[11px] text-white/80">${esc(ev.title || 'Your game')} · ${esc(ev.date || '')} ${esc(ev.time || '')}</div>
                    ${ev.spotOffer.lastCall ? '<div class="text-[11px] text-amber-300 font-bold">Last call: first to confirm gets it.</div>'
                        : (exp ? `<div class="text-[11px] text-white/80">Confirm within <b class="text-[#00F296]" data-countdown="${Number(exp)}">--:--</b></div>` : '')}
                </div>
                <button onclick="dismissSpotOffer('${esc(key)}')" class="text-white/50 hover:text-white text-lg leading-none"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <button onclick="openSpotOffer('${esc(ev.id)}')" class="w-full bg-[#00F296] text-slate-950 font-black py-2.5 rounded-xl text-xs uppercase tracking-wider">See the game & confirm</button>
        </div>`;
}

window.dismissSpotOffer = (key) => { dismissed.add(key); document.getElementById('spot-offer-banner')?.remove(); };
window.openSpotOffer = (id) => {
    document.getElementById('spot-offer-banner')?.remove();
    if (typeof window.openEventDetails === 'function') window.openEventDetails(id);
};

setInterval(render, 5000);
window.refreshSpotOffers = render;
