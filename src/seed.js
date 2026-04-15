const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-cms');
    console.log('Connected to MongoDB');

    // Check if admin exists
    const existingAdmin = await User.findOne({ email: 'admin@aicms.com' });
    
    if (existingAdmin) {
      console.log('Admin user already exists:');
      console.log('  Email: admin@aicms.com');
      console.log('  Password: admin123');
    } else {
      // Create admin user
      const admin = await User.create({
        fullName: 'System Administrator',
        email: 'admin@aicms.com',
        phone: '9999999999',
        password: 'admin123',
        role: 'admin'
      });
      
      console.log('Admin user created successfully!');
      console.log('  Email: admin@aicms.com');
      console.log('  Password: admin123');
    }

    await mongoose.disconnect();
    console.log('Database seeding complete.');
    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
};

seedAdmin();
