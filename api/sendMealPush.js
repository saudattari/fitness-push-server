const admin = require("firebase-admin");
const axios = require("axios");

// Initialize Firebase
if (!admin.apps.length) {
  const decoded = Buffer.from(process.env.FIREBASE_KEY_BASE64, "base64").toString("utf8");
  const serviceAccount = JSON.parse(decoded);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkMealAndNotify() {
  const today = new Date().toISOString().split("T")[0]; // Format: YYYY-MM-DD

  // 🔁 Loop through all users (or use a specific list)
  const usersSnapshot = await db.collection("Users").get();

  for (const doc of usersSnapshot.docs) {
    const userId = doc.id;
    const dailyDocId = `${userId}_${today}`;
    const dailyDocRef = db.collection("DailyCheck").doc(dailyDocId);
    const dailyDoc = await dailyDocRef.get();

    let shouldNotify = false;

    if (!dailyDoc.exists) {
      // No document means meal not logged
      shouldNotify = true;
    } else {
      const data = dailyDoc.data();
      if (!data.mealLogged) {
        shouldNotify = true;
      }
    }

    if (shouldNotify) {
      const oneSignalPlayerId = doc.data().oneSignalPlayerId;
      if (oneSignalPlayerId) {
        await sendOneSignalNotification(oneSignalPlayerId);
      }
    }
  }
}

async function sendOneSignalNotification(playerId) {
  const message = {
    app_id: process.env.ONESIGNAL_APP_ID,
    include_player_ids: [playerId],
    headings: { en: "Meal Reminder 🍽️" },
    contents: { en: "You haven't added your meal yet. Log it now!" }
  };

  try {
    await axios.post("https://onesignal.com/api/v1/notifications", message, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${process.env.ONESIGNAL_REST_API_KEY}`
      }
    });
    console.log(`Notification sent to ${playerId}`);
  } catch (error) {
    console.error("Error sending notification:", error.message);
  }
}

// Run the check
checkMealAndNotify();
