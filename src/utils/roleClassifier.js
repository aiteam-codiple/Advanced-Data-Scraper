/**
 * Classifies a contact's job title or headline into a seniority level and department function
 * using a tokenized, weighted heuristic scoring system.
 */
export function classifyRole(titleText) {
    if (!titleText || titleText === 'N/A') {
        return { seniority: 'Unknown', department: 'Unknown' };
    }

    let titleOnly = titleText.toLowerCase();
    
    // Split on common company name transitions to avoid scoring company tokens for department
    const atParts = titleOnly.split(/\s+at\s+|\s+@\s+|\s+-\s+|\s+\|\s+/);
    if (atParts.length > 1) {
        titleOnly = atParts[0].trim();
    }

    const cleanTitle = titleOnly.replace(/[^a-z0-9\s&-]/g, ' ').trim();
    const tokens = cleanTitle.split(/\s+/).filter(Boolean);

    // Dictionaries of weighted terms for Seniority Tiers
    const seniorityWeights = {
        'C-Suite / Executive': {
            'ceo': 10, 'cfo': 10, 'cto': 10, 'coo': 10, 'chief': 8, 'founder': 9, 'co-founder': 9,
            'owner': 8, 'partner': 7, 'president': 8, 'executive': 5, 'chairman': 8, 'chairwoman': 8,
            'md': 4, 'managing': 4, 'principal': 4
        },
        'VP / Director': {
            'vp': 10, 'vice-president': 10, 'director': 9, 'head': 8, 'president': 3,
            'principal': 5, 'partner': 4, 'lead': 2
        },
        'Manager / Lead': {
            'manager': 9, 'lead': 8, 'supervisor': 7, 'head': 4, 'chief': 2, 'coordinator': 5,
            'officer': 3, 'administrator': 5, 'admin': 3, 'controller': 6
        },
        'Individual Contributor': {
            'engineer': 5, 'developer': 5, 'architect': 5, 'analyst': 5, 'associate': 5, 'specialist': 5,
            'consultant': 5, 'designer': 5, 'scientist': 5, 'representative': 5, 'agent': 5,
            'staff': 4, 'member': 3, 'assistant': 4, 'helper': 3, 'intern': 6, 'student': 6
        }
    };

    // Dictionaries of weighted terms for Departments
    const departmentWeights = {
        'Engineering / IT': {
            'software': 10, 'engineer': 8, 'engineering': 10, 'engineers': 8, 'developer': 9, 'developers': 9,
            'tech': 7, 'technology': 7, 'cto': 10, 'it': 9, 'coder': 9, 'architect': 8, 'web': 8,
            'programmer': 9, 'systems': 8, 'system': 8, 'devops': 10, 'cloud': 8, 'infrastructure': 8,
            'network': 7, 'database': 8, 'qa': 8, 'security': 7, 'cyber': 8, 'data': 6, 'programmer': 9,
            'information': 6
        },
        'Sales / Marketing': {
            'sales': 10, 'marketing': 9, 'seo': 9, 'growth': 8, 'bizdev': 10, 'account': 7,
            'pr': 8, 'advert': 8, 'advertising': 8, 'representative': 6, 'agent': 6, 'copywriter': 9,
            'branding': 8, 'social': 5, 'media': 5, 'brand': 7, 'outreach': 8, 'relations': 5,
            'business': 3, 'development': 4, 'seller': 9, 'salesperson': 10, 'promoter': 8
        },
        'Medical / Health': {
            'dentist': 10, 'doctor': 10, 'orthodontist': 10, 'ortho': 8, 'dmd': 10, 'dds': 10,
            'md': 9, 'nurse': 10, 'clinical': 9, 'medical': 9, 'surgeon': 10, 'hygienist': 10,
            'dental': 9, 'therapist': 8, 'physician': 10, 'periodontist': 10, 'endodontist': 10,
            'pedodontist': 10, 'care': 5, 'treatment': 7, 'clinic': 8, 'health': 7, 'healthcare': 8
        },
        'Finance / Accounting': {
            'finance': 10, 'cfo': 10, 'accountant': 10, 'audit': 9, 'tax': 9, 'wealth': 8,
            'billing': 8, 'treasurer': 9, 'controller': 9, 'bookkeeper': 10, 'ledger': 8,
            'banking': 8, 'analyst': 3, 'accounting': 10, 'advisor': 5, 'investment': 8
        },
        'Human Resources': {
            'hr': 10, 'recruiter': 10, 'people': 8, 'talent': 9, 'culture': 8, 'staffing': 9,
            'hiring': 9, 'acquisition': 7, 'relations': 6, 'payroll': 8, 'personnel': 9
        }
    };

    // 1. Scan for Negatives/Modifiers
    let isAssistantTo = false;
    let isInternOrStudent = false;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === 'assistant' && i < tokens.length - 1 && (tokens[i + 1] === 'to' || tokens[i + 1] === 'of' || tokens[i + 1] === 'for')) {
            isAssistantTo = true;
        }
        if (['intern', 'student', 'trainee', 'apprentice', 'fellow'].includes(token)) {
            isInternOrStudent = true;
        }
    }

    // 2. Score Seniority Tiers
    const seniorityScores = {
        'C-Suite / Executive': 0,
        'VP / Director': 0,
        'Manager / Lead': 0,
        'Individual Contributor': 0
    };

    for (const [tier, weights] of Object.entries(seniorityWeights)) {
        for (const token of tokens) {
            if (weights[token]) {
                seniorityScores[tier] += weights[token];
            }
        }
    }

    if (isAssistantTo) {
        seniorityScores['C-Suite / Executive'] = 0;
        seniorityScores['VP / Director'] = 0;
        seniorityScores['Manager / Lead'] = 0;
        seniorityScores['Individual Contributor'] += 15;
    }
    if (isInternOrStudent) {
        seniorityScores['C-Suite / Executive'] = 0;
        seniorityScores['VP / Director'] = 0;
        seniorityScores['Manager / Lead'] = 0;
        seniorityScores['Individual Contributor'] += 20;
    }

    if (cleanTitle.includes('vice president') || cleanTitle.includes('vice-president') || cleanTitle.includes('vp')) {
        seniorityScores['VP / Director'] += 12;
        seniorityScores['C-Suite / Executive'] = 0;
    }

    let bestSeniority = 'Individual Contributor';
    let maxSeniorityScore = 0;
    for (const [tier, score] of Object.entries(seniorityScores)) {
        if (score > maxSeniorityScore) {
            maxSeniorityScore = score;
            bestSeniority = tier;
        }
    }

    // 3. Score Departments
    const departmentScores = {
        'Engineering / IT': 0,
        'Sales / Marketing': 0,
        'Medical / Health': 0,
        'Finance / Accounting': 0,
        'Human Resources': 0,
        'Operations': 1
    };

    for (const [dept, weights] of Object.entries(departmentWeights)) {
        for (const token of tokens) {
            if (weights[token]) {
                departmentScores[dept] += weights[token];
            }
        }
    }

    let bestDepartment = 'Operations';
    let maxDeptScore = 0;
    for (const [dept, score] of Object.entries(departmentScores)) {
        if (score > maxDeptScore) {
            maxDeptScore = score;
            bestDepartment = dept;
        }
    }

    return { seniority: bestSeniority, department: bestDepartment };
}
