// FutNet Cloud Functions: every push notification goes through ONE sender
// (sendChatNotification). Everything else just writes a notification record to
// artifacts/{appId}/notifications and the sender pushes it to the person's phones.
//
// Because the triggers below watch the database itself, notifications work no matter
// whether the action happened on the website or in the iOS app.

const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ maxInstances: 20 });

const db = admin.firestore();
const APP_ID = "futnetsite-de7c3";
const BASE = `artifacts/${APP_ID}`;
const col = (name) => db.collection("artifacts").doc(APP_ID).collection(name);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const uidOf = (p) => (p && (p.uid || p.userId || p.id)) || "";
const arr = (v) => (Array.isArray(v) ? v : []);
const uniq = (list) => [...new Set(list.filter(Boolean))];
const clip = (s, n = 140) => {
  const t = String(s || "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const tenMinuteBucket = () => Math.floor(Date.now() / 600000);

const nameCache = new Map();
async function nameOf(uid) {
  if (!uid) return "Someone";
  if (nameCache.has(uid)) return nameCache.get(uid);
  let name = "Someone";
  try {
    const d = (await col("directory").doc(uid).get()).data() || {};
    name = (d.name || `${d.firstName || ""} ${d.lastName || ""}`.trim() || d.nickname || "Someone").trim();
  } catch (e) {
    logger.warn("name lookup failed", uid, e.message);
  }
  nameCache.set(uid, name);
  return name;
}

/** People on the game: confirmed + waitlist. */
function participants(game) {
  return uniq([...arr(game.attendees), ...arr(game.waitingList)].map(uidOf));
}

/** Members of a community, including its creator/admin. */
async function communityMembers(communityId) {
  if (!communityId) return { all: [], admins: [], community: {} };
  const ref = col("communities").doc(communityId);
  const [cSnap, mSnap] = await Promise.all([ref.get(), ref.collection("members").get()]);
  const community = cSnap.data() || {};
  const owner = community.creatorId || community.adminId || "";
  const all = uniq([owner, ...mSnap.docs.map((d) => d.id)]);
  const admins = uniq([owner, ...mSnap.docs.filter((d) => (d.data() || {}).role === "admin").map((d) => d.id)]);
  return { all, admins, community };
}

/**
 * Who runs a game: its organizer, plus (community games) the community's creator and every admin.
 * The creator always gets every game alert, even when another admin made the game.
 */
async function gameBosses(game) {
  const out = [game && game.organizerId];
  if (game && game.communityId) {
    try { const { admins } = await communityMembers(game.communityId); out.push(...admins); } catch (e) { /* organizer only */ }
  }
  return uniq(out);
}

/**
 * Writes one notification record per recipient. The sender function pushes each one.
 * `key` makes the record id stable, so the same event never pushes twice
 * (writing to an existing id is an update, which does not trigger a push).
 */
async function notify(recipients, payload, { exclude = [], key = "" } = {}) {
  const skip = new Set(exclude.filter(Boolean));
  const targets = uniq(recipients).filter((u) => !skip.has(u));
  if (!targets.length) return 0;

  for (let i = 0; i < targets.length; i += 400) {
    const batch = db.batch();
    for (const uid of targets.slice(i, i + 400)) {
      const ref = key ? col("notifications").doc(`${key}_${uid}`.slice(0, 1400)) : col("notifications").doc();
      batch.set(ref, {
        recipientUid: uid,
        senderUid: payload.senderUid || "",
        type: payload.type || "general",
        title: payload.title || "FutNet",
        body: payload.body || "",
        eventId: payload.eventId || "",
        communityId: payload.communityId || "",
        chatId: payload.chatId || "",
        sound: payload.sound || "",
        read: false,
        source: "server",
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  return targets.length;
}

/** Which on/off switch in the user's settings a notification type belongs to. */
function categoryOf(type) {
  if (type.startsWith("chat")) return "chat";
  if (type.startsWith("friend")) return "friends";
  if (type.startsWith("community")) return "community";
  if (type === "broadcast") return "invites";
  return "games";
}

// ---------------------------------------------------------------------------
// 1. The sender: pushes every notification record to the recipient's phones
//    (kept under its original name so the deploy updates it in place)
// ---------------------------------------------------------------------------

exports.sendChatNotification = onDocumentCreated(`${BASE}/notifications/{notificationId}`, async (event) => {
  const snap = event.data;
  if (!snap) return;
  const n = snap.data();
  const type = n.type || "general";

  // Chats and friend requests are now detected on the server, so the copies the
  // website/app used to write are removed instead of pushed twice.
  if (n.source !== "server" && (type === "chat_message" || type === "friend_request")) {
    await snap.ref.delete();
    return;
  }

  const recipientUid = n.recipientUid;
  if (!recipientUid) return;

  const dirRef = col("directory").doc(recipientUid);
  const dir = (await dirRef.get()).data();
  if (!dir) {
    logger.info("No directory profile for", recipientUid);
    return;
  }

  // The person turned this kind of notification off: keep it in the in-app list, no push.
  const prefs = dir.notificationPrefs || {};
  if (prefs[categoryOf(type)] === false) {
    await snap.ref.update({ muted: true });
    return;
  }

  // One person can be signed in on several phones.
  let tokens = uniq([dir.fcmToken, dir.fcmToke, ...arr(dir.fcmTokens)]);

  // A phone that is also signed in as the person who did the action (for example a test
  // account used on the same phone) never gets a push about its own action.
  if (n.senderUid && n.senderUid !== recipientUid) {
    const sender = (await col("directory").doc(n.senderUid).get()).data() || {};
    const senderTokens = new Set(uniq([sender.fcmToken, sender.fcmToke, ...arr(sender.fcmTokens)]));
    tokens = tokens.filter((t) => !senderTokens.has(t));
  }
  if (!tokens.length) {
    logger.info("No FCM token for", recipientUid);
    return;
  }

  const data = {
    type,
    notificationId: snap.id,
    senderUid: n.senderUid || "",
    eventId: n.eventId || "",
    communityId: n.communityId || "",
    chatId: n.chatId || "",
    sound: n.sound || "",
  };
  // Money in: custom "cha-ching" sound (the file ships inside the apps; falls back to the normal sound).
  const special = n.sound === "cha_ching";

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: n.title || "FutNet", body: n.body || "" },
    data,
    android: special ? { notification: { channelId: "futnet_money", sound: "cha_ching" } } : undefined,
    apns: {
      payload: {
        aps: {
          sound: special ? "cha_ching.wav" : "default",
          // Groups notifications on the lock screen (one stack per chat / per game).
          "thread-id": n.chatId || n.eventId || n.communityId || type,
        },
      },
    },
  });

  // Forget phones that uninstalled the app or signed out.
  const dead = [];
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
      dead.push(tokens[i]);
    } else if (r.error) {
      logger.error("Push failed", recipientUid, code, r.error.message);
    }
  });
  if (dead.length) {
    const update = { fcmTokens: admin.firestore.FieldValue.arrayRemove(...dead) };
    if (dead.includes(dir.fcmToken)) update.fcmToken = admin.firestore.FieldValue.delete();
    await dirRef.update(update);
  }

  await snap.ref.update({
    sent: res.successCount > 0,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  logger.info(`Pushed ${type} to ${recipientUid}: ${res.successCount}/${tokens.length} devices`);
});

// ---------------------------------------------------------------------------
// 2. Chat messages (website and app both save chats on the directory profile)
// ---------------------------------------------------------------------------

exports.onChatMessage = onDocumentWritten(`${BASE}/directory/{uid}`, async (event) => {
  if (!event.data.after.exists) return;
  const owner = event.params.uid;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.data() || {};
  if (!Array.isArray(after.chats)) return;

  // Works for someone's very first chat too (no chats saved before).
  // Old history is never pushed thanks to the 10-minute check below.
  const seen = new Set();
  for (const t of arr(before.chats)) for (const m of arr(t.messages)) if (m && m.id) seen.add(m.id);

  for (const thread of after.chats) {
    const fresh = arr(thread.messages).filter((m) => m && m.id && !seen.has(m.id) && m.senderUid && m.senderUid !== owner);
    if (!fresh.length) continue;

    // Message ids look like "msg_<milliseconds>_xxx": ignore anything older than 10 minutes.
    const last = fresh[fresh.length - 1];
    const ms = Number(String(last.id).split("_")[1]);
    if (ms && Date.now() - ms > 10 * 60 * 1000) continue;

    const from = last.senderUid;
    await notify([owner], {
      type: "chat_message",
      senderUid: from,
      chatId: from,
      title: last.sender || thread.name || (await nameOf(from)),
      body: fresh.length > 1 ? `${fresh.length} new messages` : clip(last.text),
    }, { key: `chat_${last.id}` });
  }
});

// ---------------------------------------------------------------------------
// 3. Friend requests sent and accepted
// ---------------------------------------------------------------------------

// Website: users/{uid}/relationships/data holds friends / sentRequests / receivedRequests
exports.onFriendsChanged = onDocumentWritten(`${BASE}/users/{uid}/relationships/{docId}`, async (event) => {
  if (event.params.docId !== "data" || !event.data.after.exists) return;
  const me = event.params.uid;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.data() || {};

  // Someone sent me a request
  const oldReceived = new Set(arr(before.receivedRequests));
  for (const from of arr(after.receivedRequests).filter((u) => !oldReceived.has(u))) {
    await notify([me], {
      type: "friend_request",
      senderUid: from,
      title: "New Friend Request",
      body: `${await nameOf(from)} sent you a friend request on FutNet!`,
    }, { key: `friendreq_${from}` });
  }

  // Someone accepted the request I sent
  const oldFriends = new Set(arr(before.friends).map(uidOf));
  const iSentTo = new Set(arr(before.sentRequests));
  for (const f of arr(after.friends).map(uidOf).filter((u) => u && !oldFriends.has(u) && iSentTo.has(u))) {
    await notify([me], {
      type: "friend_accepted",
      senderUid: f,
      title: "Friend request accepted 🤝",
      body: `${await nameOf(f)} accepted your friend request.`,
    }, { key: `friendacc_${f}` });
  }
});

// iOS roster sheet writes to friendRequests (see note in the chat about syncing this with the website)
exports.onFriendRequestDoc = onDocumentWritten(`${BASE}/friendRequests/{id}`, async (event) => {
  if (!event.data.after.exists) return;
  const before = event.data.before.exists ? event.data.before.data() : null;
  const r = event.data.after.data() || {};
  if (!before && r.status !== "accepted") {
    await notify([r.receiverId], {
      type: "friend_request",
      senderUid: r.senderId,
      title: "New Friend Request",
      body: `${await nameOf(r.senderId)} sent you a friend request on FutNet!`,
    }, { key: `friendreq_${r.senderId}` });
  } else if (before && before.status !== "accepted" && r.status === "accepted") {
    await notify([r.senderId], {
      type: "friend_accepted",
      senderUid: r.receiverId,
      title: "Friend request accepted 🤝",
      body: `${await nameOf(r.receiverId)} accepted your friend request.`,
    }, { key: `friendacc_${r.receiverId}` });
  }
});

// ---------------------------------------------------------------------------
// 4. Games: new community game, joins, edits, cancels, comments, teams, End Event
// ---------------------------------------------------------------------------

const EDIT_FIELDS = ["title", "date", "time", "location", "format", "teamsCount", "fee", "description", "rules"];

function teamMap(game) {
  // uid -> team index, from the website's teamAssignments { "0": [{uid, ...}], ... }
  const out = {};
  const ta = game.teamAssignments || {};
  for (const [idx, list] of Object.entries(ta)) {
    for (const p of arr(list)) {
      if (p && !p.isHostGuest && uidOf(p)) out[uidOf(p)] = idx;
    }
  }
  return out;
}

function teamName(game, idx) {
  const names = game.teamNames || {};
  return names[idx] || (Array.isArray(names) && names[Number(idx)]) || `Team ${Number(idx) + 1}`;
}

const commentAuthor = (c) => (c && (c.uid || c.userId || c.authorId || c.authorUid || c.senderUid || c.senderId || c.createdBy || c.ownerId || c.userUid)) || "";
const commentText = (c) => (c && (c.text || c.comment || c.message || c.body)) || "";
const commentName = (c) => (c && (c.name || c.authorName || c.author || c.senderName)) || "";

async function notifyGameCancelled(game, eventId) {
  await notify(participants(game), {
    type: "game_cancelled",
    senderUid: game.organizerId,
    eventId,
    title: (game.gameStatus && game.gameStatus.cancelReason === "storm") ? "Game cancelled due to storm ⛈️" : "Game cancelled ❌",
    body: ((game.gameStatus && game.gameStatus.cancelReason === "storm")
      ? `${game.title || "Your game"} on ${game.date || ""} ${game.time || ""} was cancelled because of the weather. Stay safe!`
      : `${game.title || "Your game"} on ${game.date || ""} ${game.time || ""} was cancelled by the organizer.`).replace(/\s+/g, " "),
  }, { exclude: [game.organizerId], key: `cancel_${eventId}` });
}

exports.onGameWritten = onDocumentWritten(`${BASE}/eventsList/{eventId}`, async (event) => {
  const eventId = event.params.eventId;
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const organizer = (after || before || {}).organizerId || "";

  // New game, or its day / time / place changed: get the kickoff forecast right away (then every 3 hours).
  if (after && (!before || ["date", "time", "location"].some((f) => (before[f] || "") !== (after[f] || "")))) {
    try {
      const moved = before && (before.location || "") !== (after.location || "");
      const f = await forecastFor(moved ? { ...after, geo: null } : after);
      if (f) await event.data.after.ref.update({ weather: f.weather, geo: f.geo });
      else if (before && after.weather) await event.data.after.ref.update({ weather: FV.delete() });   // too far ahead for a forecast
    } catch (e) { logger.warn("weather on save failed", eventId, e.message); }
  }

  // A finished game was saved (ended, results fixed, attendance marked...): rebuild its players' saved stats.
  if ((before && before.isSessionEnded === true) || (after && after.isSessionEnded === true)) {
    const keyOf = (g) => g ? JSON.stringify([g.isSessionEnded === true, g.matches || [], g.teamAssignments || {}, g.teamNames || {},
      arr(g.attendees).map((a) => [uidOf(a), a.attendance || "", a.name || ""]), g.communityId || "", g.date || ""]) : "";
    if (keyOf(before) !== keyOf(after)) {
      const g = after || before;
      const uids = new Set([...arr((before || {}).attendees), ...arr(g.attendees)].map(uidOf));
      for (let i = 0; i < teamCount(g); i++) teamPlayers(g, i).forEach((p) => uids.add(uidOf(p)));
      try { await refreshStatsFor([...uids], [(before || {}).communityId, g.communityId]); } catch (e) { logger.warn("stats refresh failed", eventId, e.message); }
    }
  }

  // Late cancel (less than 2 hours before kickoff): saved for the attendance stars (2 points instead of 5).
  // Cancelling earlier is fair notice and isn't recorded. Removed by the organizer doesn't count either.
  if (before && after && after.isSessionEnded !== true) {
    const stillIn = new Set(arr(after.attendees).map(uidOf));
    const declined = new Map(arr(after.declinedList).map((d) => [uidOf(d), d]));
    const left = uniq(arr(before.attendees).map(uidOf)).filter((u) => u && !stillIn.has(u) && isRealPlayer(u));
    const start = left.length ? startOf(after) : null;
    if (start) {
      const hoursBefore = (start - Date.now()) / 3600000;
      for (const u of left) {
        const d = declined.get(u);
        if (!d || d.removedByAdmin === true || hoursBefore >= 2 || hoursBefore < -6) continue;
        try {
          await col("cancellations").doc(`${eventId}_${u}`).set({
            uid: u, eventId, communityId: after.communityId || "", date: String(after.date || "").slice(0, 10),
            hoursBefore: Math.round(hoursBefore * 10) / 10, at: Date.now(),
          });
        } catch (e) { logger.warn("cancel log", eventId, u, e.message); }
      }
    }
  }

  // New game: tell the community it belongs to
  if (!before && after) {
    if (after.communityId) {
      const { all, community } = await communityMembers(after.communityId);
      const cName = after.communityName || community.name || "your community";
      await notify(all, {
        type: "community_new_game",
        senderUid: organizer,
        eventId,
        communityId: after.communityId,
        title: `New game in ${cName} ⚽`,
        body: `${after.title || "Pick-up game"} · ${after.date || ""} at ${after.time || ""}. Tap to join!`,
      }, { exclude: [organizer], key: `newgame_${eventId}` });
    }
    return;
  }

  // Game deleted
  if (before && !after) {
    await notifyGameCancelled(before, eventId);
    return;
  }

  // Game marked cancelled instead of deleted
  const wasCancelled = (g) => g.isCancelled === true || String(g.status || "").toLowerCase() === "cancelled";
  if (!wasCancelled(before) && wasCancelled(after)) {
    await notifyGameCancelled(after, eventId);
    return;
  }

  const title = after.title || "your game";

  // a) New players on the roster -> tell the organizer
  const beforeIn = new Set(arr(before.attendees).map(uidOf));
  const joined = arr(after.attendees).map(uidOf).filter((u) => u && !beforeIn.has(u) && u !== organizer);
  if (joined.length) {
    const first = await nameOf(joined[0]);
    await notify(await gameBosses(after), {
      type: "game_join",
      senderUid: joined[0],
      eventId,
      title: "New player joined 🙌",
      body: joined.length === 1 ? `${first} joined ${title}.` : `${first} and ${joined.length - 1} more joined ${title}.`,
    }, { exclude: joined, key: `join_${eventId}_${joined.sort().join("_")}` });
  }

  // a2) Players who cancelled (left on their own, not removed by the organizer) -> tell the organizer
  const afterIn = new Set(arr(after.attendees).map(uidOf));
  const declinedNow = new Map(arr(after.declinedList).map((d) => [uidOf(d), d]));
  const cancelled = [...beforeIn].filter((u) => u && !afterIn.has(u) && u !== organizer
    && declinedNow.has(u) && declinedNow.get(u).removedByAdmin !== true);
  if (cancelled.length && after.isSessionEnded !== true) {
    const start = startOf(after);
    const hours = start ? (start - Date.now()) / 3600000 : 99;
    const when = hours < 0 ? " (cancelled after kickoff)" : hours < 2 ? ` (cancelled ${Math.max(1, Math.round(hours * 60))} min before kickoff: late cancel)` : "";
    const first = await nameOf(cancelled[0]);
    const spots = arr(after.waitingList).length ? " The waitlist was told about the open spot." : "";
    await notify(await gameBosses(after), {
      type: "game_player_cancelled",
      senderUid: cancelled[0],
      eventId,
      title: hours < 2 ? "Late cancel ⚠️" : "Player cancelled",
      body: (cancelled.length === 1 ? `${first} can't make it to ${title}${when}.` : `${first} and ${cancelled.length - 1} more cancelled ${title}${when}.`) + spots,
    }, { exclude: cancelled, key: `left_${eventId}_${cancelled.sort().join("_")}_${Math.floor(Date.now() / 60000)}` });
  }

  // b) Non-members asking to join a community game -> tell the organizer
  const beforeReq = new Set(arr(before.joinRequests).map(uidOf));
  const bosses = await gameBosses(after);
  for (const r of arr(after.joinRequests).filter((x) => uidOf(x) && !beforeReq.has(uidOf(x)))) {
    await notify(bosses, {
      type: "game_join_request",
      senderUid: uidOf(r),
      eventId,
      title: "Join request",
      body: `${r.name || (await nameOf(uidOf(r)))} wants to join ${title}.`,
    }, { key: `gamereq_${eventId}_${uidOf(r)}` });
  }

  // c) Organizer edited the game details -> tell everyone on it
  const changed = EDIT_FIELDS.filter((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null));
  if (changed.length) {
    const whenWhere = ["date", "time", "location"].some((f) => changed.includes(f));
    await notify(participants(after), {
      type: "game_updated",
      senderUid: organizer,
      eventId,
      title: `${title} was updated ✏️`,
      body: whenWhere
        ? `Now ${after.date || ""} at ${after.time || ""} · ${after.location || ""}`.replace(/\s+/g, " ")
        : "The organizer changed the game details. Tap to see what's new.",
    }, { exclude: [organizer], key: `edit_${eventId}_${tenMinuteBucket()}` });
  }

  // d) New comments saved on the game itself
  const oldCount = arr(before.comments).length;
  const newComments = arr(after.comments).slice(oldCount);
  for (const c of newComments) {
    const author = commentAuthor(c);
    await notify(uniq([...participants(after), organizer]), {
      type: "game_comment",
      senderUid: author,
      eventId,
      title: `${commentName(c) || (await nameOf(author))} commented on ${title}`,
      body: clip(commentText(c)),
    }, { exclude: [author] });
  }

  // e) Teams: tell each player when they are put on (or moved to) a team
  const oldTeams = teamMap(before);
  const newTeams = teamMap(after);
  for (const [uid, idx] of Object.entries(newTeams)) {
    if (oldTeams[uid] === idx) continue;
    await notify([uid], {
      type: "team_assigned",
      senderUid: organizer,
      eventId,
      title: after.capsDraft && after.capsDraft.status === "live" ? "You've been picked! 🧢" : "You've been assigned to a team 👕",
      body: `You're on ${teamName(after, idx)} for ${title}.`,
    }, { key: `team_${eventId}_${uid}_${idx}` });
  }

  // e1) Admin asked "who wants to be captain?": tell everyone going.
  if (after.captainCall && after.captainCall.open && (!before.captainCall || before.captainCall.at !== after.captainCall.at)) {
    await notify(arr(after.attendees).map(uidOf), {
      type: "caps_volunteer",
      senderUid: after.captainCall.by || organizer,
      eventId,
      title: "Who wants to be captain? 🧢",
      body: `Captains will pick the teams for ${title}. Open the game and tap "Yes, me!" if you want to be one.`,
    }, { exclude: [after.captainCall.by], key: `caps_call_${eventId}_${after.captainCall.at}` });
  }

  // e2) Caps mode (captains draft): tell the captains, tell whoever is on the clock, and when a picked
  //     player cancels, that team gets the next pick (then the normal order goes on).
  try { await capsDraftUpdates(eventId, before, after, title, organizer); } catch (e) { logger.warn("caps draft", eventId, e.message); }

  // f) Admin tapped End Event -> results are ready
  if (!before.isSessionEnded && after.isSessionEnded === true) {
    await notify(uniq([...participants(after), organizer]), {
      type: "session_results",
      senderUid: organizer,
      eventId,
      title: "Session over 🏁",
      body: `Final results for ${title} are in. See who won!`,
    }, { key: `results_${eventId}` });
  }

  // g) Storm watch: turned on/off, or the status changed (Game on / likely / not likely) -> tell everyone on it
  const gs = (g) => (g && g.gameStatus) || {};
  const watchOn = (g) => gs(g).stormWatch === true;
  const stState = (g) => gs(g).state || "on";
  const stNote = (g) => String(gs(g).note || "").trim();
  const changedWatch = watchOn(before) !== watchOn(after);
  const changedState = watchOn(after) && (stState(before) !== stState(after) || stNote(before) !== stNote(after));
  if (changedWatch || changedState) {
    const label = { on: "Game on ✅", likely: "Game likely 🟡", unlikely: "Game not likely 🔴" }[stState(after)] || "Game on ✅";
    const by = gs(after).by || organizer;
    let head; let body;
    if (changedWatch && !watchOn(after)) {
      head = `Storm watch over for ${title} ☀️`;
      body = "The game is going ahead as planned.";
    } else {
      head = changedWatch ? `Storm watch for ${title} ⛈️` : `${title}: ${label}`;
      body = stNote(after) || (changedWatch ? `Bad weather is possible. Status: ${label}. We'll keep you posted.` : `Storm watch update: ${label}.`);
    }
    await notify(uniq([...participants(after), organizer]), {
      type: "game_status",
      senderUid: by,
      eventId,
      title: head,
      body,
    }, { exclude: [by], key: `status_${eventId}_${watchOn(after) ? stState(after) : "off"}_${tenMinuteBucket()}` });
  }
});

// Comments saved in a sub-collection (if the app stores them that way)
exports.onGameCommentDoc = onDocumentCreated(`${BASE}/eventsList/{eventId}/comments/{commentId}`, async (event) => {
  const c = event.data && event.data.data();
  if (!c) return;
  const eventId = event.params.eventId;
  const game = (await col("eventsList").doc(eventId).get()).data();
  if (!game) return;
  const author = commentAuthor(c);
  await notify(uniq([...participants(game), game.organizerId]), {
    type: "game_comment",
    senderUid: author,
    eventId,
    title: `${commentName(c) || (await nameOf(author))} commented on ${game.title || "your game"}`,
    body: clip(commentText(c)),
  }, { exclude: [author], key: `comment_${event.params.commentId}` });
});

// ---------------------------------------------------------------------------
// 5. Communities: info changed, new member
// ---------------------------------------------------------------------------

const COMMUNITY_FIELDS = ["name", "description", "city", "thumbnail", "rules"];

exports.onCommunityUpdated = onDocumentUpdated(`${BASE}/communities/{communityId}`, async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  const changed = COMMUNITY_FIELDS.filter((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null));
  if (!changed.length) return;
  const communityId = event.params.communityId;
  const owner = after.creatorId || after.adminId || "";
  const { all } = await communityMembers(communityId);
  const what = changed.includes("thumbnail") && changed.length === 1 ? "a new photo" : "updated info";
  await notify(all, {
    type: "community_updated",
    senderUid: owner,
    communityId,
    title: `${after.name || "Your community"} has ${what}`,
    body: "Tap to see what changed.",
  }, { exclude: [owner], key: `commupd_${communityId}_${tenMinuteBucket()}` });
});

exports.onCommunityMemberAdded = onDocumentCreated(`${BASE}/communities/{communityId}/members/{uid}`, async (event) => {
  const communityId = event.params.communityId;
  const uid = event.params.uid;
  const member = (event.data && event.data.data()) || {};
  const { admins, community } = await communityMembers(communityId);
  const cName = community.name || "your community";

  // Tell the admins
  await notify(admins, {
    type: "community_new_member",
    senderUid: uid,
    communityId,
    title: "New member 🎉",
    body: `${member.name || (await nameOf(uid))} joined ${cName}.`,
  }, { exclude: [uid, member.approvedBy], key: `newmember_${communityId}_${uid}` });   // not the admin who approved them

  // Tell the person, when an admin approved their request
  if (member.approvedBy || member.approvedAt || member.status === "approved" || member.viaRequest === true) {
    await notify([uid], {
      type: "community_request_accepted",
      senderUid: member.approvedBy || community.creatorId || "",
      communityId,
      title: "You're in! ✅",
      body: `Your request to join ${cName} was accepted.`,
    }, { key: `commaccepted_${communityId}` });
  }
});

// ---------------------------------------------------------------------------
// Sign-in hint: after a wrong email + password, tell the login screen if this email signed up with
// Google or Apple (and never set a password), so it can say "Continue with Google" instead of
// "wrong password". It only ever answers "google", "apple" or nothing: it never says whether an
// email + password account exists.
// ---------------------------------------------------------------------------

const hintCalls = new Map();   // per server instance: ip -> recent call times (simple abuse limit)
exports.signInHint = onCall(async (request) => {
  const ip = String((request.rawRequest && (request.rawRequest.headers["x-forwarded-for"] || request.rawRequest.ip)) || "?").split(",")[0].trim();
  const now = Date.now();
  const recent = (hintCalls.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= 20) return { provider: "" };
  recent.push(now);
  hintCalls.set(ip, recent);
  if (hintCalls.size > 5000) hintCalls.clear();

  const email = String((request.data && request.data.email) || "").trim().toLowerCase();
  if (!email || email.length > 200 || !email.includes("@")) return { provider: "" };
  try {
    const user = await admin.auth().getUserByEmail(email);
    const ids = (user.providerData || []).map((p) => p.providerId);
    if (ids.includes("password")) return { provider: "" };
    if (ids.includes("google.com")) return { provider: "google" };
    if (ids.includes("apple.com")) return { provider: "apple" };
    return { provider: "" };
  } catch (e) {
    return { provider: "" };   // no account, or anything else: say nothing
  }
});

// ---------------------------------------------------------------------------
// 6. Admin "Notify everyone" about a game (called from the website or the app)
// ---------------------------------------------------------------------------

exports.notifyEveryone = onCall(async (request) => {
  const caller = request.auth && request.auth.uid;
  if (!caller) throw new HttpsError("unauthenticated", "Please sign in.");

  const eventId = String((request.data && request.data.eventId) || "");
  const message = clip((request.data && request.data.message) || "", 160);
  if (!eventId) throw new HttpsError("invalid-argument", "Missing game.");

  const gameRef = col("eventsList").doc(eventId);
  const game = (await gameRef.get()).data();
  if (!game) throw new HttpsError("not-found", "This game no longer exists.");

  // Only the organizer or an admin of the game's community may do this.
  let allowed = game.organizerId === caller;
  if (!allowed && game.communityId) {
    const { admins } = await communityMembers(game.communityId);
    allowed = admins.includes(caller);
  }
  if (!allowed) throw new HttpsError("permission-denied", "Only the organizer or a community admin can do this.");

  // At most once an hour per game, so nobody gets spammed.
  const last = game.lastBroadcastAt && game.lastBroadcastAt.toMillis ? game.lastBroadcastAt.toMillis() : 0;
  if (Date.now() - last < 60 * 60 * 1000) {
    throw new HttpsError("resource-exhausted", "You already notified everyone about this game in the last hour.");
  }

  // Everyone for now (people already on the game are skipped).
  const everyone = (await col("directory").select().get()).docs.map((d) => d.id);
  const sent = await notify(everyone, {
    type: "broadcast",
    senderUid: caller,
    eventId,
    communityId: game.communityId || "",
    title: `Players needed: ${game.title || "pick-up game"} ⚽`,
    body: message || `${game.date || ""} at ${game.time || ""} · ${game.location || ""}. Tap to join!`.replace(/\s+/g, " "),
  }, { exclude: [caller, ...participants(game)], key: `broadcast_${eventId}_${tenMinuteBucket()}` });

  await gameRef.update({ lastBroadcastAt: admin.firestore.FieldValue.serverTimestamp() });
  return { sent };
});

// ---------------------------------------------------------------------------
// 7. Community feed: new posts (tailored to the kind of post) and comments
// ---------------------------------------------------------------------------

/** The message line, tailored to the kind of post. */
function describePost(p) {
  if (p.poll && p.poll.question) return `📊 Poll: ${clip(p.poll.question, 100)}`;
  if (p.media && p.media.type === "video") return p.text ? `🎥 ${clip(p.text, 100)}` : "🎥 Shared a video";
  const n = arr(p.mediaList).length;
  if (n > 1) return p.text ? `📸 ${clip(p.text, 100)}` : `📸 Shared ${n} photos`;
  if (p.mediaUrl || (p.media && p.media.url)) return p.text ? `📸 ${clip(p.text, 100)}` : "📸 Shared a photo";
  return clip(p.text, 120) || "New post";
}

exports.onFeedPostCreated = onDocumentCreated(`${BASE}/communities/{communityId}/feed/{postId}`, async (event) => {
  const p = (event.data && event.data.data()) || {};
  const { communityId, postId } = event.params;
  const author = p.authorId || "";
  const { all, community } = await communityMembers(communityId);
  const who = p.authorName || (await nameOf(author));
  const cName = String(community.name || "your").replace(/\s+community$/i, "");

  // @mentions: those people get "Diego mentioned you" instead of the general post notification.
  const mentioned = uniq(arr(p.mentions).map(String)).filter((u) => u !== author && all.includes(u));
  if (mentioned.length) {
    await notify(mentioned, {
      type: "community_post",
      senderUid: author,
      communityId,
      title: `${who} mentioned you in ${cName} Community`,
      body: describePost(p),
    }, { key: `post_${postId}` });
  }
  await notify(all, {
    type: "community_post",
    senderUid: author,
    communityId,
    title: `${who} posted on ${cName} Community`,
    body: describePost(p),
  }, { exclude: [author, ...mentioned], key: `post_${postId}` });
});

exports.onFeedPostUpdated = onDocumentUpdated(`${BASE}/communities/{communityId}/feed/{postId}`, async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  const { communityId, postId } = event.params;
  const oldCount = arr(before.comments).length;
  const comments = arr(after.comments);
  if (comments.length <= oldCount) return;            // likes, votes, edits: no push

  const author = after.authorId || "";
  const { community } = await communityMembers(communityId);
  const cName = community.name || "your community";

  for (let i = oldCount; i < comments.length; i++) {
    const c = comments[i] || {};
    const by = c.authorId || c.uid || "";
    const who = c.authorName || c.name || (await nameOf(by));
    // The post's author, plus everyone who commented before (so replies reach the conversation).
    const earlier = comments.slice(0, i).map((x) => x.authorId || x.uid);
    // @mentions in the comment: "Diego mentioned you in a comment" (and nothing else for them).
    const mentioned = uniq(arr(c.mentions).map(String)).filter((u) => u && u !== by);
    if (mentioned.length) {
      await notify(mentioned, {
        type: "community_post_comment",
        senderUid: by,
        communityId,
        title: `${who} mentioned you in a comment 💬`,
        body: `${clip(c.text, 120)} · ${cName}`,
      }, { key: `postc_${postId}_${i}` });
    }
    const toAuthor = author && author !== by && !mentioned.includes(author);

    if (toAuthor) {
      await notify([author], {
        type: "community_post_comment",
        senderUid: by,
        communityId,
        title: `${who} commented on your post 💬`,
        body: `${clip(c.text, 120)} · ${cName}`,
      }, { key: `postc_${postId}_${i}` });
    }
    await notify(uniq(earlier), {
      type: "community_post_comment",
      senderUid: by,
      communityId,
      title: `${who} also commented 💬`,
      body: `${clip(c.text, 120)} · ${cName}`,
    }, { exclude: [by, author, ...mentioned], key: `postc_${postId}_${i}` });
  }
});

