// js/notify.js: lets an organizer / community admin push a game to every FutNet user.
// Usage from any page:  window.notifyEveryoneAboutGame(eventId)
import { app } from './firebase-config.js';
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const functions = getFunctions(app, 'us-central1');
const notifyEveryone = httpsCallable(functions, 'notifyEveryone');

window.notifyEveryoneAboutGame = async function (eventId, message = '') {
    if (!window.currentUser) return;
    if (!confirm('Send a notification to everyone on FutNet about this game? You can do this once an hour.')) return;
    try {
        const res = await notifyEveryone({ eventId, message });
        window.showToast(`Sent to ${res.data.sent} players!`);
    } catch (e) {
        console.error('notifyEveryone failed:', e);
        window.showToast(e.message || 'Could not send the notification.', 'error');
    }
};