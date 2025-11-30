//career_assign/backend/firebase-admin.js
// backend/firebase-admin.js
const admin = require('firebase-admin');

/**
 * Firebase Admin SDK Initialization
 * - Supports local JSON or base64 env var
 * - Initializes ONCE and only if credentials are valid
 * - Exits process on failure
 */

let db = null;
let auth = null;
let storage = null;
let FieldValue = null;
let Timestamp = null;
let adminInstance = null;

const initializeFirebaseAdmin = () => {
  if (admin.apps.length > 0) {
    console.log('Firebase Admin already initialized');
    return true;
  }

  let serviceAccount = null;

  // 1. Try local JSON file (dev)
  try {
    serviceAccount = require('./firebase-admin.json');
    console.log('Firebase Admin: Loaded from ./firebase-admin.json');
  } catch (err) {
    // Ignore
  }

  // 2. Try base64 env var (prod)
  if (!serviceAccount && process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    try {
      const buff = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64');
      serviceAccount = JSON.parse(buff.toString('utf8'));
      console.log('Firebase Admin: Loaded from FIREBASE_SERVICE_ACCOUNT_BASE64');
    } catch (parseErr) {
      console.error('Invalid FIREBASE_SERVICE_ACCOUNT_BASE64:', parseErr.message);
    }
  }

  // 3. Fail if no credentials
  if (!serviceAccount) {
    console.error('FIREBASE ADMIN INIT FAILED: No service account found');
    console.error('  → Place "firebase-admin.json" in backend/');
    console.error('  → OR set FIREBASE_SERVICE_ACCOUNT_BASE64 in .env');
    process.exit(1);
  }

  // 4. Initialize SDK
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'career-database-b2ec5.firebasestorage.app',
    });

    db = admin.firestore();
    auth = admin.auth();
    storage = admin.storage();
    FieldValue = admin.firestore.FieldValue;
    Timestamp = admin.firestore.Timestamp;
    adminInstance = admin;

    console.log('Firebase Admin SDK initialized successfully');
    console.log(`   Project ID: ${adminInstance.projectId}`);
    return true;
  } catch (initErr) {
    console.error('Firebase Admin initialization failed:', initErr.message);
    process.exit(1);
  }
};

// Run initialization
if (!initializeFirebaseAdmin()) {
  process.exit(1);
}

module.exports = {
  db,
  auth,
  storage,
  FieldValue,
  Timestamp,
  admin: adminInstance,
};