// ---------------------------------------------------------------------------
// 7b. Community group chat: WhatsApp-style push to every member except the sender
//     ("Sunday Futsal" / "Diego: see you at 7")
// ---------------------------------------------------------------------------

async function onCommunityChat(event) {
  const m = (event.data && event.data.data()) || {};
  const { communityId, msgId } = event.params;
  const by = m.senderUid || m.senderId || m.uid || "";
  if (!by) return;
  const { all, community } = await communityMembers(communityId);
  const who = (m.sender || m.senderName || m.name || (await nameOf(by))).split(" ")[0];
  let text = clip(m.text, 120);
  if (m.media && m.media.type) {
    const icon = m.media.type === "video" ? "🎥" : "📷";
    const isLabel = text === "📷 Photo" || text === "🎥 Video" || !text;
    text = isLabel ? `${icon} ${m.media.type === "video" ? "Video" : "Photo"}` : `${icon} ${text}`;
  }
  await notify(all, {
    type: "chat_community",
    senderUid: by,
    communityId,
    chatId: `community_${communityId}`,   // groups the pushes in one stack on the lock screen
    title: community.name || "Community chat",
    body: `${who}: ${text || "New message"}`,
  }, { exclude: [by], key: `cchat_${communityId}_${msgId}` });
}

exports.onCommunityChatMessage = onDocumentCreated(`${BASE}/communities/{communityId}/messages/{msgId}`, onCommunityChat);
// Older app versions saved group messages here.
exports.onCommunityChatMessageOld = onDocumentCreated(`${BASE}/communities/{communityId}/chat/{msgId}`, onCommunityChat);

