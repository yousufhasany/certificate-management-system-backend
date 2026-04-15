const express = require('express');
const Application = require('../models/Application');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/analytics/overview
// @desc    Get analytics overview
// @access  Private/Admin
router.get('/overview', protect, adminOnly, async (req, res) => {
  try {
    const applications = await Application.find();

    // Monthly applications (last 6 months)
    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const year = date.getFullYear();
      const month = date.getMonth();

      const count = applications.filter(app => {
        const appDate = new Date(app.createdAt);
        return appDate.getMonth() === month && appDate.getFullYear() === year;
      }).length;

      monthlyData.push({
        month: date.toLocaleString('default', { month: 'short' }),
        year,
        count
      });
    }

    // Board-wise distribution
    const boardDistribution = {};
    applications.forEach(app => {
      boardDistribution[app.board] = (boardDistribution[app.board] || 0) + 1;
    });

    // Certificate type distribution
    const typeDistribution = {
      SSC: applications.filter(a => a.certificateType === 'SSC').length,
      HSC: applications.filter(a => a.certificateType === 'HSC').length
    };

    // Application type distribution
    const applicationTypeDistribution = {
      certificate: applications.filter(a => a.type === 'certificate').length,
      reissue: applications.filter(a => a.type === 'reissue').length,
      correction: applications.filter(a => a.type === 'correction').length
    };

    // Status distribution
    const statusDistribution = {
      pending: applications.filter(a => a.status === 'pending').length,
      under_review: applications.filter(a => a.status === 'under_review').length,
      approved: applications.filter(a => a.status === 'approved').length,
      rejected: applications.filter(a => a.status === 'rejected').length
    };

    // Fraud risk distribution
    const fraudDistribution = {
      LOW: applications.filter(a => a.aiVerification?.fraudRisk === 'LOW').length,
      MEDIUM: applications.filter(a => a.aiVerification?.fraudRisk === 'MEDIUM').length,
      HIGH: applications.filter(a => a.aiVerification?.fraudRisk === 'HIGH').length
    };

    // Average confidence score
    const confidenceScores = applications
      .filter(a => a.aiVerification?.confidenceScore)
      .map(a => a.aiVerification.confidenceScore);
    
    const avgConfidence = confidenceScores.length > 0
      ? Math.round(confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length)
      : 0;

    // Fraud trend (last 6 months)
    const fraudTrend = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const year = date.getFullYear();
      const month = date.getMonth();

      const monthApps = applications.filter(app => {
        const appDate = new Date(app.createdAt);
        return appDate.getMonth() === month && appDate.getFullYear() === year;
      });

      const highRiskCount = monthApps.filter(a => a.aiVerification?.fraudRisk === 'HIGH').length;

      fraudTrend.push({
        month: date.toLocaleString('default', { month: 'short' }),
        highRisk: highRiskCount,
        total: monthApps.length
      });
    }

    res.json({
      monthlyApplications: monthlyData,
      boardDistribution,
      typeDistribution,
      applicationTypeDistribution,
      statusDistribution,
      fraudDistribution,
      averageConfidence: avgConfidence,
      fraudTrend,
      aiModelStats: {
        version: 'v1.2',
        accuracy: 91.8,
        lastTrained: '2026-01-15',
        totalProcessed: applications.length
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/analytics/ai-performance
// @desc    Get AI performance metrics
// @access  Private/Admin
router.get('/ai-performance', protect, adminOnly, async (req, res) => {
  try {
    const applications = await Application.find({
      'aiVerification.verifiedAt': { $exists: true }
    });

    // Calculate metrics
    const totalVerified = applications.length;
    const correctRecommendations = applications.filter(app => {
      if (app.status === 'approved' && app.aiVerification?.recommendation === 'APPROVE') return true;
      if (app.status === 'rejected' && app.aiVerification?.recommendation === 'REJECT') return true;
      return false;
    }).length;

    const accuracy = totalVerified > 0 
      ? Math.round((correctRecommendations / totalVerified) * 100) 
      : 0;

    // Confidence distribution
    const confidenceBuckets = {
      '90-100': 0,
      '80-89': 0,
      '70-79': 0,
      '60-69': 0,
      'below-60': 0
    };

    applications.forEach(app => {
      const score = app.aiVerification?.confidenceScore || 0;
      if (score >= 90) confidenceBuckets['90-100']++;
      else if (score >= 80) confidenceBuckets['80-89']++;
      else if (score >= 70) confidenceBuckets['70-79']++;
      else if (score >= 60) confidenceBuckets['60-69']++;
      else confidenceBuckets['below-60']++;
    });

    res.json({
      totalVerified,
      accuracy,
      confidenceDistribution: confidenceBuckets,
      averageProcessingTime: '2.3s', // Simulated
      modelVersion: 'v1.2',
      lastUpdated: new Date()
    });
  } catch (error) {
    console.error('AI performance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
