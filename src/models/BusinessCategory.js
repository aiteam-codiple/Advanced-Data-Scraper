import mongoose from 'mongoose';

const businessCategorySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, index: true },
    createdAt: { type: Date, default: Date.now }
});

const BusinessCategory = mongoose.model('BusinessCategory', businessCategorySchema);
export default BusinessCategory;
