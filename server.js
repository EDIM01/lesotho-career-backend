//career_assign/backend/server.js
const express = require('express');
const cors = require('cors');
const routes = require('./routes');
require('dotenv').config();

require('./firebase-admin');

const app = express();

// CORS
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));

// RATE LIMITING DISABLED (development)
console.log('Rate limiting is DISABLED (development mode)');

// Body parser
app.use(express.json({ limit: '10mb' }));

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'CareerHub API is running. Use /api/* endpoints.' });
});

// API routes
app.use('/api', routes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});