// ---------------------------------------------------------------------------
// 8. Credit added or removed by an admin
// ---------------------------------------------------------------------------

exports.onCreditLedger = onDocumentCreated(`${BASE}/communities/{communityId}/creditLedger/{entryId}`, async (event) => {
  const l = (event.data && event.data.data()) || {};
  const { communityId, entryId } = event.params;
  if (l.type !== "topup" && l.type !== "adjust") return;   // game fees and refunds are covered by the game pushes
  if (!l.uid || l.by === l.uid) return;

  const cents = Math.round(Number(l.amountCents) || 0);
  if (!cents) return;
  const money = `$${(Math.abs(cents) / 100).toFixed(2)}`;
  const balance = `$${((Number(l.balanceAfterCents) || 0) / 100).toFixed(2)}`;
  const { community } = await communityMembers(communityId);
  const who = l.byName || (await nameOf(l.by));
  const cName = community.name || "your community";

  await notify([l.uid], {
    type: "community_credit",
    senderUid: l.by || "",
    communityId,
    sound: cents > 0 ? "cha_ching" : "",
    title: cents > 0 ? `${money} credit added 💰` : `${money} credit removed`,
    body: `${who} ${cents > 0 ? "added" : "removed"} ${money} ${cents > 0 ? "to" : "from"} your ${cName} credit. Balance: ${balance}.${l.note ? " Note: " + clip(l.note, 60) : ""}`,
  }, { key: `credit_${entryId}` });
});

// ---------------------------------------------------------------------------
// 9. Someone asked to join a community -> tell the admins
// ---------------------------------------------------------------------------

exports.onCommunityJoinRequest = onDocumentCreated(`${BASE}/communities/{communityId}/requests/{uid}`, async (event) => {
  const r = (event.data && event.data.data()) || {};
  const { communityId, uid } = event.params;
  const { admins, community } = await communityMembers(communityId);
  const who = r.name || (await nameOf(uid));

  await notify(admins, {
    type: "community_join_request",
    senderUid: uid,
    communityId,
    title: "New join request 🙋",
    body: `${who} wants to join ${community.name || "your community"}. Tap to review.`,
  }, { exclude: [uid], key: `joinreq_${communityId}_${uid}_${tenMinuteBucket()}` });
});

// ---------------------------------------------------------------------------
// 10. One phone = one account: when a phone signs in to an account, remove it
//     from any other account it was saved on (so test accounts don't get your pushes)
// ---------------------------------------------------------------------------

exports.onPhoneTokenSaved = onDocumentWritten(`${BASE}/directory/{uid}`, async (event) => {
  if (!event.data.after.exists) return;
  const uid = event.params.uid;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.data() || {};
  const had = new Set(uniq([before.fcmToken, ...arr(before.fcmTokens)]));
  const added = uniq([after.fcmToken, ...arr(after.fcmTokens)]).filter((t) => !had.has(t));
  if (!added.length) return;

  for (const token of added) {
    const [inList, asMain] = await Promise.all([
      col("directory").where("fcmTokens", "array-contains", token).get(),
      col("directory").where("fcmToken", "==", token).get(),
    ]);
    const others = new Map();
    [...inList.docs, ...asMain.docs].forEach((d) => { if (d.id !== uid) others.set(d.id, d); });
    for (const [otherUid, d] of others) {
      const patch = { fcmTokens: admin.firestore.FieldValue.arrayRemove(token) };
      if ((d.data() || {}).fcmToken === token) patch.fcmToken = admin.firestore.FieldValue.delete();
      await d.ref.update(patch);
      logger.info("Moved phone token from", otherUid, "to", uid);
    }
  }
});
// ---------------------------------------------------------------------------
// 4b. Caps mode helpers
// ---------------------------------------------------------------------------
const capsLink = (eventId) => `https://futnet.site/#event=${encodeURIComponent(eventId)}&caps=1`;
const capOfTeam = (g, t) => String(((g.teamCaptains || {})[t] ?? (g.teamCaptains || {})[String(t)]) || "");
const teamUids = (g, t) => arr(((g.teamAssignments || {})[t] ?? (g.teamAssignments || {})[String(t)])).filter((p) => p && uidOf(p)).map(uidOf);
/** Everyone going (and their guests: "<uid>_guest_<n>"). */
function goingIds(g) {
  const out = new Set();
  arr(g.attendees).forEach((a) => { const u = uidOf(a); if (!u) return; out.add(u); arr(a.guests).forEach((_, i) => out.add(`${u}_guest_${i}`)); });
  return out;
}

async function capsDraftUpdates(eventId, before, after, title, organizer) {
  const d = after.capsDraft;
  const b = before.capsDraft || null;
  if (!d || d.status !== "live") return;
  const count = Number(after.teamsCount) || 3;

  // 1) Just started: every captain gets a notification with the link.
  if (!b || b.status !== "live" || b.startedAt !== d.startedAt) {
    for (let t = 0; t < count; t++) {
      const cap = capOfTeam(after, t);
      if (!cap) continue;
      const first = d.mode === "turns" && d.turnTeam === t;
      await notify([cap], {
        type: "caps_captain",
        senderUid: organizer,
        eventId,
        link: capsLink(eventId),
        title: "You're a captain! 🧢",
        body: d.mode === "turns"
          ? `You captain ${teamName(after, t)} for ${title}. ${first ? "You pick first, go!" : "Captains take turns picking. We'll tell you when it's your turn."}`
          : `You captain ${teamName(after, t)} for ${title}. Open pick: pick your players whenever you're ready.`,
      }, { key: `caps_cap_${eventId}_${d.startedAt}_${t}` });
    }
  }

  // 1b) Admin changed a captain during the draft: tell the new captain.
  if (b && b.status === "live" && b.startedAt === d.startedAt) {
    for (let t = 0; t < count; t++) {
      const was = capOfTeam(before, t), now = capOfTeam(after, t);
      if (!now || now === was) continue;
      await notify([now], {
        type: "caps_captain",
        senderUid: organizer,
        eventId,
        link: capsLink(eventId),
        title: "You're the captain now! 🧢",
        body: `You captain ${teamName(after, t)} for ${title}.${d.mode === "turns" && d.turnTeam === t ? " It's your pick!" : ""}`,
      }, { key: `caps_newcap_${eventId}_${d.startedAt}_${t}_${now}` });
    }
  }

  // 1c) A captain cancelled (left the game) during the draft: ask the admins for a new captain.
  if (b && b.status === "live") {
    const going = goingIds(after);
    const lost = [];
    for (let t = 0; t < count; t++) {
      const was = capOfTeam(before, t);
      if (was && !going.has(was) && goingIds(before).has(was)) lost.push(t);
    }
    if (lost.length) {
      const { admins } = after.communityId ? await communityMembers(after.communityId) : { admins: [] };
      const names = await Promise.all(lost.map((t) => nameOf(capOfTeam(before, t))));
      await notify(uniq([organizer, ...admins]), {
        type: "caps_need_captain",
        eventId,
        link: capsLink(eventId),
        title: "Pick a new captain 🧢",
        body: `${names.join(" and ")} cancelled ${title}, so ${lost.map((t) => teamName(after, t)).join(" and ")} need${lost.length === 1 ? "s" : ""} a new captain. Open Caps mode to pick one.`,
      }, { key: `caps_lostcap_${eventId}_${d.startedAt}_${lost.join("-")}_${tenMinuteBucket()}` });
    }
  }

  // 2) A picked player cancelled (left the game): their team picks next.
  if (b && b.status === "live" && d.mode === "turns") {
    const going = goingIds(after);
    const owed = [];
    for (let t = 0; t < count; t++) {
      const lost = teamUids(before, t).filter((u) => !teamUids(after, t).includes(u) && !going.has(u));
      lost.forEach(() => owed.push(t));
    }
    if (owed.length) {
      const ref = col("eventsList").doc(eventId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const g = snap.exists ? snap.data() : null;
        if (!g || !g.capsDraft || g.capsDraft.status !== "live") return;
        const priority = [...arr(g.capsDraft.priority), ...owed];
        tx.update(ref, { "capsDraft.priority": priority, "capsDraft.turnTeam": priority[0] });
      });
      return;   // the write above runs this again and sends the "your turn" notification
    }
  }

  // 3) Someone new is on the clock: tell that captain.
  if (d.mode === "turns" && d.turnTeam !== null && d.turnTeam !== undefined) {
    const changed = !b || b.turnTeam !== d.turnTeam || arr(b.picks).length !== arr(d.picks).length;
    const cap = capOfTeam(after, d.turnTeam);
    if (changed && cap) {
      const last = arr(d.picks)[arr(d.picks).length - 1];
      const extra = arr(d.priority).includes(d.turnTeam);
      await notify([cap], {
        type: "caps_turn",
        senderUid: organizer,
        eventId,
        link: capsLink(eventId),
        title: "Your pick! 🧢",
        body: extra
          ? `A player on ${teamName(after, d.turnTeam)} cancelled, so you pick next.`
          : last ? `${last.name || "A player"} was just picked. It's your turn for ${teamName(after, d.turnTeam)}.` : `You pick first for ${teamName(after, d.turnTeam)}.`,
      }, { key: `caps_turn_${eventId}_${d.startedAt}_${arr(d.picks).length}_${d.turnTeam}` });
    }
  }
}

// ---------------------------------------------------------------------------
// 11. Money + waitlist (same rules as the website: money-rules.js)
//   a) Must-pay games: nobody keeps a spot without paying, whatever app or link they used
//   b) Late cancels with "refund if the spot gets filled": refunded when someone takes the spot
//   c) Game cancelled (deleted): everyone's credit back, unless the organizer turned that off
//   d) Waitlist: when a spot opens, offer it to the next player(s) with a timer (scheduled below)
// ---------------------------------------------------------------------------

const rules = require("./money-rules");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const FV = admin.firestore.FieldValue;
const DEFAULT_TZ = "America/New_York";
const money = (c) => `$${(Math.abs(Number(c) || 0) / 100).toFixed(2)}`;

/**
 * Caps mode time limit: every 5 minutes, drafts past their deadline get the players nobody picked
 * placed at random (smallest team first), then the line ups are built and everyone is told.
 */
exports.capsDeadlines = onSchedule({ schedule: "every 5 minutes", timeZone: DEFAULT_TZ }, async () => {
  const now = Date.now();
  const snap = await col("eventsList").where("capsDraft.status", "==", "live").get();
  for (const docSnap of snap.docs) {
    const g0 = docSnap.data() || {};
    const at = Number(g0.capsDraft && g0.capsDraft.deadlineAt) || 0;
    if (!at || at > now) continue;
    let placed = 0;
    try {
      await db.runTransaction(async (tx) => {
        placed = 0;
        const s = await tx.get(docSnap.ref);
        const g = s.exists ? s.data() : null;
        if (!g || !g.capsDraft || g.capsDraft.status !== "live") return;
        const count = Number(g.teamsCount) || 3;
        const ta = {};
        for (let t = 0; t < count; t++) ta[t] = arr((g.teamAssignments || {})[t] ?? (g.teamAssignments || {})[String(t)]).filter((p) => p && uidOf(p));
        const taken = new Set(Object.values(ta).flat().map(uidOf));
        // everyone going (and their guests) who wasn't picked
        const pool = [];
        arr(g.attendees).forEach((a) => {
          const u = uidOf(a); if (!u) return;
          if (!taken.has(u)) pool.push({ uid: u, name: a.name || a.firstName || "Player", position: a.position || "Player" });
          arr(a.guests).forEach((gu, i) => { const id = `${u}_guest_${i}`; if (!taken.has(id)) pool.push({ uid: id, name: (gu && gu.name) || "Guest", position: "Guest", isHostGuest: true, hostUid: u }); });
        });
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        pool.forEach((p) => {
          const sizes = Object.keys(ta).map((t) => ta[t].length);
          const min = Math.min(...sizes);
          const options = Object.keys(ta).filter((t) => ta[t].length === min);
          ta[options[Math.floor(Math.random() * options.length)]].push({ ...p, randomPick: true });
          placed++;
        });
        // line ups: chosen positions first, then everyone else
        Object.keys(ta).forEach((t) => {
          ta[t] = ta[t].slice().sort((a, b) => (Number.isInteger(a.slot) ? a.slot : 999) - (Number.isInteger(b.slot) ? b.slot : 999))
            .map((p) => { const c = { ...p }; delete c.slot; return c; });
        });
        tx.update(docSnap.ref, { teamAssignments: ta, "capsDraft.status": "done", "capsDraft.turnTeam": null, "capsDraft.doneAt": now, "capsDraft.timedOut": true });
      });
      const title = g0.title || "your game";
      const caps = Object.values(g0.teamCaptains || {}).map(String).filter(Boolean);
      await notify(uniq([...caps, g0.organizerId]), {
        type: "caps_timeout",
        eventId: docSnap.id,
        title: "Time's up! ⏱️ Teams are set",
        body: placed ? `The draft for ${title} ran out of time. ${placed} player(s) were put on teams at random.` : `The draft for ${title} is done. Teams are set.`,
      }, { key: `caps_timeout_${docSnap.id}_${at}` });
      logger.info(`Caps deadline ${docSnap.id}: placed ${placed} at random`);
    } catch (e) { logger.warn("caps deadline failed", docSnap.id, e.message); }
  }
});


