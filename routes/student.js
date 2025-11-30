// career_assign/backend/routes/student.js
// backend/routes/student.js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { auth, roleCheck } = require('../middleware/auth');
const { db, bucket, FieldValue, Timestamp } = require('../firebase-admin'); // <-- FIXED
const {
  calculateMatchScore,
  sendNotification,
  handleAdmissionSelection,
  checkCourseQualification,
} = require('../utils/firestoreHelpers');

// Multer: In-memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    cb(null, allowed.includes(file.mimetype));
  },
});

router.use(auth);
router.use(roleCheck(['student']));

// ── PROFILE ─────────────────────────────────────
router.get('/profile', async (req, res) => {
  try {
    const snap = await db.collection('users').doc(req.user.uid).get();
    const profile = snap.data()?.profile || {};
    res.json({ profile });
  } catch (err) {
    console.error('GET /student/profile error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── UPDATE PROFILE ───────────────────────────────
router.put('/profile', async (req, res) => {
  try {
    const body = req.body;
    if (body.highSchoolGPA != null && (body.highSchoolGPA < 0 || body.highSchoolGPA > 5))
      return res.status(400).json({ error: 'GPA must be 0–5' });

    const sanitized = { ...body };
    if (sanitized.subjects)
      sanitized.subjects = sanitized.subjects.map(s => s.trim()).filter(Boolean);
    if (sanitized.skills)
      sanitized.skills = sanitized.skills.map(s => s.trim()).filter(Boolean);

    await db.collection('users').doc(req.user.uid).update({
      profile: { ...req.userData.profile, ...sanitized },
    });

    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    console.error('PUT /student/profile error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── APPLICATIONS ─────────────────────────────────
router.get('/applications', async (req, res) => {
  try {
    const snap = await db
      .collection('applications')
      .where('studentId', '==', req.user.uid)
      .get();

    const apps = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        submittedAt: data.submittedAt?.toDate?.() || null, // ← Safe conversion
      };
    });

    res.json(apps);
  } catch (err) {
    console.error('GET /student/applications error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── SELECT ADMISSION ─────────────────────────────
router.post('/admissions/select/:appId', async (req, res) => {
  try {
    const appSnap = await db.collection('applications').doc(req.params.appId).get();
    if (!appSnap.exists) return res.status(404).json({ error: 'Application not found' });

    const app = appSnap.data();
    if (app.studentId !== req.user.uid) return res.status(403).json({ error: 'Not your application' });
    if (app.status !== 'admitted') return res.status(400).json({ error: 'Not admitted' });

    await handleAdmissionSelection(req.user.uid, req.params.appId);
    res.json({ success: true, message: 'Admission confirmed' });
  } catch (err) {
    console.error('POST /admissions/select error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── JOBS ────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const studentSnap = await db.collection('users').doc(req.user.uid).get();
    if (!studentSnap.exists) return res.json([]);

    const profile = studentSnap.data().profile || {};
    const jobsSnap = await db.collection('jobs').orderBy('postedAt', 'desc').limit(20).get();
    const jobs = jobsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const scores = await Promise.all(
      jobs.map(job => calculateMatchScore(profile, job).catch(() => 0))
    );

    const qualified = jobs
      .map((j, i) => ({ ...j, matchScore: scores[i] }))
      .filter(j => j.matchScore > 0.7);

    const companyIds = [...new Set(qualified.map(j => j.companyId))];
    const companySnaps = await Promise.all(
      companyIds.map(id => db.collection('users').doc(id).get().catch(() => null))
    );

    const companyMap = {};
    companySnaps.forEach((s, i) => {
      companyMap[companyIds[i]] = s?.exists && s.data().profile?.name ? s.data().profile.name : 'Unknown';
    });

    const result = qualified.map(j => ({
      ...j,
      companyName: companyMap[j.companyId],
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /student/jobs error:', err);
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

// ── APPLIED JOBS ─────────────────────────────────
router.get('/jobApplications', async (req, res) => {
  try {
    const snap = await db.collection('jobApplications')
      .where('studentId', '==', req.user.uid)
      .get();

    const apps = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        appliedAt: data.appliedAt?.toDate?.() || null,
      };
    });

    res.json(apps);
  } catch (err) {
    console.error('GET /student/jobApplications error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── SET READY FOR INTERVIEW ───────────────────────
router.put('/jobApplications/:id/ready', async (req, res) => {
  try {
    const appRef = db.collection('jobApplications').doc(req.params.id);
    const app = await appRef.get();
    if (!app.exists || app.data().studentId !== req.user.uid)
      return res.status(403).json({ error: 'Not your application' });

    await appRef.update({ readyForInterview: true });
    res.json({ success: true, message: 'Ready for interview' });
  } catch (err) {
    console.error('PUT /jobApplications/:id/ready error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── MARK NOTIFICATION READ ───────────────────────
router.put('/notifications/:id/read', async (req, res) => {
  try {
    const notifRef = db
      .collection('users')
      .doc(req.user.uid)
      .collection('notifications')
      .doc(req.params.id);

    const snap = await notifRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'Notification not found' });

    await notifRef.update({ read: true });
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /notifications/:id/read error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── APPLY COURSE ─────────────────────────────────
router.post('/apply', async (req, res) => {
  try {
    const { courseId, instId } = req.body;
    if (!courseId || !instId)
      return res.status(400).json({ error: 'Course and institution IDs required' });

    const qualified = await checkCourseQualification(req.user.uid, courseId);
    if (!qualified)
      return res.status(400).json({ error: 'You do not qualify for this course' });

    const existing = await db
      .collection('applications')
      .where('studentId', '==', req.user.uid)
      .where('instId', '==', instId)
      .get();

    if (existing.size >= 2)
      return res.status(400).json({ error: 'Maximum 2 applications per institution' });

    const [courseSnap, instSnap] = await Promise.all([
      db.collection('courses').doc(courseId).get(),
      db.collection('institutions').doc(instId).get(),
    ]);

    if (!courseSnap.exists || !instSnap.exists)
      return res.status(404).json({ error: 'Course or institution not found' });

    const ref = await db.collection('applications').add({
      courseId,
      instId,
      studentId: req.user.uid,
      status: 'pending',
      submittedAt: FieldValue.serverTimestamp(),
      courseName: courseSnap.data().name,
      instName: instSnap.data().name,
    });

    const ownerId = instSnap.data().ownerId;
    if (ownerId) {
      await sendNotification(
        ownerId,
        'new_application',
        `New application for ${courseSnap.data().name}`
      );
    }

    res.status(201).json({ id: ref.id, message: 'Applied successfully' });
  } catch (err) {
    console.error('POST /student/apply error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── UPLOAD DOCUMENT ──────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const type = req.body.type;
    if (!['transcript', 'certificate'].includes(type))
      return res.status(400).json({ error: 'Type must be "transcript" or "certificate"' });

    const profileSnap = await db.collection('users').doc(req.user.uid).get();
    const profile = profileSnap.data()?.profile || {};
    if (type === 'transcript' && !profile.completedStudies) {
      return res.status(400).json({ error: 'Complete studies to upload transcript' });
    }

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const allowed = ['pdf', 'jpg', 'jpeg', 'png'];
    if (!allowed.includes(ext))
      return res.status(400).json({ error: 'Only PDF, JPG, PNG allowed' });

    const fileName = `students/${req.user.uid}/${Date.now()}_${type}.${ext}`;
    const file = bucket.file(fileName);

    const stream = file.createWriteStream({
      metadata: { contentType: req.file.mimetype },
      public: true,
    });

    stream.on('error', (err) => {
      console.error('Storage upload error:', err);
      res.status(500).json({ error: 'Upload failed' });
    });

    stream.on('finish', async () => {
      const url = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

      const docObj = {
        id: Date.now().toString(),
        type,
        filename: req.file.originalname,
        url,
        uploadedAt: FieldValue.serverTimestamp(),
      };

      await db.collection('users').doc(req.user.uid).update({
        'profile.documents': FieldValue.arrayUnion(docObj),
      });

      res.json({ success: true, document: docObj });
    });

    stream.end(req.file.buffer);
  } catch (err) {
    console.error('POST /student/upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE DOCUMENT ──────────────────────────────
router.delete('/documents/:id', async (req, res) => {
  try {
    const profile = req.userData.profile || {};
    const docToRemove = profile.documents?.find(d => d.id === req.params.id);
    if (!docToRemove) return res.status(404).json({ error: 'Document not found' });

    await db.collection('users').doc(req.user.uid).update({
      'profile.documents': FieldValue.arrayRemove(docToRemove),
    });

    try {
      const path = decodeURIComponent(docToRemove.url.split('/o/')[1].split('?')[0]);
      await bucket.file(path).delete();
    } catch (e) {
      console.warn('Failed to delete file from storage:', e);
    }

    res.json({ success: true, message: 'Document deleted' });
  } catch (err) {
    console.error('DELETE /student/documents error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── APPLY JOB ────────────────────────────────────
router.post('/jobs/:jobId/apply', async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const jobSnap = await db.collection('jobs').doc(jobId).get();
    if (!jobSnap.exists) return res.status(404).json({ error: 'Job not found' });

    const score = await calculateMatchScore(req.userData.profile, jobSnap.data());
    if (score <= 0.7) return res.status(400).json({ error: 'Not qualified' });

    const ref = await db.collection('jobApplications').add({
      studentId: req.user.uid,
      jobId,
      matchScore: score,
      status: 'pending',
      readyForInterview: false,
      appliedAt: FieldValue.serverTimestamp(),
    });

    await db.collection('jobs').doc(jobId).update({
      applicants: FieldValue.arrayUnion(ref.id),
    });

    await sendNotification(
      jobSnap.data().companyId,
      'new_applicant',
      `New applicant for ${jobSnap.data().title}`
    );

    res.status(201).json({ id: ref.id, message: 'Applied successfully' });
  } catch (err) {
    console.error('POST /jobs/:jobId/apply error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;