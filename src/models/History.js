import mongoose from 'mongoose';

const historySchema = new mongoose.Schema({
    jobId: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, index: true },
    username: { type: String, required: false },
    platform: { type: String, required: true },
    query: { type: String, required: true },
    location: { type: String, required: true },
    recordCount: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
    data: [{
        name: { type: String, required: true },
        profileUrl: { type: String, required: true },
        title: { type: String, default: 'N/A' },
        seniority: { type: String, default: 'Individual Contributor' },
        department: { type: String, default: 'Operations' },
        location: { type: String, default: 'N/A' },
        email: { type: String, default: 'N/A' },
        phone: { type: String, default: 'N/A' },
        website: { type: String, default: 'N/A' },
        emailStatus: { type: String, default: 'Pending' },
        phoneStatus: { type: String, default: 'Pending' },
        websiteStatus: { type: String, default: 'Pending' },
        linkedinStatus: { type: String, default: 'Pending' }
    }]
});

const History = mongoose.model('History', historySchema);
export default History;