/** Wall-clock time in a time zone -> ms (games are saved as "2026-10-20" + "7:00 PM", local time). */
function tzOffsetMs(t, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t));
  const g = (k) => Number((parts.find((p) => p.type === k) || {}).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - t;
}
function startOf(game) {
  const tz = game.timeZone || DEFAULT_TZ;
  return rules.startMsOf(game, (y, mo, d, h, mi) => {
    const guess = Date.UTC(y, mo, d, h, mi);
    let t = guess - tzOffsetMs(guess, tz);
    t = guess - tzOffsetMs(t, tz);
    return t;
  });
}

const credRef = (cid, uid) => col("communities").doc(cid).collection("credits").doc(String(uid));
const ledgerCol = (cid) => col("communities").doc(cid).collection("creditLedger");
const isRealPlayer = (uid) => uid && !uid.startsWith("usr_") && !uid.includes("_guest_");

/** Credit move inside a transaction (reads must already be done: pass the balance read before). */
function writeCredit(tx, cid, uid, name, balanceBefore, amountCents, type, note, game, eventId) {
  const after = balanceBefore + amountCents;
  tx.set(credRef(cid, uid), { uid: String(uid), name: name || "Member", balanceCents: after, updatedAt: FV.serverTimestamp() }, { merge: true });
  tx.set(ledgerCol(cid).doc(), {
    uid: String(uid), name: name || "Member", amountCents, type, note,
    eventId, eventTitle: (game && game.title) || "Game", by: "server", byName: "FutNet",
    balanceAfterCents: after, at: FV.serverTimestamp(),
  });
  return after;
}

// ---- a) must-pay enforcement --------------------------------------------------
async function enforcePayment(eventId, before, after) {
  if (!rules.isCreditGame(after)) return false;
  const beforeIn = new Set(arr(before.attendees).map(uidOf));
  const suspects = arr(after.attendees).filter((a) => {
    const u = uidOf(a);
    return isRealPlayer(u) && !beforeIn.has(u) && u !== after.organizerId && a.role !== "Organizer" &&
      !(Number(a.creditPaidCents) > 0) && a.paid !== "Paid" && a.paid !== "Free" && a.addedByAdmin !== true;
  }).map(uidOf);
  if (!suspects.length) return false;

  const ref = col("eventsList").doc(eventId);
  const removed = [], charged = [];
  await db.runTransaction(async (tx) => {
    removed.length = 0; charged.length = 0;
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const g = snap.data();
    const cid = g.communityId;
    const todo = arr(g.attendees).filter((a) => suspects.includes(uidOf(a)) && !(Number(a.creditPaidCents) > 0) && a.paid !== "Paid" && a.addedByAdmin !== true);
    if (!todo.length) return;
    const balances = {};
    for (const a of todo) {
      const s = await tx.get(credRef(cid, uidOf(a)));
      balances[uidOf(a)] = s.exists ? (Number(s.data().balanceCents) || 0) : 0;
    }
    const attendees = [];
    for (const a of arr(g.attendees)) {
      const u = uidOf(a);
      if (!todo.find((t) => uidOf(t) === u)) { attendees.push(a); continue; }
      const cost = rules.costFor(g, arr(a.guests).length);
      if (balances[u] >= cost) {
        writeCredit(tx, cid, u, a.name, balances[u], -cost, "game", "Game fee", g, eventId);
        attendees.push({ ...a, paid: "Credit", creditPaidCents: cost, creditCommunityId: cid, guests: arr(a.guests).map((x) => ({ ...x, paid: "Credit" })) });
        charged.push({ uid: u, cost });
      } else {
        removed.push({ uid: u, cost, have: balances[u] });
      }
    }
    tx.update(ref, { attendees });
  });
  for (const r of removed) {
    await notify([r.uid], {
      type: "game_payment_needed",
      eventId,
      communityId: after.communityId || "",
      title: "Add credit to join 💳",
      body: `${after.title || "This game"} costs ${money(r.cost)} and you have ${money(r.have)} credit. Send the money to your admin, then join again.`,
    }, { key: `paycheck_${eventId}_${r.uid}_${tenMinuteBucket()}` });
  }
  if (removed.length || charged.length) logger.info(`Payment check ${eventId}: charged ${charged.length}, removed ${removed.length}`);
  return removed.length > 0 || charged.length > 0;
}

// ---- a2) guests added / removed later -------------------------------------------
// The website charges or refunds guests itself (creditPaidCents changes in the same save).
// When a player's guests change and creditPaidCents did NOT (an app's "Manage guests"),
// the server does it: extra guests are charged from credit (not enough = those guests are
// taken off again + a notice), removed guests are refunded by the game's refund policy.
async function settleGuestChanges(eventId, before, after) {
  if (!rules.isCreditGame(after)) return false;
  const prev = new Map(arr(before.attendees).map((a) => [uidOf(a), a]));
  const todo = arr(after.attendees).filter((a) => {
    const u = uidOf(a);
    const b = prev.get(u);
    // Paid with credit, or marked Paid by the admin (cash / Zelle: only their new guests are charged).
    const payer = !!b && (Number(b.creditPaidCents) > 0 || b.paid === "Paid");
    return b && isRealPlayer(u) && payer && a.role !== "Organizer" && u !== after.organizerId &&
      arr(a.guests).length !== arr(b.guests).length &&
      (Number(a.creditPaidCents) || 0) === (Number(b.creditPaidCents) || 0) &&
      (Number(a.guestCreditCents) || 0) === (Number(b.guestCreditCents) || 0);
  }).map((a) => ({ uid: uidOf(a), beforeGuests: arr(prev.get(uidOf(a)).guests) }));
  if (!todo.length) return false;

  const ref = col("eventsList").doc(eventId);
  const done = [];
  await db.runTransaction(async (tx) => {
    done.length = 0;
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const g = snap.data();
    const cid = g.communityId;
    const now = Date.now();
    const start = startOf(g);
    const bal = {};
    for (const t of todo) {
      const s = await tx.get(credRef(cid, t.uid));
      bal[t.uid] = s.exists ? (Number(s.data().balanceCents) || 0) : 0;
    }
    let changed = false;
    const attendees = arr(g.attendees).map((a) => {
      const t = todo.find((x) => x.uid === uidOf(a));
      if (!t) return a;
      if (!(Number(a.creditPaidCents) > 0)) {
        // Cash player: they paid for themselves outside the app; guests come out of their credit.
        const per = rules.costFor(g, 1) - rules.costFor(g, 0);
        const diff = arr(a.guests).length - t.beforeGuests.length;
        const gc = Number(a.guestCreditCents) || 0;
        if (diff > 0) {
          const need = diff * per;
          const keep = t.beforeGuests.length;
          changed = true;
          if (bal[t.uid] >= need) {
            writeCredit(tx, cid, t.uid, a.name, bal[t.uid], -need, "game", "Guest fee", g, eventId);
            done.push({ uid: t.uid, kind: "charged", cents: need });
            return { ...a, guestCreditCents: gc + need, guests: arr(a.guests).map((x, i) => (i >= keep ? { ...x, paid: "Credit" } : x)) };
          }
          done.push({ uid: t.uid, kind: "owed", cents: need, have: bal[t.uid] });
          return { ...a, guestCreditCents: gc, guests: arr(a.guests).map((x, i) => (i >= keep ? { ...x, paid: "Unpaid" } : x)) };
        }
        if (diff < 0 && gc > 0) {
          const back = rules.leaveRefund(g, Math.min(gc, -diff * per), now, start).now;
          changed = true;
          if (back > 0) {
            writeCredit(tx, cid, t.uid, a.name, bal[t.uid], back, "refund", "Guest removed", g, eventId);
            done.push({ uid: t.uid, kind: "refunded", cents: back });
          }
          return { ...a, guestCreditCents: gc - back };
        }
        return a;
      }
      const paid = Number(a.creditPaidCents) || 0;
      const cost = rules.costFor(g, arr(a.guests).length);
      if (cost > paid) {
        const need = cost - paid;
        if (bal[t.uid] >= need) {
          writeCredit(tx, cid, t.uid, a.name, bal[t.uid], -need, "game", "Guest fee", g, eventId);
          changed = true;
          done.push({ uid: t.uid, kind: "charged", cents: need });
          return { ...a, paid: "Credit", creditPaidCents: cost, creditCommunityId: cid, guests: arr(a.guests).map((x) => ({ ...x, paid: "Credit" })) };
        }
        changed = true;
        done.push({ uid: t.uid, kind: "short", cents: need, have: bal[t.uid] });
        return { ...a, guests: t.beforeGuests };             // not enough credit: guests go back to what was paid for
      }
      if (cost < paid) {
        const back = rules.leaveRefund(g, paid - cost, now, start).now;
        changed = true;
        if (back > 0) {
          writeCredit(tx, cid, t.uid, a.name, bal[t.uid], back, "refund", "Guest removed", g, eventId);
          done.push({ uid: t.uid, kind: "refunded", cents: back });
        }
        return { ...a, creditPaidCents: paid - back };     // what was not refunded still counts as paid
      }
      return a;
    });
    if (changed) tx.update(ref, { attendees, playersGoing: rules.headsOf(attendees) });
  });
  for (const d of done) {
    const title = after.title || "the game";
    const msg = d.kind === "charged"
      ? { title: "Guest added 💳", body: `${money(d.cents)} was taken from your credit for your guest(s) in ${title}.` }
      : d.kind === "refunded"
        ? { title: `${money(d.cents)} refunded 💰`, body: `You removed a guest from ${title}, so ${money(d.cents)} is back in your credit.`, sound: "cha_ching" }
        : d.kind === "owed"
          ? { title: "Pay for your guest 💳", body: `Your guest(s) in ${title} cost ${money(d.cents)} and you have ${money(d.have)} credit. They're in, so please pay your admin.` }
          : { title: "Add credit for your guest 💳", body: `Your guest(s) in ${title} cost ${money(d.cents)} and you have ${money(d.have)} credit, so they weren't added. Send the money to your admin, then add them again.` };
    await notify([d.uid], { type: d.kind === "refunded" ? "community_credit" : "game_payment_needed", eventId, communityId: after.communityId || "", ...msg },
      { key: `guests_${eventId}_${d.uid}_${d.kind}_${tenMinuteBucket()}_${d.cents}` });
  }
  if (done.length) logger.info(`Guest money ${eventId}:`, done.map((d) => `${d.uid} ${d.kind} ${d.cents}`).join(", "));
  return done.length > 0;
}

// ---- a3) a player an admin added: charge their credit and tell them ---------------
// Admins add players with "Add players" / "Move to roster" (marked addedByAdmin, paid "Unpaid").
// In a credit game the fee (with their guests) now comes out of the player's credit, and they get
// "{Admin} added you to {game}. $X was taken from your credit." Not enough credit: they stay in
// the game as Unpaid (they show on the admin's "Didn't pay" list after the game) and get told.
// Marked Paid / Free by the admin = nothing is charged.
async function chargeAdminAdds(eventId, before, after) {
  if (!rules.isCreditGame(after)) return false;
  const beforeIn = new Set(arr(before.attendees).map(uidOf));
  const fresh = arr(after.attendees).filter((a) => {
    const u = uidOf(a);
    return isRealPlayer(u) && !beforeIn.has(u) && a.addedByAdmin === true && u !== after.organizerId && a.role !== "Organizer" &&
      !(Number(a.creditPaidCents) > 0) && (!a.paid || a.paid === "Unpaid") && !a.adminChargeTried;
  }).map(uidOf);
  if (!fresh.length) return false;

  const ref = col("eventsList").doc(eventId);
  const out = [];
  await db.runTransaction(async (tx) => {
    out.length = 0;
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const g = snap.data();
    const cid = g.communityId;
    const todo = arr(g.attendees).filter((a) => fresh.includes(uidOf(a)) && !(Number(a.creditPaidCents) > 0) && (!a.paid || a.paid === "Unpaid") && !a.adminChargeTried);
    if (!todo.length) return;
    const bal = {};
    for (const a of todo) {
      const s = await tx.get(credRef(cid, uidOf(a)));
      bal[uidOf(a)] = s.exists ? (Number(s.data().balanceCents) || 0) : 0;
    }
    const attendees = arr(g.attendees).map((a) => {
      const u = uidOf(a);
      if (!todo.find((t) => uidOf(t) === u)) return a;
      const cost = rules.costFor(g, arr(a.guests).length);
      const by = a.addedByName || "An admin";
      if (bal[u] >= cost) {
        writeCredit(tx, cid, u, a.name, bal[u], -cost, "game", `Game fee (added by ${by})`, g, eventId);
        out.push({ uid: u, ok: true, cost, by });
        return { ...a, paid: "Credit", creditPaidCents: cost, creditCommunityId: cid, adminChargeTried: true,
          guests: arr(a.guests).map((x) => ({ ...x, paid: "Credit" })) };
      }
      out.push({ uid: u, ok: false, cost, have: bal[u], by });
      return { ...a, adminChargeTried: true };      // stays Unpaid; never tried twice
    });
    tx.update(ref, { attendees });
  });
  const title = after.title || "the game";
  for (const o of out) {
    await notify([o.uid], o.ok
      ? { type: "game_added", eventId, communityId: after.communityId || "", title: "You're in! ⚽",
        body: `${o.by} added you to ${title}. ${money(o.cost)} was taken from your credit.` }
      : { type: "game_payment_needed", eventId, communityId: after.communityId || "", title: "You're in! Payment needed 💳",
        body: `${o.by} added you to ${title}. It costs ${money(o.cost)} and you have ${money(o.have)} credit, so please pay your admin.` },
    { key: `adminadd_${eventId}_${o.uid}` });
  }
  if (out.length) logger.info(`Admin adds ${eventId}:`, out.map((o) => `${o.uid} ${o.ok ? "charged" : "short"} ${o.cost}`).join(", "));
  return out.length > 0;
}

// ---- b) refund late cancels once someone takes the spot ------------------------
async function refundFilledSpots(eventId, before, after) {
  const pending = arr(after.pendingRefunds);
  if (!pending.length) return false;
  const beforeIn = new Set(arr(before.attendees).map(uidOf));
  const newcomers = arr(after.attendees).filter((a) => !beforeIn.has(uidOf(a)) && uidOf(a) !== after.organizerId).length;
  if (!newcomers) return false;

  const ref = col("eventsList").doc(eventId);
  const paidBack = [];
  await db.runTransaction(async (tx) => {
    paidBack.length = 0;
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const g = snap.data();
    const inNow = new Set(arr(g.attendees).map(uidOf));
    // Oldest first; never someone who came back to the game themselves
    const list = arr(g.pendingRefunds).filter((p) => p && p.cents > 0 && !inNow.has(String(p.uid)));
    const take = list.slice(0, newcomers);
    if (!take.length) return;
    const bal = {};
    for (const p of take) {
      const k = `${p.cid}|${p.uid}`;
      if (bal[k] === undefined) {
        const s = await tx.get(credRef(p.cid || g.communityId, p.uid));
        bal[k] = s.exists ? (Number(s.data().balanceCents) || 0) : 0;
      }
    }
    for (const p of take) {
      const k = `${p.cid}|${p.uid}`;
      bal[k] = writeCredit(tx, p.cid || g.communityId, p.uid, p.name, bal[k], p.cents, "refund", "Your spot was filled", g, eventId);
      paidBack.push(p);
    }
    const left = arr(g.pendingRefunds).filter((p) => !take.includes(p) && !inNow.has(String(p.uid)));
    tx.update(ref, { pendingRefunds: left });
  });
  for (const p of paidBack) {
    await notify([String(p.uid)], {
      type: "community_credit",
      eventId,
      communityId: p.cid || after.communityId || "",
      sound: "cha_ching",
      title: `${money(p.cents)} refunded 💰`,
      body: `Someone took your spot in ${after.title || "the game"}, so your ${money(p.cents)} is back in your credit.`,
    }, { key: `spotrefund_${eventId}_${p.uid}_${p.at || ""}` });
  }
  return paidBack.length > 0;
}

