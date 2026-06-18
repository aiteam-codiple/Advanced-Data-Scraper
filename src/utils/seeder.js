import User from '../models/User.js';
import BusinessCategory from '../models/BusinessCategory.js';

const defaultCategories = [
    "Plumbers",
    "Dentists",
    "Realtors",
    "Software Engineers",
    "Lawyers",
    "Restaurants",
    "Salons",
    "Clinics",
    "Electricians",
    "Hotels",
    "Orthodontist"
];

export async function seedDatabase() {
    try {
        // 1. Seed Users
        const userCount = await User.countDocuments();
        if (userCount === 0) {
            console.log('Seeding default user accounts...');
            
            // Seed Admin
            const adminUser = new User({
                username: 'admin',
                password: 'admin123',
                role: 'admin',
                canManageCategories: true
            });
            await adminUser.save();
            
            // Seed Regular User
            const regularUser = new User({
                username: 'user',
                password: 'user123',
                role: 'user'
            });
            await regularUser.save();
            
            console.log('Successfully seeded default users: admin/admin123 (Admin) and user/user123 (User).');
        }

        // 2. Seed Business Categories
        const categoryCount = await BusinessCategory.countDocuments();
        if (categoryCount === 0) {
            console.log('Seeding default business categories...');
            const categoriesToInsert = defaultCategories.map(name => ({ name }));
            await BusinessCategory.insertMany(categoriesToInsert);
            console.log(`Successfully seeded ${defaultCategories.length} default business categories.`);
        }
    } catch (err) {
        console.error('Error seeding database:', err.message);
    }
}
