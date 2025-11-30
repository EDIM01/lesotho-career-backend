//career_assign/backend/routes/index.js
const express = require('express');
const authRoutes = require('./auth');
const adminRoutes = require('./admin');
const instituteRoutes = require('./institute');
const studentRoutes = require('./student');
const companyRoutes = require('./company');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/institute', instituteRoutes);
router.use('/student', studentRoutes);
router.use('/company', companyRoutes);

module.exports = router;