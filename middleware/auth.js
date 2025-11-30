//career_assign/backend/middleware/auth.js
const admin = require('firebase-admin');
const { db } = require('../firebase-admin');

async function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
    const userData = userDoc.data();
    // In prod, uncomment: if (!userData.verified) return res.status(403).json({ error: 'Email not verified' });
    req.userData = userData;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(401).json({ error: 'Invalid token' });
  }
}

function roleCheck(allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.userData.role)) {
      return res.status(403).json({ error: 'Role forbidden' });
    }
    next();
  };
}

module.exports = { auth, roleCheck };