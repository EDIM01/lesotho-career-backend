// career_assign/backend/migrate-notifications.js
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-admin.json'); // Your service account key

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrateNotifications() {
  console.log('Starting migration...');

  const notifsSnap = await db.collection('notifications').get();
  const batch = db.batch();

  let count = 0;
  for (const doc of notifsSnap.docs) {
    const data = doc.data();
    const userRef = db.collection('users').doc(data.userId).collection('notifications').doc();
    batch.set(userRef, {
      type: data.type,
      message: data.message,
      timestamp: data.timestamp,
      read: data.read || false
    });
    batch.delete(doc.ref);
    count++;
  }

  await batch.commit();
  console.log(`Migration complete: ${count} notifications moved.`);
  process.exit(0);
}

migrateNotifications().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});