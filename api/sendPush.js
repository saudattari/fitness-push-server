const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const app = express();
const port = process.env.PORT || 3000;

// Firebase Admin SDK Setup
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  universe_domain: "googleapis.com",
};

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("Firebase initialized successfully");
} catch (error) {
  console.error("Firebase initialization failed:", error);
  throw error;
}

const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

async function sendPush(playerId, name) {
  try {
    const payload = {
      app_id: process.env.ONESIGNAL_APP_ID,
      target_channel: "push",
      name: "Daily Workout Reminder",
      include_player_ids: [playerId],
      headings: { en: `${name}, don't forget!` },
      contents: { en: "You haven’t completed your workout today 💪" },
      big_picture: "https://avatars.githubusercontent.com/u/11823027?s=200&v=4",
      ios_attachments: {
        onesignal_logo: "https://avatars.githubusercontent.com/u/11823027?s=200&v=4",
      },
    };

    const headers = {
      Authorization: `Key ${process.env.ONESIGNAL_API_KEY}`,
      "Content-Type": "application/json; charset=utf-8",
    };

    const response = await axios.post("https://api.onesignal.com/notifications", payload, { headers });
    console.log(`✅ Push sent to ${name}, response:`, response.data);
    return response.data;
  } catch (error) {
    console.error(`❌ Push failed for ${name}:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    throw error;
  }
}

app.get('/sendPush', async (req, res) => {
  try {
    const db = admin.firestore();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    console.log(`Querying DailyCheck for date range: ${startOfDay} to ${endOfDay}`);
    const dailyCheckSnapshot = await db
      .collection("DailyCheck")
      .where("date", ">=", admin.firestore.Timestamp.fromDate(startOfDay))
      .where("date", "<", admin.firestore.Timestamp.fromDate(endOfDay))
      .get();

    console.log(`Found ${dailyCheckSnapshot.size} entries for today`);

    const notifications = [];

    for (const doc of dailyCheckSnapshot.docs) {
      const data = doc.data();
      const { userId, workoutCompleted, notificationSent } = data;

      if (!userId || workoutCompleted || notificationSent) {
        console.log(`Skipped document: ${doc.id}, userId: ${userId}, workoutCompleted: ${workoutCompleted}, notificationSent: ${notificationSent}`);
        continue;
      }

      const userDoc = await db.collection("Users").doc(userId).get();
      if (!userDoc.exists) {
        console.log(`User not found for userId: ${userId}`);
        continue;
      }

      const userData = userDoc.data();
      const playerId = userData?.fcmToken;
      const name = userData?.name || "Hey there";

      if (!playerId) {
        console.log(`No playerId for userId: ${userId}`);
        continue;
      }

      notifications.push({ playerId, name, docId: doc.id });
    }

    const batches = chunkArray(notifications, 10);
    for (const batch of batches) {
      const batchPromises = batch.map(({ playerId, name, docId }) =>
        Promise.all([
          sendPush(playerId, name),
          db.collection("DailyCheck").doc(docId).update({
            notificationSent: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }),
        ])
      );
      await Promise.all(batchPromises);
    }

    console.log("All notifications processed successfully");
    res.status(200).send("✅ Push notifications sent for today.");
  } catch (error) {
    console.error("Error in /sendPush:", {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).send("❌ Failed to send push notifications");
  }
});

app.listen(port, () => {
  console.log(`🚀 Push server running at http://localhost:${port}`);
});