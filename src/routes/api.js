import express from 'express';
import { Parser } from 'json2csv';
import XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import GoogleMapsScraper from '../services/GoogleMapsScraper.js';
import YellowpagesScraper from '../services/YellowpagesScraper.js';
import LinkedInScraper from '../services/LinkedInScraper.js';
import jobEmitter from '../utils/jobEmitter.js';
import { getCachedLeads, cacheLeads } from '../utils/leadCache.js';
import { saveToHistory, getHistoryList, getHistoryItem, deleteHistoryItem } from '../utils/historyStore.js';
import { classifyRole } from '../utils/roleClassifier.js';
import { canonicalizeUrl } from '../utils/urlHelper.js';
import { verifyEmail, verifyPhone, verifyWebsite, verifyLinkedInProfile } from '../utils/verifier.js';

import Lead from '../models/Lead.js';
import { requireAuth } from '../middlewares/auth.js';

const router = express.Router();
export const jobs = new Map();

// Protect all routes under this router
router.use(requireAuth);

// Concurrency-limited parallel execution helper
async function limitConcurrency(tasks, limit, fn) {
    const results = [];
    const executing = new Set();
    for (const task of tasks) {
        const p = Promise.resolve().then(() => fn(task));
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean, clean);
        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

router.post('/scrape', async (req, res) => {
    let { platform, query, location, maxEntries, seniority, companySize, speedMode } = req.body;

    if (!platform || (!query && !location)) {
        return res.status(400).json({ error: 'Missing required parameters: platform, and either query or location' });
    }

    const limit = maxEntries ? parseInt(maxEntries, 10) : 100;

    // Automatic De-duplication: Compile sets from ALL previously scraped leads in MongoDB
    const dedupUrls = new Set();
    const dedupNames = new Set();
    const dedupWebsites = new Set();

    try {
        const allExisting = await Lead.find({}, { name: 1, profileUrl: 1, website: 1 }).exec();
        allExisting.forEach(lead => {
            const lUrl = canonicalizeUrl(lead.profileUrl || lead.url);
            const lName = (lead.name || '').toLowerCase().trim();
            const lWebsite = canonicalizeUrl(lead.website);
            
            if (lUrl && lUrl !== 'https://n/a' && lUrl !== 'N/A') dedupUrls.add(lUrl);
            if (lName && lName !== 'n/a') dedupNames.add(lName);
            if (lWebsite && lWebsite !== 'https://n/a' && lWebsite !== 'N/A') dedupWebsites.add(lWebsite);
        });
    } catch (err) {
        console.error('Failed to compile automatic de-duplication sets:', err.message);
    }

    const filteredCached = [];
    const cachedCount = 0;
    const newToScrapeCount = limit;
    const cachedUrls = new Set();

    const jobId = Date.now().toString();
    jobs.set(jobId, { status: 'running', platform, query, location, limit, data: null, userId: req.user._id });

    res.status(202).json({
        message: 'Scraping job started',
        jobId,
        platform
    });

    if (cachedCount > 0) {
        jobEmitter.emit('log', { jobId, message: `Found ${cachedCount} matching leads in MongoDB cache. Initiating crawl for remaining ${newToScrapeCount} leads...` });
    } else {
        jobEmitter.emit('log', { jobId, message: `No matching cached leads. Initiating fresh crawl for ${limit} leads...` });
    }

    // Run scraper asynchronously
    try {
        let scraper;
        switch (platform.toLowerCase()) {
            case 'googlemaps':
                scraper = new GoogleMapsScraper(jobId);
                break;
            case 'yellowpages':
                scraper = new YellowpagesScraper(jobId);
                break;
            case 'linkedin':
                scraper = new LinkedInScraper(jobId);
                break;
            default:
                throw new Error('Unsupported platform');
        }

        let maxWorkers = 5; // Default Medium
        if (speedMode === 'slow') maxWorkers = 2;
        if (speedMode === 'fast') maxWorkers = 6;

        scraper.limit = limit;
        scraper.maxWorkers = maxWorkers;
        scraper.speedMode = speedMode;

        const rawData = await scraper.scrape(query, location, newToScrapeCount, { dedupUrls, dedupNames, dedupWebsites, cachedUrls }, seniority, companySize);
        
        // Defensive classification block: ensures ALL elements are tagged before saving/caching
        const classifiedData = rawData.map(item => {
            if (!item.seniority || !item.department) {
                const classification = classifyRole(item.title || item.name);
                return {
                    ...item,
                    seniority: item.seniority || classification.seniority,
                    department: item.department || classification.department
                };
            }
            return item;
        });

        // Backend hard-filtering of seniority based on user target selection
        const mapSeniorityOptionToDb = (opt) => {
            if (!opt) return null;
            const cleanOpt = opt.toLowerCase().trim();
            if (cleanOpt === 'executive') return 'C-Suite / Executive';
            if (cleanOpt === 'vp_director') return 'VP / Director';
            if (cleanOpt === 'manager') return 'Manager / Lead';
            return null;
        };
        const targetDbSeniority = mapSeniorityOptionToDb(seniority);

        let filteredClassifiedData = classifiedData;
        if (targetDbSeniority) {
            filteredClassifiedData = classifiedData.filter(item => item.seniority === targetDbSeniority);
        }

        jobEmitter.emit('log', { jobId, message: `Performing concurrency-controlled SMTP & phone validations...`, progress: 95, leadsCount: cachedCount, limit, stateMessage: 'Verifying contacts (SMTP & Phone)...' });

        // Concurrency-Controlled validation queue (max 10 parallel lookups)
        let verifiedCount = 0;
        const totalToVerify = filteredClassifiedData.length || 1;
        const verifiedData = await limitConcurrency(filteredClassifiedData, 10, async (item) => {
            let resItem = item;
            if (!item.isResolved) {
                const emailVal = await verifyEmail(item.email);
                const phoneVal = verifyPhone(item.phone);
                const webVal = await verifyWebsite(item.website);
                const liVal = await verifyLinkedInProfile(item.profileUrl || item.url);
                
                resItem = {
                    ...item,
                    emailStatus: emailVal.status || 'Undeliverable',
                    phoneStatus: phoneVal.status || 'Invalid',
                    websiteStatus: webVal.status || 'Broken',
                    linkedinStatus: liVal.status || 'Invalid'
                };
            }
            verifiedCount++;
            const valPct = 95 + Math.round((verifiedCount / totalToVerify) * 4);
            jobEmitter.emit('log', {
                jobId,
                progress: Math.min(valPct, 99),
                leadsCount: Math.min(cachedCount + verifiedCount, limit),
                limit,
                stateMessage: 'Verifying contacts (SMTP & Phone)...'
            });
            return resItem;
        });

        // Cache newly scraped records for subsequent instant lookups
        if (verifiedData.length > 0) {
            const newLeadsToCache = verifiedData.filter(lead => !lead.isResolved);
            if (newLeadsToCache.length > 0) {
                await cacheLeads(newLeadsToCache, query);
            }
        }
        
        // Merge cached leads with newly scraped results
        const plainCached = filteredCached.map(doc => doc.toObject ? doc.toObject() : doc);
        const rawCombined = [...plainCached, ...verifiedData];

        const seenKeys = new Set();
        const cleanCombined = [];
        for (const lead of rawCombined) {
            const urlKey = canonicalizeUrl(lead.profileUrl || lead.url);
            const nameKey = (lead.name || '').toLowerCase().trim();
            const uniqueKey = urlKey && urlKey !== 'https://n/a' && urlKey !== 'N/A' ? urlKey : nameKey;

            if (uniqueKey && !seenKeys.has(uniqueKey)) {
                seenKeys.add(uniqueKey);
                cleanCombined.push({
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
                    linkedinStatus: lead.linkedinStatus || 'Pending',
                    companySize: lead.companySize || 'N/A',
                    isResolved: lead.isResolved || false
                });
            }
        }

        const combinedData = cleanCombined.slice(0, limit);

        // Save completed job to MongoDB history only if we found results
        if (combinedData.length > 0) {
            await saveToHistory(jobId, platform, query, location, combinedData.length, combinedData, req.user._id, req.user.username);
        }

        const job = jobs.get(jobId);
        if (job) {
            job.status = 'completed';
            job.data = combinedData;
            jobs.set(jobId, job);
        }
        
        const newlyScrapedCount = combinedData.filter(l => !l.isResolved).length;
        const resolvedDbCount = combinedData.filter(l => l.isResolved).length;
        jobEmitter.emit('log', { 
            jobId, 
            message: `Job completed. Found ${combinedData.length} records (${cachedCount + resolvedDbCount} from cache, ${newlyScrapedCount} newly scraped).`, 
            isComplete: true,
            progress: 100,
            leadsCount: combinedData.length,
            limit
        });

    } catch (error) {
        console.error(error);
        const job = jobs.get(jobId);
        if (job) {
            job.status = 'failed';
            job.error = error.message;
            jobs.set(jobId, job);
        }
        jobEmitter.emit('log', { jobId, message: `Job failed: ${error.message}`, isError: true, progress: 100 });
    }
});

router.get('/scrape/:jobId', async (req, res) => {
    const { jobId } = req.params;
    let job = jobs.get(jobId);
    let jobUserId = null;

    if (job) {
        jobUserId = job.userId;
    } else {
        // Fallback: check if the job exists in MongoDB history
        const hist = await getHistoryItem(jobId);
        if (hist) {
            job = {
                status: 'completed',
                data: hist.data
            };
            jobUserId = hist.userId;
        }
    }

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    // Check ownership
    if (req.user.role !== 'admin' && jobUserId && jobUserId.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Access denied. You do not own this job.' });
    }

    res.json({
        jobId,
        status: job.status,
        resultCount: job.data ? job.data.length : 0,
        data: job.data
    });
});

router.get('/download/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const { format } = req.query; // 'csv', 'xlsx', or 'zip'
    
    const ids = jobId.split(',');
    let combinedData = [];
    const jobsDataMap = new Map();
    let firstJobMeta = null;

    for (const id of ids) {
        let job = jobs.get(id);
        let jobData = null;
        let jobUserId = null;
        let jobMeta = null;
        
        if (job && job.data) {
            jobData = job.data;
            jobUserId = job.userId;
            jobMeta = job;
        } else {
            // Check MongoDB history fallback
            const hist = await getHistoryItem(id);
            if (hist && hist.data) {
                jobData = hist.data;
                jobUserId = hist.userId;
                jobMeta = hist;
            }
        }

        // Ownership validation
        if (jobUserId && req.user.role !== 'admin' && jobUserId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: 'Access denied. You do not own one or more of the requested runs.' });
        }

        if (jobData) {
            if (!firstJobMeta) firstJobMeta = jobMeta;
            combinedData.push(...jobData);
            jobsDataMap.set(id, { jobData, jobMeta });
        }
    }

    if (combinedData.length === 0) {
        return res.status(404).json({ error: 'Data not available or jobs not completed' });
    }

    function generateFileName(meta, defaultId) {
        if (!meta || !meta.platform) return `export_${defaultId}`;
        const p = meta.platform.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const q = (meta.query || '').split(',')[0].replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase();
        const l = (meta.location || '').split(',')[0].replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase();
        
        const parts = [p, q, l].filter(Boolean);
        return parts.length > 0 ? `${parts.join('_')}_${defaultId.slice(-5)}` : `export_${defaultId}`;
    }

    const singleFileName = generateFileName(firstJobMeta, ids[0]);
    const attachmentBaseName = ids.length === 1 ? singleFileName : 'exports_bulk';

    const seenKeys = new Set();
    const cleanedData = [];

    for (const d of combinedData) {
        const urlKey = (d.profileUrl || d.url || '').toLowerCase().trim();
        const nameKey = (d.name || '').toLowerCase().trim();
        const uniqueKey = urlKey && urlKey !== 'n/a' ? urlKey : nameKey;

        if (uniqueKey && !seenKeys.has(uniqueKey)) {
            seenKeys.add(uniqueKey);
            cleanedData.push({
                name: d.name || 'N/A',
                profileUrl: d.profileUrl || d.url || 'N/A',
                title: d.title || 'N/A',
                location: d.location || 'N/A',
                companySize: d.companySize || 'N/A',
                email: d.email || 'N/A',
                phone: d.phone || 'N/A',
                website: d.website || 'N/A'
            });
        }
    }

    if (format === 'csv') {
        try {
            const parser = new Parser();
            const csv = parser.parse(cleanedData);
            res.header('Content-Type', 'text/csv');
            res.attachment(`${attachmentBaseName}.csv`);
            return res.send(csv);
        } catch (err) {
            return res.status(500).json({ error: 'Failed to generate CSV' });
        }
    } else if (format === 'xlsx') {
        try {
            const worksheet = XLSX.utils.json_to_sheet(cleanedData);
            
            // Format column widths nicely
            const maxNameLen = Math.max(...cleanedData.map(d => (d.name || '').length), 10);
            const maxProfileUrlLen = Math.min(Math.max(...cleanedData.map(d => (d.profileUrl || '').length), 15), 50);
            const maxTitleLen = Math.min(Math.max(...cleanedData.map(d => (d.title || '').length), 10), 35);
            const maxLocLen = Math.min(Math.max(...cleanedData.map(d => (d.location || '').length), 15), 45);
            const maxCompanySizeLen = Math.max(...cleanedData.map(d => (d.companySize || '').length), 10);
            const maxEmailLen = Math.max(...cleanedData.map(d => (d.email || '').length), 15);
            const maxPhoneLen = Math.max(...cleanedData.map(d => (d.phone || '').length), 12);
            const maxWebLen = Math.max(...cleanedData.map(d => (d.website || '').length), 15);
            
            worksheet['!cols'] = [
                { wch: maxNameLen + 2 },
                { wch: maxProfileUrlLen + 2 },
                { wch: maxTitleLen + 2 },
                { wch: maxLocLen + 2 },
                { wch: maxCompanySizeLen + 2 },
                { wch: maxEmailLen + 2 },
                { wch: maxPhoneLen + 2 },
                { wch: maxWebLen + 2 }
            ];

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');
            const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
            
            res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.attachment(`${attachmentBaseName}.xlsx`);
            return res.send(buffer);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to generate XLSX' });
        }
    } else if (format === 'zip') {
        try {
            const parser = new Parser();
            const zip = new AdmZip();
            let addedFiles = 0;

            for (const [id, { jobData, jobMeta }] of jobsDataMap.entries()) {
                const individualName = generateFileName(jobMeta, id);
                const seenKeys = new Set();
                const jobCleanedData = [];
                for (const d of jobData) {
                    const urlKey = (d.profileUrl || d.url || '').toLowerCase().trim();
                    const nameKey = (d.name || '').toLowerCase().trim();
                    const uniqueKey = urlKey && urlKey !== 'n/a' ? urlKey : nameKey;

                    if (uniqueKey && !seenKeys.has(uniqueKey)) {
                        seenKeys.add(uniqueKey);
                        jobCleanedData.push({
                            name: d.name || 'N/A',
                            profileUrl: d.profileUrl || d.url || 'N/A',
                            title: d.title || 'N/A',
                            location: d.location || 'N/A',
                            companySize: d.companySize || 'N/A',
                            email: d.email || 'N/A',
                            phone: d.phone || 'N/A',
                            website: d.website || 'N/A'
                        });
                    }
                }
                if (jobCleanedData.length > 0) {
                    const csv = parser.parse(jobCleanedData);
                    zip.addFile(`${individualName}.csv`, Buffer.from(csv, 'utf8'));
                    addedFiles++;
                }
            }

            if (addedFiles === 0) {
                return res.status(404).json({ error: 'No valid data found to zip' });
            }

            const zipBuffer = zip.toBuffer();
            res.header('Content-Type', 'application/zip');
            res.attachment(`${attachmentBaseName}.zip`);
            return res.send(zipBuffer);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to generate ZIP' });
        }
    } else {
        return res.status(400).json({ error: 'Unsupported format. Use csv, xlsx, or zip.' });
    }
});

router.get('/history', async (req, res) => {
    try {
        const filter = req.user.role === 'admin' ? {} : { userId: req.user._id };
        const list = await getHistoryList(filter);
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/history/:jobId', async (req, res) => {
    const { jobId } = req.params;
    if (req.user.role !== 'admin' && !req.user.canDeleteHistory) {
        return res.status(403).json({ error: 'Access denied. You do not have permission to delete history.' });
    }
    try {
        const hist = await getHistoryItem(jobId);
        if (hist) {
            // Ownership validation
            if (req.user.role !== 'admin' && hist.userId && hist.userId.toString() !== req.user._id.toString()) {
                return res.status(403).json({ error: 'Access denied. You do not own this history item.' });
            }
        }

        const success = await deleteHistoryItem(jobId);
        if (success) {
            jobs.delete(jobId);
            res.json({ message: 'Scrape job deleted successfully from MongoDB history' });
        } else {
            res.status(404).json({ error: 'History record not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
