const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const app = express();
const port = process.env.PORT || 3000;

// Firebase Admin SDK Seup
const serviceAccount = require('./fitness-guru-1112b-c5f25ea1da12.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
console.log("Firebase initialized successfully");

app.get('/sendPush', async (req, res) => {
  try {
    const db = admin.firestore();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    console.log(`Querying DailyCheck for date range: ${startOfDay} to ${endOfDay}`);
    const dailyCheckSnapshot = await db.collection("DailyCheck")
      .where("date", ">=", startOfDay)
      .where("date", "<", endOfDay)
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

      console.log(`Sending push to playerId: ${playerId}, name: ${name}`);
      notifications.push(sendPush(playerId, name));

      await db.collection("DailyCheck").doc(doc.id).update({
        notificationSent: true
      });
      console.log(`Updated notificationSent for document: ${doc.id}`);
    }

    await Promise.all(notifications);
    console.log("All notifications processed successfully");
    res.send("✅ Push notifications sent for today.");
  } catch (error) {
    console.error("Error in /sendPush:", error);
    res.status(500).send("❌ Failed to send push notifications");
  }
});

async function sendPush(playerId, name) {
  try {
    const payload = {
      app_id: "cc7c28e7-d45c-41ec-9e24-2e422a03a26c",
      target_channel: "push",
      name: "Daily Workout Reminder",
      include_player_ids: [playerId],
      headings: { en: `${name}, don't forget!` },
      contents: { en: "You haven’t completed your workout today 💪" },
      big_picture: "https://avatars.githubusercontent.com/u/11823027?s=200&v=4",
      ios_attachments: {
        onesignal_logo: "https://avatars.githubusercontent.com/u/11823027?s=200&v=4"
      }
    };

    const headers = {
      Authorization: "Key os_v2_app_zr6crz6ulra6zhrefzbcua5cns6b4p65qcie444jqsqxjt5qwlkoicclaz5ctckvyzo4bi5fmvsdvw3ukw3watbhk5ihjpo2bmxo5ma",
      "Content-Type": "application/json; charset=utf-8"
    };

    const response = await axios.post("https://api.onesignal.com/notifications", payload, { headers });
    console.log(`✅ Push sent to ${name}, response:`, response.data);
    return response.data;
  } catch (error) {
    console.error(`❌ Push failed for ${name}:`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    throw error;
  }
}

app.listen(port, () => {
  console.log(`🚀 Push server running at http://localhost:${port}`);
});