// ---- c) game cancelled: give back what each player still has paid for this game ---
async function refundCancelledGame(eventId, game) {
  if (!game.communityId || !rules.refundsOnCancel(game)) return;
  const cids = uniq([game.communityId, ...arr(game.attendees).map((a) => a.creditCommunityId), ...arr(game.pendingRefunds).map((p) => p.cid)]);
  for (const cid of cids) {
    // Net paid per player for this game = -(fees + refunds) in the ledger. Refunds the apps already made are counted.
    const ledger = await ledgerCol(cid).where("eventId", "==", eventId).get();
    const net = {};
    ledger.docs.forEach((d) => {
      const l = d.data() || {};
      if (l.type !== "game" && l.type !== "refund") return;
      net[l.uid] = (net[l.uid] || 0) - (Number(l.amountCents) || 0);
    });
    for (const [uid, owed] of Object.entries(net)) {
      if (owed <= 0) continue;
      const name = (arr(game.attendees).find((a) => uidOf(a) === uid) || arr(game.pendingRefunds).find((p) => String(p.uid) === uid) || {}).name;
      await db.runTransaction(async (tx) => {
        const s = await tx.get(credRef(cid, uid));
        writeCredit(tx, cid, uid, name, s.exists ? (Number(s.data().balanceCents) || 0) : 0, owed, "refund", "Game was cancelled", game, eventId);
      });
      await notify([uid], {
        type: "community_credit",
        eventId,
        communityId: cid,
        sound: "cha_ching",
        title: `${money(owed)} refunded 💰`,
        body: `${game.title || "Your game"} was cancelled, so your ${money(owed)} is back in your credit.`,
      }, { key: `cancelrefund_${eventId}_${uid}` });
    }
  }
}

// ---- d0) "Put me in automatically": waiting players who chose it get the open spot right away
//      (fee taken from their credit on must-pay games). Same order as the offers: only players the
//      spot would be offered to now. Not enough credit -> they are asked like everybody else.
async function autoPlace(eventId, after) {
  const now = Date.now();
  const start = startOf(after);
  if (after.isSessionEnded === true || (start && now > start + 3 * 3600000)) return false;
  if (!rules.freeSpotsOf(after) || !rules.waitingUids(after).length) return false;
  const ref = col("eventsList").doc(eventId);
  const placed = [];
  await db.runTransaction(async (tx) => {
    placed.length = 0;
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const g = snap.data();
    const probe = { ...g, spotOffer: g.spotOffer || { round: 1 } };
    const candidates = rules.offerEligible(probe, now, startOf(g))
      .map((u) => arr(g.waitingList).find((w) => uidOf(w) === u))
      .filter((w) => w && w.autoJoin === true);
    if (!candidates.length) return;
    const pay = rules.isCreditGame(g);
    const cid = g.communityId;
    const balances = {};
    if (pay) {
      for (const w of candidates) {
        const s = await tx.get(credRef(cid, uidOf(w)));
        balances[uidOf(w)] = s.exists ? (Number(s.data().balanceCents) || 0) : 0;
      }
    }
    let attendees = arr(g.attendees).slice();
    let waitingList = arr(g.waitingList).slice();
    for (const w of candidates) {
      const u = uidOf(w);
      const heads = 1 + arr(w.guests).length;
      const free = rules.capacityOf(g) - rules.headsOf(attendees);
      if (free < heads) continue;                       // not enough room for them + their guests: ask instead
      const entry = { ...w, status: "confirmed", autoJoined: true, autoJoinedAt: now };
      delete entry.autoJoin;
      if (pay) {
        const cost = rules.costFor(g, arr(w.guests).length);
        if (balances[u] < cost) continue;                // not enough credit: they get asked
        writeCredit(tx, cid, u, w.name, balances[u], -cost, "game", "Game fee (auto-joined from the waitlist)", g, eventId);
        Object.assign(entry, { paid: "Credit", creditPaidCents: cost, creditCommunityId: cid, guests: arr(w.guests).map((x) => ({ ...x, paid: "Credit" })) });
        placed.push({ uid: u, cost });
      } else placed.push({ uid: u, cost: 0 });
      attendees.push(entry);
      waitingList = waitingList.filter((x) => uidOf(x) !== u);
    }
    if (!placed.length) return;
    tx.update(ref, { attendees, waitingList, playersGoing: rules.headsOf(attendees) });
  });
  for (const p of placed) {
    await notify([p.uid], {
      type: "game_auto_joined",
      eventId,
      communityId: after.communityId || "",
      title: "You're in! ⚽",
      body: `A spot opened in ${after.title || "the game"} and we added you automatically${p.cost ? `. ${money(p.cost)} was taken from your credit` : ""}.`,
    }, { key: `autojoin_${eventId}_${p.uid}_${now}` });
  }
  if (placed.length) logger.info(`Auto-joined ${placed.length} player(s) from the waitlist of ${eventId}`);
  return placed.length > 0;
}

// ---- d) waitlist spot offers ----------------------------------------------------
async function updateSpotOffer(eventId, before, after) {
  const now = Date.now();
  const start = startOf(after);
  const ended = after.isSessionEnded === true || (start && now > start + 3 * 3600000);
  const free = rules.freeSpotsOf(after);
  const waiting = rules.waitingUids(after);
  const want = !ended && free > 0 && waiting.length > 0;
  const ref = col("eventsList").doc(eventId);

  if (!want) {
    if (!after.spotOffer) return;
    // Spot taken (or nobody waiting): close the offer, and tell the others who were offered it.
    const offered = rules.offerEligible({ ...before, spotOffer: before.spotOffer || after.spotOffer }, now, start);
    await ref.update({ spotOffer: null });
    const inNow = new Set(arr(after.attendees).map(uidOf));
    const stillWaiting = offered.filter((u) => !inNow.has(u) && waiting.includes(u));
    if (free === 0 && stillWaiting.length) {
      await notify(stillWaiting, {
        type: "game_spot_taken",
        eventId,
        title: "Someone grabbed the spot",
        body: `The open spot in ${after.title || "the game"} was taken. You're still on the waitlist.`,
      }, { key: `spottaken_${eventId}_${(after.spotOffer && after.spotOffer.startedAt) || ""}` });
    }
    return;
  }

  let offer = after.spotOffer;
  const patch = {};
  if (!offer) {
    offer = { round: 1, startedAt: now, expiresAt: rules.offerExpiry(after, now, start), lastCall: false, notified: [] };
    if (offer.expiresAt <= now) { offer.lastCall = true; offer.expiresAt = null; }
    patch.spotOffer = offer;
  }
  const g = { ...after, spotOffer: offer };
  const eligible = rules.offerEligible(g, now, start);
  const fresh = eligible.filter((u) => !arr(offer.notified).includes(u));
  const next = { ...offer, notified: uniq([...arr(offer.notified), ...fresh]) };
  if (!next.lastCall) {
    if (eligible.length >= waiting.length) {
      // Everyone waiting is already invited: nothing to widen. Wake up again only for last call.
      const wake = start ? Math.max(now, start - rules.LAST_CALL_MS) : null;
      if (next.expiresAt !== wake && (wake === null || !next.expiresAt || next.expiresAt > wake)) next.expiresAt = wake;
    } else {
      // More people joined the waitlist after the timer was parked: start ticking again.
      const due = rules.offerExpiry(after, now, start);
      if (!next.expiresAt || next.expiresAt > due) next.expiresAt = due;
    }
  }
  if (!fresh.length && !patch.spotOffer && JSON.stringify(next) === JSON.stringify(offer)) return;
  patch.spotOffer = next;
  await ref.update(patch);

  if (fresh.length) {
    const mins = rules.claimMinutesOf(after);
    const pay = rules.isCreditGame(after) ? ` and pay ${money(rules.feeCentsOf(after))} from your credit` : "";
    const lastCall = patch.spotOffer.lastCall || rules.isLastCall(g, now, start);
    const autoNoFunds = new Set(arr(after.waitingList).filter((w) => w.autoJoin === true).map(uidOf));
    const why = (u) => (autoNoFunds.has(u) && rules.isCreditGame(after) ? "We couldn't add you automatically (not enough credit). " : "");
    const groups = {};
    fresh.forEach((u) => { (groups[why(u)] = groups[why(u)] || []).push(u); });
    for (const [prefix, who] of Object.entries(groups)) await notify(who, {
      type: "game_spot_offer",
      eventId,
      communityId: after.communityId || "",
      title: lastCall ? "Last call: a spot is open! ⚽" : "Someone cancelled! You're up next ⚽",
      body: lastCall
        ? `A spot opened in ${after.title || "the game"}. First to confirm gets it${pay ? pay.replace(" and pay", ", you'll pay") : ""}.`
        : `${prefix}A spot opened in ${after.title || "the game"}. Confirm within ${mins === 60 ? "1 hour" : mins + " minutes"}${pay} to grab it.`,
    }, { key: `spotoffer_${eventId}_${patch.spotOffer.startedAt}_${who.join("_")}`.slice(0, 900) });
  }
}

exports.onGameMoney = onDocumentWritten(`${BASE}/eventsList/{eventId}`, async (event) => {
  const eventId = event.params.eventId;
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;

  if (before && !after) { await refundCancelledGame(eventId, before); return; }
  if (!after) return;
  const prev = before || {};
  try {
    await sendPaymentAsks(eventId, prev, after);
    // A fix writes the game again, and that write runs this function again for the next step.
    // Both look at who is new in this save, so both run now (each in its own transaction).
    const paidCheck = await enforcePayment(eventId, prev, after);
    const adminAdds = await chargeAdminAdds(eventId, prev, after);
    if (paidCheck || adminAdds) return;
    if (await settleGuestChanges(eventId, prev, after)) return;
    await refundFilledSpots(eventId, prev, after);
    if (await autoPlace(eventId, after)) return;      // the roster changed: the next run handles the offer
    await updateSpotOffer(eventId, prev, after);
  } catch (e) {
    logger.error("onGameMoney failed", eventId, e.message);
  }
});

// ---- "Didn't pay" list -----------------------------------------------------------
// The admin taps "Ask to pay" on the list: the website / app saves paymentAsks.{uid} = time,
// and this sends that player the reminder.
async function sendPaymentAsks(eventId, before, after) {
  const was = (before && before.paymentAsks) || {};
  const now = (after && after.paymentAsks) || {};
  const fresh = Object.keys(now).filter((u) => Number(now[u]) > (Number(was[u]) || 0) && Date.now() - Number(now[u]) < 3600000);
  if (!fresh.length) return;
  const owed = new Map(rules.unpaidList({ ...after, unpaidIgnored: [] }).map((x) => [x.uid, x]));
  const gs = (n) => `${n} guest${n === 1 ? "" : "s"}`;
  const what = (o) => (!o.guests ? "" : o.self ? ` (you + ${gs(o.guests)})` : ` (your ${gs(o.guests)})`);
  for (const u of fresh) {
    const o = owed.get(u);
    if (!o || !isRealPlayer(u)) continue;
    await notify([u], {
      type: "game_payment_needed", eventId, communityId: after.communityId || "",
      title: "Payment reminder 💳",
      body: `You still owe ${money(o.cents)} for ${after.title || "the game"}${what(o)}. Please pay your admin.`,
    }, { key: `payask_${eventId}_${u}_${now[u]}` });
  }
}

// Every 30 minutes: 5 hours after a paid game, the admins get who still owes money.
exports.unpaidReports = onSchedule({ schedule: "every 30 minutes", timeZone: DEFAULT_TZ, timeoutSeconds: 120 }, async () => {
  const now = Date.now();
  const dayOf = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ }).format(new Date(t));
  const snap = await col("eventsList").where("date", ">=", dayOf(now - 3 * 86400000)).where("date", "<=", dayOf(now) + "~").get();
  let sent = 0;
  for (const d of snap.docs) {
    const g = d.data() || {};
    if (g.isCancelled === true || rules.feeCentsOf(g) <= 0) continue;
    const due = rules.unpaidDueAt(g, startOf(g));
    if (!due || now < due || now - due > 2 * 86400000) continue;
    try { await col("unpaidReports").doc(d.id).create({ eventId: d.id, at: now }); } catch (e) { continue; }   // once per game
    const list = rules.unpaidList(g);
    if (!list.length) continue;
    const total = list.reduce((n, x) => n + x.cents, 0);
    const names = list.slice(0, 3).map((x) => String(x.name).split(" ")[0]).join(", ") + (list.length > 3 ? ` +${list.length - 3} more` : "");
    await notify(await gameBosses(g), {
      type: "game_unpaid", eventId: d.id, communityId: g.communityId || "",
      title: `💸 ${list.length} didn't pay for ${g.title || "the game"}`,
      body: `${names} still owe ${money(total)} in total. Open the game's Admin tab to mark them paid or ask them to pay.`,
    }, { key: `unpaid_${d.id}` });
    sent++;
  }
  if (sent) logger.info(`unpaid reports: ${sent} games`);
});

// Every minute: offers whose timer ran out move on to the next player (or to "last call").
exports.advanceSpotOffers = onSchedule({ schedule: "every 1 minutes", timeZone: DEFAULT_TZ }, async () => {
  const now = Date.now();
  const due = await col("eventsList").where("spotOffer.expiresAt", "<=", now).limit(200).get();
  for (const d of due.docs) {
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(d.ref);
        const g = snap.data();
        const o = g && g.spotOffer;
        if (!o || !o.expiresAt || o.expiresAt > now) return;
        const start = startOf(g);
        if (start && now >= start - rules.LAST_CALL_MS) {
          tx.update(d.ref, { spotOffer: { ...o, lastCall: true, expiresAt: null } });
          return;
        }
        const waiting = rules.waitingUids(g).length;
        const round = (Number(o.round) || 1) + 1;
        const covers = rules.freeSpotsOf(g) + round - 1 >= waiting;
        const parked = start ? Math.max(now + 60000, start - rules.LAST_CALL_MS) : null;
        tx.update(d.ref, { spotOffer: { ...o, round, expiresAt: covers ? parked : rules.offerExpiry(g, now, start) } });
      });
    } catch (e) {
      logger.error("advance offer failed", d.id, e.message);
    }
  }
});

// ---------------------------------------------------------------------------
// Names & photos stay in sync everywhere.
// Each player's public card is directory/{uid}. When their name or photo there changes, every
// saved copy is updated: game rosters (going, waitlist, join requests, teams), community member
// records, credit lists, friends lists and chat threads. When someone edits their private profile
// (users/{uid}/profile/data), their public card is updated first, which then updates the copies.
// ---------------------------------------------------------------------------

const crypto = require("crypto");
// Owner accounts (stored as fingerprints so the emails are not in the code).
const OWNER_EMAIL_SHA256 = [
  "0cc4e2724ff40ad5f2b24d4a43d906996652b2d33d242c17c1efb4b7ff90d67b",
  "dc33de30406203e7cdf8490b5ef4b5c7f993bdb2989bc3025bc5e4dd6b129378",
];
const isOwner = (auth) => !!(auth && auth.token && auth.token.email &&
  OWNER_EMAIL_SHA256.includes(crypto.createHash("sha256").update(String(auth.token.email).trim().toLowerCase()).digest("hex")));

const cleanName = (s) => String(s || "").replace(/\s+/g, " ").trim();
/** Name on a directory card: name, else first + last, else nickname. */
const cardName = (d) => cleanName((d && d.name) || `${(d && d.firstName) || ""} ${(d && d.lastName) || ""}`) || cleanName(d && d.nickname);
/** Name from a private profile: first + last (that is what the person typed). */
const profileName = (p) => cleanName(`${(p && p.firstName) || ""} ${(p && p.lastName) || ""}`) || cleanName(p && p.name);
/** Only short web links are copied into rosters (big uploaded photos are looked up from the card). */
const shareableAvatar = (a) => (typeof a === "string" && a.startsWith("http") && a.length <= 500 ? a : "");
const realName = (n) => !!n && !/^(player|someone|member)$/i.test(n);

