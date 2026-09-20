const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
admin.initializeApp();

const appId = "futnetsite-de7c3";

exports.sendChatNotification = onDocumentCreated(
  `artifacts/${appId}/notifications/{notificationId}`,
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.log("No data associated with the event");
      return;
    }

    const notification = snapshot.data();
    const recipientUid = notification.recipientUid;
    const title = notification.title || "New Notification";
    const body = notification.body || "";
    const type = notification.type || "chat_message";

    if (!recipientUid) {
      console.log("Missing recipientUid in notification record.");
      return;
    }

    try {
      // Fetch the recipient's directory document to get their FCM token
      const userDocRef = admin.firestore()
        .collection("artifacts")
        .doc(appId)
        .collection("directory")
        .doc(recipientUid);

      const userDoc = await userDocRef.get();
      if (!userDoc.exists) {
        console.log(`Recipient directory document not found for UID: ${recipientUid}`);
        return;
      }

      const userData = userDoc.data();
      const fcmToken = userData.fcmToken || userData.fcmToke; // Support both naming keys

      if (!fcmToken) {
        console.log(`No FCM token registered for recipient UID: ${recipientUid}`);
        return;
      }

      // Construct the FCM message payload
      const message = {
        token: fcmToken,
        notification: {
          title: title,
          body: body,
        },
        data: {
          type: type,
          senderUid: notification.senderUid || "",
        },
      };

      // Send the push notification via FCM
      const response = await admin.messaging().send(message);
      console.log("Successfully sent FCM push notification:", response);

      // Mark notification record as read/sent
      await snapshot.ref.update({ sent: true, sentAt: admin.firestore.FieldValue.serverTimestamp() });
    } catch (error) {
      console.error("Error sending FCM notification:", error);
    }
  }
);