// js/people.js: everyone's name, photo, position... for lists, search and rosters.
// Reads the light "people" list (a copy of each player card WITHOUT the private chats), which is
// much smaller than the full directory. Until the server has built that list (meta/people says so),
// it reads the directory like before, so nothing is ever missing.
// Starts by itself when someone signs in and reconnects after a connection error.
import { db, appId, auth } from './firebase-config.js';
import { collection, doc, getDoc, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const col = (name) => collection(db, 'artifacts', appId, name);
let unsub = null;
let mode = '';            // 'people' or 'directory'
let waiters = [];
let askedBuild = false;
let startedFor = null;

const toList = (snap) => snap.docs.map(d => { const x = d.data(); if (!x.uid) x.uid = d.id; return x; });

function publish(list) {
    window.directoryList = list;
    window.cachedDirectoryList = list;
    const w = waiters; waiters = [];
    w.forEach(r => r(list));
    try { window.dispatchEvent(new CustomEvent('futnet-people')); } catch (e) { /* old browser */ }
}

function stop() { if (unsub) { try { unsub(); } catch (e) { /* gone */ } } unsub = null; }

function listen(name) {
    stop();
    mode = name;
    let gotData = false;
    unsub = onSnapshot(col(name), (snap) => {
        gotData = true;
        publish(toList(snap));
    }, () => {
        unsub = null;
        // The light list can't be read (yet): use the full directory like before.
        if (name === 'people' && !gotData) { listen('directory'); return; }
        // Firestore stops a listener after an error and never restarts it: try again shortly.
        setTimeout(() => { if (window.currentUser && !unsub && mode === name) listen(name); }, 4000);
    });
}

/** The owner's account builds the light list the first time (other accounts aren't allowed to). */
async function askBuild() {
    if (askedBuild) return;
    askedBuild = true;
    try {
        await httpsCallable(getFunctions(auth.app, 'us-central1'), 'buildPeopleList', { timeout: 540000 })({});
        listen('people');
    } catch (e) { /* not the owner: keep using the directory */ }
}

async function start() {
    let built = false;
    try { built = !!((await getDoc(doc(db, 'artifacts', appId, 'meta', 'people'))).data() || {}).builtAt; } catch (e) { built = false; }
    if (built) listen('people');
    else { listen('directory'); askBuild(); }
}

// Old name, used by other files.
window.initDirectoryLiveListener = function () { if (window.currentUser) start(); };

/** Everyone (from memory when loaded). Waits a few seconds for the first load, then reads once. */
window.getPeopleList = async function () {
    if (Array.isArray(window.directoryList) && window.directoryList.length) return window.directoryList;
    const list = await Promise.race([
        new Promise(r => waiters.push(r)),
        new Promise(r => setTimeout(() => r(null), 6000)),
    ]);
    if (list && list.length) return list;
    try { return toList(await getDocs(col(mode === 'people' ? 'people' : 'directory'))); } catch (e) { return []; }
};

// Start (or restart for another account) as soon as someone is signed in.
setInterval(() => {
    const uid = window.currentUser?.uid || null;
    if (uid === startedFor) return;
    startedFor = uid;
    if (uid) start();
    else { stop(); window.directoryList = []; window.cachedDirectoryList = null; }
}, 700);