/** Puts the right name (and photo) on everyone's entries inside a list. ids: Map uid -> {name, avatar}. */
function fixEntries(list, ids) {
  let changed = false;
  for (const e of arr(list)) {
    if (!e || typeof e !== "object") continue;
    const who = ids.get(uidOf(e));
    if (!who) continue;
    if (e.name !== who.name) { e.name = who.name; changed = true; }
    if (who.avatar && "avatar" in e && e.avatar !== who.avatar) { e.avatar = who.avatar; changed = true; }
  }
  return changed;
}
const copyList = (v) => arr(v).map((x) => (x && typeof x === "object" ? { ...x } : x));

/**
 * Updates every saved copy of these people's names/photos in ONE pass over the data.
 * ids: Map uid -> {name, avatar}. Returns how many documents changed.
 */
async function propagateIdentities(ids) {
  for (const [uid, who] of [...ids]) if (!uid || !realName(who.name)) ids.delete(uid);
  if (!ids.size) return 0;
  let changes = 0;

  // 1. Game rosters, waitlists, not-going lists, join requests, teams and the organizer name
  const games = await col("eventsList").get();
  for (const g of games.docs) {
    const d = g.data() || {};
    const patch = {};
    for (const key of ["attendees", "waitingList", "declinedList", "joinRequests"]) {
      const list = copyList(d[key]);
      if (fixEntries(list, ids)) patch[key] = list;
    }
    if (d.teamAssignments && typeof d.teamAssignments === "object") {
      const ta = {};
      let tChanged = false;
      for (const [k, v] of Object.entries(d.teamAssignments)) {
        if (!Array.isArray(v)) { ta[k] = v; continue; }
        const list = copyList(v);
        if (fixEntries(list, ids)) tChanged = true;
        ta[k] = list;
      }
      if (tChanged) patch.teamAssignments = ta;
    }
    const org = ids.get(d.organizerId || "");
    if (org && d.organizer !== org.name) { patch.organizer = org.name; patch.hostName = org.name; }
    if (Object.keys(patch).length) { await g.ref.update(patch); changes++; }
  }

  // 2. Community member records and credit lists
  const communities = await col("communities").get();
  for (const c of communities.docs) {
    for (const sub of ["members", "credits"]) {
      const snaps = ids.size <= 5
        ? (await Promise.all([...ids.keys()].map((u) => c.ref.collection(sub).doc(u).get()))).filter((x) => x.exists)
        : (await c.ref.collection(sub).get()).docs;
      for (const s of snaps) {
        const who = ids.get(s.id);
        if (!who) continue;
        const m = s.data() || {};
        const patch = {};
        if (m.name !== who.name) patch.name = who.name;
        if (sub === "members" && who.avatar && m.avatar !== who.avatar) patch.avatar = who.avatar;
        if (Object.keys(patch).length) { await s.ref.update(patch); changes++; }
      }
    }
  }

  // 3. Friends lists that saved {uid, name, avatar}
  const rels = await db.collectionGroup("relationships").get();
  for (const r of rels.docs) {
    if (!r.ref.path.startsWith(`${BASE}/users/`)) continue;
    const d = r.data() || {};
    const patch = {};
    for (const key of ["friends", "sentRequests", "receivedRequests"]) {
      const list = copyList(d[key]);
      if (fixEntries(list, ids)) patch[key] = list;
    }
    if (Object.keys(patch).length) { await r.ref.update(patch); changes++; }
  }

  // 4. Chat threads (a thread's "id" is the other person's uid)
  const dir = await col("directory").get();
  for (const p of dir.docs) {
    const chats = arr((p.data() || {}).chats);
    let changed = false;
    const next = chats.map((t) => {
      const who = t && t.id !== p.id ? ids.get(t.id) : null;
      if (!who || (t.name === who.name && (!who.avatar || t.avatar === who.avatar))) return t;
      changed = true;
      return { ...t, name: who.name, ...(who.avatar ? { avatar: who.avatar } : {}) };
    });
    if (changed) { await p.ref.update({ chats: next }); changes++; }
  }
  return changes;
}
const propagateIdentity = (uid, name, avatar) => propagateIdentities(new Map([[uid, { name, avatar }]]));

// Profile edited → public card gets the same name/photo (the card change then updates every copy).
exports.onProfileIdentity = onDocumentWritten(`${BASE}/users/{uid}/profile/{docId}`, async (event) => {
  if (event.params.docId !== "data" || !event.data.after.exists) return;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.data() || {};
  const name = profileName(after);
  if (!realName(name)) return;
  const nameChanged = profileName(before) !== name;
  const avatarChanged = (before.avatar || "") !== (after.avatar || "");
  if (!nameChanged && !avatarChanged) return;

  const ref = col("directory").doc(event.params.uid);
  const card = (await ref.get()).data() || {};
  const patch = {};
  if (nameChanged && cardName(card) !== name) {
    patch.name = name;
    patch.firstName = cleanName(after.firstName);
    patch.lastName = cleanName(after.lastName);
  }
  if (avatarChanged && after.avatar && card.avatar !== after.avatar) patch.avatar = after.avatar;
  if ("nickname" in after && (card.nickname || "") !== (after.nickname || "")) patch.nickname = after.nickname || "";
  if (Object.keys(patch).length) await ref.set(patch, { merge: true });
});

// Public card changed name or photo → update every saved copy.
exports.onIdentityChanged = onDocumentWritten(`${BASE}/directory/{uid}`, async (event) => {
  if (!event.data.after.exists) return;
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.data() || {};
  const name = cardName(after);
  const avatar = shareableAvatar(after.avatar);
  if (cardName(before) === name && shareableAvatar(before.avatar) === avatar) return;   // chats, tokens... not a name change
  if (!realName(name)) return;
  const n = await propagateIdentity(event.params.uid, name, avatar);
  if (n) logger.info(`Name/photo synced for ${event.params.uid}: ${n} places updated`);
});

// Owner only: check everyone once. Cards that disagree with the person's own profile are fixed (which
// updates every copy), and a report lists names used by more than one account and cards without an account.
exports.syncAllNames = onCall({ timeoutSeconds: 540, memory: "512MiB" }, async (request) => {
  if (!isOwner(request.auth)) throw new HttpsError("permission-denied", "Only the FutNet owner can run this.");
  const fix = !(request.data && request.data.dryRun);
  const dir = await col("directory").get();
  const fixed = [];
  const everyone = new Map();
  const byName = new Map();
  const ids = [];
  for (const c of dir.docs) {
    ids.push(c.id);
    const card = c.data() || {};
    const prof = (await col("users").doc(c.id).collection("profile").doc("data").get()).data() || {};
    const want = profileName(prof);
    let name = cardName(card);
    if (realName(want) && want !== name) {
      fixed.push({ uid: c.id, from: name || "(empty)", to: want });
      if (fix) await c.ref.set({ name: want, firstName: cleanName(prof.firstName), lastName: cleanName(prof.lastName) }, { merge: true });
      name = want;
    }
    if (realName(name)) everyone.set(c.id, { name, avatar: shareableAvatar(card.avatar) });
    const key = name.toLowerCase();
    if (key) byName.set(key, [...(byName.get(key) || []), { uid: c.id, name }]);
  }

  // Every saved copy (rosters, members, friends, chats) gets the right name, in one pass.
  const updated = fix ? await propagateIdentities(everyone) : 0;

  // Cards with no login account behind them (left over from deleted or test accounts).
  const orphans = [];
  for (let i = 0; i < ids.length; i += 100) {
    const res = await admin.auth().getUsers(ids.slice(i, i + 100).map((uid) => ({ uid })));
    for (const nf of res.notFound) {
      const card = dir.docs.find((d) => d.id === nf.uid);
      orphans.push({ uid: nf.uid, name: cardName(card ? card.data() : {}) || "(no name)" });
    }
  }
  const duplicates = [...byName.values()].filter((l) => l.length > 1);
  logger.info(`syncAllNames: ${dir.size} cards, ${fixed.length} fixed, ${duplicates.length} shared names, ${orphans.length} without account`);
  return { cards: dir.size, fixed, updated, duplicates, orphans, dryRun: !fix };
});

// Owner only: remove public cards that have no login account behind them (they show up in searches).
exports.removeOrphanCards = onCall(async (request) => {
  if (!isOwner(request.auth)) throw new HttpsError("permission-denied", "Only the FutNet owner can run this.");
  const uids = arr(request.data && request.data.uids).map(String).slice(0, 200);
  let removed = 0;
  for (let i = 0; i < uids.length; i += 100) {
    const res = await admin.auth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
    for (const nf of res.notFound) { await col("directory").doc(nf.uid).delete(); removed++; }
  }
  return { removed };
});

// ---------------------------------------------------------------------------
// 12. Edit, delete and react to messages (private chats, community chat, game comments).
//     One place for the rules, used by the website and both apps:
//       react: anyone in the conversation (same emoji again = remove it)
//       edit: only who sent it
//       delete: who sent it, or an admin (community admin / game organizer)
//     The message keeps its place: deleted ones become "This message was deleted".
// ---------------------------------------------------------------------------
const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "⚽", "🔥"];

function applyMessageAction(m, caller, action, value, canModerate) {
  if (!m || m.deleted === true) throw new HttpsError("failed-precondition", "This message was deleted.");
  const sender = String(m.senderUid || m.senderId || m.uid || m.userId || "");
  if (action === "react") {
    const r = { ...(m.reactions && typeof m.reactions === "object" ? m.reactions : {}) };
    if (!value || r[caller] === value) delete r[caller];
    else {
      if (!REACTIONS.includes(value)) throw new HttpsError("invalid-argument", "That reaction isn't available.");
      r[caller] = value;
    }
    m.reactions = r;
  } else if (action === "edit") {
    if (sender !== caller) throw new HttpsError("permission-denied", "You can only edit your own messages.");
    const text = String(value || "").trim().slice(0, 1000);
    if (!text) throw new HttpsError("invalid-argument", "The message can't be empty.");
    m.text = text;
    m.edited = true;
    m.editedAt = Date.now();
  } else if (action === "vote") {
    // Polls: one vote each; "" takes your vote back.
    const p = m.poll && typeof m.poll === "object" ? m.poll : null;
    if (!p || !Array.isArray(p.options)) throw new HttpsError("failed-precondition", "That message isn't a poll.");
    const votes = { ...(p.votes && typeof p.votes === "object" ? p.votes : {}) };
    if (value === "") delete votes[caller];
    else {
      const i = parseInt(value, 10);
      if (!Number.isInteger(i) || i < 0 || i >= p.options.length) throw new HttpsError("invalid-argument", "That option doesn't exist.");
      votes[caller] = i;
    }
    m.poll = { ...p, votes };
  } else if (action === "delete") {
    if (sender !== caller && !canModerate) throw new HttpsError("permission-denied", "You can only delete your own messages.");
    m.deleted = true;
    m.deletedBy = caller;
    m.text = "";
    delete m.media;
    delete m.reactions;
    delete m.poll;
  } else {
    throw new HttpsError("invalid-argument", "Unknown action.");
  }
  return m;
}

exports.messageAction = onCall(async (request) => {
  const caller = request.auth && request.auth.uid;
  if (!caller) throw new HttpsError("unauthenticated", "Please sign in.");
  const d = request.data || {};
  const kind = String(d.kind || "");
  const where = String(d.id || "");
  const msgId = String(d.msgId || "");
  const action = String(d.action || "");
  const value = d.value == null ? "" : String(d.value);
  if (!where || !msgId) throw new HttpsError("invalid-argument", "Missing message.");

  if (kind === "dm") {
    // Both copies (mine and theirs) change together.
    const myRef = col("directory").doc(caller);
    const theirRef = col("directory").doc(where);
    await db.runTransaction(async (tx) => {
      const [mine, theirs] = await Promise.all([tx.get(myRef), tx.get(theirRef)]);
      const myChats = arr(mine.exists ? mine.data().chats : []);
      const theirChats = arr(theirs.exists ? theirs.data().chats : []);
      const myThread = myChats.find((t) => t && t.id === where);
      const msg = myThread && arr(myThread.messages).find((m) => m && m.id === msgId);
      if (!msg) throw new HttpsError("not-found", "Message not found.");
      const updated = applyMessageAction({ ...msg }, caller, action, value, false);
      const put = (chats, threadId) => {
        let hit = false;
        chats.forEach((t) => {
          if (!t || t.id !== threadId) return;
          t.messages = arr(t.messages).map((m) => {
            if (m && m.id === msgId) { hit = true; return { ...updated, isRead: m.isRead === true }; }
            return m;
          });
        });
        return hit;
      };
      put(myChats, where);
      tx.set(myRef, { chats: myChats }, { merge: true });
      if (theirs.exists && put(theirChats, caller)) tx.set(theirRef, { chats: theirChats }, { merge: true });
    });
    return { ok: true };
  }

  if (kind === "community") {
    const cRef = col("communities").doc(where);
    const [cSnap, memSnap] = await Promise.all([cRef.get(), cRef.collection("members").doc(caller).get()]);
    if (!cSnap.exists) throw new HttpsError("not-found", "Community not found.");
    const c = cSnap.data() || {};
    const mem = memSnap.exists ? memSnap.data() : null;
    if (!mem && c.adminId !== caller) throw new HttpsError("permission-denied", "Join the community first.");
    const until = mem && mem.adminUntil && mem.adminUntil.toMillis ? mem.adminUntil.toMillis() : 0;
    const isAdmin = c.adminId === caller || (mem && mem.role === "admin" && (!until || until > Date.now()));
    const mRef = cRef.collection("messages").doc(msgId);
    await db.runTransaction(async (tx) => {
      const s = await tx.get(mRef);
      if (!s.exists) throw new HttpsError("not-found", "Message not found.");
      const m = applyMessageAction({ ...s.data() }, caller, action, value, isAdmin);
      const patch = { reactions: m.reactions || FV.delete() };
      if (action === "edit") Object.assign(patch, { text: m.text, edited: true, editedAt: m.editedAt });
      if (action === "delete") Object.assign(patch, { text: "", deleted: true, deletedBy: caller, media: FV.delete(), reactions: FV.delete(), poll: FV.delete() });
      if (action === "vote") patch.poll = m.poll;
      tx.update(mRef, patch);
    });
    return { ok: true };
  }

  if (kind === "game") {
    // Game comments: an id, or "<uid>:<createdAt>" for older comments without one.
    let ref = col("eventsList").doc(where);
    let snap = await ref.get();
    if (!snap.exists) {
      const q = await col("eventsList").where("id", "==", where).limit(1).get();
      if (q.empty) throw new HttpsError("not-found", "Game not found.");
      ref = q.docs[0].ref;
    }
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const g = s.data() || {};
      const comments = arr(g.comments);
      const idx = comments.findIndex((c) => c && (c.id === msgId || `${commentAuthor(c)}:${c.createdAt || ""}` === msgId));
      if (idx < 0) throw new HttpsError("not-found", "Comment not found.");
      let isAdmin = g.organizerId === caller;
      if (!isAdmin && g.communityId) {
        const [cs, ms] = await Promise.all([tx.get(col("communities").doc(g.communityId)),
          tx.get(col("communities").doc(g.communityId).collection("members").doc(caller))]);
        const until = ms.exists && ms.data().adminUntil && ms.data().adminUntil.toMillis ? ms.data().adminUntil.toMillis() : 0;
        isAdmin = (cs.exists && cs.data().adminId === caller) || (ms.exists && ms.data().role === "admin" && (!until || until > Date.now()));
      }
      const original = comments[idx];
      const changed = applyMessageAction({ ...original, senderUid: commentAuthor(original) }, caller, action, value, isAdmin);
      if (!("senderUid" in original)) delete changed.senderUid;
      comments[idx] = changed;
      tx.update(ref, { comments });
    });
    return { ok: true };
  }

  throw new HttpsError("invalid-argument", "Unknown conversation.");
});


// ---------------------------------------------------------------------------
// 13. Weather for upcoming games (free Open-Meteo forecast, no key needed).
//     Every 3 hours: games in the next 7 days get `weather` = what to expect at kickoff
//     ({ emoji, label, tempF, rainPct, code, storm }). The website and apps show it on the game.
//     If storms show up for a game in the next 24 hours, the organizer gets one heads-up
//     to set the game status (Admin tab: Game on / Storm watch / Delayed).
// ---------------------------------------------------------------------------
const US_STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia", PR: "Puerto Rico" };

