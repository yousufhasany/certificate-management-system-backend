const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const loadServiceAccountFromPath = () => {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!serviceAccountPath) return null;

  const resolvedPath = path.isAbsolute(serviceAccountPath)
    ? serviceAccountPath
    : path.join(process.cwd(), serviceAccountPath);

  try {
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_PATH');
  }
};

const parseServiceAccountJson = () => {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return null;
  try {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch (error) {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON');
  }
};

const buildServiceAccount = () => {
  const pathAccount = loadServiceAccountFromPath();
  if (pathAccount) return pathAccount;

  const jsonAccount = parseServiceAccountJson();
  if (jsonAccount) return jsonAccount;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) return null;

  return {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, '\n')
  };
};

const initFirebaseAdmin = () => {
  if (admin.apps.length) return admin;

  const serviceAccount = buildServiceAccount();
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    return admin;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
    return admin;
  }

  throw new Error('Firebase Admin SDK not configured');
};

module.exports = { initFirebaseAdmin };
