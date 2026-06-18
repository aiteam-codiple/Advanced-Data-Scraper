import mongoose from 'mongoose';
import History from '../src/models/History.js';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/scraper');
    
    // Find the latest history item
    const latestHistory = await History.findOne({}).sort({ timestamp: -1 }).exec();
    
    if (latestHistory) {
        console.log(`Latest Job ID: ${latestHistory.jobId}`);
        console.log(`Platform:      ${latestHistory.platform}`);
        console.log(`Query:         ${latestHistory.query}`);
        console.log(`Location:      ${latestHistory.location}`);
        console.log(`Record Count:  ${latestHistory.recordCount}`);
        console.log('\nLeads Details:');
        latestHistory.data.forEach((lead, idx) => {
            console.log(`--------------------- Lead #${idx + 1} ---------------------`);
            console.log(`Name:        ${lead.name}`);
            console.log(`Title:       ${lead.title}`);
            console.log(`Location:    ${lead.location}`);
            console.log(`Email:       ${lead.email}`);
            console.log(`Phone:       ${lead.phone}`);
            console.log(`Website:     ${lead.website}`);
            console.log(`Email Status: ${lead.emailStatus}`);
        });
    } else {
        console.log('No history records found.');
    }
    
    await mongoose.disconnect();
}
check().catch(console.error);
