const express = require('express');
const Application = require('../models/Application');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');
const AIVerificationService = require('../services/aiVerification');

const router = express.Router();

// @route   GET /api/admin/applications
// @desc    Get all applications (admin)
// @access  Private/Admin
router.get('/applications', protect, adminOnly, async (req, res) => {
  try {
    const { status, type, fraudRisk, page = 1, limit = 20 } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (type) query.type = type;
    if (fraudRisk) query['aiVerification.fraudRisk'] = fraudRisk;

    const applications = await Application.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('userId', 'fullName email phone')
      .populate('reviewedBy', 'fullName');

    const total = await Application.countDocuments(query);

    res.json({
      applications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Admin get applications error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/applications/:id
// @desc    Get single application (admin)
// @access  Private/Admin
router.get('/applications/:id', protect, adminOnly, async (req, res) => {
  try {
    const application = await Application.findById(req.params.id)
      .populate('userId', 'fullName email phone')
      .populate('reviewedBy', 'fullName');

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    res.json(application);
  } catch (error) {
    console.error('Admin get application error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/admin/applications/:id/approve
// @desc    Approve an application
// @access  Private/Admin
router.put('/applications/:id/approve', protect, adminOnly, async (req, res) => {
  try {
    const application = await Application.findById(req.params.id);

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    application.status = 'approved';
    application.reviewedBy = req.user.id;
    application.reviewedAt = new Date();

    await application.save();

    res.json({
      message: 'Application approved successfully',
      application
    });
  } catch (error) {
    console.error('Approve application error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/admin/applications/:id/reject
// @desc    Reject an application
// @access  Private/Admin
router.put('/applications/:id/reject', protect, adminOnly, async (req, res) => {
  try {
    const { rejectionReason } = req.body;

    const application = await Application.findById(req.params.id);

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    application.status = 'rejected';
    application.rejectionReason = rejectionReason || 'Application rejected by administrator';
    application.reviewedBy = req.user.id;
    application.reviewedAt = new Date();

    await application.save();

    res.json({
      message: 'Application rejected',
      application
    });
  } catch (error) {
    console.error('Reject application error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/stats
// @desc    Get admin dashboard statistics
// @access  Private/Admin
router.get('/stats', protect, adminOnly, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalApplications,
      pendingCount,
      approvedToday,
      rejectedCount,
      highRiskCount,
      applications
    ] = await Promise.all([
      Application.countDocuments(),
      Application.countDocuments({ status: { $in: ['pending', 'under_review'] } }),
      Application.countDocuments({ 
        status: 'approved',
        reviewedAt: { $gte: today }
      }),
      Application.countDocuments({ status: 'rejected' }),
      Application.countDocuments({ 'aiVerification.fraudRisk': 'HIGH' }),
      Application.find().select('aiVerification board certificateType status createdAt')
    ]);

    // Get AI analytics
    const aiAnalytics = AIVerificationService.generateAnalytics(applications);

    const reviewedApplications = applications.filter(app =>
      ['approved', 'rejected'].includes(app.status) && app.aiVerification?.recommendation
    );

    const correctRecommendations = reviewedApplications.filter(app =>
      (app.status === 'approved' && app.aiVerification.recommendation === 'APPROVE') ||
      (app.status === 'rejected' && app.aiVerification.recommendation === 'REJECT')
    ).length;

    const aiAccuracyRate = reviewedApplications.length > 0
      ? Math.round((correctRecommendations / reviewedApplications.length) * 100)
      : 0;

    res.json({
      totalApplications,
      pendingReview: pendingCount,
      approvedToday,
      rejected: rejectedCount,
      aiFlaggedCases: highRiskCount,
      aiAccuracyRate,
      ...aiAnalytics
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/flagged
// @desc    Get AI flagged applications
// @access  Private/Admin
router.get('/flagged', protect, adminOnly, async (req, res) => {
  try {
    const flaggedApplications = await Application.find({
      'aiVerification.fraudRisk': { $in: ['MEDIUM', 'HIGH'] }
    })
      .sort({ 'aiVerification.fraudRisk': -1, createdAt: -1 })
      .limit(10)
      .populate('userId', 'fullName email');

    res.json(flaggedApplications);
  } catch (error) {
    console.error('Get flagged error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users
// @access  Private/Admin
router.get('/users', protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
