const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Uploads: Vercel serverless file system is read-only except /tmp
const UPLOAD_DIR = process.env.VERCEL === '1'
  ? path.join('/tmp', 'uploads')
  : path.join(__dirname, '../uploads');

try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (error) {
  console.warn('Could not create upload directory:', error.message);
}

app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/api/uploads', express.static(UPLOAD_DIR));

// MongoDB Connection (cache across serverless invocations)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/certificate_management';

let cached = global.__mongooseCached;
if (!cached) {
  cached = global.__mongooseCached = { conn: null, promise: null };
}

const connectDB = async () => {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI)
      .then((m) => m.connection)
      .catch((err) => {
        cached.promise = null;
        throw err;
      });
  }
  cached.conn = await cached.promise;
  return cached.conn;
};

connectDB()
  .then(() => console.log('MongoDB connected successfully'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Routes
const authRoutes = require('./routes/auth');
const applicationRoutes = require('./routes/applications');
const adminRoutes = require('./routes/admin');
const analyticsRoutes = require('./routes/analytics');

app.use('/api/auth', authRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/analytics', analyticsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'AI Certificate Management System API is running' });
});

// Only start a port listener when running locally (not in Vercel serverless)
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
