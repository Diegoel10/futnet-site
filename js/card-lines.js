// js/card-lines.js: the jokes / disses / hype printed on the share cards.
//   The list lives on the server (Manager > Settings > 🃏 Card lines), read once per visit with cardLines().
//   Each line is { t: text, s: spicy? }. The game's organizer picks the mood for its cards:
//     'friendly' = only plain lines,  'spicy' = 🌶 lines too (spicy ones are picked more often).
//   No internet / old server: the small built-in list below is used, so the cards always work.
import { app } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const f = (t) => ({ t, s: false }), sp = (t) => ({ t, s: true });
const BUILT_IN = {
    win: [f('GOOD GAMES, BETTER PEOPLE'), f('TOO EASY 😮‍💨'), f('NO MERCY TONIGHT'), f('CHAMPIONS BEHAVIOR 🏆'), f('TELL YOUR FRIENDS 📣'), f('¡CAMPEONES! 🏆'),
        sp('NOBODY CAN STOP US'), sp('BOW DOWN 👑'), sp('NO MERCY. NO DOUBT.'), sp('COOKED THEM 🍳')],
    lose: [f('CARDIO WAS THE REAL WIN 🏃'), f('THANKS FOR SHOWING UP 😂'), f('NEXT WEEK FOR SURE… RIGHT? 🤡'), f('SOMEBODY CHECK ON THEM 😭'), f('THE DONATION TEAM 🎁'), f('ASÍ NO SE PUEDE 😂'),
        sp('GO HOME. PRACTICE. 🏠'), sp('THAT WAS EMBARRASSING 😭'), sp('THE BUS LEFT WITHOUT THEM 🚌'), sp('FREE 3 POINTS 🎁'), sp('DELETE THE TEAM CHAT 🗑️'), sp('NOT EVEN CLOSE 🤡')],
    draw: [f('NOBODY WINS. NOBODY LOSES.'), f('SEE YOU IN THE REMATCH 🔁'), f('TOO CLOSE TO CALL'), sp('BOTH TEAMS SCARED TO LOSE 🐔')],
    pregame: [f('GAME DAY ⚽'), f("LET'S GET IT"), f('MAY THE BEST TEAM WIN'), f('LACE \'EM UP 👟'), f('HOY SE JUEGA ⚽'),
        sp("SOMEBODY'S GOING HOME SAD 😭"), sp('BRING TISSUES 🧻'), sp('LOSER BUYS THE DRINKS 🍻')],
};

let lines = null, loading = null;
/** Loads the list once (max 4 s, then the built-in list). */
export function loadCardLines() {
    if (lines) return Promise.resolve(lines);
    if (loading) return loading;
    const ask = httpsCallable(getFunctions(app, 'us-central1'), 'cardLines')({}).then(r => (r.data || {}).lines).catch(() => null);
    const wait = new Promise(r => setTimeout(() => r(null), 4000));
    loading = Promise.race([ask, wait]).then(got => {
        const out = {};
        Object.keys(BUILT_IN).forEach(k => { const l = got && Array.isArray(got[k]) ? got[k].filter(x => x && x.t) : []; out[k] = l.length ? l : BUILT_IN[k]; });
        if (got) lines = out;   // only keep it if the server answered (try again next time otherwise)
        loading = null;
        return out;
    });
    return loading;
}

/** Normal spice value from a game / VS doc. Old VS matches were spicy, old games friendly. */
export const spiceOf = (doc, fallback = 'friendly') => (doc && (doc.cardSpice === 'spicy' || doc.cardSpice === 'friendly')) ? doc.cardSpice : fallback;

/** One line for a card. kind: win | lose | draw | pregame. Same seed = same line (so a redraw doesn't change it). */
export function pickLine(all, kind, spice, seed) {
    const list = (all && all[kind]) || BUILT_IN[kind] || [];
    let pool = spice === 'spicy' ? list : list.filter(x => !x.s);
    if (!pool.length) pool = list.filter(x => !x.s).length ? list.filter(x => !x.s) : list;
    if (spice === 'spicy') { const hot = pool.filter(x => x.s); if (hot.length && Math.abs(seed) % 3 !== 0) pool = hot; }   // 2 out of 3 spicy
    return pool.length ? pool[Math.abs(seed) % pool.length].t : '';
}

/** Splits a line in two near the middle (for the hand-written corner notes). */
export function twoLines(t, max = 16) {
    t = String(t || '');
    if (t.length <= max || t.includes('\n')) return t;
    const mid = t.length / 2;
    let best = -1;
    for (let i = 0; i < t.length; i++) if (t[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    return best < 0 ? t : t.slice(0, best) + '\n' + t.slice(best + 1);
}

/** The Friendly / 🌶 Spicy switch shown on the cards screen (organizer only). onPick(newSpice) saves + redraws. */
export function spiceSwitchHtml(spice) {
    const b = (v, label) => `<button data-spice="${v}" class="flex-1 py-2 rounded-xl text-xs font-black ${spice === v ? (v === 'spicy' ? 'bg-orange-500 text-slate-950' : 'bg-[#00F296] text-slate-950') : 'bg-black/50 border border-white/15 text-white/80'}">${label}</button>`;
    return `<div class="bg-black/40 border border-white/10 rounded-2xl p-3 space-y-2">
        <div class="text-[11px] font-black uppercase tracking-wider text-white/70">Jokes on the cards <span class="normal-case font-bold text-white/45">(only you can change this)</span></div>
        <div class="flex gap-2">${b('friendly', '😇 Friendly')}${b('spicy', '🌶 Spicy')}</div>
        <div class="text-[10px] text-white/45">${spice === 'spicy' ? 'Trash talk on. Everyone\'s cards for this game use spicy lines.' : 'Clean jokes only. Switch to Spicy for trash talk.'}</div></div>`;
}
export function wireSpiceSwitch(host, onPick) {
    host.querySelectorAll('[data-spice]').forEach(b => b.addEventListener('click', () => onPick(b.dataset.spice)));
}
