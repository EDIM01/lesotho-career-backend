//career_assign/backend/routes/auth.js
const express = require('express');
const { auth: adminAuth, db } = require('../firebase-admin');
const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { uid, email, role, profile = {} } = req.body;
    if (!uid || !email || !role) {
      return res.status(400).json({ error: 'UID, email, and role required' });
    }

    let defaultProfile;
    switch (role) {
      case 'student':
        defaultProfile = {
          highSchoolGPA: 0,
          subjects: [],
          skills: [],
          experienceYears: 0,
          documents: [],
          completedStudies: false // Added for module
        };
        break;
      case 'institute':
        defaultProfile = { ...profile, instId: null };
        break;
      case 'company':
        defaultProfile = { ...profile, approved: true }; // Dev auto-approve
        break;
      case 'admin':
        defaultProfile = {};
        break;
      default:
        return res.status(400).json({ error: 'Invalid role' });
    }

    await db.collection('users').doc(uid).set({
      email,
      role,
      verified: true, // Dummy/auto-verify
      profile: { ...defaultProfile, ...profile },
      uid
    });

    res.status(201).json({ uid, message: 'User registered successfully' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Login – returns full user data
router.post('/login', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ error: 'ID token required' });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    const userDoc = await db.collection('users').doc(decoded.uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User profile not found – please register again' });
    }

    const userData = userDoc.data();

    // In prod, uncomment: if (!userData.verified) return res.status(403).json({ error: 'Email not verified' });
    // Dev: Allow all

    // In prod, for company: if (userData.role === 'company' && !userData.profile?.approved) return res.status(403).json({ error: 'Company pending approval' });

    res.json({
      token: idToken,
      user: {
        uid: decoded.uid,
        email: userData.email,
        role: userData.role,
        profile: userData.profile || {},
        verified: userData.verified
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(401).json({ error: 'Invalid token or server error' });
  }
});

// Verify email (dummy, since auto-verify)
router.post('/verify-email', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'ID token required' });

    const decoded = await adminAuth.verifyIdToken(idToken);
    await db.collection('users').doc(decoded.uid).update({ verified: true });
    res.json({ success: true, message: 'Email verified' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;