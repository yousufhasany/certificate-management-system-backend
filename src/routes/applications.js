const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Application = require('../models/Application');
const { protect } = require('../middleware/auth');
const AIVerificationService = require('../services/aiVerification');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only jpeg, jpg, png, and pdf files are allowed'));
  }
});

// Generate unique application ID
const generateApplicationId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `APP-${timestamp}-${random}`;
};

// @route   POST /api/applications/certificate
// @desc    Submit a new certificate application
// @access  Private
router.post('/certificate', protect, upload.array('documents', 5), async (req, res) => {
  try {
    const { certificateType, studentName, roll, registrationNo, year, board } = req.body;

    // Prepare documents array
    const documents = req.files?.map(file => ({
      filename: file.filename,
      originalName: file.originalname,
      path: `/uploads/${file.filename}`
    })) || [];

    // Create application
    const application = new Application({
      applicationId: generateApplicationId(),
      userId: req.user.id,
      type: 'certificate',
      certificateType,
      studentName,
      roll,
      registrationNo,
      year,
      board,
      documents,
      status: 'pending'
    });

    // Perform AI verification
    const formData = { studentName, roll, registrationNo, year, board };
    const primaryDocument = req.files?.[0] || null;
    const aiResult = await AIVerificationService.performVerification(primaryDocument, formData);
    application.aiVerification = aiResult;

    // Auto-update status based on AI recommendation
    if (aiResult.recommendation === 'APPROVE' && aiResult.confidenceScore >= 90) {
      application.status = 'under_review';
    }

    await application.save();

    res.status(201).json({
      message: 'Application submitted successfully',
      application
    });
  } catch (error) {
    console.error('Create application error:', error);
    res.status(500).json({ message: 'Server error creating application' });
  }
});

// @route   POST /api/applications/reissue
// @desc    Submit a reissue application
// @access  Private
router.post('/reissue', protect, upload.array('documents', 5), async (req, res) => {
  try {
    const { certificateType, studentName, roll, registrationNo, year, board, reissueReason } = req.body;

    const documents = req.files?.map(file => ({
      filename: file.filename,
      originalName: file.originalname,
      path: `/uploads/${file.filename}`
    })) || [];

    const application = new Application({
      applicationId: generateApplicationId(),
      userId: req.user.id,
      type: 'reissue',
      certificateType,
      studentName,
      roll,
      registrationNo,
      year,
      board,
      reissueReason,
      documents,
      status: 'pending'
    });

    // Perform AI verification
    const formData = { studentName, roll, registrationNo, year, board };
    const primaryDocument = req.files?.[0] || null;
    const aiResult = await AIVerificationService.performVerification(primaryDocument, formData);
    application.aiVerification = aiResult;

    await application.save();

    res.status(201).json({
      message: 'Reissue application submitted successfully',
      application
    });
  } catch (error) {
    console.error('Create reissue application error:', error);
    res.status(500).json({ message: 'Server error creating reissue application' });
  }
});

// @route   POST /api/applications/correction
// @desc    Submit a correction request
// @access  Private
router.post('/correction', protect, upload.array('documents', 5), async (req, res) => {
  try {
    const { certificateType, studentName, roll, registrationNo, year, board, correctionFields } = req.body;

    const documents = req.files?.map(file => ({
      filename: file.filename,
      originalName: file.originalname,
      path: `/uploads/${file.filename}`
    })) || [];

    // Parse correctionFields if it's a string
    let parsedCorrectionFields = correctionFields;
    if (typeof correctionFields === 'string') {
      parsedCorrectionFields = JSON.parse(correctionFields);
    }

    const application = new Application({
      applicationId: generateApplicationId(),
      userId: req.user.id,
      type: 'correction',
      certificateType,
      studentName,
      roll,
      registrationNo,
      year,
      board,
      correctionFields: parsedCorrectionFields,
      documents,
      status: 'pending'
    });

    // Perform AI verification
    const formData = { studentName, roll, registrationNo, year, board };
    const primaryDocument = req.files?.[0] || null;
    const aiResult = await AIVerificationService.performVerification(primaryDocument, formData);
    application.aiVerification = aiResult;

    await application.save();

    res.status(201).json({
      message: 'Correction request submitted successfully',
      application
    });
  } catch (error) {
    console.error('Create correction application error:', error);
    res.status(500).json({ message: 'Server error creating correction application' });
  }
});

// @route   GET /api/applications
// @desc    Get all applications for current user
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { status, type } = req.query;
    
    const query = { userId: req.user.id };
    if (status) query.status = status;
    if (type) query.type = type;

    const applications = await Application.find(query)
      .sort({ createdAt: -1 })
      .populate('userId', 'fullName email');

    res.json(applications);
  } catch (error) {
    console.error('Get applications error:', error);
    res.status(500).json({ message: 'Server error fetching applications' });
  }
});

// @route   GET /api/applications/stats
// @desc    Get application statistics for current user
// @access  Private
router.get('/stats', protect, async (req, res) => {
  try {
    const userId = req.user.id;

    const stats = await Application.aggregate([
      { $match: { userId: req.user._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalApplications = await Application.countDocuments({ userId: req.user._id });

    const result = {
      total: totalApplications,
      pending: 0,
      under_review: 0,
      approved: 0,
      rejected: 0
    };

    stats.forEach(stat => {
      result[stat._id] = stat.count;
    });

    res.json(result);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ message: 'Server error fetching stats' });
  }
});

// @route   GET /api/applications/:id
// @desc    Get single application
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const application = await Application.findOne({
      _id: req.params.id,
      userId: req.user.id
    }).populate('userId', 'fullName email');

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    res.json(application);
  } catch (error) {
    console.error('Get application error:', error);
    res.status(500).json({ message: 'Server error fetching application' });
  }
});

module.exports = router;
