import mongoose from 'mongoose';
import History from '../models/History.js';
import { canonicalizeUrl } from './urlHelper.js';

/**
 * Saves a completed scrape run to the MongoDB History collection.
 */
export async function saveToHistory(jobId, platform, query, location, recordCount, data, userId, username) {
    try {
        const seenKeys = new Set();
        const cleanData = [];

        for (const lead of (data || [])) {
            const urlKey = canonicalizeUrl(lead.profileUrl || lead.url);
            const nameKey = (lead.name || '').toLowerCase().trim();
            const uniqueKey = urlKey && urlKey !== 'https://n/a' && urlKey !== 'N/A' ? urlKey : nameKey;

            if (uniqueKey && !seenKeys.has(uniqueKey)) {
                seenKeys.add(uniqueKey);
                cleanData.push({
                    name: lead.name || 'N/A',
                    profileUrl: urlKey && urlKey !== 'https://n/a' ? urlKey : (lead.profileUrl || lead.url || 'N/A'),
                    title: lead.title || 'N/A',
                    location: lead.location || 'N/A',
                    email: lead.email || 'N/A',
                    phone: lead.phone || 'N/A',
                    website: canonicalizeUrl(lead.website),
                    seniority: lead.seniority || 'Individual Contributor',
                    department: lead.department || 'Operations',
                    emailStatus: lead.emailStatus || 'Pending',
                    phoneStatus: lead.phoneStatus || 'Pending',
                    websiteStatus: lead.websiteStatus || 'Pending',
                    linkedinStatus: lead.linkedinStatus || 'Pending'
                });
            }
        }

        let resolvedUsername = username;
        if (!resolvedUsername && userId) {
            try {
                const user = await mongoose.model('User').findById(userId);
                if (user) {
                    resolvedUsername = user.username;
                }
            } catch (userErr) {
                console.error('Error fetching user for history:', userErr.message);
            }
        }

        const newRecord = new History({
            jobId,
            userId: userId || null,
            username: resolvedUsername || null,
            platform,
            query,
            location,
            recordCount: cleanData.length,
            data: cleanData
        });


        await newRecord.save();
        console.log(`Successfully saved job ${jobId} to MongoDB history.`);
    } catch (err) {
        console.error('Error saving job to MongoDB history:', err.message);
    }
}

/**
 * Retrieves history list metadata (excluding the detailed data array) sorted by newest first.
 */
export async function getHistoryList(filter = {}) {
    try {
        return await History.find(filter, { data: 0 }).populate('userId', 'username').sort({ timestamp: -1 }).exec();
    } catch (err) {
        console.error('Error fetching history list from MongoDB:', err.message);
        return [];
    }
}

/**
 * Retrieves a detailed history record (including data array).
 */
export async function getHistoryItem(jobId) {
    try {
        return await History.findOne({ jobId }).exec();
    } catch (err) {
        console.error(`Error fetching history item ${jobId} from MongoDB:`, err.message);
        return null;
    }
}

/**
 * Deletes a history item.
 */
export async function deleteHistoryItem(jobId) {
    try {
        await History.deleteOne({ jobId }).exec();
        console.log(`Successfully deleted job ${jobId} from MongoDB history.`);
        return true;
    } catch (err) {
        console.error(`Error deleting history item ${jobId} from MongoDB:`, err.message);
        return false;
    }
}
