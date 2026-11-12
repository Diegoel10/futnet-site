// js/track.js: which buttons and tabs people tap (counts only, no personal data), for futnet.site/manager.
// Saves at most every 30 seconds into artifacts/{appId}/analyticsDaily/{YYYY-MM-DD}.counts["<what>"] (+n).
import { db, appId } from './firebase-config.js';
import { doc, setDoc, increment, arrayUnion } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const pending = {};
let timer = null;
const clean = (s) => String(s || '').replace(/[^\w:+-]/g, '_').slice(0, 60);
function count(key) {
    key = clean(key); if (!key) return;
    pending[key] = (pending[key] || 0) + 1;
    if (!timer) timer = setTimeout(flush, 30000);
}
async function flush() {
    timer = null;
    const keys = Object.keys(pending); if (!keys.length) return;
    const counts = {}; keys.forEach(k => { counts[k] = increment(pending[k]); delete pending[k]; });
    const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const uid = window.currentUser && window.currentUser.uid;
    try { await setDoc(doc(db, 'artifacts', appId, 'analyticsDaily', day), { counts, ...(uid ? { users: arrayUnion(uid) } : {}) }, { merge: true }); } catch (e) { /* offline: skip */ }
}
// The tapped button's action, e.g. onclick="switchModalTab('stats')" -> "switchModalTab:stats"
document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[onclick],a[href],[data-track]') : null;
    if (!el) return;
    if (el.dataset && el.dataset.track) { count(el.dataset.track); return; }
    const oc = el.getAttribute('onclick');
    if (oc) {
        const calls = [...oc.matchAll(/(?:window\.)?([A-Za-z_]\w*)\(\s*(?:'([^']{0,30})')?/g)].map(m => [m[1], m[2]]).filter(([f]) => !['document', 'getElementById', 'remove', 'stopPropagation', 'event', 'setTimeout', 'closeCreateActionSheet', 'import', 'then'].includes(f));
        if (!calls.length) return;
        const [f, a] = calls[0];
        // tab switches keep their tab name; other actions just the function
        count(/tab|Tab|switch|Sub|Filter|Seg/i.test(f) && a ? `${f}:${a}` : f);
    } else if (el.tagName === 'A') {
        const h = el.getAttribute('href') || '';
        count(/maps|waze/i.test(h) ? 'link:maps' : /^tel:/.test(h) ? 'link:call' : /^sms:/.test(h) ? 'link:text' : /wa\.me|whatsapp/i.test(h) ? 'link:whatsapp' : 'link:other');
    }
}, true);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
count('app:open');
