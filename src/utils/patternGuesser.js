import { verifyEmail } from './verifier.js';
import Company from '../models/Company.js';

/**
 * Generates corporate email candidates based on standard business patterns,
 * checks learned patterns from MongoDB to bypass duplicate checking,
 * and updates learned patterns upon successful SMTP verification.
 */
export async function guessCorporateEmail(firstName, lastName, domain) {
    if (!firstName || !domain) return 'N/A';
    
    const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '').trim();
    const cleanLast = lastName ? lastName.toLowerCase().replace(/[^a-z]/g, '').trim() : '';
    const cleanDomain = domain.toLowerCase().trim();

    if (cleanFirst.length === 0) return 'N/A';

    // Patterns we can generate
    const patternGenerators = {
        'first': () => `${cleanFirst}@${cleanDomain}`,
        'first.last': () => cleanLast ? `${cleanFirst}.${cleanLast}@${cleanDomain}` : `${cleanFirst}@${cleanDomain}`,
        'f_last': () => cleanLast ? `${cleanFirst[0]}${cleanLast}@${cleanDomain}` : `${cleanFirst}@${cleanDomain}`,
        'first_l': () => cleanLast ? `${cleanFirst}${cleanLast[0]}@${cleanDomain}` : `${cleanFirst}@${cleanDomain}`
    };

    // 1. Check MongoDB for a learned pattern for this domain
    let learnedPattern = null;
    let companyRecord = null;
    try {
        companyRecord = await Company.findOne({ domain: cleanDomain }).exec();
        if (companyRecord && companyRecord.learnedEmailPattern) {
            learnedPattern = companyRecord.learnedEmailPattern;
        }
    } catch (dbErr) {
        console.error('Error reading company record in patternGuesser:', dbErr.message);
    }

    if (learnedPattern && patternGenerators[learnedPattern]) {
        return patternGenerators[learnedPattern]();
    }

    // Default to 'first.last' pattern if domain is valid
    const targetEmail = patternGenerators['first.last']();
    try {
        const check = await verifyEmail(targetEmail);
        if (check.valid) {
            // Save 'first.last' as the learned pattern to speed up future runs
            try {
                if (companyRecord) {
                    companyRecord.learnedEmailPattern = 'first.last';
                    await companyRecord.save();
                } else {
                    await Company.create({
                        name: cleanDomain.split('.')[0],
                        domain: cleanDomain,
                        website: `https://${cleanDomain}`,
                        learnedEmailPattern: 'first.last'
                    });
                }
            } catch (saveErr) {
                // Ignore save errors
            }
            return targetEmail;
        }
    } catch (err) {
        // Ignore
    }

    return 'N/A';
}
