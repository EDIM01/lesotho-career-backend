//career_assign/backend/routes/institute.js
const express = require('express');
const router = express.Router();
const { auth, roleCheck } = require('../middleware/auth');
const { db, FieldValue } = require('../firebase-admin');
const { sendNotification } = require('../utils/firestoreHelpers');

router.use(auth);
router.use(roleCheck(['institute']));

// ── PROFILE ─────────────────────────────────────
router.get('/profile', (req, res) => {
  res.json(req.userData.profile || {});
});

router.put('/profile', async (req, res) => {
  try {
    const sanitized = { ...req.body };
    if (sanitized.address) sanitized.address = sanitized.address.trim();
    if (sanitized.contact) sanitized.contact = sanitized.contact.trim();

    await db.collection('users').doc(req.user.uid).update({
      profile: { ...req.userData.profile, ...sanitized }
    });

    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    console.error('PUT /institute/profile error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── CREATE INSTITUTION ──────────────────────────
router.post('/institution', async (req, res) => {
  try {
    if (req.userData.profile?.instId) {
      return res.status(400).json({ error: 'Already has an institution' });
    }

    const { name, address } = req.body;
    if (!name?.trim() || !address?.trim()) {
      return res.status(400).json({ error: 'Name and address required' });
    }

    const ref = await db.collection('institutions').add({
      name: name.trim(),
      address: address.trim(),
      ownerId: req.user.uid,
    });

    await db.collection('users').doc(req.user.uid).update({
      'profile.instId': ref.id
    });

    res.status(201).json({ id: ref.id, message: 'Institution created' });
  } catch (err) {
    console.error('POST /institute/institution error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── FACULTIES ───────────────────────────────────
router.post('/faculties', async (req, res) => {
  try {
    const instId = req.userData.profile?.instId;
    if (!instId) return res.status(400).json({ error: 'Institution ID not set' });

    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

    const ref = await db.collection('faculties').add({
      name: name.trim(),
      instId
    });

    res.status(201).json({ id: ref.id, message: 'Faculty added' });
  } catch (err) {
    console.error('POST /institute/faculties error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/faculties', async (req, res) => {
  try {
    const instId = req.userData.profile?.instId;
    if (!instId) return res.status(400).json({ error: 'Institution ID not set' });

    const snap = await db.collection('faculties').where('instId', '==', instId).get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error('GET /institute/faculties error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/faculties/:id', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

    const fac = await db.collection('faculties').doc(req.params.id).get();
    if (!fac.exists) return res.status(404).json({ error: 'Faculty not found' });
    if (fac.data().instId !== req.userData.profile.instId)
      return res.status(403).json({ error: 'Not your faculty' });

    await db.collection('faculties').doc(req.params.id).update({ name: name.trim() });
    res.json({ success: true, message: 'Faculty updated' });
  } catch (err) {
    console.error('PUT /institute/faculties/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/faculties/:id', async (req, res) => {
  try {
    const fac = await db.collection('faculties').doc(req.params.id).get();
    if (!fac.exists) return res.status(404).json({ error: 'Faculty not found' });
    if (fac.data().instId !== req.userData.profile.instId)
      return res.status(403).json({ error: 'Not your faculty' });

    const courses = await db.collection('courses').where('facultyId', '==', req.params.id).get();
    if (!courses.empty) return res.status(400).json({ error: 'Cannot delete faculty with courses' });

    await db.collection('faculties').doc(req.params.id).delete();
    res.json({ success: true, message: 'Faculty deleted' });
  } catch (err) {
    console.error('DELETE /institute/faculties/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── COURSES ─────────────────────────────────────
router.post('/courses', async (req, res) => {
  try {
    const instId = req.userData.profile?.instId;
    if (!instId) return res.status(400).json({ error: 'Institution ID not set' });

    const { name, facultyId, requirements = { minGPA: 2.5, subjects: [] } } = req.body;
    if (!name?.trim() || !facultyId) return res.status(400).json({ error: 'Name and facultyId required' });
    if (requirements.minGPA < 0 || requirements.minGPA > 5)
      return res.status(400).json({ error: 'Min GPA must be 0–5' });

    const ref = await db.collection('courses').add({
      name: name.trim(),
      facultyId,
      instId,
      requirements,
      published: false
    });

    res.status(201).json({ id: ref.id, message: 'Course added' });
  } catch (err) {
    console.error('POST /institute/courses error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/courses', async (req, res) => {
  try {
    const instId = req.userData.profile?.instId;
    if (!instId) return res.status(400).json({ error: 'Institution ID not set' });

    const snap = await db.collection('courses').where('instId', '==', instId).get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error('GET /institute/courses error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/courses/:id', async (req, res) => {
  try {
    const course = await db.collection('courses').doc(req.params.id).get();
    if (!course.exists) return res.status(404).json({ error: 'Course not found' });
    if (course.data().instId !== req.userData.profile.instId)
      return res.status(403).json({ error: 'Not your course' });

    await db.collection('courses').doc(req.params.id).update(req.body);
    res.json({ success: true, message: 'Course updated' });
  } catch (err) {
    console.error('PUT /institute/courses/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/courses/:id', async (req, res) => {
  try {
    const course = await db.collection('courses').doc(req.params.id).get();
    if (!course.exists) return res.status(404).json({ error: 'Course not found' });
    if (course.data().instId !== req.userData.profile.instId)
      return res.status(403).json({ error: 'Not your course' });

    const apps = await db.collection('applications').where('courseId', '==', req.params.id).get();
    if (!apps.empty) return res.status(400).json({ error: 'Cannot delete course with applications' });

    await db.collection('courses').doc(req.params.id).delete();
    res.json({ success: true, message: 'Course deleted' });
  } catch (err) {
    console.error('DELETE /institute/courses/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── APPLICATIONS (WITH STUDENT DATA) ─────────────
router.get('/applications', async (req, res) => {
  try {
    const instId = req.userData.profile?.instId;
    if (!instId) return res.status(400).json({ error: 'Institution ID not set' });

    const snap = await db.collection('applications')
      .where('instId', '==', instId)
      .get();

    const apps = await Promise.all(
      snap.docs.map(async (d) => {
        const data = d.data();
        const studentSnap = await db.collection('users').doc(data.studentId).get();
        const student = studentSnap.exists ? studentSnap.data() : {};

        return {
          id: d.id,
          ...data,
          submittedAt: data.submittedAt?.toDate?.() || null,
          courseName: data.courseName || 'Unknown',
          instName: data.instName || 'Unknown',
          student: {
            id: data.studentId,
            name: student.profile?.name || 'Unknown',
            email: student.email || 'N/A',
            gpa: student.profile?.highSchoolGPA || 'N/A',
            subjects: student.profile?.subjects || [],
            skills: student.profile?.skills || [],
            documents: student.profile?.documents || []
          }
        };
      })
    );

    res.json(apps);
  } catch (err) {
    console.error('GET /institute/applications error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── WAITING LIST (WITH STUDENT DATA) ─────────────
router.get('/waiting-list', async (req, res) => {
  try {
    const instId = req.userData.profile?.instId;
    if (!instId) return res.status(400).json({ error: 'Institution ID not set' });

    const snap = await db.collection('applications')
      .where('instId', '==', instId)
      .where('status', '==', 'waiting')
      .get();

    const waiting = await Promise.all(
      snap.docs.map(async (d) => {
        const data = d.data();
        const studentSnap = await db.collection('users').doc(data.studentId).get();
        const student = studentSnap.exists ? studentSnap.data() : {};

        return {
          id: d.id,
          ...data,
          submittedAt: data.submittedAt?.toDate?.() || null,
          student: {
            id: data.studentId,
            name: student.profile?.name || 'Unknown',
            email: student.email || 'N/A',
            gpa: student.profile?.highSchoolGPA || 'N/A',
            subjects: student.profile?.subjects || [],
            skills: student.profile?.skills || [],
            documents: student.profile?.documents || []
          }
        };
      })
    );

    res.json(waiting);
  } catch (err) {
    console.error('GET /institute/waiting-list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── UPDATE APPLICATION STATUS ───────────────────
router.put('/applications/:appId/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'admitted', 'rejected', 'waiting'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });

    const appRef = db.collection('applications').doc(req.params.appId);
    const appSnap = await appRef.get();
    if (!appSnap.exists) return res.status(404).json({ error: 'Application not found' });

    const app = appSnap.data();
    if (app.instId !== req.userData.profile.instId)
      return res.status(403).json({ error: 'Not your application' });

    if (status === 'admitted') {
      const dup = await db.collection('applications')
        .where('studentId', '==', app.studentId)
        .where('instId', '==', app.instId)
        .where('status', '==', 'admitted')
        .get();
      if (!dup.empty) return res.status(400).json({ error: 'Student already admitted to another program' });
    }

    await appRef.update({ status });

    // Notify student
    const studentSnap = await db.collection('users').doc(app.studentId).get();
    const studentName = studentSnap.data()?.profile?.name || 'Student';
    await sendNotification(
      app.studentId,
      'application_update',
      `Your application for "${app.courseName}" is now: ${status.toUpperCase()}`
    );

    res.json({ success: true, message: 'Status updated' });
  } catch (err) {
    console.error('PUT /institute/applications/:appId/status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PUBLISH COURSE ──────────────────────────────
router.put('/courses/:courseId/publish', async (req, res) => {
  try {
    const { published } = req.body;
    if (typeof published !== 'boolean')
      return res.status(400).json({ error: 'published must be boolean' });

    const course = await db.collection('courses').doc(req.params.courseId).get();
    if (!course.exists) return res.status(404).json({ error: 'Course not found' });
    if (course.data().instId !== req.userData.profile.instId)
      return res.status(403).json({ error: 'Not your course' });

    await db.collection('courses').doc(req.params.courseId).update({ published });
    res.json({ success: true, message: 'Publish status updated' });
  } catch (err) {
    console.error('PUT /institute/courses/:courseId/publish error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;