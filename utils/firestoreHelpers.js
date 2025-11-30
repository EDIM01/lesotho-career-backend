// career_assign/backend/utils/firestoreHelpers.js
const { db, FieldValue } = require('../firebase-admin');

/**
 * Calculate match score between student profile and job requirements
 * Returns value between 0 and 1
 *
 * Weights:
 * - GPA: 40%
 * - Experience: 20%
 * - Certificates: 20% (max 3 count)
 * - Skills: 20% (case-insensitive match)
 */
async function calculateMatchScore(studentProfile, job) {
  try {
    const req = job.requirements || {};
    const profile = studentProfile || {};

    // GPA: normalize to 0–1
    const gpaScore = req.gpaThreshold
      ? Math.min((profile.highSchoolGPA || 0) / Math.max(req.gpaThreshold, 0.1), 1)
      : 1;

    // Experience
    const expScore = req.experienceYears
      ? Math.min((profile.experienceYears || 0) / Math.max(req.experienceYears, 1), 1)
      : 1;

    // Certificates (max 3 count)
    const certCount = (profile.documents || [])
      .filter((d) => d.type === 'certificate').length;
    const certScore = Math.min(certCount / 3, 1);

    // Skills match (case-insensitive)
    const jobSkills = (req.skills || []).map(s => s.trim().toLowerCase());
    const studentSkills = (profile.skills || []).map(s => s.trim().toLowerCase());
    const skillMatch = jobSkills.length > 0
      ? jobSkills.filter(s => studentSkills.includes(s)).length / jobSkills.length
      : 1;

    // Weighted average
    return 0.4 * gpaScore + 0.2 * expScore + 0.2 * certScore + 0.2 * skillMatch;
  } catch (err) {
    console.error('calculateMatchScore error:', err);
    return 0;
  }
}

/**
 * Handle admission selection:
 * - Reject all other admitted applications
 * - Promote next waiting applicant
 *
 * Uses Firestore batch for atomicity
 */
async function handleAdmissionSelection(studentId, selectedAppId) {
  const batch = db.batch();

  try {
    // Get all admitted apps for this student
    const admittedSnap = await db
      .collection('applications')
      .where('studentId', '==', studentId)
      .where('status', '==', 'admitted')
      .get();

    for (const doc of admittedSnap.docs) {
      if (doc.id === selectedAppId) continue;

      const data = doc.data();

      // Reject this one
      batch.update(doc.ref, { status: 'rejected' });

      // Notify student
      await sendNotification(
        studentId,
        'admission_rejected',
        `Your application to ${data.courseName} at ${data.instName} has been rejected.`
      );

      // Promote next from waiting list
      const waitingSnap = await db
        .collection('applications')
        .where('courseId', '==', data.courseId)
        .where('instId', '==', data.instId)
        .where('status', '==', 'waiting')
        .orderBy('submittedAt', 'asc')
        .limit(1)
        .get();

      if (!waitingSnap.empty) {
        const next = waitingSnap.docs[0];
        batch.update(next.ref, { status: 'admitted' });
        await sendNotification(
          next.data().studentId,
          'admission_granted',
          `You have been admitted to ${data.courseName} at ${data.instName} from the waiting list.`
        );
      }
    }

    await batch.commit();
  } catch (err) {
    console.error('handleAdmissionSelection error:', err);
    throw err;
  }
}

/**
 * Send notification to user's subcollection
 */
async function sendNotification(userId, type, message) {
  try {
    await db
      .collection('users')
      .doc(userId)
      .collection('notifications')
      .add({
        type,
        message,
        timestamp: FieldValue.serverTimestamp(),
        read: false,
      });
  } catch (err) {
    console.error('sendNotification error:', err);
  }
}

/**
 * Check if student qualifies for a course
 * Case-insensitive subject match
 */
async function checkCourseQualification(studentId, courseId) {
  try {
    const [studentSnap, courseSnap] = await Promise.all([
      db.collection('users').doc(studentId).get(),
      db.collection('courses').doc(courseId).get(),
    ]);

    if (!studentSnap.exists || !courseSnap.exists) return false;

    const profile = studentSnap.data().profile || {};
    const course = courseSnap.data();
    const req = course.requirements || {};

    // GPA check
    const gpaOk = (profile.highSchoolGPA || 0) >= (req.minGPA || 0);

    // Subjects check (case-insensitive)
    const reqSubjects = (req.subjects || []).map(s => s.trim().toLowerCase());
    const studentSubjects = (profile.subjects || []).map(s => s.trim().toLowerCase());
    const subjectsOk = reqSubjects.every(s => studentSubjects.includes(s));

    return gpaOk && subjectsOk;
  } catch (err) {
    console.error('checkCourseQualification error:', err);
    return false;
  }
}

module.exports = {
  calculateMatchScore,
  handleAdmissionSelection,
  sendNotification,
  checkCourseQualification,
};