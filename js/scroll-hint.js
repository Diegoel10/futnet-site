// js/scroll-hint.js: arrows on sideways-scrolling tab bars, so people see there are more tabs.
// Any element with data-scroll-hint gets a "›" on the right while there's more to the right
// (and a "‹" on the left once scrolled). Tapping an arrow scrolls the bar. Works for elements
// added later too (game pages, VS pages are drawn on the fly).
const ARROW = (side) => `<button type="button" aria-label="More tabs" data-hint-arrow="${side}" tabindex="-1"
    style="position:absolute;top:0;bottom:0;${side}:0;width:34px;display:none;align-items:center;justify-content:${side === 'right' ? 'flex-end' : 'flex-start'};
    padding:0 6px;border:0;cursor:pointer;z-index:5;border-radius:${side === 'right' ? '0 16px 16px 0' : '16px 0 0 16px'};
    background:linear-gradient(to ${side === 'right' ? 'left' : 'right'}, rgba(0,0,0,.92) 35%, rgba(0,0,0,0));color:#fff">
    <i class="fa-solid fa-chevron-${side}" style="font-size:12px;filter:drop-shadow(0 0 4px rgba(0,242,150,.9))"></i></button>`;

function setup(bar) {
    if (bar.dataset.hinted) return;
    bar.dataset.hinted = '1';
    let wrap = bar.parentElement;
    if (!wrap || !wrap.hasAttribute('data-hint-wrap')) {
        wrap = document.createElement('div');
        wrap.setAttribute('data-hint-wrap', '');
        wrap.style.position = 'relative';
        bar.parentNode.insertBefore(wrap, bar);
        wrap.appendChild(bar);
    }
    wrap.insertAdjacentHTML('beforeend', ARROW('left') + ARROW('right'));
    const L = wrap.querySelector('[data-hint-arrow="left"]'), R = wrap.querySelector('[data-hint-arrow="right"]');
    const update = () => {
        const more = bar.scrollWidth - bar.clientWidth - bar.scrollLeft;
        R.style.display = more > 4 ? 'flex' : 'none';
        L.style.display = bar.scrollLeft > 4 ? 'flex' : 'none';
    };
    L.onclick = (e) => { e.stopPropagation(); bar.scrollBy({ left: -bar.clientWidth * 0.6, behavior: 'smooth' }); };
    R.onclick = (e) => { e.stopPropagation(); bar.scrollBy({ left: bar.clientWidth * 0.6, behavior: 'smooth' }); };
    bar.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    // keep the picked tab in view, then check the arrows
    const on = bar.querySelector('.bg-\\[\\#00F296\\], .bg-red-600, [aria-selected="true"]');
    if (on && on.scrollIntoView) { try { bar.scrollLeft = Math.max(0, on.offsetLeft - bar.clientWidth / 2 + on.clientWidth / 2); } catch (e) { /* old browsers */ } }
    update(); setTimeout(update, 300);
}
function scan(root) {
    (root.querySelectorAll ? root.querySelectorAll('[data-scroll-hint]:not([data-hinted])') : []).forEach(setup);
}
new MutationObserver((list) => {
    for (const m of list) m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.hasAttribute && n.hasAttribute('data-scroll-hint')) setup(n); scan(n); } });
}).observe(document.documentElement, { childList: true, subtree: true });
scan(document);