/** "Lakeside Park (Coconut Creek, FL)" -> { city: "Coconut Creek", state: "FL" } */
function cityOf(game) {
  const m = String(game.location || "").match(/\(([^(),]+),\s*([^()]+)\)\s*$/);
  if (m) return { city: m[1].trim(), state: m[2].trim() };
  if (game.city) return { city: String(game.city), state: String(game.state || "") };
  return null;
}

const geoCache = new Map();
async function geocode(city, state) {
  const k = `${city}|${state}`.toLowerCase();
  if (geoCache.has(k)) return geoCache.get(k);
  let out = null;
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=en&format=json`);
    const j = await r.json();
    const list = arr(j.results);
    const want = (US_STATES[String(state).toUpperCase()] || state || "").toLowerCase();
    const hit = list.find((x) => want && String(x.admin1 || "").toLowerCase() === want) || list.find((x) => x.country_code === "US") || list[0];
    if (hit) out = { lat: hit.latitude, lng: hit.longitude };
  } catch (e) { logger.warn("geocode failed", city, state, e.message); }
  geoCache.set(k, out);
  return out;
}

/** WMO weather code -> emoji + words */
function weatherLabel(code, rainPct) {
  if (code >= 95) return { emoji: "⛈️", label: "Thunderstorms", storm: true };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { emoji: "🌧️", label: rainPct >= 60 ? "Rain likely" : "Showers possible", storm: false };
  if (code >= 51 && code <= 57) return { emoji: "🌦️", label: "Drizzle", storm: false };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { emoji: "🌨️", label: "Snow", storm: false };
  if (code === 45 || code === 48) return { emoji: "🌫️", label: "Fog", storm: false };
  if (code === 3) return { emoji: "☁️", label: "Cloudy", storm: false };
  if (code === 1 || code === 2) return { emoji: "⛅", label: "Partly cloudy", storm: false };
  return { emoji: "☀️", label: "Clear", storm: false };
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function forecastFor(game) {
  const date = String(game.date || "").slice(0, 10);
  const place = cityOf(game);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !place) return null;
  const geo = (game.geo && typeof game.geo.lat === "number") ? game.geo : await geocode(place.city, place.state);
  if (!geo) return null;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lng}` +
    `&hourly=temperature_2m,precipitation_probability,weather_code&temperature_unit=fahrenheit&timezone=auto&start_date=${date}&end_date=${date}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  const times = arr(j.hourly && j.hourly.time);
  if (!times.length) return null;
  const hh = String(game.time || "18:00").match(/^(\d{1,2})/);
  const hour = Math.min(23, Math.max(0, hh ? parseInt(hh[1], 10) : 18));
  // kickoff hour, and the worst of the next 2 hours (a game lasts a while)
  const i0 = Math.max(0, times.findIndex((t) => t.endsWith(`T${String(hour).padStart(2, "0")}:00`)));
  const span = [i0, i0 + 1, i0 + 2].filter((i) => i < times.length);
  const codes = span.map((i) => Number(j.hourly.weather_code[i]) || 0);
  const rain = Math.max(...span.map((i) => Number(j.hourly.precipitation_probability[i]) || 0));
  const worst = codes.reduce((a, b) => (b >= 95 ? b : (a >= 95 ? a : Math.max(a, b))), codes[0]);
  const look = weatherLabel(worst, rain);
  return {
    weather: { ...look, code: worst, rainPct: Math.round(rain), tempF: Math.round(Number(j.hourly.temperature_2m[i0]) || 0), at: Date.now() },
    geo: { lat: geo.lat, lng: geo.lng },
  };
}

exports.refreshGameWeather = onSchedule({ schedule: "every 3 hours", timeZone: DEFAULT_TZ, timeoutSeconds: 300 }, async () => {
  const now = new Date();
  const until = new Date(now.getTime() + 7 * 86400000);
  const snap = await col("eventsList").where("date", ">=", ymd(new Date(now.getTime() - 86400000))).where("date", "<=", ymd(until) + "~").get();
  let updated = 0;
  for (const d of snap.docs) {
    const g = d.data() || {};
    if (g.isSessionEnded === true || g.isCancelled === true) continue;
    try {
      const f = await forecastFor(g);
      if (!f) continue;
      const old = g.weather || {};
      const same = old.emoji === f.weather.emoji && old.label === f.weather.label &&
        Math.abs((old.tempF || 0) - f.weather.tempF) < 3 && Math.abs((old.rainPct || 0) - f.weather.rainPct) < 10;
      const patch = {};
      if (!same) patch.weather = f.weather;
      if (!g.geo) patch.geo = f.geo;
      if (Object.keys(patch).length) { await d.ref.update(patch); updated++; }
      // Storms within 24 hours: one heads-up to the organizer (only while the game is still "on").
      const kick = new Date(`${String(g.date).slice(0, 10)}T${String(g.time || "18:00").slice(0, 5)}:00`);
      const hoursAway = (kick.getTime() - Date.now()) / 3600000;   // rough (server time zone); fine for a heads-up
      const watching = !!(g.gameStatus && g.gameStatus.stormWatch === true);
      if (f.weather.storm && !watching && hoursAway > -2 && hoursAway < 30 && g.organizerId) {
        await notify(await gameBosses(g), {
          type: "game_weather",
          eventId: d.id,
          title: `Storms forecast for ${g.title || "your game"} ⛈️`,
          body: `${f.weather.label} around kickoff (${f.weather.rainPct}% rain). Turn on Storm watch in the Admin tab so players know.`,
        }, { key: `stormwarn_${d.id}_${String(g.date).slice(0, 10)}` });
      }
    } catch (e) { logger.warn("weather failed", d.id, e.message); }
  }
  logger.info(`weather: ${snap.size} games checked, ${updated} updated`);
});

// ---------------------------------------------------------------------------
// 14. Member count: whenever someone joins or leaves a community, its membersCount is set to the
//     real number of members (the apps and website add/subtract 1 themselves, which can drift).
//     Every screen listens to the community, so the number updates live everywhere.
// ---------------------------------------------------------------------------
exports.syncMemberCount = onDocumentWritten(`${BASE}/communities/{communityId}/members/{uid}`, async (event) => {
  const joinedOrLeft = !event.data.before.exists || !event.data.after.exists;
  if (!joinedOrLeft) return;
  const ref = col("communities").doc(event.params.communityId);
  try {
    const agg = await ref.collection("members").count().get();
    const n = agg.data().count;
    const c = await ref.get();
    if (c.exists && Number((c.data() || {}).membersCount) !== n) await ref.update({ membersCount: n });
  } catch (e) { logger.warn("member count", event.params.communityId, e.message); }
});

// ---------------------------------------------------------------------------
// 16. Game reminder to everyone going (the roster, not the waitlist), once per game.
//     When it goes out depends on kickoff (Florida time):
//       12:00 AM - 8:00 AM   -> 10 PM the night before   "Game in the morning! ⚽"
//        8:01 AM - 10:00 AM  ->  6 AM                    "Game coming up soon! ⚽"
//       10:01 AM - 5:00 PM   ->  8 AM                    "Remember today's game! ⚽"
//        5:01 PM - 11:59 PM  -> 11 AM                    "Remember game today! ⚽"
//     A game made after that time still gets it right away (never later than 20 minutes before kickoff).
//     Players can turn it off with the "Games" notifications switch.
// ---------------------------------------------------------------------------
function reminderPlan(kickMinutes) {
  if (kickMinutes <= 8 * 60) return { dayBefore: true, at: "22:00", title: "Game in the morning! ⚽" };
  if (kickMinutes <= 10 * 60) return { dayBefore: false, at: "06:00", title: "Game coming up soon! ⚽" };
  if (kickMinutes <= 17 * 60) return { dayBefore: false, at: "08:00", title: "Remember today's game! ⚽" };
  return { dayBefore: false, at: "11:00", title: "Remember game today! ⚽" };
}

exports.gameDayReminders = onSchedule({ schedule: "every 15 minutes", timeZone: DEFAULT_TZ, timeoutSeconds: 120 }, async () => {
  const now = Date.now();
  const tz = DEFAULT_TZ;
  const dayOf = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(t));   // 2026-10-15
  const today = dayOf(now);
  const tomorrow = dayOf(startOf({ date: today, time: "12:00" }) + 86400000);
  const snap = await col("eventsList").where("date", ">=", today).where("date", "<=", tomorrow + "~").get();
  let sent = 0;
  for (const d of snap.docs) {
    const g = d.data() || {};
    if (g.isSessionEnded === true || g.isCancelled === true) continue;
    const start = startOf(g);
    if (!start || now > start - 20 * 60000) continue;                 // too close or already started
    const gameDay = String(g.date).slice(0, 10);
    const hm = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(new Date(start)).split(":").map(Number);
    const plan = reminderPlan(hm[0] * 60 + hm[1]);
    const sendDay = plan.dayBefore ? dayOf(startOf({ date: gameDay, time: "12:00" }) - 86400000) : gameDay;
    const sendAt = startOf({ date: sendDay, time: plan.at, timeZone: g.timeZone });
    if (!sendAt || now < sendAt) continue;                            // not time yet
    const going = uniq(arr(g.attendees).map(uidOf)).filter(isRealPlayer);
    if (!going.length) continue;
    try {
      await col("gameReminders").doc(`${d.id}_${gameDay}`).create({ eventId: d.id, date: gameDay, at: now, count: going.length });
    } catch (e) { continue; }                                         // already reminded for this game day
    const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(start));
    const when = plan.dayBefore ? `tomorrow at ${time}` : `today at ${time}`;
    const place = String(g.location || "").replace(/\s*\(.*$/, "").split(",")[0].trim();   // "Firefighters Park (Margate, FL)" -> "Firefighters Park"
    const storm = g.gameStatus && g.gameStatus.stormWatch === true
      ? ({ on: " ✅ Game on.", likely: " 🟡 Game likely, watching the weather.", unlikely: " 🔴 Game not likely, check the game for updates." }[g.gameStatus.state] || "")
      : "";
    await notify(going, {
      type: "game_reminder",
      eventId: d.id,
      communityId: g.communityId || "",
      title: plan.title,
      body: `${g.title || "Your game"} ${when}${place ? ` at ${place}` : ""}. See you there!${storm}`,
    }, { key: `remind_${d.id}_${gameDay}` });
    sent++;
  }
  if (sent) logger.info(`game reminders: ${sent} games`);
});

// ---------------------------------------------------------------------------
// 17. Player stats for the profile (website + apps): everything a player did in finished games.
//     playerStats({ uid, communityId? }) -> totals, W/D/L, attendance, goals by month,
//     last 5 games, best game, and the communities they played in (for the switch).
//     Same counting as the leaderboard and results page: 3 pts a win, own goals count for nobody.
// ---------------------------------------------------------------------------
let endedCache = { at: 0, games: [] };
async function endedGames() {
  if (Date.now() - endedCache.at < 3 * 60000) return endedCache.games;
  const snap = await col("eventsList").where("isSessionEnded", "==", true).get();
  endedCache = { at: Date.now(), games: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
  return endedCache.games;
}

const ownGoal = (g) => /^(own goal|unknown scorer)\b/i.test(String((g && typeof g === "object") ? (g.name || g.scorer || "") : (g || "")).trim());
const teamCount = (g) => {
  if (typeof g.teamsCount === "number") return g.teamsCount;
  const n = parseInt((String(g.teamsCount || "").match(/(\d+)/) || [])[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
};
const teamPlayers = (g, i) => {
  const ta = g.teamAssignments || {};
  const list = Array.isArray(ta) ? ta[i] : (ta[i] !== undefined ? ta[i] : ta[String(i)]);
  return (Array.isArray(list) ? list : []).filter((p) => p && (p.uid || p.name));
};

/** One finished game from one player's point of view (null = they weren't in it). */
function playerGame(g, uid) {
  const att = arr(g.attendees).find((a) => uidOf(a) === uid);
  const n = teamCount(g);
  const names = Array.from({ length: n }, (_, i) => (g.teamNames || {})[i] || `Team ${i + 1}`);
  let myTeam = -1;
  for (let i = 0; i < n && myTeam < 0; i++) if (teamPlayers(g, i).some((p) => uidOf(p) === uid)) myTeam = i;
  if (!att && myTeam < 0) return null;
  // My names (goals are saved by name): roster name + team-sheet name
  const myNames = new Set([att && att.name, ...(myTeam >= 0 ? teamPlayers(g, myTeam).filter((p) => uidOf(p) === uid).map((p) => p.name) : [])]
    .filter(Boolean).map((s) => String(s).trim().toLowerCase()));
  const isMine = (goal) => {
    if (!goal || ownGoal(goal)) return false;
    if (typeof goal === "object" && (goal.uid || goal.userId)) return (goal.uid || goal.userId) === uid;
    return myNames.has(String(typeof goal === "object" ? (goal.name || goal.scorer || "") : goal).trim().toLowerCase());
  };
  const pick = (idx, name, fb) => (Number.isInteger(idx) && idx >= 0 && idx < n) ? idx : (names.indexOf(name) !== -1 ? names.indexOf(name) : fb);
  const table = names.map((nm, i) => ({ i, pts: 0, gf: 0, ga: 0 }));
  let goals = 0, w = 0, dr = 0, l = 0, gf = 0, ga = 0, ownGoals = 0;
  // "Own goal (Name)": the name is the player who put it in their own net.
  const ogBy = (goal) => {
    const t = typeof goal === "object" && goal ? (goal.name || goal.scorer || "") : String(goal || "");
    const mm = String(t).match(/^own goal \((.+)\)\s*$/i);
    return mm ? mm[1].trim().toLowerCase() : "";
  };
  for (const m of arr(g.matches)) {
    if (!m || m.isFinished === false) continue;
    const a = pick(m.teamAIndex, m.teamA, 0), b = pick(m.teamBIndex, m.teamB, 1);
    if (!table[a] || !table[b] || a === b) continue;
    const g1 = arr(m.team1Goals), g2 = arr(m.team2Goals);
    const s1 = g1.length, s2 = g2.length;
    table[a].gf += s1; table[a].ga += s2; table[b].gf += s2; table[b].ga += s1;
    if (s1 > s2) table[a].pts += 3; else if (s2 > s1) table[b].pts += 3; else { table[a].pts++; table[b].pts++; }
    goals += [...g1, ...g2].filter(isMine).length;
    ownGoals += [...g1, ...g2].filter((x) => { const o = ogBy(x); return o && myNames.has(o); }).length;
    if (myTeam === a || myTeam === b) {
      const mine = myTeam === a ? s1 : s2, theirs = myTeam === a ? s2 : s1;
      gf += mine; ga += theirs;
      if (mine > theirs) w++; else if (mine < theirs) l++; else dr++;
    }
  }
  const order = table.slice().sort((x, y) => (y.pts - x.pts) || ((y.gf - y.ga) - (x.gf - x.ga)) || (y.gf - x.gf));
  const place = myTeam >= 0 && (w + dr + l) > 0 ? order.findIndex((t) => t.i === myTeam) + 1 : 0;
  return {
    eventId: g.id, title: g.title || "Game", date: String(g.date || "").slice(0, 10), communityId: g.communityId || "",
    goals, ownGoals, w, d: dr, l, gf, ga, place, champion: place === 1, lastPlace: place > 1 && place === n, team: myTeam >= 0 ? names[myTeam] : "",
    attendance: (att && att.attendance) || "", signedUp: !!att,
  };
}

function buildPlayerStats(games, uid, communityId) {
  const all = games.map((g) => playerGame(g, uid)).filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const comms = {};
  all.forEach((x) => { if (x.communityId) comms[x.communityId] = (comms[x.communityId] || 0) + 1; });
  const list = communityId ? all.filter((x) => x.communityId === communityId) : all;
  const showed = list.filter((x) => x.attendance !== "noshow");
  const sum = (k) => showed.reduce((s, x) => s + x[k], 0);
  const matches = sum("w") + sum("d") + sum("l");
  const goals = sum("goals");
  // Goals and games per month, last 12 months (oldest first)
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const inMonth = showed.filter((x) => x.date.startsWith(key));
    months.push({ month: key, games: inMonth.length, goals: inMonth.reduce((s, x) => s + x.goals, 0) });
  }
  const best = showed.reduce((b, x) => (x.goals > (b ? b.goals : 0) ? x : b), null);
  const signed = list.filter((x) => x.signedUp);
  return {
    uid,
    communityId: communityId || "",
    totals: {
      games: showed.length, matches, wins: sum("w"), draws: sum("d"), losses: sum("l"), goals,
      champion: showed.filter((x) => x.champion).length,
      winPct: matches ? Math.round((sum("w") / matches) * 100) : 0,
      goalsPerGame: showed.length ? Math.round((goals / showed.length) * 10) / 10 : 0,
    },
    attendance: {
      joined: signed.length,
      showed: signed.filter((x) => x.attendance !== "noshow").length,
      late: signed.filter((x) => x.attendance === "late").length,
      noShow: signed.filter((x) => x.attendance === "noshow").length,
      pct: signed.length ? Math.round((signed.filter((x) => x.attendance !== "noshow").length / signed.length) * 100) : 0,
    },
    months,
    recent: showed.slice(0, 5).map(({ eventId, title, date, goals: gl, w, d, l, place, team }) => ({ eventId, title, date, goals: gl, w, d, l, place, team })),
    best: best && best.goals > 0 ? { eventId: best.eventId, title: best.title, date: best.date, goals: best.goals } : null,
    communities: Object.entries(comms).map(([id, n]) => ({ id, games: n })),
  };
}

// ---------------------------------------------------------------------------
// 18. Stars: attendance (are they reliable?) and skill (how good, from the stats). Shown to everyone.
//   Attendance, points per game: on time 5, late 4, cancelled < 2 h before kickoff 2, no-show 0.
//   Skill, per match, ranked against the other players (so 3 stars = middle of the pack):
//     win rate 35%, team +/- per match 30%, goals per match 25%, titles 10%
//     (keepers/defenders: goals 10%, +/- 45%; forwards: goals 30%, +/- 25%).
//   Both: 60% last 10 games + 40% whole history once there are 10 games; "New" until 3 games.
//   Skill is pulled toward 3 stars while there are few games, so one lucky night isn't 5 stars.
// ---------------------------------------------------------------------------
let ratingIndex = { at: 0, byUid: null, cancels: null };
async function ratingData() {
  if (ratingIndex.byUid && Date.now() - ratingIndex.at < 3 * 60000) return ratingIndex;
  const games = await endedGames();
  const byUid = {};
  for (const g of games) {
    const uids = new Set(arr(g.attendees).map(uidOf));
    for (let i = 0; i < teamCount(g); i++) teamPlayers(g, i).forEach((p) => uids.add(uidOf(p)));
    for (const u of uids) {
      if (!isRealPlayer(u)) continue;
      const r = playerGame(g, u);
      if (r) (byUid[u] = byUid[u] || []).push(r);
    }
  }
  Object.values(byUid).forEach((list) => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)));
  let cancels = {};
  try {
    const snap = await col("cancellations").get();
    snap.docs.forEach((d) => { const c = d.data() || {}; if (c.uid) (cancels[c.uid] = cancels[c.uid] || []).push(c); });
  } catch (e) { cancels = {}; }
  ratingIndex = { at: Date.now(), byUid, cancels };
  return ratingIndex;
}

const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
const halfStars = (v) => Math.max(0, Math.min(5, Math.round(v * 2) / 2));
const blend = (all, recent, n) => (n >= 10 ? 0.6 * recent + 0.4 * all : all);

function attendanceRating(records, cancels, communityId) {
  const played = new Set(records.map((r) => r.eventId));
  const today = new Date().toISOString().slice(0, 10);
  const entries = [
    ...records.filter((r) => r.signedUp).map((r) => ({ date: r.date, pts: r.attendance === "noshow" ? 0 : r.attendance === "late" ? 4 : 5 })),
    ...cancels.filter((c) => !played.has(c.eventId) && c.date <= today && (!communityId || c.communityId === communityId)).map((c) => ({ date: c.date, pts: 2 })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const n = entries.length;
  const score = blend(avg(entries.map((e) => e.pts)), avg(entries.slice(0, 10).map((e) => e.pts)), n);
  return {
    score: Math.round(score * 10) / 10, stars: halfStars(score), games: n, isNew: n < 3,
    onTime: entries.filter((e) => e.pts === 5).length, late: entries.filter((e) => e.pts === 4).length,
    lateCancels: entries.filter((e) => e.pts === 2).length, noShows: entries.filter((e) => e.pts === 0).length,
  };
}

function rates(list) {
  const showed = list.filter((r) => r.attendance !== "noshow");
  const m = showed.reduce((s, r) => s + r.w + r.d + r.l, 0);
  if (!m) return null;
  return {
    win: showed.reduce((s, r) => s + r.w, 0) / m,
    pm: showed.reduce((s, r) => s + r.gf - r.ga, 0) / m,
    gpm: showed.reduce((s, r) => s + r.goals, 0) / m,
    title: showed.filter((r) => r.champion).length / showed.length,
    games: showed.length,
  };
}

function skillWeights(position) {
  const p = String(position || "").toLowerCase();
  if (/goal|keeper|gk|defen|back|cb|lb|rb/.test(p)) return { win: 0.35, pm: 0.45, gpm: 0.10, title: 0.10 };
  if (/forw|strik|wing|st\b|cf|attack/.test(p)) return { win: 0.35, pm: 0.25, gpm: 0.30, title: 0.10 };
  return { win: 0.35, pm: 0.30, gpm: 0.25, title: 0.10 };
}

/** Everyone's rates in this scope (players with 3+ games), to rank against. */
function skillPopulation(byUid, communityId) {
  const pop = { win: [], pm: [], gpm: [], title: [] };
  for (const list of Object.values(byUid)) {
    const r = rates(communityId ? list.filter((x) => x.communityId === communityId) : list);
    if (!r || r.games < 3) continue;
    pop.win.push(r.win); pop.pm.push(r.pm); pop.gpm.push(r.gpm); pop.title.push(r.title);
  }
  return pop;
}

function skillRating(records, pop, position) {
  const showed = records.filter((r) => r.attendance !== "noshow");
  const all = rates(showed);
  const n = all ? all.games : 0;
  if (!all || n < 3) return { score: 0, stars: 0, games: n, isNew: true };
  const pct = (list, x) => (list.length ? (list.filter((v) => v < x).length + 0.5 * list.filter((v) => v === x).length) / list.length : 0.5);
  const w = skillWeights(position);
  const composite = (r) => w.win * pct(pop.win, r.win) + w.pm * pct(pop.pm, r.pm) + w.gpm * pct(pop.gpm, r.gpm) + w.title * pct(pop.title, r.title);
  const recent = rates(showed.slice(0, 10)) || all;
  const raw = 1 + 4 * blend(composite(all), composite(recent), n);
  const score = 3 + (raw - 3) * (n / (n + 4));   // few games -> closer to 3
  return { score: Math.round(score * 10) / 10, stars: halfStars(score), games: n, isNew: false };
}

async function positionOf(uid) {
  try { return ((await col("directory").doc(uid).get()).data() || {}).position || ""; } catch (e) { return ""; }
}

async function ratingsFor(uid, communityId, position) {
  const { byUid, cancels } = await ratingData();
  const all = byUid[uid] || [];
  const records = communityId ? all.filter((r) => r.communityId === communityId) : all;
  return {
    attendance: attendanceRating(records, cancels[uid] || [], communityId),
    skill: skillRating(records, skillPopulation(byUid, communityId), position),
  };
}

/** Community Info: top 5 players (skill stars) and top 5 scorers, from this community's finished games. */
exports.communityTop = onCall(async (request) => {
  if (!(request.auth && request.auth.uid)) throw new HttpsError("unauthenticated", "Please sign in.");
  const communityId = String((request.data || {}).communityId || "");
  if (!communityId) throw new HttpsError("invalid-argument", "Missing community.");
  const { byUid } = await ratingData();
  const pop = skillPopulation(byUid, communityId);
  const rows = [];
  for (const [u, list] of Object.entries(byUid)) {
    const mine = list.filter((r) => r.communityId === communityId && r.attendance !== "noshow");
    if (!mine.length) continue;
    rows.push({ uid: u, list: mine, games: mine.length, goals: mine.reduce((s, r) => s + r.goals, 0) });
  }
  const scorers = rows.filter((r) => r.goals > 0).sort((a, b) => (b.goals - a.goals) || (a.games - b.games)).slice(0, 5);
  const candidates = rows.filter((r) => r.games >= 3);
  const positions = await Promise.all(candidates.map((r) => positionOf(r.uid)));
  const players = candidates.map((r, i) => ({ ...r, skill: skillRating(r.list, pop, positions[i]) }))
    .sort((a, b) => (b.skill.score - a.skill.score) || (b.games - a.games)).slice(0, 5);
  // Wall of shame: most losses and most own goals (matches lost, all time in this community).
  const sum = (list, k) => list.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  rows.forEach((r) => { r.losses = sum(r.list, "l"); r.ogs = sum(r.list, "ownGoals"); });
  const losers = rows.filter((r) => r.losses > 0).sort((a, b) => (b.losses - a.losses) || (a.games - b.games)).slice(0, 5);
  const ogs = rows.filter((r) => r.ogs > 0).sort((a, b) => (b.ogs - a.ogs) || (a.games - b.games)).slice(0, 5);
  // Sessions (whole game days): won = your team finished 1st, lost = your team finished last.
  rows.forEach((r) => { r.sWon = r.list.filter((x) => x.champion).length; r.sLost = r.list.filter((x) => x.lastPlace).length; });
  const sessionKings = rows.filter((r) => r.sWon > 0).sort((a, b) => (b.sWon - a.sWon) || (a.games - b.games)).slice(0, 5);
  const sessionLosers = rows.filter((r) => r.sLost > 0).sort((a, b) => (b.sLost - a.sLost) || (a.games - b.games)).slice(0, 5);
  // This week (Monday to today): best and worst, only when there was a finished game this week.
  const dayOf = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TZ }).format(new Date(t));
  const today = dayOf(Date.now());
  const dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7;            // 0 = Monday
  const monday = dayOf(Date.parse(today + "T12:00:00Z") - dow * 86400000);
  const weekRows = rows.map((r) => {
    const wk = r.list.filter((x) => x.date >= monday && x.date <= today);
    const w = sum(wk, "w"), d = sum(wk, "d"), l = sum(wk, "l");
    return { uid: r.uid, n: w + d + l, w, d, l, pts: w * 3 + d, gd: sum(wk, "gf") - sum(wk, "ga"), goals: sum(wk, "goals") };
  }).filter((r) => r.n > 0);
  let best = [], worst = [];
  if (weekRows.length) {
    best = weekRows.slice().sort((a, b) => (b.pts - a.pts) || (b.gd - a.gd) || (b.goals - a.goals)).slice(0, 3);
    const top = new Set(best.map((r) => r.uid));
    worst = weekRows.filter((r) => !top.has(r.uid)).sort((a, b) => (a.pts - b.pts) || (a.gd - b.gd) || (b.l - a.l)).slice(0, 3);
  }
  // Names + photos from the directory
  const uids = uniq([...players, ...scorers, ...losers, ...ogs, ...sessionKings, ...sessionLosers, ...best, ...worst].map((r) => r.uid));
  const dir = {};
  await Promise.all(uids.map((u) => col("directory").doc(u).get().then((d) => { dir[u] = d.data() || {}; }).catch(() => { dir[u] = {}; })));
  const who = (u) => {
    const d = dir[u] || {};
    return { uid: u, name: d.name || `${d.firstName || ""} ${d.lastName || ""}`.trim() || "Player", avatar: String(d.avatar || "").startsWith("http") ? d.avatar : "" };
  };
  return {
    players: players.map((r) => ({ ...who(r.uid), stars: r.skill.stars, score: r.skill.score, games: r.games })),
    scorers: scorers.map((r) => ({ ...who(r.uid), goals: r.goals, games: r.games })),
    losses: losers.map((r) => ({ ...who(r.uid), losses: r.losses, games: r.games })),
    ownGoals: ogs.map((r) => ({ ...who(r.uid), ownGoals: r.ogs, games: r.games })),
    sessionsWon: sessionKings.map((r) => ({ ...who(r.uid), sessions: r.sWon, games: r.games })),
    sessionsLost: sessionLosers.map((r) => ({ ...who(r.uid), sessions: r.sLost, games: r.games })),
    week: weekRows.length ? {
      from: monday, to: today,
      best: best.map((r) => ({ ...who(r.uid), w: r.w, d: r.d, l: r.l, pts: r.pts, gd: r.gd, goals: r.goals })),
      worst: worst.map((r) => ({ ...who(r.uid), w: r.w, d: r.d, l: r.l, pts: r.pts, gd: r.gd, goals: r.goals })),
    } : null,
  };
});

/** Stars for a list of players (rosters): { ratings: { uid: { skill, attendance } } } */
exports.playerRatings = onCall(async (request) => {
  if (!(request.auth && request.auth.uid)) throw new HttpsError("unauthenticated", "Please sign in.");
  const uids = arr((request.data || {}).uids).map(String).filter(isRealPlayer).slice(0, 80);
  const { byUid, cancels } = await ratingData();
  const pop = skillPopulation(byUid, "");
  const positions = await Promise.all(uids.map(positionOf));
  const ratings = {};
  uids.forEach((u, i) => {
    const records = byUid[u] || [];
    const sk = skillRating(records, pop, positions[i]);
    const at = attendanceRating(records, cancels[u] || [], "");
    ratings[u] = { skill: { stars: sk.stars, isNew: sk.isNew }, attendance: { stars: at.stars, isNew: at.isNew } };
  });
  return { ratings };
});

async function computePlayerStats(uid, communityId) {
  const stats = buildPlayerStats(await endedGames(), uid, communityId);
  stats.ratings = await ratingsFor(uid, communityId, await positionOf(uid));
  // Community names for the switch
  const names = await Promise.all(stats.communities.map((c) => col("communities").doc(c.id).get().then((s) => (s.data() || {}).name || "Community").catch(() => "Community")));
  stats.communities = stats.communities.map((c, i) => ({ ...c, name: names[i] })).sort((a, b) => b.games - a.games);
  return stats;
}

// Ready-made stats: one saved answer per player (and per community), rebuilt when a finished game
// changes and every night, so opening a profile is one quick read instead of going through every game.
const statsCacheRef = (uid, cid) => col("playerStatsCache").doc(`${uid}_${cid || "all"}`);
async function saveStats(uid, cid) {
  const stats = await computePlayerStats(uid, cid);
  await statsCacheRef(uid, cid).set({ stats, at: Date.now() });
  return stats;
}
async function refreshStatsFor(uids, cids) {
  endedCache.at = 0; ratingIndex.at = 0;            // read the games again
  for (const u of uniq(uids).filter(isRealPlayer)) {
    for (const c of uniq(["", ...cids.filter(Boolean)])) {
      try { await saveStats(u, c); } catch (e) { logger.warn("stats rebuild failed", u, c, e.message); }
    }
  }
}

exports.playerStats = onCall(async (request) => {
  if (!(request.auth && request.auth.uid)) throw new HttpsError("unauthenticated", "Please sign in.");
  const uid = String((request.data || {}).uid || request.auth.uid);
  const communityId = String((request.data || {}).communityId || "");
  try {
    const s = await statsCacheRef(uid, communityId).get();
    const d = s.exists ? s.data() : null;
    if (d && d.stats && Date.now() - (Number(d.at) || 0) < 26 * 3600000) return d.stats;
  } catch (e) { /* build it below */ }
  return saveStats(uid, communityId);
});

/** Every night: rebuild everyone's saved stats (stars move a little as other players play). */
exports.rebuildPlayerStats = onSchedule({ schedule: "every day 04:00", timeZone: DEFAULT_TZ, timeoutSeconds: 540, memory: "512MiB" }, async () => {
  endedCache.at = 0; ratingIndex.at = 0;
  const { byUid } = await ratingData();
  let n = 0;
  for (const [u, list] of Object.entries(byUid)) {
    for (const c of uniq(["", ...list.map((r) => r.communityId).filter(Boolean)])) {
      try { await saveStats(u, c); n++; } catch (e) { logger.warn("stats rebuild failed", u, c, e.message); }
    }
  }
  logger.info(`Rebuilt ${n} saved stats`);
});
