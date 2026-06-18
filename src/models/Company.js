import mongoose from 'mongoose';

const companySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, index: true },
    domain: { type: String, default: 'N/A' },
    website: { type: String, default: 'N/A' },
    companySize: { type: String, default: 'N/A' },
    learnedEmailPattern: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});

const Company = mongoose.model('Company', companySchema);
export default Company;
