// js/game-profile/card-share.js
// "Share to FutNet" for the team cards and the celebration cards: tick which images to send (all by default),
// then send them to the game's comments and/or the community feed (community games only).
// Comments: one message per image (the first one carries the caption), so the phones show them all too.
// Feed: one post with every image.
import { uploadMedia, showUploadProgress, hideUploadProgress, MEDIA_LABEL } from '../wa-chat.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m, t) => window.showToast && window.showToast(m, t);

/** Posts images to a game's comments: one message per image (the first one carries the caption). */
export async function postFilesToComments(eventId, files, caption) {
    if (!window.postGameComment) throw new Error('comments not loaded');
    try {
        for (let k = 0; k < files.length; k++) {
            const msg = `Sending image ${k + 1} of ${files.length}…`;
            showUploadProgress(msg, 0);
            const media = await uploadMedia(files[k], `comments/${eventId}`, (p) => showUploadProgress(msg, p));
            const ok = await window.postGameComment(eventId, k === 0 && caption ? caption : MEDIA_LABEL.image, media);
            if (!ok) throw new Error('comment failed');
        }
    } finally { hideUploadProgress(); }
}
/** Posts images to a community feed (one post with every image). */
export async function postFilesToFeed(communityId, files, caption) {
    if (!window.postToCommunityFeed) return false;
    return !!(await window.postToCommunityFeed(communityId, caption || '', files));
}
/** Posts images to a community's group chat (one message per image). */
export async function postFilesToChat(communityId, files, caption) {
    if (!window.postToCommunityChat) return false;
    return !!(await window.postToCommunityChat(communityId, caption || '', files));
}
export const canPostToChat = (communityId) => !!(communityId && window.postToCommunityChat && (window.myCommunityRoles || {})[communityId]);
export const canPostToFeed = (communityId) => !!(communityId && window.postToCommunityFeed && (window.myCommunityRoles || {})[communityId]);

/**
 * Puts the share box at the top of `host`.
 * items: [{ title, file }] (file can be null when the image couldn't be made)
 * opts: { eventId, communityId, caption, postComments(files, caption) (VS matches: their own comments) }
 */
export function mountShareBar(host, items, opts = {}) {
    const usable = items.map((it, i) => ({ ...it, i })).filter(it => it.file);
    if (!host || !usable.length || (!opts.eventId && !opts.communityId)) return;
    const canFeed = !!(opts.communityId && window.postToCommunityFeed && (window.myCommunityRoles || {})[opts.communityId]);
    const canComments = !!(opts.postComments || (opts.eventId && window.postGameComment));
    const canChat = canPostToChat(opts.communityId);
    if (!canFeed && !canComments && !canChat) return;
    const n = [canComments, canChat, canFeed].filter(Boolean).length;

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
        <div class="grid ${n === 3 ? 'grid-cols-3' : n === 2 ? 'grid-cols-2' : 'grid-cols-1'} gap-2 pt-1">
            ${canComments ? '<button data-to="comments" class="bg-[#00F296] text-slate-950 font-black py-2.5 px-1 rounded-xl text-xs"><i class="fa-solid fa-comments mr-1"></i> Game comments</button>' : ''}
            ${canChat ? '<button data-to="chat" class="bg-[#25D366] text-slate-950 font-black py-2.5 px-1 rounded-xl text-xs"><i class="fa-solid fa-message mr-1"></i> Community chat</button>' : ''}
            ${canFeed ? '<button data-to="feed" class="bg-gradient-to-r from-[#00F296] to-[#00B4AE] text-slate-950 font-black py-2.5 px-1 rounded-xl text-xs"><i class="fa-solid fa-users mr-1"></i> Community feed</button>' : ''}
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
            if (opts.postComments) await opts.postComments(chosen.map(c => c.file), opts.caption);
            else await postFilesToComments(opts.eventId, chosen.map(c => c.file), opts.caption);
            b.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Sent to the comments';
            toast(`Shared ${chosen.length} image${chosen.length === 1 ? '' : 's'} in the game comments.`);
        } catch (err) {
            console.error('share to comments', err);
            toast("Couldn't share to the comments. Try again.", 'error');
            b.disabled = false; b.innerHTML = label;
        }
    });

    box.querySelector('[data-to="chat"]')?.addEventListener('click', async (e) => {
        const chosen = picks();
        if (!chosen.length) { toast('Tick at least one image.', 'error'); return; }
        const b = e.currentTarget; b.disabled = true; const label = b.innerHTML;
        b.textContent = 'Sending…';
        const ok = await postFilesToChat(opts.communityId, chosen.map(c => c.file), opts.caption);
        if (ok) b.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Sent to chat';
        else { b.disabled = false; b.innerHTML = label; }
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
