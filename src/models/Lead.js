import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema({
    name: { type: String, required: true },
    profileUrl: { type: String, required: true },
    queries: [{ type: String }],
    title: { type: String, default: 'N/A' },
    seniority: { type: String, default: 'Individual Contributor' },
    department: { type: String, default: 'Operations' },
    companySize: { type: String, default: 'N/A' },
    location: { type: String, default: 'N/A' },
    email: { type: String, default: 'N/A' },
    phone: { type: String, default: 'N/A' },
    website: { type: String, default: 'N/A' },
    emailStatus: { type: String, default: 'Pending' },
    phoneStatus: { type: String, default: 'Pending' },
    websiteStatus: { type: String, default: 'Pending' },
    linkedinStatus: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});

// Compound unique index to prevent duplicate leads in cache
leadSchema.index({ name: 1, profileUrl: 1 }, { unique: true });

// Case insensitive indexes for caching lookups
leadSchema.index({ name: 'text', title: 'text', location: 'text' });
leadSchema.index({ queries: 1 });

const Lead = mongoose.model('Lead', leadSchema);
export default Lead;
