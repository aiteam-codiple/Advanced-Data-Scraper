/**
 * Canonicalizes a URL to a standard format starting with https://
 */
export function canonicalizeUrl(url) {
    if (!url || url === 'N/A' || url === 'n/a') return 'N/A';
    let clean = url.toLowerCase().trim();
    
    // Remove protocol
    clean = clean.replace(/^(https?:\/\/)/, '');
    
    // Remove query parameters and hashes
    clean = clean.split(/[?#]/)[0];
    
    // Remove trailing slash
    if (clean.endsWith('/')) {
        clean = clean.slice(0, -1);
    }
    
    // Handle subdomains
    if (clean.includes('linkedin.com/')) {
        clean = clean.replace(/^[a-z]{2,3}\.linkedin\.com/, 'linkedin.com');
        clean = clean.replace(/^www\.linkedin\.com/, 'linkedin.com');
        return 'https://' + clean;
    } else if (clean.includes('google.com/maps/')) {
        clean = clean.replace(/^www\.google\.com/, 'google.com');
        return 'https://' + clean;
    } else {
        // General websites
        clean = clean.replace(/^www\./, '');
        return 'https://' + clean;
    }
}
