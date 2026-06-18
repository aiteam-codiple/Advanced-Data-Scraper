import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes, { jobs } from './src/routes/api.js';
import { connectDB } from './src/utils/db.js';
import authRoutes from './src/routes/auth.js';
import categoryRoutes from './src/routes/categories.js';
import { seedDatabase } from './src/utils/seeder.js';
import jwt from 'jsonwebtoken';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB().then(async () => {
    await seedDatabase();
}).catch(err => {
    console.error('Critical database connection failure. Scraper will run without DB functionality if needed.');
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files (to be built in Step 5)
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api', apiRoutes);

import jobEmitter from './src/utils/jobEmitter.js';
import { getHistoryItem } from './src/utils/historyStore.js';

// SSE Endpoint for real-time progress updates (Step 5)
app.get('/api/stream', (req, res) => {
    const token = req.query.token;
    const JWT_SECRET = process.env.JWT_SECRET || 'antigravity-secret-key-12345';
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized SSE connection' });
    }
    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'Invalid SSE connection token' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write(`data: ${JSON.stringify({ status: 'connected', message: 'SSE connection established' })}\n\n`);

    const listener = async (data) => {
        if (data.jobId) {
            let jobUserId = null;
            const job = jobs.get(data.jobId);
            if (job) {
                jobUserId = job.userId;
            } else {
                try {
                    const hist = await getHistoryItem(data.jobId);
                    if (hist) {
                        jobUserId = hist.userId;
                    }
                } catch (err) {
                    console.error('Error fetching history item for SSE filter:', err.message);
                }
            }

            if (!jobUserId || jobUserId.toString() !== decoded.id.toString()) {
                return;
            }
        }
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    jobEmitter.on('log', listener);

    req.on('close', () => {
        jobEmitter.off('log', listener);
        res.end();
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

// Global exception handlers to prevent asynchronous Puppeteer CDP crashes from halting the server process
process.on('uncaughtException', (err) => {
    console.error('CRITICAL UNCAUGHT EXCEPTION PREVENTED:', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL UNHANDLED REJECTION PREVENTED:', reason);
});
