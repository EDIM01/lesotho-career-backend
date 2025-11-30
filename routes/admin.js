// career_assign/backend/routes/admin.js
const express = require('express');
const router = express.Router();
const { auth, roleCheck } = require('../middleware/auth');
const { db, FieldValue, adminAuth } = require('../firebase-admin');  // ← FIXED: Added adminAuth import

router.use(auth);
router.use(roleCheck(['admin']));

// ── PROFILE ─────────────────────────────────────
router.get('/profile', (req, res) => {
  res.json({ profile: req.userData.profile || {}, role: req.userData.role });
});

// ── INSTITUTIONS (CRUD) ─────────────────────────
router.post('/institutions', async (req, res) => {
  try {
    const { name, address } = req.body;
    if (!name || !address) return res.status(400).json({ error: 'Name and address required' });
    const docRef = await db.collection('institutions').add({ name, address, ownerId: null });
    res.status(201).json({ id: docRef.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/institutions', async (req, res) => {
  try {
    const snap = await db.collection('institutions').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/institutions/:id', async (req, res) => {
  try {
    const doc = await db.collection('institutions').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Institution not found' });
    await db.collection('institutions').doc(req.params.id).update(req.body);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/institutions/:id', async (req, res) => {
  try {
    const apps = await db.collection('applications').where('instId', '==', req.params.id).get();
    if (!apps.empty) return res.status(400).json({ error: 'Cannot delete institution with active applications' });
    await db.collection('institutions').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CREATE INSTITUTE OWNER (email + password) ───────────────────────
router.post('/create-institute-owner', async (req, res) => {
  try {
    const { email, password, instName, instAddress } = req.body;
    if (!email || !password || !instName || !instAddress)
      return res.status(400).json({ error: 'All fields required' });

    // 1. Create Firebase Auth user
    const userRecord = await adminAuth.createUser({ email, password });

    // 2. Create institution
    const instRef = await db.collection('institutions').add({
      name: instName,
      address: instAddress,
      ownerId: userRecord.uid,
    });

    // 3. Register user in Firestore
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      role: 'institute',
      verified: true,
      profile: { instId: instRef.id },
    });

    res.json({ uid: userRecord.uid, instId: instRef.id });
  } catch (err) {
    console.error('Create owner error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── COMPANIES ───────────────────────────────────
router.put('/companies/:id/approve', async (req, res) => {
  try {
    const user = await db.collection('users').doc(req.params.id).get();
    if (user.data().role !== 'company') return res.status(400).json({ error: 'Not a company' });
    await db.collection('users').doc(req.params.id).update({ 'profile.approved': true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/companies/:id/suspend', async (req, res) => {
  try {
    const user = await db.collection('users').doc(req.params.id).get();
    if (user.data().role !== 'company') return res.status(400).json({ error: 'Not a company' });
    await db.collection('users').doc(req.params.id).update({ 'profile.approved': false });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/companies/:id', async (req, res) => {  
  try {
    const user = await db.collection('users').doc(req.params.id).get();
    if (user.data().role !== 'company') return res.status(400).json({ error: 'Not a company' });
    const jobs = await db.collection('jobs').where('companyId', '==', req.params.id).get();
    const batch = db.batch();
    jobs.docs.forEach(d => batch.delete(d.ref));
    batch.delete(user.ref);
    await batch.commit();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/companies', async (req, res) => {
  try {
    const snap = await db.collection('users').where('role', '==', 'company').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── REPORTS ─────────────────────────────────────
router.get('/reports', async (req, res) => {
  try {
    const [users, apps, jobs] = await Promise.all([
      db.collection('users').get(),
      db.collection('applications').get(),
      db.collection('jobs').get()
    ]);
    const byRole = {};
    users.docs.forEach(d => { const r = d.data().role; byRole[r] = (byRole[r] || 0) + 1; });
    res.json({
      totalUsers: users.size,
      totalApps: apps.size,
      totalJobs: jobs.size,
      byRole,
      users: users.docs.map(d => ({ id: d.id, ...d.data() }))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── FACULTIES (CRUD) ────────────────────────────
router.post('/faculties', async (req, res) => {
  try {
    const { name, instId } = req.body;
    if (!name || !instId) return res.status(400).json({ error: 'Name and instId required' });
    const ref = await db.collection('faculties').add({ name, instId });
    res.status(201).json({ id: ref.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/faculties', async (req, res) => {
  try {
    const snap = await db.collection('faculties').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/faculties/:id', async (req, res) => {
  try {
    const doc = await db.collection('faculties').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Faculty not found' });
    await db.collection('faculties').doc(req.params.id).update(req.body);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/faculties/:id', async (req, res) => {
  try {
    const courses = await db.collection('courses').where('facultyId', '==', req.params.id).get();
    if (!courses.empty) return res.status(400).json({ error: 'Cannot delete faculty with courses' });
    await db.collection('faculties').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── COURSES (CRUD) ──────────────────────────────
router.post('/courses', async (req, res) => {
  try {
    const { name, facultyId, requirements = { minGPA: 2.5, subjects: [] } } = req.body;
    if (!name || !facultyId) return res.status(400).json({ error: 'Name and facultyId required' });
    const fac = await db.collection('faculties').doc(facultyId).get();
    if (!fac.exists) return res.status(404).json({ error: 'Faculty not found' });
    const instId = fac.data().instId;
    const ref = await db.collection('courses').add({ name, facultyId, instId, requirements, published: false });
    res.status(201).json({ id: ref.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/courses', async (req, res) => {
  try {
    const snap = await db.collection('courses').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/courses/:id', async (req, res) => {
  try {
    const doc = await db.collection('courses').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Course not found' });
    await db.collection('courses').doc(req.params.id).update(req.body);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/courses/:id', async (req, res) => {
  try {
    const apps = await db.collection('applications').where('courseId', '==', req.params.id).get();
    if (!apps.empty) return res.status(400).json({ error: 'Cannot delete course with applications' });
    await db.collection('courses').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;