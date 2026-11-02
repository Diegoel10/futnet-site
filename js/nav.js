// js/nav.js: the phone / browser Back button goes back one screen.
//
// Every full-screen pop-up (a player's page, a team, the money tracker, a form…) is a <div class="fixed inset-0">
// added to the page. Each one that opens adds a step to the browser history, so Back closes the
// top pop-up first (instead of jumping to another tab behind it). Closing a pop-up with its own ✕
// takes that step back out, so the history always matches what's on screen.
//
// A pop-up that needs cleanup when it closes says so with data-close="functionName" (that function is
// called instead of just removing it). data-no-history="1" leaves a pop-up out (small menus).

const stack = [];          // open pop-ups, oldest first
let skipPops = 0;          // Back steps we made ourselves (when a pop-up closed with its ✕)
const isOverlay = (n) => n && n.nodeType === 1 && n.parentNode === document.body && n.classList
    && n.classList.contains('fixed') && n.classList.contains('inset-0') && !(n.dataset && n.dataset.noHistory);

function opened(el) {
    stack.push(el);
    try { history.pushState({ ...(history.state || {}), overlay: stack.length }, '', location.href); } catch (e) { /* ignore */ }
}
function closedByApp(el) {
    const i = stack.indexOf(el);
    if (i < 0) return;
    stack.splice(i, 1);
    // Take our history step back out (quietly).
    skipPops++;
    try { history.back(); } catch (e) { skipPops--; }
}

new MutationObserver((records) => {
    const added = [], removed = [];
    records.forEach(r => {
        r.addedNodes.forEach(n => { if (isOverlay(n)) added.push(n); });
        r.removedNodes.forEach(n => { if (n.nodeType === 1 && stack.includes(n)) removed.push(n); });
    });
    // The same pop-up redrawn (removed and added again with the same id): keep its history step.
    removed.slice().forEach(old => {
        const again = added.find(a => a.id && a.id === old.id);
        if (again) {
            stack[stack.indexOf(old)] = again;
            added.splice(added.indexOf(again), 1);
            removed.splice(removed.indexOf(old), 1);
        }
    });
    removed.forEach(closedByApp);
    added.forEach(n => { if (document.body.contains(n)) opened(n); });
}).observe(document.body, { childList: true });

function closeTop() {
    const el = stack.pop();
    if (!el) return;
    const fn = el.dataset && el.dataset.close;
    if (fn && typeof window[fn] === 'function') { try { window[fn](); } catch (e) { el.remove(); } }
    if (document.body.contains(el)) el.remove();
}

// Runs before the page's other Back handlers (this file loads first).
window.addEventListener('popstate', (e) => {
    if (skipPops > 0) { skipPops--; e.stopImmediatePropagation(); return; }
    const want = (e.state && e.state.overlay) || 0;
    if (stack.length > want) {
        while (stack.length > want) closeTop();
        e.stopImmediatePropagation();
    }
});

window.__navStack = stack;

// iPhone: date and time boxes have a built-in minimum width, so two side by side ran into each other.
(function fixDateBoxes() {
    if (document.getElementById('futnet-date-fix')) return;
    const s = document.createElement('style');
    s.id = 'futnet-date-fix';
    s.textContent = `input[type=date],input[type=time]{-webkit-appearance:none;appearance:none;min-width:0;max-width:100%;width:100%;display:block;box-sizing:border-box;min-height:2.6rem}
input[type=date]::-webkit-date-and-time-value,input[type=time]::-webkit-date-and-time-value{text-align:left}`;
    (document.head || document.documentElement).appendChild(s);
})();
