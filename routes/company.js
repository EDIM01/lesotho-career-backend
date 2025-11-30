//career_assign/backend/routes/company.js (added put/delete for jobs)
const express = require('express');
const router = express.Router();
const { db, admin } = require('../firebase-admin'); // <-- Fixed: import admin
const { auth, roleCheck } = require('../middleware/auth');
const { calculateMatchScore, sendNotification } = require('../utils/firestoreHelpers');

// Middleware
router.use(auth);
router.use(roleCheck(['company']));

// ── PROFILE ─────────────────────────────────────
router.get('/profile', (req, res) => {
  res.json({ profile: req.userData.profile || {} });
});

router.put('/profile', async (req, res) => {
  try {
    const body = req.body;
    if (body.name) body.name = body.name.trim();
    if (body.description) body.description = body.description.trim();

    await db.collection('users').doc(req.user.uid).update({
      profile: { ...req.userData.profile, ...body }
    });

    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    console.error('PUT /company/profile error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST JOB ────────────────────────────────────
router.post('/jobs', async (req, res) => {
  try {
    const { title, requirements = { gpaThreshold: 3.0, experienceYears: 1, skills: [] } } = req.body;

    if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
    if (requirements.gpaThreshold < 0 || requirements.gpaThreshold > 5)
      return res.status(400).json({ error: 'GPA must be 0–5' });
    if (requirements.experienceYears < 0)
      return res.status(400).json({ error: 'Experience must be ≥0' });

    requirements.skills = requirements.skills.map(s => s.trim()).filter(Boolean);

    const jobRef = await db.collection('jobs').add({
      title: title.trim(),
      requirements,
      companyId: req.user.uid,
      postedAt: admin.firestore.FieldValue.serverTimestamp(),
      applicants: []
    });

    // ── Notify qualified students ──
    const studentsSnap = await db.collection('users').where('role', '==', 'student').get();
    for (const s of studentsSnap.docs) {
      const profile = s.data().profile || {};
      if (profile.completedStudies) {
        const score = await calculateMatchScore(profile, { requirements });
        if (score > 0.7) {
          await sendNotification(s.id, 'job_match', `New matching job: ${title.trim()}`, {
            jobId: jobRef.id,
            companyId: req.user.uid
          });
        }
      }
    }

    res.status(201).json({ id: jobRef.id, message: 'Job posted' });
  } catch (err) {
    console.error('POST /company/jobs error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── UPDATE JOB ──────────────────────────────────
router.put('/jobs/:id', async (req, res) => {
  try {
    const jobRef = db.collection('jobs').doc(req.params.id);
    const jobDoc = await jobRef.get();

    if (!jobDoc.exists) return res.status(404).json({ error: 'Job not found' });
    if (jobDoc.data().companyId !== req.user.uid) return res.status(403).json({ error: 'Not your job' });

    await jobRef.update(req.body);
    res.json({ success: true, message: 'Job updated' });
  } catch (err) {
    console.error('PUT /company/jobs/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE JOB ──────────────────────────────────
router.delete('/jobs/:id', async (req, res) => {
  try {
    const jobRef = db.collection('jobs').doc(req.params.id);
    const jobDoc = await jobRef.get();

    if (!jobDoc.exists) return res.status(404).json({ error: 'Job not found' });
    if (jobDoc.data().companyId !== req.user.uid) return res.status(403).json({ error: 'Not your job' });

    const appsSnap = await db.collection('jobApplications')
      .where('jobId', '==', req.params.id)
      .get();

    const batch = db.batch();
    appsSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(jobRef);
    await batch.commit();

    res.json({ success: true, message: 'Job and applications deleted' });
  } catch (err) {
    console.error('DELETE /company/jobs/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET OWN JOBS ─────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const snap = await db.collection('jobs')
      .where('companyId', '==', req.user.uid)
      .orderBy('postedAt', 'desc')
      .get();

    const jobs = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        postedAt: data.postedAt?.toDate?.() || null
      };
    });

    res.json(jobs);
  } catch (err) {
    console.error('GET /company/jobs error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET QUALIFIED APPLICANTS ────────────────────
router.get('/jobs/:jobId/applicants', async (req, res) => {
  try {
    const jobDoc = await db.collection('jobs').doc(req.params.jobId).get();
    if (!jobDoc.exists) return res.status(404).json({ error: 'Job not found' });
    if (jobDoc.data().companyId !== req.user.uid) return res.status(403).json({ error: 'Not your job' });

    const appsSnap = await db.collection('jobApplications')
      .where('jobId', '==', req.params.jobId)
      .where('matchScore', '>', 0.7)
      .where('readyForInterview', '==', true)
      .get();

    const qualified = await Promise.all(
      appsSnap.docs.map(async a => {
        const data = a.data();
        const studentDoc = await db.collection('users').doc(data.studentId).get();
        const student = studentDoc.exists ? studentDoc.data() : {};

        return {
          id: a.id,
          ...data,
          student: {
            id: data.studentId,
            profile: student.profile || {},
            email: student.email || ''
          },
          appliedAt: data.appliedAt?.toDate?.() || null
        };
      })
    );

    res.json(qualified);
  } catch (err) {
    console.error('GET /company/jobs/:jobId/applicants error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── SCHEDULE INTERVIEW (NEW) ────────────────────
router.post('/schedule-interview/:appId', async (req, res) => {
  try {
    const { date, expectations } = req.body;
    if (!date || !expectations?.trim()) {
      return res.status(400).json({ error: 'Date and expectations are required' });
    }

    const appRef = db.collection('jobApplications').doc(req.params.appId);
    const appDoc = await appRef.get();
    if (!appDoc.exists) return res.status(404).json({ error: 'Application not found' });

    const appData = appDoc.data();
    const jobDoc = await db.collection('jobs').doc(appData.jobId).get();
    if (!jobDoc.exists || jobDoc.data().companyId !== req.user.uid) {
      return res.status(403).json({ error: 'Not your applicant' });
    }

    const interviewDate = new Date(date);
    const message = `Interview Scheduled\n\nDate: ${interviewDate.toLocaleString()}\n\nWhat to Expect:\n${expectations.trim()}`;

    // Include student data for download
    const studentDoc = await db.collection('users').doc(appData.studentId).get();
    const studentProfile = studentDoc.data()?.profile || {};

    await sendNotification(
      appData.studentId,
      'interview_scheduled',
      message,
      {
        jobId: appData.jobId,
        companyId: req.user.uid,
        studentData: { profile: studentProfile }
      }
    );

    await appRef.update({
      interviewScheduled: true,
      interviewDate: admin.firestore.Timestamp.fromDate(interviewDate),
      interviewExpectations: expectations.trim()
    });

    res.json({ success: true, message: 'Interview scheduled' });
  } catch (err) {
    console.error('POST /company/schedule-interview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── REJECT APPLICANT (NEW) ──────────────────────
router.put('/reject-applicant/:appId', async (req, res) => {
  try {
    const appRef = db.collection('jobApplications').doc(req.params.appId);
    const appDoc = await appRef.get();
    if (!appDoc.exists) return res.status(404).json({ error: 'Application not found' });

    const appData = appDoc.data();
    const jobDoc = await db.collection('jobs').doc(appData.jobId).get();
    if (!jobDoc.exists || jobDoc.data().companyId !== req.user.uid) {
      return res.status(403).json({ error: 'Not your applicant' });
    }

    await appRef.update({ status: 'rejected' });

    await sendNotification(
      appData.studentId,
      'application_rejected',
      `Your application for "${jobDoc.data().title}" has been rejected.`
    );

    res.json({ success: true, message: 'Applicant rejected' });
  } catch (err) {
    console.error('PUT /company/reject-applicant error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE NOTIFICATION (NEW) ───────────────────
router.delete('/notifications/:id', async (req, res) => {
  try {
    const notifRef = db
      .collection('users')
      .doc(req.user.uid)
      .collection('notifications')
      .doc(req.params.id);

    const notifDoc = await notifRef.get();
    if (!notifDoc.exists) return res.status(404).json({ error: 'Notification not found' });

    await notifRef.delete();
    res.json({ success: true, message: 'Notification deleted' });
  } catch (err) {
    console.error('DELETE /company/notifications/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;