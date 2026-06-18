import mongoose from 'mongoose';
import User from '../src/models/User.js';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/scraper');
    const users = await User.find({});
    console.log('Existing users:');
    for (const u of users) {
        let password = 'N/A';
        try {
            password = User.decryptPassword(u.password);
        } catch (e) {}
        console.log(`- Username: ${u.username}, Role: ${u.role}, Password: ${password}`);
    }
    await mongoose.disconnect();
}
check().catch(console.error);
