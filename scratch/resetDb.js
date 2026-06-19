import mongoose from 'mongoose';
import User from '../src/models/User.js';
import { seedDatabase } from '../src/utils/seeder.js';
import dotenv from 'dotenv';
dotenv.config();

async function reset() {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/scraper';
    console.log(`Connecting to MongoDB at ${uri}...`);
    await mongoose.connect(uri);

    console.log('Clearing existing users from database...');
    const deleteResult = await User.deleteMany({});
    console.log(`Deleted ${deleteResult.deletedCount} user(s).`);

    console.log('Re-seeding database...');
    await seedDatabase();

    console.log('Database reset and re-seeded successfully!');
    await mongoose.disconnect();
}

reset().catch(err => {
    console.error('Database reset failed:', err);
    process.exit(1);
});
