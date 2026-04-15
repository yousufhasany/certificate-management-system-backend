const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema({
  applicationId: {
    type: String,
    unique: true,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['certificate', 'reissue', 'correction'],
    required: true
  },
  certificateType: {
    type: String,
    enum: ['SSC', 'HSC'],
    required: true
  },
  // Student Details
  studentName: {
    type: String,
    required: true
  },
  roll: {
    type: String,
    required: true
  },
  registrationNo: {
    type: String,
    required: true
  },
  year: {
    type: String,
    required: true
  },
  board: {
    type: String,
    required: true
  },
  // For reissue
  reissueReason: {
    type: String
  },
  // For correction
  correctionFields: [{
    type: String,
    enum: ['name', 'fatherName', 'motherName', 'dateOfBirth']
  }],
  // Documents
  documents: [{
    filename: String,
    originalName: String,
    path: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // AI Verification Results
  aiVerification: {
    extractedName: String,
    extractedRoll: String,
    extractedReg: String,
    extractedYear: String,
    extractedBoard: String,
    confidenceScore: {
      type: Number,
      default: 0
    },
    fraudRisk: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      default: 'LOW'
    },
    nameMatch: {
      type: Boolean,
      default: false
    },
    rollMatch: {
      type: Boolean,
      default: false
    },
    forgeryDetected: {
      type: Boolean,
      default: false
    },
    riskScore: {
      type: Number,
      default: 0
    },
    riskSignals: [{
      type: String
    }],
    recommendation: {
      type: String,
      enum: ['APPROVE', 'MANUAL_REVIEW', 'REJECT'],
      default: 'MANUAL_REVIEW'
    },
    verifiedAt: Date
  },
  // Status
  status: {
    type: String,
    enum: ['pending', 'under_review', 'approved', 'rejected'],
    default: 'pending'
  },
  rejectionReason: {
    type: String
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
applicationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Application', applicationSchema);
