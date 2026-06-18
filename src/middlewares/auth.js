import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'antigravity-secret-key-12345';

export async function requireAuth(req, res, next) {
    try {
        let token = null;

        // Extract token from Authorization header
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }

        // Fallback: Extract token from query parameter (useful for EventSource / SSE)
        if (!token && req.query && req.query.token) {
            token = req.query.token;
        }

        if (!token) {
            return res.status(401).json({ error: 'Access denied. No token provided.' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');
        
        if (!user) {
            return res.status(401).json({ error: 'Access denied. Invalid user account.' });
        }

        req.user = user;
        next();
    } catch (err) {
        console.error('Auth Middleware Error:', err.message);
        return res.status(401).json({ error: 'Invalid or expired token.' });
    }
}

export function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Access denied. Authentication required.' });
    }
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    next();
}

export function requireCategoryManager(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Access denied. Authentication required.' });
    }
    if (req.user.role !== 'admin' && !req.user.canManageCategories) {
        return res.status(403).json({ error: 'Access denied. Category management permission required.' });
    }
    next();
}
