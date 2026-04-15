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

// Body parsing
// - Locally: parse JSON bodies via express.json()
// - On Vercel: req.body may already be populated; avoid double-reading the stream (can cause 400 Bad Request)
const jsonParser = express.json();
app.use((req, res, next) => {
  if (req.body !== undefined) {
    if (typeof req.body === 'string' && req.body.length) {
      try {
        req.body = JSON.parse(req.body);
      } catch (e) {
        // Leave as-is; routes can validate as needed.
      }
    }
    return next();
  }

  return jsonParser(req, res, next);
});

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

// Return JSON for invalid JSON payloads instead of the default HTML error page
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'Invalid JSON' });
  }
  return next(err);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'AI Certificate Management System API is running' });
});

// DB health check (used to verify MongoDB connectivity in deployments)
app.get('/api/health/db', async (req, res) => {
  try {
    await connectDB();

    const readyState = mongoose.connection.readyState;
    if (!mongoose.connection.db) {
      return res.status(503).json({
        status: 'ERROR',
        message: 'Database connection is not ready',
        db: { connected: false, readyState }
      });
    }

    const ping = await mongoose.connection.db.admin().ping();

    return res.json({
      status: 'OK',
      message: 'Database reachable',
      db: { connected: true, readyState, ping }
    });
  } catch (error) {
    console.error('DB health check error:', error);
    return res.status(503).json({
      status: 'ERROR',
      message: 'Database unavailable',
      error: error?.name || 'UnknownError'
    });
  }
});

// Firebase Admin health check (used to verify Firebase Admin credentials in deployments)
app.get('/api/health/firebase', (req, res) => {
  try {
    // Require lazily to avoid initializing Firebase Admin on cold start unless needed
    const { initFirebaseAdmin } = require('./services/firebaseAdmin');
    const admin = initFirebaseAdmin();
    const appInstance = admin.app();

    return res.json({
      status: 'OK',
      message: 'Firebase Admin initialized',
      firebase: {
        projectId: appInstance?.options?.projectId || process.env.FIREBASE_PROJECT_ID || null
      }
    });
  } catch (error) {
    console.error('Firebase health check error:', error);
    return res.status(503).json({
      status: 'ERROR',
      message: 'Firebase Admin not configured',
      error: error?.message || error?.name || 'UnknownError'
    });
  }
});

// Only start a port listener when running locally (not in Vercel serverless)
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
