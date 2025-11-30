// backend/server.js
const express = require('express');
const cors = require('cors');
const routes = require('./routes');
require('dotenv').config();
require('./firebase-admin');

const app = express();

// CORS — FIXED: Allow your live Firebase site
app.use(cors({
  origin: [
    'https://career-database-b2ec5.web.app',
    'https://career-database-b2ec5.firebaseapp.com',
    'http://localhost:3000'
  ],
  credentials: true
}));

// Body parser
app.use(express.json({ limit: '10mb' }));

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'CareerHub API is running. Use /api/* endpoints.' });
});

// API routes
app.use('/api', routes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});