// js/game-profile/comments-tab.js
import { mutateEvent, safeAvatar, escapeHtml } from './event-store.js';
import { renderWhatsApp, typingBubbleHtml, watchTyping, reportTyping, stopTyping, msOf, uploadMedia, showUploadProgress, hideUploadProgress, mediaErrorText, MEDIA_LABEL } from '../wa-chat.js';

export function renderCommentsTab(event) {
    const activeEvent = event || window.currentSelectedEvent || {};
    const comments = Array.isArray(activeEvent.comments) ? activeEvent.comments : [];
    const eventId = activeEvent.id || window.activeModalEventId || (window.currentSelectedEvent && window.currentSelectedEvent.id);
    const myUid = window.currentUser?.uid;
    watchCommentsTyping(eventId);

    const list = comments.map((c, i) => ({
        id: 'c' + i, uid: c.uid || c.userId || c.authorId || '', name: c.name || c.userName || 'Player',
        avatar: c.avatar || c.userAvatar, text: c.text || '', ms: msOf(c), time: c.timestamp, media: c.media
    }));
    const avatarOf = (uid, name, avatar) => window.resolvePlayerAvatar ? window.resolvePlayerAvatar({ uid, name, avatar }) : (avatar || '');

    // The page redraws when anything on the game changes: keep the half-typed message and the cursor.
    const prevInput = document.getElementById('game-comment-input');
    const hadFocus = !!prevInput && document.activeElement === prevInput;
    const draft = prevInput ? prevInput.value : (window._commentDraft || '');

    // Keep the view at the bottom (like WhatsApp) unless you scrolled up to read.
    setTimeout(() => {
        const box = document.getElementById('chat-messages-scroll');
        if (box && (window._commentsStickBottom !== false)) box.scrollTop = box.scrollHeight;
        const inp = document.getElementById('game-comment-input');
        if (inp && hadFocus) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }, 0);

    return `
        <div class="flex flex-col rounded-2xl overflow-hidden border border-white/10 shadow-inner">
            <div id="chat-messages-scroll" onscroll="window._commentsStickBottom = (this.scrollHeight - this.scrollTop - this.clientHeight < 120)"
                 class="wa-wall min-h-[300px] max-h-[55vh] overflow-y-auto py-2">
                ${list.length === 0
                    ? '<div class="text-center text-xs text-slate-400 py-16">No messages yet. Start the conversation! 👋</div>'
                    : renderWhatsApp(list, { myUid, group: true, ticks: false, avatarOf })}
                <div id="game-typing-bubble">${typingBubbleHtml(_commentsTyping.names)}</div>
            </div>
            <div class="bg-[#202C33] px-2 py-2 flex gap-2 items-center">
                <input type="file" id="game-comment-file" accept="image/*,video/*" class="hidden"
                    onchange="handleGameCommentFile('${escapeHtml(String(eventId))}', this)">
                <button type="button" onclick="document.getElementById('game-comment-file').click()" aria-label="Send a photo or video" title="Send a photo or video"
                    class="w-10 h-10 rounded-full text-[#8696A0] hover:text-white flex items-center justify-center shrink-0 text-lg">
                    <i class="fa-solid fa-paperclip"></i>
                </button>
                <input type="text" id="game-comment-input" autocomplete="off" value="${escapeHtml(draft)}"
                    oninput="window._commentDraft = this.value; handleGameCommentTyping('${escapeHtml(String(eventId))}')"
                    onkeydown="if(event.key === 'Enter') handleSendGameComment('${escapeHtml(String(eventId))}')"
                    placeholder="Message"
                    class="flex-1 bg-[#2A3942] rounded-full px-4 py-2.5 text-[#E9EDEF] text-base sm:text-sm placeholder:text-[#8696A0] focus:outline-none">
                <button type="button" onclick="handleSendGameComment('${escapeHtml(String(eventId))}')" aria-label="Send"
                    class="w-10 h-10 rounded-full bg-[#00A884] hover:bg-[#06CF9C] text-[#0B141A] flex items-center justify-center shrink-0">
                    <i class="fa-solid fa-paper-plane"></i>
                </button>
            </div>
        </div>
    `;
}

