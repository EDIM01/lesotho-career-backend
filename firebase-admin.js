const admin = require('firebase-admin');

let db = null;
let auth = null;
let storage = null;
let FieldValue = null;
let Timestamp = null;

// Only initialize once
if (!admin.apps.length) {
  // 1. Try individual env vars (Render, Vercel, Railway)
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'career-database-b2ec5.firebasestorage.app',
    });
    console.log('Firebase Admin initialized via individual env vars (Render/Vercel)');
  }
  // 2. Fallback: base64 env var
  else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'career-database-b2ec5.firebasestorage.app',
    });
    console.log('Firebase Admin initialized via BASE64 env var');
  }
  // 3. Last resort: local file (only for localhost)
  else {
    try {
      const serviceAccount = require('./firebase-admin.json');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'career-database-b2ec5.firebasestorage.app',
      });
      console.log('Firebase Admin initialized via local firebase-admin.json (localhost only)');
    } catch (err) {
      console.error('FIREBASE ADMIN INIT FAILED: No credentials found');
      console.error('Set FIREBASE_PROJECT_ID + FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL in Render');
      process.exit(1);
    }
  }
}

// Export everything
db = admin.firestore();
auth = admin.auth();
storage = admin.storage();
FieldValue = admin.firestore.FieldValue;
Timestamp = admin.firestore.Timestamp;

module.exports = {
  db,
  auth,
  storage,
  FieldValue,
  Timestamp,
  admin,
};