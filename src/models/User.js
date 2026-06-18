import mongoose from 'mongoose';
import crypto from 'crypto';

// Use a fixed 32-byte key for AES-256. In production, use an environment variable.
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default_secret_key_32_bytes_long_which_is_super_secret'; 
// Ensure it's exactly 32 bytes
const key = crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest('base64').substring(0, 32);

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true }, // stores iv:encrypted_data
    role: { type: String, enum: ['admin', 'user'], default: 'user' },
    canManageCategories: { type: Boolean, default: false },
    canDeleteHistory: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// Encrypt string helper
function encryptPassword(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// Decrypt string helper
userSchema.statics.decryptPassword = function(text) {
    if (!text || !text.includes(':')) return text; // Fallback
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (err) {
        return text; // Return as-is if decryption fails
    }
};

// Pre-save hook to encrypt password if it's modified or new
userSchema.pre('save', function() {
    if (!this.isModified('password')) return;
    // Only encrypt if it isn't already encrypted (basic check)
    if (!this.password.includes(':') || this.password.split(':')[0].length !== 32) {
        this.password = encryptPassword(this.password);
    }
});

// Helper method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
    try {
        const decrypted = mongoose.model('User').decryptPassword(this.password);
        return candidatePassword === decrypted;
    } catch (err) {
        return false;
    }
};

const User = mongoose.model('User', userSchema);
export default User;