// "Diego is typing…" for this game's comments (kept running while the game is open).
const _commentsTyping = { eventId: null, unsub: null, names: [] };
function watchCommentsTyping(eventId) {
    if (!eventId || _commentsTyping.eventId === eventId) return;
    if (_commentsTyping.unsub) _commentsTyping.unsub();
    _commentsTyping.eventId = eventId;
    _commentsTyping.names = [];
    _commentsTyping.unsub = watchTyping('game:' + eventId, (names) => {
        _commentsTyping.names = names;
        const box = document.getElementById('game-typing-bubble');
        if (!box) return;
        const scroller = document.getElementById('chat-messages-scroll');
        const atBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
        box.innerHTML = typingBubbleHtml(names);
        if (atBottom && scroller) scroller.scrollTop = scroller.scrollHeight;
    });
}

// 💬 Send a comment. Only the comments list is changed, on top of the freshest copy of the game
// (the old version re-saved the whole game, which failed on big games and could undo other people's changes).
window.handleSendGameComment = async function(eventId) {
    const targetEventId = eventId || window.activeModalEventId || (window.currentSelectedEvent && window.currentSelectedEvent.id);
    const input = document.getElementById('game-comment-input');
    const messageText = input ? input.value.trim() : '';
    if (!messageText) { window.showToast("Please type a message first.", "error"); return; }
    if (!targetEventId) { window.showToast("Error: No active game found.", "error"); return; }
    if (input) input.value = '';
    window._commentDraft = '';
    const ok = await postComment(targetEventId, messageText, null);
    if (!ok && input) input.value = messageText;
};

// 📎 A photo or video was picked for the game's comments.
window.handleGameCommentFile = async function(eventId, picker) {
    const file = picker && picker.files && picker.files[0];
    if (picker) picker.value = '';
    const targetEventId = eventId || window.activeModalEventId;
    if (!file || !targetEventId) return;
    const kind = String(file.type).startsWith('video/') ? 'video' : 'image';
    const label = kind === 'video' ? 'Sending video…' : 'Sending photo…';
    const input = document.getElementById('game-comment-input');
    const caption = input ? input.value.trim() : '';
    try {
        showUploadProgress(label, 0);
        const media = await uploadMedia(file, `comments/${targetEventId}`, (p) => showUploadProgress(label, p));
        if (input) input.value = '';
        window._commentDraft = '';
        await postComment(targetEventId, caption || MEDIA_LABEL[kind], media);
    } catch (err) {
        console.error('comment media failed', err);
        window.showToast(mediaErrorText(err), 'error');
    } finally {
        hideUploadProgress();
    }
};

// Adds one comment. Only the comments list is changed, on top of the freshest copy of the game
// (the old version re-saved the whole game, which failed on big games and could undo other people's changes).
async function postComment(targetEventId, text, media) {
    const user = window.currentUser;
    if (!user || !user.uid) { window.showToast("Please sign in to comment.", "error"); return false; }
    const profile = window.userProfile || {};
    const senderName = profile.name || `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || user.displayName || 'Player';

    const newComment = {
        uid: String(user.uid),
        name: String(senderName),
        text: String(text).slice(0, 1000),
        timestamp: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        createdAt: Date.now()
    };
    if (media) newComment.media = media;
    const av = safeAvatar(profile.avatar || user.photoURL || '');   // web links only; photos come from the profile
    if (av) newComment.avatar = av;

    stopTyping('game:' + targetEventId);
    window._commentsStickBottom = true;
    const res = await mutateEvent(targetEventId, (draft) => {
        draft.comments = Array.isArray(draft.comments) ? draft.comments : [];
        draft.comments.push(newComment);
    });
    if (!res.ok) return false;

    if (typeof window.renderEventDetailModalContent === 'function') window.renderEventDetailModalContent();
    setTimeout(() => {
        const box = document.getElementById('chat-messages-scroll');
        if (box) box.scrollTop = box.scrollHeight;
    }, 50);
    return true;
}

// ⌨️ "is typing…": shared typing rooms (nothing is written to the game itself).
window.handleGameCommentTyping = function(eventId) {
    const id = eventId || window.activeModalEventId;
    if (id) reportTyping('game:' + id);
};