import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/scraper';

export async function connectDB() {
    if (mongoose.connection.readyState >= 1) return;
    
    try {
        console.log(`Connecting to MongoDB at: ${MONGODB_URI}...`);
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000
        });
        console.log('MongoDB Connected successfully!');
    } catch (err) {
        console.error('MongoDB Connection Error:', err.message);
        throw err;
    }
}

export default mongoose;
