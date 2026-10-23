// js/game-profile/card-share.js
// "Share to FutNet" for the team cards and the celebration cards: tick which images to send (all by default),
// then send them to the game's comments and/or the community feed (community games only).
// Comments: one message per image (the first one carries the caption), so the phones show them all too.
// Feed: one post with every image.
import { uploadMedia, showUploadProgress, hideUploadProgress, MEDIA_LABEL } from '../wa-chat.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m, t) => window.showToast && window.showToast(m, t);

/**
 * Puts the share box at the top of `host`.
 * items: [{ title, file }] (file can be null when the image couldn't be made)
 * opts: { eventId, communityId, caption }
 */
export function mountShareBar(host, items, opts = {}) {
    const usable = items.map((it, i) => ({ ...it, i })).filter(it => it.file);
    if (!host || !usable.length || (!opts.eventId && !opts.communityId)) return;
    const canFeed = !!(opts.communityId && window.postToCommunityFeed && (window.myCommunityRoles || {})[opts.communityId]);
    const canComments = !!(opts.eventId && window.postGameComment);
    if (!canFeed && !canComments) return;

    const box = document.createElement('div');
    box.className = 'bg-black/40 border border-[#00F296]/40 rounded-2xl p-3 space-y-2';
    box.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="text-[11px] font-black uppercase tracking-wider text-[#00F296]">Share to FutNet</div>
            <label class="flex items-center gap-1.5 text-[11px] font-bold text-white/80 cursor-pointer"><input type="checkbox" data-all checked class="w-4 h-4 accent-[#00F296]"> All</label>
        </div>
        <div class="flex flex-wrap gap-2">${usable.map(it => `
            <label class="flex items-center gap-1.5 bg-black/50 border border-white/15 rounded-full px-2.5 py-1 text-[11px] font-bold text-white cursor-pointer">
                <input type="checkbox" data-pick="${it.i}" checked class="w-3.5 h-3.5 accent-[#00F296]"> ${esc(it.title)}</label>`).join('')}</div>
        <div class="grid ${canComments && canFeed ? 'grid-cols-2' : 'grid-cols-1'} gap-2 pt-1">
            ${canComments ? '<button data-to="comments" class="bg-[#00F296] text-slate-950 font-black py-2.5 rounded-xl text-xs"><i class="fa-solid fa-comments mr-1"></i> Share in game comments</button>' : ''}
            ${canFeed ? '<button data-to="feed" class="bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-2.5 rounded-xl text-xs"><i class="fa-solid fa-users mr-1"></i> Share in community feed</button>' : ''}
        </div>`;
    host.prepend(box);

    const picks = () => [...box.querySelectorAll('[data-pick]')].filter(c => c.checked).map(c => items[+c.dataset.pick]).filter(Boolean);
    box.querySelector('[data-all]').addEventListener('change', (e) => box.querySelectorAll('[data-pick]').forEach(c => { c.checked = e.target.checked; }));
    box.querySelectorAll('[data-pick]').forEach(c => c.addEventListener('change', () => {
        box.querySelector('[data-all]').checked = [...box.querySelectorAll('[data-pick]')].every(x => x.checked);
    }));

    box.querySelector('[data-to="comments"]')?.addEventListener('click', async (e) => {
        const chosen = picks();
        if (!chosen.length) { toast('Tick at least one image.', 'error'); return; }
        const b = e.currentTarget; b.disabled = true; const label = b.innerHTML;
        try {
            for (let k = 0; k < chosen.length; k++) {
                const msg = `Sending image ${k + 1} of ${chosen.length}…`;
                showUploadProgress(msg, 0);
                const media = await uploadMedia(chosen[k].file, `comments/${opts.eventId}`, (p) => showUploadProgress(msg, p));
                const ok = await window.postGameComment(opts.eventId, k === 0 && opts.caption ? opts.caption : MEDIA_LABEL.image, media);
                if (!ok) throw new Error('comment failed');
            }
            b.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Sent to the comments';
            toast(`Shared ${chosen.length} image${chosen.length === 1 ? '' : 's'} in the game comments.`);
        } catch (err) {
            console.error('share to comments', err);
            toast("Couldn't share to the comments. Try again.", 'error');
            b.disabled = false; b.innerHTML = label;
        } finally { hideUploadProgress(); }
    });

    box.querySelector('[data-to="feed"]')?.addEventListener('click', async (e) => {
        const chosen = picks();
        if (!chosen.length) { toast('Tick at least one image.', 'error'); return; }
        const b = e.currentTarget; b.disabled = true; const label = b.innerHTML;
        b.textContent = 'Posting…';
        const ok = await window.postToCommunityFeed(opts.communityId, opts.caption || '', chosen.map(c => c.file));
        if (ok) b.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Posted to the feed';
        else { b.disabled = false; b.innerHTML = label; }
    });
}
