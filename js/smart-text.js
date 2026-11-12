// js/smart-text.js: makes phone numbers, addresses and web links in messages / comments tappable.
//   phone   -> Call / Text / Copy
//   address -> Apple Maps / Google Maps / Waze / Copy
//   link    -> opens in a new tab
// smartText(text) returns safe HTML (everything else is escaped).
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STREET = '(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|parkway|hwy|highway|ter|terrace|cir|circle|trl|trail|sq|square|loop|plz|plaza)';
const DIR = '(?:n|s|e|w|ne|nw|se|sw|north|south|east|west)';
// 123 Main St / 4500 N State Road 7 Ave / 1200 NW 3rd Street, Margate, FL 33063
const ADDRESS = new RegExp(
    `\\b\\d{1,6}\\s+(?:${DIR}\\.?\\s+)?(?:[A-Za-z0-9][\\w'.-]*\\s+){0,4}${STREET}\\b\\.?(?:\\s+${DIR}\\.?)?` +
    `(?:(?:,\\s*|\\s+)(?:(?:apt|suite|ste|unit|#)\\s*[\\w-]+,?\\s*)?[A-Za-z][A-Za-z .'-]{1,30},\\s*[A-Z]{2}(?:\\s+\\d{5}(?:-\\d{4})?)?)?`, 'gi');
// (954) 555-1234 / 954-555-1234 / 954.555.1234 / +1 954 555 1234 / 9545551234
const PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+/gi;

const ACTION = 'style="color:#53BDEB;text-decoration:underline;cursor:pointer"';

export function smartText(text) {
    const s = String(text ?? '');
    if (!s) return '';
    const hits = [];
    const add = (re, kind) => { re.lastIndex = 0; let m; while ((m = re.exec(s))) { let v = m[0]; if (kind === 'url') v = v.replace(/[.,!?)]+$/, ''); hits.push({ i: m.index, end: m.index + v.length, v, kind }); } };
    add(URL_RE, 'url'); add(ADDRESS, 'addr'); add(PHONE, 'phone');
    hits.sort((a, b) => a.i - b.i || b.end - a.end);
    let out = '', at = 0;
    for (const h of hits) {
        if (h.i < at) continue;   // overlaps an earlier match (e.g. digits inside a link)
        if (h.kind === 'phone' && h.v.replace(/\D/g, '').length < 10) continue;
        out += esc(s.slice(at, h.i));
        const v = esc(h.v), arg = esc(JSON.stringify(h.v));
        if (h.kind === 'url') out += `<a href="${esc(/^https?:/i.test(h.v) ? h.v : 'https://' + h.v)}" target="_blank" rel="noopener noreferrer" ${ACTION} onclick="event.stopPropagation()">${v}</a>`;
        else out += `<span role="button" tabindex="0" ${ACTION} onclick="event.stopPropagation(); openSmartActions('${h.kind}', ${arg})">${h.kind === 'phone' ? '📞 ' : '📍 '}${v}</span>`;
        at = h.end;
    }
    return out + esc(s.slice(at));
}
window.smartText = smartText;

window.openSmartActions = function (kind, value) {
    document.getElementById('smart-actions')?.remove();
    const v = String(value || '');
    const q = encodeURIComponent(v);
    const digits = v.replace(/[^\d+]/g, '');
    const row = (href, icon, label) => `<a href="${esc(href)}" ${href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''} onclick="setTimeout(()=>document.getElementById('smart-actions')?.remove(),50)"
        style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;background:rgba(255,255,255,.06);color:#fff;font-weight:800;font-size:14px;text-decoration:none">
        <span style="width:22px;text-align:center">${icon}</span>${label}</a>`;
    const rows = kind === 'phone'
        ? row(`tel:${digits}`, '📞', 'Call') + row(`sms:${digits}`, '💬', 'Text') + row(`https://wa.me/${digits.replace(/^\+/, '').replace(/^(\d{10})$/, '1$1')}`, '🟢', 'WhatsApp')
        : row(`https://maps.apple.com/?q=${q}`, '🍎', 'Apple Maps') + row(`https://www.google.com/maps/search/?api=1&query=${q}`, '🗺️', 'Google Maps') + row(`https://waze.com/ul?q=${q}&navigate=yes`, '🚗', 'Waze');
    const el = document.createElement('div');
    el.id = 'smart-actions';
    el.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center';
    el.onclick = (e) => { if (e.target === el) el.remove(); };
    el.innerHTML = `<div style="width:100%;max-width:440px;background:#0B141A;border:1px solid rgba(255,255,255,.12);border-radius:22px 22px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px">
        <div style="color:rgba(255,255,255,.6);font-size:12px;font-weight:700;text-align:center;padding-bottom:4px;word-break:break-word">${esc(v)}</div>
        ${rows}
        <button type="button" id="smart-copy" style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;background:rgba(255,255,255,.06);color:#fff;font-weight:800;font-size:14px;border:0;text-align:left"><span style="width:22px;text-align:center">📋</span>Copy</button>
        <button type="button" onclick="document.getElementById('smart-actions').remove()" style="padding:12px;color:rgba(255,255,255,.6);font-weight:800;background:none;border:0">Cancel</button>
    </div>`;
    document.body.appendChild(el);
    el.querySelector('#smart-copy').onclick = async () => {
        try { await navigator.clipboard.writeText(v); if (window.showToast) window.showToast('Copied.'); } catch (e) { /* no clipboard */ }
        el.remove();
    };
};
