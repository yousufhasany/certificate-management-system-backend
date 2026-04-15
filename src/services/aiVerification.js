/**
 * AI Verification Service
 * Rule-based verification without a labeled dataset.
 * It combines file-integrity checks and form/document consistency checks.
 */

const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');

class AIVerificationService {
  static addSignal(bucket, code, points) {
    bucket.signals.push(code);
    bucket.riskPoints += points;
  }

  static clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  static expectedMimeByExt(ext) {
    const map = {
      '.pdf': ['application/pdf'],
      '.jpg': ['image/jpeg'],
      '.jpeg': ['image/jpeg'],
      '.png': ['image/png']
    };
    return map[ext] || [];
  }

  static resolveDocumentPath(document) {
    if (!document || !document.path) {
      return '';
    }

    if (path.isAbsolute(document.path)) {
      return document.path;
    }

    return path.join(process.cwd(), document.path);
  }

  static normalizeLoose(str) {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  static containsLoose(haystack, needle) {
    const h = this.normalizeLoose(haystack);
    const n = this.normalizeLoose(needle);
    if (!h || !n) return false;
    return h.includes(n);
  }

  static extractFirstMatch(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return '';
  }

  static extractYearFromText(text) {
    const yearMatch = text.match(/\b(19\d{2}|20\d{2})\b/);
    return yearMatch ? yearMatch[1] : '';
  }

  static async extractRawTextFromDocument(document) {
    if (!document) {
      return { text: '', engine: 'none', attempted: false, readable: false };
    }

    const originalName = (document.originalname || document.originalName || document.filename || '').toLowerCase();
    const extension = path.extname(originalName);
    const resolvedPath = this.resolveDocumentPath(document);

    if (!resolvedPath) {
      console.warn('[OCR] Could not resolve document path', { originalName, documentPath: document.path });
      return { text: '', engine: 'none', attempted: false, readable: false };
    }

    try {
      if (extension === '.pdf') {
        const fileBuffer = fs.readFileSync(resolvedPath);
        const parsed = await pdfParse(fileBuffer);
        const text = (parsed?.text || '').trim();
        console.log('[OCR] PDF extraction success', { length: text.length, readable: text.length >= 20 });
        return {
          text,
          engine: 'pdf-parse',
          attempted: true,
          readable: text.length >= 20
        };
      }

      if (extension === '.jpg' || extension === '.jpeg' || extension === '.png') {
        console.log('[OCR] Starting Tesseract for image', { originalName, resolvedPath });
        const ocrResult = await Tesseract.recognize(resolvedPath, 'eng', {
          logger: () => {}
        });

        const text = (ocrResult?.data?.text || '').trim();
        const confidence = ocrResult?.data?.confidence || 0;
        console.log('[OCR] Tesseract result', { textLength: text.length, confidence, readable: text.length >= 20 });
        return {
          text,
          engine: 'tesseract.js',
          attempted: true,
          readable: text.length >= 20,
          confidence: Math.round(confidence)
        };
      }

      return { text: '', engine: 'unsupported', attempted: true, readable: false };
    } catch (error) {
      console.error('[OCR] Extraction failed', { originalName, error: error.message });
      return { text: '', engine: 'failed', attempted: true, readable: false };
    }
  }

  static checkFileSignature(document, ext) {
    if (!document || !document.path) {
      return { state: 'missing-path' };
    }

    try {
      const fd = fs.openSync(document.path, 'r');
      const header = Buffer.alloc(8);
      const bytesRead = fs.readSync(fd, header, 0, 8, 0);
      fs.closeSync(fd);

      if (bytesRead < 4) {
        return { state: 'invalid' };
      }

      if (ext === '.pdf') {
        const isPdf = header.subarray(0, 5).toString('utf8') === '%PDF-';
        return { state: isPdf ? 'valid' : 'invalid' };
      }

      if (ext === '.jpg' || ext === '.jpeg') {
        const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
        return { state: isJpeg ? 'valid' : 'invalid' };
      }

      if (ext === '.png') {
        const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        const isPng = pngSignature.every((value, idx) => header[idx] === value);
        return { state: isPng ? 'valid' : 'invalid' };
      }

      return { state: 'skipped' };
    } catch (error) {
      return { state: 'unreadable' };
    }
  }

  static readDocumentText(document) {
    if (!document || !document.path) {
      return '';
    }

    try {
      // Files are already limited by multer to 5MB, safe to read for lightweight marker checks.
      const fileBuffer = fs.readFileSync(document.path);
      return fileBuffer.toString('latin1').toLowerCase();
    } catch (error) {
      return '';
    }
  }

  static analyzeDocumentSignals(document) {
    const result = { riskPoints: 0, signals: [], hardForgeryDetected: false };

    if (!document) {
      this.addSignal(result, 'NO_DOCUMENT_UPLOADED', 55);
      return result;
    }

    const originalName = (document.originalname || document.originalName || document.filename || '').toLowerCase();
    const extension = path.extname(originalName);
    const allowedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

    if (!extension) {
      this.addSignal(result, 'MISSING_FILE_EXTENSION', 20);
    } else if (!allowedExtensions.has(extension)) {
      this.addSignal(result, 'UNSUPPORTED_FILE_EXTENSION', 35);
      result.hardForgeryDetected = true;
    }

    const hardSuspiciousFilename = /(fake|forged|tamper|photoshop|manipulat|altered)/i;
    if (hardSuspiciousFilename.test(originalName)) {
      this.addSignal(result, 'HARD_SUSPICIOUS_FILENAME_PATTERN', 55);
      result.hardForgeryDetected = true;
    }

    const softSuspiciousFilename = /(edited|copy|final_final|camscanner|scan\d*|v\d+)/i;
    if (softSuspiciousFilename.test(originalName)) {
      this.addSignal(result, 'SUSPICIOUS_FILENAME_PATTERN', 18);
    }

    if ((originalName.match(/\./g) || []).length > 1) {
      this.addSignal(result, 'MULTI_DOT_FILENAME', 8);
    }

    // Image-based uploads are easier to manipulate than native PDF exports.
    if (extension === '.jpg' || extension === '.jpeg' || extension === '.png') {
      this.addSignal(result, 'RASTER_IMAGE_DOCUMENT', 12);
    }

    if (typeof document.size === 'number') {
      if (document.size < 15 * 1024) {
        this.addSignal(result, 'VERY_SMALL_FILE_SIZE', 20);
      }
      if (document.size > 4.5 * 1024 * 1024) {
        this.addSignal(result, 'NEAR_MAX_FILE_SIZE', 8);
      }
    }

    if (document.mimetype && extension) {
      const expectedMimes = this.expectedMimeByExt(extension);
      if (expectedMimes.length > 0 && !expectedMimes.includes(document.mimetype)) {
        this.addSignal(result, 'MIME_EXTENSION_MISMATCH', 25);
      }
    }

    const signature = this.checkFileSignature(document, extension);
    if (signature.state === 'invalid') {
      this.addSignal(result, 'FILE_SIGNATURE_MISMATCH', 40);
      result.hardForgeryDetected = true;
    } else if (signature.state === 'unreadable') {
      this.addSignal(result, 'FILE_SIGNATURE_UNREADABLE', 10);
    } else if (signature.state === 'missing-path') {
      this.addSignal(result, 'FILE_PATH_MISSING', 8);
    }

    // Look for common editor fingerprints in metadata/content chunks.
    const contentText = this.readDocumentText(document);
    if (contentText) {
      const hardEditMarkers = /(adobe photoshop|photoshop|gimp|pixlr|canva|picsart|snapseed|lightroom)/i;
      const softEditMarkers = /(software\x00|xmp:createtool|creator tool|modified by|edited)/i;

      if (hardEditMarkers.test(contentText)) {
        this.addSignal(result, 'EDITOR_METADATA_MARKER', 35);
      } else if (softEditMarkers.test(contentText)) {
        this.addSignal(result, 'POSSIBLE_EDITOR_METADATA', 15);
      }
    }

    return result;
  }

  static analyzeFieldConsistency(extractedData, formData, nameMatch, rollMatch) {
    const result = { riskPoints: 0, signals: [] };

    // Adjust penalty severity based on OCR confidence
    // If OCR is unreliable, don't penalize field mismatches as heavily
    const ocrConfidence = extractedData.ocrConfidence || 0;
    const isLowOcrQuality = ocrConfidence < 50;

    if (!nameMatch && !isLowOcrQuality) {
      this.addSignal(result, 'NAME_MISMATCH', 25);
    } else if (!nameMatch && isLowOcrQuality) {
      // Low OCR quality: lighter penalty for name mismatch
      this.addSignal(result, 'NAME_MISMATCH', 5);
    }

    if (!rollMatch && !isLowOcrQuality) {
      this.addSignal(result, 'ROLL_MISMATCH', 25);
    } else if (!rollMatch && isLowOcrQuality) {
      // Low OCR quality: lighter penalty for roll mismatch
      this.addSignal(result, 'ROLL_MISMATCH', 5);
    }

    if (this.normalizeString(extractedData.extractedReg) !== this.normalizeString(formData.registrationNo)) {
      if (!isLowOcrQuality) {
        this.addSignal(result, 'REGISTRATION_MISMATCH', 20);
      } else {
        this.addSignal(result, 'REGISTRATION_MISMATCH', 3);
      }
    }

    if (this.normalizeString(extractedData.extractedYear) !== this.normalizeString(formData.year)) {
      if (!isLowOcrQuality) {
        this.addSignal(result, 'YEAR_MISMATCH', 12);
      } else {
        this.addSignal(result, 'YEAR_MISMATCH', 2);
      }
    }

    if (this.normalizeString(extractedData.extractedBoard) !== this.normalizeString(formData.board)) {
      if (!isLowOcrQuality) {
        this.addSignal(result, 'BOARD_MISMATCH', 15);
      } else {
        this.addSignal(result, 'BOARD_MISMATCH', 3);
      }
    }

    if (extractedData.ocrAttempted && !extractedData.ocrReadable) {
      this.addSignal(result, 'OCR_TEXT_UNREADABLE', 20);
    }

    // Only apply strict OCR field penalties if OCR confidence is HIGH (>60%)
    const ocrIsHighConfidence = extractedData.ocrConfidence && extractedData.ocrConfidence >= 60;

    if (extractedData.ocrReadable && ocrIsHighConfidence) {
      // Strict penalties only if OCR is confident
      if (!this.containsLoose(extractedData.ocrText, formData.studentName)) {
        this.addSignal(result, 'OCR_NAME_NOT_FOUND', 20);  // Reduced from 30
      }

      if (!this.containsLoose(extractedData.ocrText, formData.roll)) {
        this.addSignal(result, 'OCR_ROLL_NOT_FOUND', 20);  // Reduced from 30
      }

      if (!this.containsLoose(extractedData.ocrText, formData.registrationNo)) {
        this.addSignal(result, 'OCR_REGISTRATION_NOT_FOUND', 20);  // Reduced from 30
      }

      if (!this.containsLoose(extractedData.ocrText, formData.year)) {
        this.addSignal(result, 'OCR_YEAR_NOT_FOUND', 8);  // Reduced from 10
      }

      if (!this.containsLoose(extractedData.ocrText, formData.board)) {
        this.addSignal(result, 'OCR_BOARD_NOT_FOUND', 8);  // Reduced from 10
      }
    } else if (extractedData.ocrReadable && !ocrIsHighConfidence) {
      // Low OCR confidence: only penalize if VERY suspicious (multiple fields completely absent)
      const missingCount = [
        !this.containsLoose(extractedData.ocrText, formData.studentName),
        !this.containsLoose(extractedData.ocrText, formData.roll),
        !this.containsLoose(extractedData.ocrText, formData.registrationNo)
      ].filter(Boolean).length;

      if (missingCount >= 3) {
        this.addSignal(result, 'OCR_MULTIPLE_FIELDS_MISSING', 15);
      }
    }

    const rollPattern = /^[A-Za-z0-9-]{4,20}$/;
    if (!rollPattern.test(formData.roll || '')) {
      this.addSignal(result, 'INVALID_ROLL_FORMAT', 12);
    }

    const regPattern = /^[A-Za-z0-9-]{6,30}$/;
    if (!regPattern.test(formData.registrationNo || '')) {
      this.addSignal(result, 'INVALID_REGISTRATION_FORMAT', 12);
    }

    const yearNum = Number(formData.year);
    const maxYear = new Date().getFullYear() + 1;
    if (!Number.isInteger(yearNum) || yearNum < 1980 || yearNum > maxYear) {
      this.addSignal(result, 'INVALID_YEAR_RANGE', 12);
    }

    return result;
  }

  /**
   * Placeholder extraction layer.
   * In production this should be replaced with OCR output.
   */
  static async extractDataFromDocument(document, formData) {
    let baseConfidence = 45;
    if (document) {
      const originalName = (document.originalname || document.originalName || document.filename || '').toLowerCase();
      const extension = path.extname(originalName);

      if (extension === '.pdf') {
        baseConfidence = 88;
      } else if (extension === '.jpg' || extension === '.jpeg' || extension === '.png') {
        baseConfidence = 72;
      } else {
        baseConfidence = 60;
      }
    }

    const ocr = await this.extractRawTextFromDocument(document);
    console.log('[VERIFY] OCR result:', { engine: ocr.engine, textLength: ocr.text?.length, confidence: ocr.confidence, readable: ocr.readable, baseConfidence });

    const extractedRoll = this.extractFirstMatch(ocr.text, [
      /(?:roll\s*(?:no|number)?|r\/n)\s*[:\-]?\s*([a-z0-9-]{4,20})/i,
      /\b([a-z0-9]{2,6}-[a-z0-9-]{2,20})\b/i
    ]);

    const extractedReg = this.extractFirstMatch(ocr.text, [
      /(?:registration\s*(?:no|number)?|reg\s*(?:no|number)?)\s*[:\-]?\s*([a-z0-9-]{6,30})/i,
      /\b([a-z0-9]{3,8}-[a-z0-9-]{4,24})\b/i
    ]);

    const extractedYear = this.extractYearFromText(ocr.text);

    const extractedName = this.containsLoose(ocr.text, formData.studentName)
      ? formData.studentName
      : '';

    const extractedBoard = this.containsLoose(ocr.text, formData.board)
      ? formData.board
      : '';

    if (ocr.attempted && !ocr.readable) {
      baseConfidence -= 15;
    }

    // Only penalize field mismatches if OCR confidence is HIGH (>60%)
    // If OCR quality is poor, treat it as "OCR unreliable" not "certificate tampered"
    const ocrIsHighConfidence = ocr.confidence && ocr.confidence >= 60;

    if (ocr.readable && ocrIsHighConfidence) {
      // Strict matching: penalize mismatches with 5-7 points (reduced from 12-14)
      if (!this.containsLoose(ocr.text, formData.studentName)) baseConfidence -= 5;
      if (!this.containsLoose(ocr.text, formData.roll)) baseConfidence -= 6;
      if (!this.containsLoose(ocr.text, formData.registrationNo)) baseConfidence -= 6;
      if (!this.containsLoose(ocr.text, formData.year)) baseConfidence -= 3;
      if (!this.containsLoose(ocr.text, formData.board)) baseConfidence -= 3;
    } else if (ocr.readable && !ocrIsHighConfidence) {
      // Low OCR confidence: be very lenient, only penalize if multiple fields missing
      const missingCount = [
        !this.containsLoose(ocr.text, formData.studentName),
        !this.containsLoose(ocr.text, formData.roll),
        !this.containsLoose(ocr.text, formData.registrationNo)
      ].filter(Boolean).length;

      if (missingCount >= 3) {
        baseConfidence -= 8; // Only penalize if ALL major fields missing
      } else if (missingCount >= 2) {
        baseConfidence -= 4; // Soft penalty for 2+ missing fields
      }
    }

    const extractedData = {
      extractedName,
      extractedRoll,
      extractedReg,
      extractedYear,
      extractedBoard,
      ocrText: ocr.text,
      ocrEngine: ocr.engine,
      ocrAttempted: ocr.attempted,
      ocrReadable: ocr.readable,
      ocrConfidence: ocr.confidence || 0
    };

    return {
      ...extractedData,
      confidenceScore: this.clamp(baseConfidence, 0, 100)
    };
  }

  /**
   * Verify document authenticity and detect fraud
   */
  static verifyDocument(extractedData, formData, document) {
    console.log('[VERIFY] Document verification - extracted confidence:', extractedData.confidenceScore, 'OCR confidence:', extractedData.ocrConfidence);
    
    const nameMatch = this.normalizeString(extractedData.extractedName) ===
                      this.normalizeString(formData.studentName);
    const rollMatch = extractedData.extractedRoll === formData.roll;
    
    console.log('[VERIFY] Field matching:', { 
      nameMatch,
      nameExtracted: extractedData.extractedName,
      nameForm: formData.studentName,
      rollMatch,
      rollExtracted: extractedData.extractedRoll,
      rollForm: formData.roll
    });

    const fileAnalysis = this.analyzeDocumentSignals(document);
    const fieldAnalysis = this.analyzeFieldConsistency(extractedData, formData, nameMatch, rollMatch);
    
    console.log('[VERIFY] Risk analysis:', {
      fileRiskPoints: fileAnalysis.riskPoints,
      fieldRiskPoints: fieldAnalysis.riskPoints,
      fileSignals: fileAnalysis.signals,
      fieldSignals: fieldAnalysis.signals
    });

    const riskSignals = [...fileAnalysis.signals, ...fieldAnalysis.signals];
    const riskScore = this.clamp(fileAnalysis.riskPoints + fieldAnalysis.riskPoints, 0, 100);

    const forgeryDetected = fileAnalysis.hardForgeryDetected || riskScore >= 75;

    let fraudRisk = 'LOW';
    let recommendation = 'APPROVE';

    if (forgeryDetected || riskScore >= 70) {
      fraudRisk = 'HIGH';
      recommendation = 'REJECT';
    } else if (riskScore >= 35 || !nameMatch || !rollMatch) {
      fraudRisk = 'MEDIUM';
      recommendation = 'MANUAL_REVIEW';
    }

    let adjustedConfidence = extractedData.confidenceScore;
    adjustedConfidence -= Math.round(riskScore * 0.6);
    if (!nameMatch) adjustedConfidence -= 5;
    if (!rollMatch) adjustedConfidence -= 5;
    adjustedConfidence = this.clamp(adjustedConfidence, 0, 100);

    if (fraudRisk === 'LOW' && adjustedConfidence < 75) {
      fraudRisk = 'MEDIUM';
      recommendation = 'MANUAL_REVIEW';
    }

    return {
      ...extractedData,
      confidenceScore: Math.round(adjustedConfidence),
      nameMatch,
      rollMatch,
      forgeryDetected,
      fraudRisk,
      recommendation,
      riskScore,
      riskSignals,
      verifiedAt: new Date()
    };
  }

  /**
   * Normalize string for comparison
   */
  static normalizeString(str) {
    if (!str) return '';
    return str.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Full AI verification pipeline
   */
  static async performVerification(document, formData) {
    // Small delay to keep UX behavior similar to the current async pipeline.
    await new Promise(resolve => setTimeout(resolve, 500));

    const extractedData = await this.extractDataFromDocument(document, formData);

    const verificationResult = this.verifyDocument(extractedData, formData, document);

    return verificationResult;
  }

  /**
   * Generate analytics data for dashboard
   */
  static generateAnalytics(applications) {
    const stats = {
      totalApplications: applications.length,
      approved: applications.filter(a => a.status === 'approved').length,
      rejected: applications.filter(a => a.status === 'rejected').length,
      pending: applications.filter(a => a.status === 'pending' || a.status === 'under_review').length,
      highRiskCount: applications.filter(a => a.aiVerification?.fraudRisk === 'HIGH').length,
      averageConfidence: 0,
      fraudTrend: [],
      boardDistribution: {},
      typeDistribution: {}
    };

    // Calculate average confidence
    const validConfidences = applications
      .filter(a => a.aiVerification?.confidenceScore)
      .map(a => a.aiVerification.confidenceScore);
    
    if (validConfidences.length > 0) {
      stats.averageConfidence = Math.round(
        validConfidences.reduce((a, b) => a + b, 0) / validConfidences.length
      );
    }

    // Board distribution
    applications.forEach(app => {
      stats.boardDistribution[app.board] = (stats.boardDistribution[app.board] || 0) + 1;
      stats.typeDistribution[app.certificateType] = (stats.typeDistribution[app.certificateType] || 0) + 1;
    });

    return stats;
  }
}

module.exports = AIVerificationService;
