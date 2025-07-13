const admin = require("firebase-admin");
const axios = require("axios");

if (!admin.apps.length) {
  try {
    const decoded = Buffer.from(process.env.FIREBASE_KEY_BASE64, "base64").toString("utf8");
    const serviceAccount = JSON.parse(decoded);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    console.log("Firebase initialized successfully");
  } catch (e) {
    console.error("Failed to initialize Firebase:", e);
  }
}

module.exports = async (req, res) => {
  try {
    const db = admin.firestore();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    console.log(`Querying DailyCheck from ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`);

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
        console.log(`Skipping document: ${doc.id}`);
        continue;
      }

      const userDoc = await db.collection("Users").doc(userId).get();
      if (!userDoc.exists) {
        console.log(`User not found: ${userId}`);
        continue;
      }

      const userData = userDoc.data();
      const playerId = userData?.fcmToken;
      const name = userData?.name || "Hey there";

      if (!playerId) {
        console.log(`Missing playerId for user ${userId}`);
        continue;
      }

      console.log(`Sending push to ${name} (playerId: ${playerId})`);
      notifications.push(sendPush(playerId, name));

      await db.collection("DailyCheck").doc(doc.id).update({
        notificationSent: true
      });

      console.log(`Updated 'notificationSent' for: ${doc.id}`);
    }

    await Promise.all(notifications);
    console.log("All notifications processed");
    res.status(200).send("Push notifications sent for today.");
  } catch (error) {
    console.error("Error in /sendPush:", error);
    res.status(500).send("Failed to send push notifications");
  }
};

async function sendPush(playerId, name) {
  try {
    const payload = {
      app_id: "cc7c28e7-d45c-41ec-9e24-2e422a03a26c",
      target_channel: "push",
      name: "Daily Workout Reminder",
      include_player_ids: [playerId],
      headings: { en: `${name}, don't forget!` },
      contents: { en: "You haven’t completed your workout today" },
      big_picture: "https://res.cloudinary.com/dfwynwymk/image/upload/v1752379629/sp_picture_m9hjmq.png",
      ios_attachments: {
        onesignal_logo: "https://res.cloudinary.com/dfwynwymk/image/upload/v1752379629/sp_picture_m9hjmq.png"
      }
    };

    const headers = {
      Authorization: "Key os_v2_app_zr6crz6ulra6zhrefzbcua5cns6b4p65qcie444jqsqxjt5qwlkoicclaz5ctckvyzo4bi5fmvsdvw3ukw3watbhk5ihjpo2bmxo5ma",
      "Content-Type": "application/json; charset=utf-8"
    };

    const response = await axios.post("https://api.onesignal.com/notifications", payload, { headers });
    console.log(`Push sent to ${name}`, response.data);
    return response.data;
  } catch (error) {
    console.error(`Push failed for ${name}`, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    throw error;
  }
}
