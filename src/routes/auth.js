const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { initFirebaseAdmin } = require('../services/firebaseAdmin');

const router = express.Router();

const isDbError = (error) => {
  if (!error || !error.name) return false;
  return error.name === 'MongooseServerSelectionError'
    || error.name === 'MongoServerSelectionError'
    || error.name === 'MongoNetworkError';
};

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_in_production', {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, phone, password, role } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Create user
    const user = await User.create({
      fullName,
      email,
      phone,
      password,
      role: role || 'student'
    });

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      message: 'Registration successful',
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role
      },
      token
    });
  } catch (error) {
    if (isDbError(error)) {
      console.error('Registration DB error:', error.name);
      return res.status(503).json({ message: 'Database unavailable. Try again shortly.' });
    }

    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate token
    const token = generateToken(user._id);

    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role
      },
      token
    });
  } catch (error) {
    if (isDbError(error)) {
      console.error('Login DB error:', error.name);
      return res.status(503).json({ message: 'Database unavailable. Try again shortly.' });
    }

    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// @route   POST /api/auth/firebase
// @desc    Login with Firebase ID token
// @access  Public
router.post('/firebase', async (req, res) => {
  try {
    const { idToken, fullName, phone } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: 'Missing Firebase ID token' });
    }

    const safeFullName = typeof fullName === 'string' ? fullName.trim().slice(0, 120) : '';
    const safePhone = typeof phone === 'string' ? phone.trim().slice(0, 30) : '';

    const admin = initFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(idToken);

    if (!decoded.email) {
      return res.status(400).json({ message: 'Firebase user email is required' });
    }

    let user = await User.findOne({ email: decoded.email });

    if (!user) {
      user = await User.create({
        fullName: safeFullName || decoded.name || 'Firebase User',
        email: decoded.email,
        phone: safePhone || decoded.phone_number || 'N/A',
        password: crypto.randomBytes(24).toString('hex'),
        role: 'student',
        firebaseUid: decoded.uid
      });
    } else {
      let changed = false;

      if (!user.firebaseUid && decoded.uid) {
        user.firebaseUid = decoded.uid;
        changed = true;
      }

      if (safeFullName && (!user.fullName || user.fullName === 'Firebase User')) {
        user.fullName = safeFullName;
        changed = true;
      }

      if (safePhone && (!user.phone || user.phone === 'N/A')) {
        user.phone = safePhone;
        changed = true;
      }

      if (changed) {
        await user.save();
      }
    }

    const token = generateToken(user._id);

    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role
      },
      token
    });
  } catch (error) {
    if (isDbError(error)) {
      console.error('Firebase login DB error:', error.name);
      return res.status(503).json({ message: 'Database unavailable. Try again shortly.' });
    }

    const firebaseCode = error?.code || error?.errorInfo?.code;

    if (error && typeof error.message === 'string') {
      if (
        error.message.includes('Firebase Admin SDK not configured')
        || error.message.includes('Invalid FIREBASE_SERVICE_ACCOUNT_PATH')
        || error.message.includes('Invalid FIREBASE_SERVICE_ACCOUNT_JSON')
      ) {
        return res.status(500).json({ message: 'Firebase Admin is not configured correctly on server.' });
      }
    }

    if (typeof firebaseCode === 'string' && firebaseCode.startsWith('auth/')) {
      return res.status(401).json({ message: 'Invalid Firebase token', error: firebaseCode });
    }

    if (
      error
      && (
        firebaseCode === 'app/invalid-credential'
        || error.codePrefix === 'app'
      )
    ) {
      return res.status(500).json({ message: 'Invalid Firebase Admin credentials. Check FIREBASE_PRIVATE_KEY format.', error: firebaseCode || 'app/invalid-credential' });
    }

    console.error('Firebase login error:', error);
    return res.status(500).json({
      message: 'Server error during Firebase login',
      error: firebaseCode || error?.name || 'UnknownError'
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (error) {
    if (isDbError(error)) {
      console.error('Get user DB error:', error.name);
      return res.status(503).json({ message: 'Database unavailable. Try again shortly.' });
    }

    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', protect, async (req, res) => {
  try {
    const { fullName, phone } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { fullName, phone },
      { new: true }
    ).select('-password');

    res.json({
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    if (isDbError(error)) {
      console.error('Update profile DB error:', error.name);
      return res.status(503).json({ message: 'Database unavailable. Try again shortly.' });
    }

    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
