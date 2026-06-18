import Lead from '../models/Lead.js';
import { canonicalizeUrl } from './urlHelper.js';

/**
 * Searches the Lead cache database for matching leads.
 */
export async function getCachedLeads(query, location, seniority = null, companySize = null) {
    try {
        let cleanQ = query ? query.toLowerCase().trim() : '';
        if (cleanQ.endsWith('s') && cleanQ.length > 3) {
            if (cleanQ.endsWith('ies')) {
                cleanQ = cleanQ.slice(0, -3) + 'y';
            } else {
                cleanQ = cleanQ.slice(0, -1);
            }
        }
        const cleanLoc = location ? location.toLowerCase().trim() : '';

        const mapSeniorityOptionToDb = (opt) => {
            if (!opt) return null;
            const cleanOpt = opt.toLowerCase().trim();
            if (cleanOpt === 'executive') return 'C-Suite / Executive';
            if (cleanOpt === 'vp_director') return 'VP / Director';
            if (cleanOpt === 'manager') return 'Manager / Lead';
            return null;
        };
        const targetDbSeniority = mapSeniorityOptionToDb(seniority);

        const conditions = [];

        if (cleanQ) {
            conditions.push({
                $or: [
                    { queries: cleanQ },
                    { name: { $regex: cleanQ, $options: 'i' } },
                    { title: { $regex: cleanQ, $options: 'i' } }
                ]
            });
        }

        if (cleanLoc) {
            conditions.push({ location: { $regex: cleanLoc, $options: 'i' } });
        }

        // High-Yield Check: Only serve from cache if it has real contact details
        conditions.push({
            $or: [
                { email: { $exists: true, $ne: 'N/A', $ne: '' } },
                { phone: { $exists: true, $ne: 'N/A', $ne: '' } }
            ]
        });

        if (targetDbSeniority) {
            conditions.push({ seniority: targetDbSeniority });
        }

        if (companySize && companySize !== 'all') {
            conditions.push({ companySize: companySize });
        }

        const filter = conditions.length > 0 ? { $and: conditions } : {};

        return await Lead.find(filter).exec();
    } catch (err) {
        console.error('Error fetching cached leads from MongoDB:', err.message);
        return [];
    }
}

/**
 * Persists scraped leads to MongoDB, skipping duplicates.
 */
export async function cacheLeads(newLeads, query = null) {
    if (!newLeads || !Array.isArray(newLeads) || newLeads.length === 0) return;

    try {
        const operations = newLeads.map(lead => {
            const profileUrl = canonicalizeUrl(lead.profileUrl || lead.url);
            const website = canonicalizeUrl(lead.website);

            const mappedLead = {
                name: lead.name || 'N/A',
                profileUrl,
                title: lead.title || 'N/A',
                location: lead.location || 'N/A',
                email: lead.email || 'N/A',
                phone: lead.phone || 'N/A',
                website,
                seniority: lead.seniority || 'Individual Contributor',
                department: lead.department || 'Operations',
                companySize: lead.companySize || 'N/A',
                emailStatus: lead.emailStatus || 'Pending',
                phoneStatus: lead.phoneStatus || 'Pending',
                websiteStatus: lead.websiteStatus || 'Pending',
                linkedinStatus: lead.linkedinStatus || 'Pending'
            };

            const updateDoc = { $set: mappedLead };
            if (query) {
                let cleanQ = query.toLowerCase().trim();
                if (cleanQ.endsWith('s') && cleanQ.length > 3) {
                    if (cleanQ.endsWith('ies')) {
                        cleanQ = cleanQ.slice(0, -3) + 'y';
                    } else {
                        cleanQ = cleanQ.slice(0, -1);
                    }
                }
                updateDoc.$addToSet = { queries: cleanQ };
            }

            // Strict URL-based deduplication filter
            const filter = (profileUrl && profileUrl !== 'https://n/a' && profileUrl !== 'N/A')
                ? { profileUrl }
                : { name: mappedLead.name, profileUrl: 'N/A' };

            return {
                updateOne: {
                    filter,
                    update: updateDoc,
                    upsert: true
                }
            };
        });

        await Lead.bulkWrite(operations);
        console.log(`Successfully cached/updated ${newLeads.length} leads in MongoDB.`);
    } catch (err) {
        console.error('Error caching leads in MongoDB:', err.message);
    }
}
