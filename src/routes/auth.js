import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { requireAuth, requireAdmin } from '../middlewares/auth.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'antigravity-secret-key-12345';

// Helper to generate JWT
function generateToken(user) {
    return jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, {
        expiresIn: '7d'
    });
}


// POST /api/auth/login - Public login endpoint
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    try {
        const user = await User.findOne({ username: username.toLowerCase().trim() });
        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        const token = generateToken(user);

        res.json({
            message: 'Login successful!',
            token,
            user: {
                id: user._id,
                username: user.username,
                role: user.role,
                canManageCategories: user.canManageCategories,
                canDeleteHistory: user.canDeleteHistory
            }
        });
    } catch (err) {
        console.error('Login Error:', err.message);
        res.status(500).json({ error: 'Server error during login.' });
    }
});

// GET /api/auth/me - Protected current user profile
router.get('/me', requireAuth, (req, res) => {
    res.json({
        user: {
            id: req.user._id,
            username: req.user.username,
            role: req.user.role,
            canManageCategories: req.user.canManageCategories,
            canDeleteHistory: req.user.canDeleteHistory
        }
    });
});

// Admin-Only endpoints

// GET /api/auth/users - Admin-Only: list all users
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const users = await User.find({}).sort({ createdAt: -1 });
        const usersDecrypted = users.map(user => {
            const userObj = user.toObject();
            try {
                userObj.password = User.decryptPassword(user.password);
            } catch (err) {
                // Ignore error
            }
            return userObj;
        });
        res.json(usersDecrypted);
    } catch (err) {
        console.error('List Users Error:', err.message);
        res.status(500).json({ error: 'Server error listing users.' });
    }
});

// POST /api/auth/users - Admin-Only: create user
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
    const { username, password, role, canManageCategories, canDeleteHistory } = req.body;

    if (!username || !password || !role) {
        return res.status(400).json({ error: 'Username, password, and role are required.' });
    }

    try {
        const existingUser = await User.findOne({ username: username.toLowerCase().trim() });
        if (existingUser) {
            return res.status(400).json({ error: 'Username is already taken.' });
        }

        const newUser = new User({
            username: username.toLowerCase().trim(),
            password,
            role,
            canManageCategories: canManageCategories || false,
            canDeleteHistory: canDeleteHistory || false
        });

        await newUser.save();

        res.status(201).json({
            message: 'User created successfully!',
            user: {
                id: newUser._id,
                username: newUser.username,
                role: newUser.role,
                canManageCategories: newUser.canManageCategories,
                canDeleteHistory: newUser.canDeleteHistory
            }
        });
    } catch (err) {
        console.error('Admin Create User Error:', err.message);
        res.status(500).json({ error: 'Server error creating user.' });
    }
});

// PUT /api/auth/users/:id - Admin-Only: update user role or password
router.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { role, password, canManageCategories, canDeleteHistory } = req.body;

    try {
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        if (role && role !== user.role) {
            if (user.role === 'admin' && role === 'user') {
                const adminCount = await User.countDocuments({ role: 'admin' });
                if (adminCount <= 1) {
                    return res.status(400).json({ error: 'Cannot demote user. The system must have at least one administrator.' });
                }
            }
            user.role = role;
        }

        if (password && password.trim() !== '') {
            user.password = password;
        }

        if (canManageCategories !== undefined) {
            user.canManageCategories = canManageCategories;
        }

        if (canDeleteHistory !== undefined) {
            user.canDeleteHistory = canDeleteHistory;
        }

        await user.save();

        res.json({
            message: 'User updated successfully!',
            user: {
                id: user._id,
                username: user.username,
                role: user.role,
                canManageCategories: user.canManageCategories,
                canDeleteHistory: user.canDeleteHistory
            }
        });
    } catch (err) {
        console.error('Admin Update User Error:', err.message);
        res.status(500).json({ error: 'Server error updating user.' });
    }
});

// DELETE /api/auth/users/:id - Admin-Only: delete user
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.params;

    if (req.user._id.toString() === id) {
        return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    try {
        const user = await User.findByIdAndDelete(id);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        res.json({ message: 'User deleted successfully!' });
    } catch (err) {
        console.error('Admin Delete User Error:', err.message);
        res.status(500).json({ error: 'Server error deleting user.' });
    }
});

export default router;
