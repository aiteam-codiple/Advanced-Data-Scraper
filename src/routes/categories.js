import express from 'express';
import BusinessCategory from '../models/BusinessCategory.js';
import { requireAuth, requireCategoryManager } from '../middlewares/auth.js';

const router = express.Router();

// GET /api/categories - Accessible to all logged-in users
router.get('/', requireAuth, async (req, res) => {
    try {
        const categories = await BusinessCategory.find({}).sort({ name: 1 });
        res.json(categories);
    } catch (err) {
        console.error('List Categories Error:', err.message);
        res.status(500).json({ error: 'Server error listing categories.' });
    }
});

// POST /api/categories - Admin or CategoryManager: create category
router.post('/', requireAuth, requireCategoryManager, async (req, res) => {
    const { name } = req.body;

    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Category name is required.' });
    }

    try {
        const cleanName = name.trim();
        const existingCategory = await BusinessCategory.findOne({ 
            name: { $regex: new RegExp(`^${cleanName}$`, 'i') } 
        });

        if (existingCategory) {
            return res.status(400).json({ error: 'Category already exists.' });
        }

        const newCategory = new BusinessCategory({ name: cleanName });
        await newCategory.save();

        res.status(201).json({
            message: 'Category created successfully!',
            category: newCategory
        });
    } catch (err) {
        console.error('Create Category Error:', err.message);
        res.status(500).json({ error: 'Server error creating category.' });
    }
});

// PUT /api/categories/:id - Admin or CategoryManager: update category
router.put('/:id', requireAuth, requireCategoryManager, async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Category name is required.' });
    }

    try {
        const cleanName = name.trim();
        
        // Check if other category with same name exists
        const existingCategory = await BusinessCategory.findOne({
            _id: { $ne: id },
            name: { $regex: new RegExp(`^${cleanName}$`, 'i') }
        });

        if (existingCategory) {
            return res.status(400).json({ error: 'Another category already exists with that name.' });
        }

        const category = await BusinessCategory.findById(id);
        if (!category) {
            return res.status(404).json({ error: 'Category not found.' });
        }

        category.name = cleanName;
        await category.save();

        res.json({
            message: 'Category updated successfully!',
            category
        });
    } catch (err) {
        console.error('Update Category Error:', err.message);
        res.status(500).json({ error: 'Server error updating category.' });
    }
});

// DELETE /api/categories/:id - Admin or CategoryManager: delete category
router.delete('/:id', requireAuth, requireCategoryManager, async (req, res) => {
    const { id } = req.params;

    try {
        const category = await BusinessCategory.findByIdAndDelete(id);
        if (!category) {
            return res.status(404).json({ error: 'Category not found.' });
        }

        res.json({ message: 'Category deleted successfully!' });
    } catch (err) {
        console.error('Delete Category Error:', err.message);
        res.status(500).json({ error: 'Server error deleting category.' });
    }
});

export default router;
