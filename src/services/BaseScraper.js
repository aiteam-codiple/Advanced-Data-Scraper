import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import jobEmitter from '../utils/jobEmitter.js';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import * as cheerio from 'cheerio';
import { canonicalizeUrl } from '../utils/urlHelper.js';

// Apply the stealth plugin
puppeteer.use(StealthPlugin());

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
];

function decryptCfEmail(hex) {
    if (!hex) return '';
    try {
        let email = '';
        const key = parseInt(hex.substr(0, 2), 16);
        for (let i = 2; i < hex.length; i += 2) {
            const charCode = parseInt(hex.substr(i, 2), 16) ^ key;
            email += String.fromCharCode(charCode);
        }
        return email.trim().toLowerCase();
    } catch (e) {
        return '';
    }
}

export default class BaseScraper {
    constructor(jobId, platform) {
        this.jobId = jobId;
        this.platform = platform;
        this.browser = null;
        this.page = null;
        this.pageNavigations = 0;
        this.disabledEngines = new Set();
        this.engineFailures = {};
        this.companyWebsiteCache = new Map();
        this.crawledWebsitesCache = new Map();
        this.leadsCount = 0;
        this.progressPercent = 0;
        this.limit = 100;
        this.stateMessage = null;
        this.maxWorkers = 5;
    }

    trackEngineFailure(engine, immediate = false) {
        if (!this.engineFailures[engine]) {
            this.engineFailures[engine] = 0;
        }
        this.engineFailures[engine]++;
        this.log(`[Engine Health]: Tracked consecutive failure for ${engine}. Consecutive failures: ${this.engineFailures[engine]}/3`);
        if (immediate || this.engineFailures[engine] >= 3) {
            this.disabledEngines.add(engine);
            this.log(`[Engine Health]: Deactivated search engine ${engine} for the remainder of this job due to repeated failures/immediate block.`);
        }
    }

    /**
     * Resets the consecutive failure count of a search engine upon success.
     */
    trackEngineSuccess(engine) {
        this.engineFailures[engine] = 0;
    }

    /**
     * Set up page settings (user agent, stealth fingerprints, optimized headers)
     */
    async setupPage(page) {
        if (!page) return;
        const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        
        try {
            // Failsafe: dismiss dialog alert boxes to prevent infinite hanging
            if (page.listenerCount && page.listenerCount('dialog') === 0) {
                page.on('dialog', async dialog => {
                    this.log(`[Dialog Handler]: Auto-dismissing dialog box: "${dialog.message()}"`);
                    await dialog.dismiss().catch(() => null);
                });
            }

            await page.setUserAgent(ua);
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9'
            });
            await this.injectStealthFingerprints(page);
        } catch (e) {
            this.log(`Warning: Failed setting user agent or headers on page: ${e.message}`);
        }
    }

    /**
     * Helper to format and validate phone numbers globally, forcing text format for Excel
     */
    formatPhone(rawPhone) {
        if (!rawPhone || rawPhone === 'N/A') return 'N/A';
        
        let cleaned = rawPhone.replace(/[^\d+]/g, '').trim();
        if (cleaned.length === 0) return 'N/A';
        
        // Failsafe: reject short-codes / extensions with less than 7 digits
        if (cleaned.replace('+', '').length < 7) {
            return 'N/A';
        }

        // Strict high-yield check: US phone body must be at least 10 digits
        const unescapedDigits = cleaned.replace('+', '');
        const bodyLength = unescapedDigits.startsWith('1') ? unescapedDigits.length - 1 : unescapedDigits.length;
        if (bodyLength < 10) {
            return 'N/A';
        }

        // Try standard US parsing first
        const parsed = parsePhoneNumberFromString(cleaned, 'US');
        if (parsed && parsed.isValid()) {
            const formatted = parsed.formatInternational();
            return formatted.startsWith('+') ? ` ${formatted}` : formatted;
        }

        // If the number has an invalid leading prefix (like a zip code or suite),
        // extract the last 10 digits and try to format/validate them
        if (unescapedDigits.length > 10) {
            const last10 = unescapedDigits.slice(-10);
            const parsedLast10 = parsePhoneNumberFromString(last10, 'US');
            if (parsedLast10 && parsedLast10.isValid()) {
                const formatted = parsedLast10.formatInternational();
                return formatted.startsWith('+') ? ` ${formatted}` : formatted;
            }
            return ` (${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`;
        }

        if (cleaned.length === 10) {
            return ` (${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
        } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
            return ` +1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
        }

        return ` ${rawPhone.trim()}`;
    }

    /**
     * Check if email is from a personal or free email provider
     */
    isPersonalEmail(email) {
        if (!email || email === 'N/A') return false;
        const freeProviders = [
            'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 
            'aol.com', 'mail.com', 'zoho.com', 'protonmail.com', 'gmx.com', 
            'yandex.com', 'live.com', 'msn.com', 'verizon.net', 'comcast.net'
        ];
        const domain = email.split('@').pop().toLowerCase().trim();
        return freeProviders.includes(domain);
    }

    normalizeUrl(url) {
        return canonicalizeUrl(url);
    }

    /**
     * Helper to verify if a profile is a duplicate based on compiled dedup sets
     */
    isDuplicate(name, url, website, dedupSets) {
        if (!dedupSets) return false;
        const { dedupUrls, dedupNames, dedupWebsites, cachedUrls } = dedupSets;
        
        const normUrl = this.normalizeUrl(url);
        const normWebsite = this.normalizeUrl(website);
        const lName = (name || '').toLowerCase().trim();

        if (normUrl && normUrl !== 'https://n/a' && normUrl !== 'N/A') {
            if (dedupUrls && dedupUrls.has(normUrl)) return true;
            if (cachedUrls && cachedUrls.has(normUrl)) return true;
        }
        if (this.platform && this.platform.toLowerCase() === 'linkedin') {
            // Skip name & website de-duplication for LinkedIn to allow different people with same names or same companies
        } else {
            if (lName && lName !== 'n/a' && dedupNames && dedupNames.has(lName)) return true;
            if (normWebsite && normWebsite !== 'https://n/a' && normWebsite !== 'N/A' && dedupWebsites && dedupWebsites.has(normWebsite)) return true;
        }
        return false;
    }

    /**
     * Unescape Unicode HTML entities, strip tags, and filter out descriptive slogans
     */
    cleanLocation(text, defaultLocation = 'N/A') {
        if (!text || text === 'N/A') return defaultLocation;
        
        let cleaned = text
            // First decode literal escapes
            .replace(/\\u003C/gi, '<')
            .replace(/\\u003E/gi, '>')
            .replace(/\\u0026/gi, '&')
            // Decode entity characters
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\\u003Cstrong\\u003E/gi, '')
            .replace(/\\u003C\/strong\\u003E/gi, '')
            .replace(/\\u003C[^>]*\\u003E/gi, '')
            // Strip tags
            .replace(/<\/?[a-z][^>]*>/gi, '')
            .replace(/<[^>]*>/gi, '')
            // Clean specific cut-off tags left over from Brave
            .replace(/ng>|strong>|em>|<strong|<em/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Strict whole-word narrative check to filter out sentences captured as locations
        const narrativeRegex = /\b(?:was|is|were|are|has|have|had|been|who|upon|graduating|graduated|school|university|college|years|experience|staff|team|doctor|dentist|dentists|plumber|plumbers|attorney|attorneys|lawyer|lawyers|owner|president|founder|partner|ceo|manager|director|award|awarded|awards|member|specializes|licensed|practice|special one|today|yesterday|tomorrow|night|morning|afternoon|evening|at the|in the|on the|for more)\b/i;
        if (narrativeRegex.test(cleaned)) {
            return defaultLocation;
        }

        // Filter out non-location titles or descriptors commonly found in snippets
        const garbageKeywords = ['realtor', 'broker', 'sales', 'salesperson', 'agent', 'association', 'enjoy the charm', 'specialist', 'executive', 'advisor', 'consultant', 'office', 'service', 'license', 'sweden', 'broker at'];
        const isGarbage = garbageKeywords.some(keyword => cleaned.toLowerCase().includes(keyword));
        
        if (isGarbage || cleaned.length > 150 || cleaned.length < 2) {
            return defaultLocation;
        }
        
        return cleaned;
    }

    /**
     * Check if a URL belongs to a personal directory
     */
    isPersonalDirectory(url) {
        if (!url || url === 'N/A') return false;
        const personalDirs = [
            'spokeo.com', 'whitepages.com', 'rocketreach.co', 'radaris.com', 'mylife.com',
            'truepeoplesearch.com', 'fastpeoplesearch.com', 'peoplelooker.com', 'beenverified.com',
            'clustrmaps.com', 'voterrecords.com', 'instantcheckmate.com', 'peekyou.com',
            'intelius.com', 'cyberbackgroundchecks.com', 'addresssearch.com', 'searchpeoplefree.com',
            'usa-people-search.com', 'peoplesearchnow.com', 'publicrecords360.com'
        ];
        const lower = url.toLowerCase();
        return personalDirs.some(dir => lower.includes(dir));
    }

    /**
     * Check if a URL belongs to a directory, aggregator, review site, or personal search engine
     */
    isBusinessDirectory(url) {
        if (!url || url === 'N/A') return true; // Treat N/A as directory/exclude
        const directories = [
            'linkedin.com', 'pinterest.com', 'google.', 'groupon.com', 
            'wikipedia.org', 'wiktionary.org', 'indeed.com', 'glassdoor.com',
            'duckduckgo.com', 'bing.com', 'doubleclick', 'publicrecords',
            'search', 'privacy', 'usnews.com', 'peoplefinders.com',
            'whitepages.com', 'spokeo.com', 'fandom.com', 'cityneighborhoods.nyc',
            'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com',
            'mapquest.com', 'superpages.com', 'dexknows.com', 'localsearch.com',
            'bizapedia.com', 'dnb.com', 'zoominfo.com', 'apollo.io', 'lusha.com',
            'crunchbase.com', 'opentable.com', 'tripadvisor.com', 'yelp.com',
            'yellowpages.com', 'healthgrades.com', 'zocdoc.com', 'vitals.com',
            'webmd.com', 'nuwber.com', 'peoplesmart.com', 'niche.com',
            'uslowcostdental.com', 'findatopdoc.com', 'topdentists.com',
            'chamberofcommerce.com', 'allbiz.com', 'cylex', 'manta.com',
            'ezlocal.com', 'merchantcircle.com', 'citysearch.com', 'insiderpages.com',
            'yellowbook.com', 'expertise.com', 'threebestrated.com', 'angi.com',
            'homeadvisor.com', 'houzz.com', 'nextdoor.com', 'foursquare.com',
            'local.com', 'bizbuysell.com', 'city-data.com', 'noodle.com',
            'care.com', 'health.com', 'webodontologia.com', 'ehealthscores.com',
            'healthprovidersdata.com', 'doctor.info', 'cmgforum.net', 'locator',
            'directory', 'zillow.com', 'localmed.com', 'doximity.com', 'realself.com', 
            'github.com', 'nytimes.com', 'dentalinsider.com', 'dentistdig.com', 
            'npiprofile.com', 'doctor.com', 'lohud.com', 'discogs.com',
            'patientconnect365.com', 'nopp.us', 'calbar.ca.gov', 'academia.edu', 'about.me'
        ];
        const lower = url.toLowerCase();
        
        // 1. Exclude matching directory domains
        const isDirDomain = directories.some(dir => lower.includes(dir));
        if (isDirDomain) return true;

        // 2. Check for common directory profile path segments
        const pathSegments = [
            '/places-to-live/', '/places/', '/name/', '/people/', '/dentists/', 
            '/doctors/', '/profile/', '/wiki/', '/marketplace/profile/', 
            '/locality/', '/search/'
        ];
        if (pathSegments.some(segment => lower.includes(segment))) {
            return true;
        }

        return false;
    }

    /**
     * Truncates any captured directory noise and narrative descriptions from the physical address
     */
    cleanAddress(address) {
        if (!address || address === 'N/A') return 'N/A';
        
        let cleaned = address
            // Decode entity characters and strip basic tags
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/<\/?[a-z][^>]*>/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        // 1. Narrative truncation: split at common conversational/biographical transition words
        const narrativeSplitRegex = /[,.]?\s+\b(?:for|where|upon|who|which|is|was|were|are|he|she|his|her|since|during|after|to|from|over|under|with|about|in|on|at|by|that|but|and|as|graduating|graduated|school|university|college|years|experience|award|awarded|member|specialist|specializes|practice|is a|was a|for more|where he|where she|upon graduating|graduated from|patients|can|reach|him|her|contact|call|please|our|us|appointment|schedule|dentist|doctor|dr)\b.*$/i;
        cleaned = cleaned.replace(narrativeSplitRegex, '').trim();

        // 2. Personal doctor title truncation: split at "Dr. Name" or "Dr Name" representing a person
        // Avoid truncating suite/direction words like "Dr. Suite", "Dr S", "Dr. S"
        const doctorSplitRegex = /[,.]?\s+\bDr\b\.?\s+(?![sSeEwWnN]\b|Suite|Ste|Apt|Unit|Fl|Floor|Room|Rm)(?:[A-Z][a-zA-Z]+).*$/;
        cleaned = cleaned.replace(doctorSplitRegex, '').trim();

        // 3. Remove trailing 4-digit years (e.g. "125 Worth Street 1936" -> "125 Worth Street")
        cleaned = cleaned.replace(/\s+\b\d{4}$/, '').trim();

        // 4. Exclude other common corporate garbage suffixes
        cleaned = cleaned
            .replace(/\s*(?:Overview|Patient Experience|Location|Reviews|to contact|To know more|please use|desktop computer|Patient Awards).*$/i, '')
            .trim();

        // 4.5 Clean trailing email/metadata remnants glued to zip codes (e.g. 11217info -> 11217) or standalone
        cleaned = cleaned
            .replace(/\b(\d{5})[a-zA-Z]+\b/gi, '$1') // 5-digit zip with glued letters
            .replace(/[,.-]?\s*\b(?:info|email|contact|website|phone|tel|fax|web)\b.*$/i, '') // trailing standalone email words with optional punctuation
            .replace(/\s*info@.*$/i, '') // trailing email addresses starting with info
            .trim()
            .replace(/[,.-]+$/, '') // strip any trailing punctuation left over
            .trim();

        // 5. Structure Validation: A valid address must start with a number (with optional leading suite/name), be at least 8 chars,
        // and contain a street suffix or common address keyword
        const addressKeywords = /Street|St|Avenue|Ave|Road|Rd|Highway|Hwy|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Way|Terrace|Ter|Parkway|Pkwy|Circle|Cir|Suite|Ste|Floor|Fl|Unit|Room|Rm|Box|Plaza|Bldg|Building/i;
        const startsWithNumber = /^(?:[a-zA-Z\s.,#-]{1,30})?\b\d{1,5}\b/i;
        
        if (cleaned.length < 8 || !startsWithNumber.test(cleaned) || !addressKeywords.test(cleaned)) {
            return 'N/A';
        }

        return cleaned;
    }

    /**
     * Scans text to find a full street address in US/Canada format
     */
    extractAddress(text) {
        if (!text || text === 'N/A') return null;
        
        // Remove excess spaces and HTML remnants
        const cleanText = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        
        // Regex 1: Full US/Canada Street Address with Zip/Postal Code (e.g. 123 Main St, Toronto, ON M5V 2N8)
        const fullAddressRegex = /\b\d{1,5}\s+[A-Za-z0-9\s.,#-]{3,45}\s+(?:Street|St|Avenue|Ave|Road|Rd|Highway|Hwy|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Way|Terrace|Ter|Parkway|Pkwy|Circle|Cir|Suite|Ste|Floor|Fl|Unit|Room|Rm|Box)\b[A-Za-z0-9\s.,#-]{0,100}\b(?:[A-Z]{2}\b|[A-Za-z\s]+)\b\s*(?:\d{5}(?:-\d{4})?|[A-Z]\d[A-Z]\s*\d[A-Z]\d)\b/i;
        const match1 = cleanText.match(fullAddressRegex);
        if (match1) {
            const cleaned = this.cleanAddress(match1[0]);
            return cleaned !== 'N/A' ? cleaned : null;
        }
        
        // Regex 2: Relaxed street address without mandatory zip/postal code (e.g. 123 Main St, New York, NY)
        const relaxedRegex = /\b\d{1,5}\s+[A-Za-z0-9\s.,#-]{3,40}\s+(?:Street|St|Avenue|Ave|Road|Rd|Highway|Hwy|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Way|Terrace|Ter|Parkway|Pkwy)\b(?:[A-Za-z0-9\s.,#-]{0,60})/i;
        const match2 = cleanText.match(relaxedRegex);
        if (match2) {
            const cleaned = this.cleanAddress(match2[0]);
            return cleaned !== 'N/A' ? cleaned : null;
        }
        
        return null;
    }

    /**
     * Stealthily scrape personal contacts from a social media URL
     */
    async scrapeSocialContacts(socialUrl, browserInstance = null) {
        if (!socialUrl || socialUrl === 'N/A' || !socialUrl.startsWith('http')) {
            return { email: null, phone: null };
        }

        const lower = socialUrl.toLowerCase();
        let email = null;
        let phone = null;
        let tempPage = null;

        try {
            const activeBrowser = browserInstance || this.browser;
            if (!activeBrowser) throw new Error('No active browser available for social scrape');
            tempPage = await activeBrowser.newPage();
            await this.setupPage(tempPage);
            await this.optimizePage(tempPage);
            await tempPage.setViewport({ width: 1280, height: 800 });

            if (lower.includes('facebook.com')) {
                // Convert to mbasic Facebook for direct text scraping without complex react login walls
                let fbUrl = socialUrl;
                if (fbUrl.includes('www.facebook.com')) {
                    fbUrl = fbUrl.replace('www.facebook.com', 'mbasic.facebook.com');
                } else {
                    fbUrl = fbUrl.replace('facebook.com', 'mbasic.facebook.com');
                }
                this.log(`Stealth crawling basic Facebook profile: ${fbUrl}`);
                
                try {
                    // Standardized pivot: to avoid landing on Facebook authentication/login gates in headless environments,
                    // we strictly rely on public cached page texts or direct public search snippets
                    await this.safeNavigate(tempPage, fbUrl, { timeout: 15000 });
                    await this.randomDelay(1000, 2000);
                    
                    const fbText = await tempPage.evaluate(() => document.body.innerText);
                    
                    const emailMatch = fbText.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
                    if (emailMatch) email = emailMatch[0];
                    
                    const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
                    const phoneMatch = fbText.match(phoneRegex);
                    if (phoneMatch) phone = phoneMatch[0];

                    // If not found or blocked by login walls, try public directory/about pages
                    if (!email || !phone) {
                        let aboutUrl = fbUrl;
                        if (fbUrl.endsWith('/')) {
                            aboutUrl = fbUrl + 'about';
                        } else if (!fbUrl.includes('/about')) {
                            aboutUrl = fbUrl + '/about';
                        }
                        
                        this.log(`Stealth crawling basic Facebook about page: ${aboutUrl}`);
                        await this.safeNavigate(tempPage, aboutUrl, { timeout: 15000 });
                        await this.randomDelay(1000, 2000);
                        
                        const aboutText = await tempPage.evaluate(() => document.body.innerText);
                        
                        const emailMatchAbout = aboutText.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
                        if (emailMatchAbout && !email) email = emailMatchAbout[0];
                        
                        const phoneMatchAbout = aboutText.match(phoneRegex);
                        if (phoneMatchAbout && !phone) phone = phoneMatchAbout[0];
                    }
                } catch (fbErr) {
                    this.log(`FB direct crawl limited. Relying on search index snippet instead.`);
                }
            } else if (lower.includes('instagram.com') || lower.includes('twitter.com') || lower.includes('x.com')) {
                // For Instagram and X, perform a stealth DuckDuckGo snippet query to fetch contacts
                const username = lower.split('/').pop().split('?')[0];
                if (username && !this.disabledEngines.has('DuckDuckGo')) {
                    const searchQ = `site:${lower.replace('https://', '').replace('http://', '').split('/')[0]} "${username}" email OR phone`;
                    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQ)}`;
                    this.log(`Mining social snippet on DuckDuckGo: ${searchQ}`);
                    
                    try {
                        await this.safeNavigate(tempPage, searchUrl, { timeout: 15000 });
                        await this.randomDelay(1000, 2000);
                        
                        const ddgText = await tempPage.evaluate(() => document.body.innerText);
                        
                        const emailMatch = ddgText.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
                        if (emailMatch) email = emailMatch[0];
                        
                        const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
                        const phoneMatch = ddgText.match(phoneRegex);
                        if (phoneMatch) phone = phoneMatch[0];
                    } catch (ddgErr) {
                        this.log(`Failed querying DuckDuckGo snippet for social: ${ddgErr.message}`);
                    }
                }
            }
        } catch (err) {
            this.log(`Error in scrapeSocialContacts: ${err.message}`);
        } finally {
            if (tempPage) {
                await tempPage.close().catch(() => null);
            }
        }

        return { email, phone };
    }

    /**
     * Send log messages to the console and to the SSE event emitter
     */
    log(message) {
        const formattedMessage = `[${this.platform}]: ${message}`;
        console.log(`[Job ${this.jobId}] ${formattedMessage}`);
        jobEmitter.emit('log', { jobId: this.jobId, message: formattedMessage, progress: this.progressPercent, leadsCount: this.leadsCount, limit: this.limit, stateMessage: this.stateMessage });
    }

    setProgress(leadsCount, progressPercent, stateMessage = null) {
        this.leadsCount = leadsCount;
        this.progressPercent = Math.min(Math.max(0, Math.round(progressPercent)), 99);
        if (stateMessage !== null) {
            this.stateMessage = stateMessage;
        }
        jobEmitter.emit('log', {
            jobId: this.jobId,
            progress: this.progressPercent,
            leadsCount: this.leadsCount,
            limit: this.limit,
            stateMessage: this.stateMessage
        });
    }

    /**
     * Initialize the headless browser with random viewports and proxy scaffolding
     */
    async initBrowser(options = {}) {
        this.log('Initializing browser...');
        
        const args = [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ];
        
        // Dynamic Proxy Gateway Rotation (Technique 4)
        let activeProxy = options.proxyServer || null;
        if (!activeProxy && process.env.ROTATING_PROXIES) {
            const proxyPool = process.env.ROTATING_PROXIES.split(',');
            activeProxy = proxyPool[Math.floor(Math.random() * proxyPool.length)];
        }
        
        if (activeProxy) {
            this.log(`Dynamic Proxy Rotation: Routing session via residential gateway [${activeProxy}]...`);
            args.push(`--proxy-server=${activeProxy}`);
        }

        this.browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            protocolTimeout: 0,
            args
        });

        this.page = await this.browser.newPage();
        await this.setupPage(this.page);
        
        // Anti-bot: Randomize viewport
        const viewports = [
            { width: 1920, height: 1080 },
            { width: 1366, height: 768 },
            { width: 1536, height: 864 },
            { width: 1440, height: 900 }
        ];
        const vp = viewports[Math.floor(Math.random() * viewports.length)];
        await this.page.setViewport(vp);
        
        this.log(`Browser initialized with viewport ${vp.width}x${vp.height}`);
    }

    /**
     * Intelligent random delay for mimicking human behavior
     */
    async randomDelay(min = 1000, max = 3000) {
        const delay = Math.floor(Math.random() * (max - min + 1) + min);
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Shorter delay for headless cluster workers to maximize throughput
     */
    async workerDelay(min = 100, max = 300) {
        const delay = Math.floor(Math.random() * (max - min + 1) + min);
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Scrape abstraction to be implemented by child classes
     */
    async scrape(query, location) {
        throw new Error('scrape() method must be implemented by subclass');
    }

    /**
     * Cleanup resources
     */
    /**
     * Helper to optimize pages by blocking heavy resources (images, fonts, media)
     */
    async optimizePage(pageInstance, blockJSAndCSS = false) {
        if (!pageInstance) return;
        pageInstance._blockJSAndCSS = blockJSAndCSS;
        if (pageInstance._isOptimized) return;
        try {
            await pageInstance.setRequestInterception(true);
            pageInstance.on('request', (req) => {
                try {
                    // Check if request is already handled or intercepted by another handler
                    if (req.isInterceptResolutionHandled && req.isInterceptResolutionHandled()) {
                        return;
                    }
                    const type = req.resourceType();
                    if (['image', 'font', 'media'].includes(type) || 
                        (pageInstance._blockJSAndCSS && ['script', 'stylesheet'].includes(type)) ||
                        req.url().includes('google-analytics') || 
                        req.url().includes('doubleclick') || 
                        req.url().includes('facebook.net')) {
                        req.abort().catch(() => null);
                    } else {
                        req.continue().catch(() => null);
                    }
                } catch (e) {
                    // Fail-safe for already handled requests
                    req.continue().catch(() => null);
                }
            });
            pageInstance._isOptimized = true;
        } catch (err) {
            // Ignore if request interception is already set or fails
        }
    }

    /**
     * Check if the browser needs to be recycled to prevent memory exhaustion
     */
    async checkRecycleBrowser() {
        // Safe no-op to prevent premature browser closure while parallel cluster workers are active
        this.pageNavigations++;
    }

    /**
     * Resolve related professional synonyms for specific industries
     */
    getIndustrySynonyms(baseQuery) {
        const lower = baseQuery.toLowerCase();
        
        const realEstate = ['real estate agent', 'realtor', 'real estate broker', 'property manager', 'real estate consultant', 'real estate specialist'];
        const medical = ['dentist', 'dental care', 'orthodontist', 'doctor', 'physician', 'clinic', 'medical center'];
        const plumbing = ['plumber', 'plumbing services', 'emergency plumber', 'plumbing contractor', 'drain cleaning'];
        const construction = ['builder', 'contractor', 'renovations', 'remodeling', 'general contractor', 'home builder'];
        const software = ['software engineer', 'software developer', 'web developer', 'fullstack developer', 'frontend engineer', 'backend engineer'];

        if (realEstate.some(x => lower.includes(x) || x.includes(lower))) return realEstate;
        if (medical.some(x => lower.includes(x) || x.includes(lower))) return medical;
        if (plumbing.some(x => lower.includes(x) || x.includes(lower))) return plumbing;
        if (construction.some(x => lower.includes(x) || x.includes(lower))) return construction;
        if (software.some(x => lower.includes(x) || x.includes(lower))) return software;

        return [
            baseQuery,
            `${baseQuery} services`,
            `${baseQuery} specialist`,
            `${baseQuery} consultant`,
            `${baseQuery} professional`,
            `${baseQuery} expert`
        ];
    }

    /**
     * Generate dynamic query variations to bypass platform search limits
     */
    getQueryVariations(baseQuery) {
        const synonyms = this.getIndustrySynonyms(baseQuery);
        const variations = [];
        for (const syn of synonyms) {
            variations.push(syn);
            variations.push(`${syn} services`);
            variations.push(`best ${syn}`);
            variations.push(`top ${syn}`);
        }
        return [...new Set(variations)];
    }

    /**
     * Generate dynamic location subdivisions using stable geographic suffixes compatible with LinkedIn profiles
     */
    getLocationVariations(baseLocation) {
        const cleanLoc = baseLocation.replace(/,?\s*\b[A-Z]{2}$/i, '').trim();
        const stateMatch = baseLocation.match(/,?\s*\b([A-Z]{2})$/i);
        const stateCode = stateMatch ? stateMatch[1].toUpperCase() : '';
        const stateSuffix = stateCode ? `, ${stateCode}` : '';

        const variations = [
            baseLocation,
            `Greater ${cleanLoc} Area`,
            `${cleanLoc} Metropolitan Area`,
            `${cleanLoc} Area`,
            `${cleanLoc}${stateSuffix}`
        ];
        return [...new Set(variations.filter(Boolean))];
    }

    /**
     * Segment major metropolitan cities into boroughs/localities to multiply bulk query yields
     */
    getLocationSubdivisions(baseLocation) {
        if (!baseLocation || baseLocation === 'N/A') return [baseLocation];
        const lower = baseLocation.toLowerCase();
        const stateMatch = baseLocation.match(/,?\s*\b([A-Z]{2})$/i);
        const stateCode = stateMatch ? stateMatch[1].toUpperCase() : '';
        const stateSuffix = stateCode ? `, ${stateCode}` : '';
        const cleanLoc = baseLocation.replace(/,?\s*\b[A-Z]{2}$/i, '').trim();

        if (lower.includes('new york') || lower.includes('nyc')) {
            return [
                baseLocation,
                `Manhattan${stateSuffix}`,
                `Brooklyn${stateSuffix}`,
                `Queens${stateSuffix}`,
                `Bronx${stateSuffix}`,
                `Staten Island${stateSuffix}`,
                `Greater ${cleanLoc} Area`
            ];
        }
        if (lower.includes('los angeles') || lower.includes('la')) {
            return [
                baseLocation,
                `Los Angeles${stateSuffix}`,
                `Santa Monica${stateSuffix}`,
                `Beverly Hills${stateSuffix}`,
                `Pasadena${stateSuffix}`,
                `Long Beach${stateSuffix}`,
                `Hollywood${stateSuffix}`,
                `Glendale${stateSuffix}`
            ];
        }
        if (lower.includes('chicago')) {
            return [
                baseLocation,
                `Chicago${stateSuffix}`,
                `Evanston${stateSuffix}`,
                `Naperville${stateSuffix}`,
                `Oak Park${stateSuffix}`,
                `Schaumburg${stateSuffix}`
            ];
        }
        
        return [
            baseLocation,
            `Downtown ${cleanLoc}${stateSuffix}`,
            `North ${cleanLoc}${stateSuffix}`,
            `South ${cleanLoc}${stateSuffix}`,
            `East ${cleanLoc}${stateSuffix}`,
            `West ${cleanLoc}${stateSuffix}`,
            `Central ${cleanLoc}${stateSuffix}`,
            `${cleanLoc} Suburbs${stateSuffix}`
        ];
    }

    /**
     * Helper to launch a headless browser with custom proxy and arguments.
     */
    async launchWorkerBrowser() {
        const args = [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ];
        
        let activeProxy = null;
        if (process.env.ROTATING_PROXIES) {
            const proxyPool = process.env.ROTATING_PROXIES.split(',');
            activeProxy = proxyPool[Math.floor(Math.random() * proxyPool.length)];
        }
        
        if (activeProxy) {
            args.push(`--proxy-server=${activeProxy}`);
        }

        const launchPromise = puppeteer.launch({
            headless: true,
            defaultViewport: null,
            protocolTimeout: 0,
            args
        });
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Browser launch timeout (25s)')), 25000)
        );
        const browser = await Promise.race([launchPromise, timeoutPromise]);
        const pid = browser.process() ? browser.process().pid : null;
        return { browser, pid };
    }

    /**
     * Highly robust task queue worker cluster engine (Technique 1).
     * Spins up to maxWorkers pages, dynamically allocates tasks,
     * recycles pages after 15 tasks to free memory, and handles page crashes securely.
     */
    async runClusterQueue(tasks, workerFn, maxWorkers = this.maxWorkers || 5, shouldStop = null) {
        if (!tasks || tasks.length === 0) return [];
        this.log(`Spinning up headless worker cluster with ${Math.min(tasks.length, maxWorkers)} parallel tabs to process ${tasks.length} deep-crawling tasks...`);

        const results = [];
        let taskIndex = 0;

        // Initialize worker pages pool
        const workers = [];
        const numWorkers = Math.min(tasks.length, maxWorkers);
        try {
            for (let idx = 0; idx < numWorkers; idx++) {
                const { browser, pid } = await this.launchWorkerBrowser();
                const page = await browser.newPage();
                await this.setupPage(page);
                await this.optimizePage(page);
                await page.setViewport({ width: 1280, height: 800 });
                workers.push({ id: idx + 1, browser, page, pid, taskCount: 0 });
            }
        } catch (err) {
            this.log(`Error initializing workers: ${err.message}. Closing successfully opened workers...`);
            for (const w of workers) {
                if (w.page) await w.page.close().catch(() => null);
                if (w.browser) {
                    await this.safeCloseBrowser(w.browser, w.pid).catch(() => null);
                }
            }
            throw err;
        }

        const runWorker = async (worker) => {
            while (taskIndex < tasks.length) {
                if (shouldStop && shouldStop()) {
                    this.log(`[Worker ${worker.id}]: early termination triggered by shouldStop condition.`);
                    break;
                }
                const currentIdx = taskIndex++;
                const task = tasks[currentIdx];
                if (!task) break;

                worker.taskCount++;
                
                // Dynamic Page Recycling after 15 tasks to prevent Chrome memory exhaustion
                if (worker.taskCount > 15) {
                    this.log(`[Worker ${worker.id}]: Completed 15 deep-crawls. Recycling browser worker process to clear memory...`);
                    if (worker.page) await worker.page.close().catch(() => null);
                    await this.safeCloseBrowser(worker.browser, worker.pid);
                    
                    const { browser, pid } = await this.launchWorkerBrowser();
                    worker.browser = browser;
                    worker.pid = pid;

                    worker.page = await worker.browser.newPage();
                    await this.setupPage(worker.page);
                    await this.optimizePage(worker.page);
                    await worker.page.setViewport({ width: 1280, height: 800 });
                    worker.taskCount = 1;
                }

                this.log(`[Worker ${worker.id}]: Processing task [${currentIdx + 1}/${tasks.length}]...`);
                
                let timeoutTimer = null;
                try {
                    const taskTimeoutMs = 120000;
                    const executionPromise = (async () => {
                        try {
                            return await workerFn(task, worker.page, worker.id);
                        } finally {
                            if (timeoutTimer) clearTimeout(timeoutTimer);
                        }
                    })();

                    const timeoutPromise = new Promise((_, reject) => {
                        timeoutTimer = setTimeout(() => {
                            reject(new Error(`Task timeout: Task exceeded ${taskTimeoutMs / 1000} seconds`));
                        }, taskTimeoutMs);
                    });

                    const res = await Promise.race([executionPromise, timeoutPromise]);
                    if (res) results.push(res);
                } catch (taskErr) {
                    if (timeoutTimer) clearTimeout(timeoutTimer);
                    this.log(`[Worker ${worker.id}]: Error processing task [${currentIdx + 1}/${tasks.length}]: ${taskErr.message}`);
                    
                    // Recover from crashed page or task timeout by spinning up a new page instance
                    if (taskErr.message.includes('timeout') || taskErr.message.includes('Timeout') || taskErr.message.includes('closed') || taskErr.message.includes('detached') || taskErr.message.includes('crash')) {
                        const reason = (taskErr.message.includes('timeout') || taskErr.message.includes('Timeout')) ? 'task timeout' : 'page crash';
                        this.log(`[Worker ${worker.id}]: Recovering from ${reason}...`);
                        try {
                            if (worker.page) await worker.page.close().catch(() => null);
                            
                            let needNewBrowser = !worker.browser || !worker.browser.isConnected();
                            if (!needNewBrowser) {
                                try {
                                    worker.page = await worker.browser.newPage();
                                    await this.setupPage(worker.page);
                                    await this.optimizePage(worker.page);
                                    await worker.page.setViewport({ width: 1280, height: 800 });
                                    worker.taskCount = 0;
                                } catch (pageErr) {
                                    this.log(`[Worker ${worker.id}]: Failed creating new page on existing browser: ${pageErr.message}. Will relaunch browser.`);
                                    needNewBrowser = true;
                                }
                            }
                            
                            if (needNewBrowser) {
                                this.log(`[Worker ${worker.id}]: Relaunching browser process...`);
                                await this.safeCloseBrowser(worker.browser, worker.pid);
                                
                                const { browser, pid } = await this.launchWorkerBrowser();
                                worker.browser = browser;
                                worker.pid = pid;

                                worker.page = await worker.browser.newPage();
                                await this.setupPage(worker.page);
                                await this.optimizePage(worker.page);
                                await worker.page.setViewport({ width: 1280, height: 800 });
                                worker.taskCount = 0;
                            }
                        } catch (recoverErr) {
                            this.log(`[Worker ${worker.id}]: CRITICAL: Recovery failed: ${recoverErr.message}`);
                        }
                    }
                }
            }
        };

        // Fire all workers concurrently
        await Promise.all(workers.map(worker => runWorker(worker)));

        // Close all worker page/browser processes concurrently
        await Promise.all(workers.map(async (w) => {
            if (w.page) await w.page.close().catch(() => null);
            await this.safeCloseBrowser(w.browser, w.pid);
        }));

        this.log(`Headless worker cluster finished. Successfully completed ${results.length}/${tasks.length} tasks!`);
        return results;
    }

    /**
     * Injects professional stealth hardware fingerprints, spoofing WebGL renders,
     * canvas pixels, languages, concurrency, and masking webdriver presence.
     */
    async injectStealthFingerprints(page) {
        if (!page) return;
        try {
            await page.evaluateOnNewDocument(() => {
                // 1. Spoof navigator.webdriver
                Object.defineProperty(navigator, 'webdriver', { get: () => false });

                // 2. Spoof languages
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

                // 3. Spoof plugins
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [
                        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                        { name: 'Chrome PDF Viewer', filename: 'mhjfbgoacfdegappjgbcjkvbdfgpnoce', description: 'Google Chrome PDF Viewer' }
                    ]
                });

                // 4. Spoof WebGL renderer to look like an NVIDIA card on Windows
                const getParameterOriginal = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(parameter) {
                    if (parameter === 37445) return 'Google Inc. (NVIDIA)';
                    if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                    return getParameterOriginal.apply(this, arguments);
                };

                if (window.WebGL2RenderingContext) {
                    const getParameter2Original = WebGL2RenderingContext.prototype.getParameter;
                    WebGL2RenderingContext.prototype.getParameter = function(parameter) {
                        if (parameter === 37445) return 'Google Inc. (NVIDIA)';
                        if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                        return getParameter2Original.apply(this, arguments);
                    };
                }

                // 5. Spoof hardware concurrency
                Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

                // 6. Canvas Fingerprint Noise Injection (Bypasses canvas tracking)
                const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
                CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
                    const imageData = originalGetImageData.apply(this, arguments);
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        imageData.data[i] = (imageData.data[i] + Math.floor(Math.random() * 2)) % 256;
                    }
                    return imageData;
                };
            });
        } catch (e) {
            // Ignore fingerprint injection failures
        }
    }

    /**
     * Safe navigate wrapper that executes page.goto with fast timeouts and minimal retries.
     * CAPTCHA solving is NOT automatic — call solveCaptcha() explicitly where needed.
     */
    async safeNavigate(page, url, options = {}) {
        if (!page) throw new Error('safeNavigate requires a valid Page instance');
        
        const defaultOptions = {
            waitUntil: 'domcontentloaded',
            timeout: 15000
        };
        const navOptions = { ...defaultOptions, ...options };
        
        this.log(`Navigating safe session to: ${url}`);
        
        let attempts = 0;
        const maxNavAttempts = 2;
        let lastError = null;
        
        while (attempts < maxNavAttempts) {
            attempts++;
            let failsafeTimer = null;
            try {
                // Enforce a strict Promise race wrapper to prevent infinite CDP session freezes on modal dialogs or connection drops
                const navigationPromise = page.goto(url, navOptions);
                
                const failsafeTimeoutPromise = new Promise((_, reject) => {
                    failsafeTimer = setTimeout(() => {
                        reject(new Error('CDP Navigation Timeout: Failsafe triggered'));
                    }, navOptions.timeout + 3000);
                });
                
                const response = await Promise.race([navigationPromise, failsafeTimeoutPromise]);
                if (failsafeTimer) clearTimeout(failsafeTimer);
                
                // Brief delay to allow DOM to settle
                await this.randomDelay(200, 600);
                
                return response;
            } catch (err) {
                if (failsafeTimer) clearTimeout(failsafeTimer);
                lastError = err;
                this.log(`[Safe Navigate Warning]: Attempt ${attempts}/${maxNavAttempts} failed: ${err.message}`);
                
                if (err.message.includes('Target closed') || err.message.includes('Session closed') || err.message.includes('browser has been closed')) {
                    throw err;
                }
                
                if (attempts < maxNavAttempts) {
                    await this.randomDelay(500, 1500);
                }
            }
        }
        
        throw new Error(`Failed to navigate to ${url} after ${maxNavAttempts} attempts. Last error: ${lastError.message}`);
    }

    /**
     * Automatically solves Cloudflare Turnstile and hCaptcha challenges inside frames
     * using precise coordinates, natural human Bezier curves, and key-press events,
     * running in a reactive checking loop with coordinate offsets.
     */
    async solveCaptcha(page, maxAttempts = 5) {
        if (!page) return;
        try {
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                if (page.isClosed()) return;

                // Check if the page is a Cloudflare hard block (e.g. Sorry, you have been blocked / Attention Required!)
                const isHardBlocked = await page.evaluate(() => {
                    const title = (document.title || '').toLowerCase();
                    const txt = (document.body ? document.body.innerText : '').toLowerCase();
                    return title.includes('attention required') || 
                           txt.includes('sorry, you have been blocked') || 
                           txt.includes('why have i been blocked') ||
                           txt.includes('access denied');
                });

                if (isHardBlocked) {
                    this.log(`[Stealth Solver ERROR]: Hard security block page detected. Bypassing automation solver...`);
                    throw new Error('Hard security block detected');
                }

                // 1. Check if Cloudflare or CAPTCHA or Brave challenge is present
                const isChallengePresent = await page.evaluate(() => {
                    const title = (document.title || '').toLowerCase();
                    const body = document.body;
                    const bodyText = body ? body.innerText : '';
                    
                    // If profiles or standard "no results" are already present, we are not blocked
                    const hasProfiles = Array.from(document.querySelectorAll('a')).some(link => {
                        const decoded = decodeURIComponent(link.href || '');
                        return decoded.includes('linkedin.com/in/') && !decoded.includes('q=');
                    });
                    if (hasProfiles) return false;

                    const hasNoResults = bodyText.includes('no results') || bodyText.includes('did not match') || bodyText.includes('no spelling suggestions');
                    if (hasNoResults) return false;

                    const hasCfText = bodyText.includes('Cloudflare') || 
                                     bodyText.includes('checking your browser') || 
                                     bodyText.includes('Verify you are human') ||
                                     bodyText.includes('Verify your identity') ||
                                     bodyText.includes('Verifying you\'re not a bot') ||
                                     bodyText.includes('Please solve the challenge below');
                                     
                    const hasCfIframe = document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[src*="hcaptcha"], iframe[src*="recaptcha"]') !== null;
                    
                    const hasBraveButton = document.querySelector('.captcha-button-fade button, .captcha-button-wrap button') !== null || 
                                           Array.from(document.querySelectorAll('button')).some(b => {
                                               const txt = (b.innerText || '').trim();
                                               return txt === 'Verify' && (
                                                   b.className.includes('svelte') ||
                                                   b.closest('[class*="captcha"]') ||
                                                   document.title.includes('bot') ||
                                                   document.title.includes('CAPTCHA')
                                               );
                                           });
                                           
                    const hasGoogleSorry = title.includes('sorry') || bodyText.includes('unusual traffic') || bodyText.includes('automated queries');
                                           
                    if (hasCfText || hasCfIframe || hasBraveButton || hasGoogleSorry) {
                        return true;
                    }

                    // Otherwise check for early return title matches
                    if (title.includes('yellow pages') || 
                        title.includes('yellowpages') || 
                        title.includes('google maps') || 
                        title.includes('linkedin') || 
                        title.includes('plumbers') || 
                        title.includes('realtors') ||
                        title.includes('dentists') ||
                        title.includes('dentist')) {
                        return false;
                    }
                });

                if (!isChallengePresent) {
                    if (attempt > 1) {
                        this.log(`[Stealth Solver]: Verification challenge cleared successfully.`);
                    }
                    return;
                }

                this.log(`[Stealth Solver] Detection (Attempt ${attempt}/${maxAttempts}): Cloudflare/CAPTCHA challenge present on page.`);

                // 2. First check: Native Svelte / Brave "Verify" button (direct HTML, no iframe)
                const braveButtonHandle = await page.evaluateHandle(() => {
                    return Array.from(document.querySelectorAll('button')).find(b => {
                        const txt = (b.innerText || '').trim();
                        return txt === 'Verify' && (
                            b.className.includes('svelte') || 
                            b.closest('[class*="captcha"]') || 
                            b.className.includes('button')
                        );
                    }) || null;
                });

                const braveButton = braveButtonHandle ? braveButtonHandle.asElement() : null;
                if (braveButton) {
                    this.log(`[Stealth Solver]: Native Brave/Svelte verify button detected. Resolving challenge directly...`);
                    const rect = await braveButton.boundingBox();
                    if (rect && rect.width > 0 && rect.height > 0) {
                        const clickX = rect.x + (rect.width / 2) + (Math.random() * 4 - 2);
                        const clickY = rect.y + (rect.height / 2) + (Math.random() * 4 - 2);
                        
                        this.log(`[Stealth Solver]: Simulating human mouse movements to Brave button at [${Math.round(clickX)}, ${Math.round(clickY)}]...`);
                        
                        // Curved Bezier path moves
                        await page.mouse.move(clickX - 80, clickY - 60);
                        await this.randomDelay(150, 250);
                        await page.mouse.move(clickX - 30, clickY - 20, { steps: 4 });
                        await this.randomDelay(100, 150);
                        await page.mouse.move(clickX, clickY, { steps: 4 });
                        await this.randomDelay(150, 300);
                        
                        this.log(`[Stealth Solver]: Clicking Brave Verify button...`);
                        await page.mouse.down();
                        await this.randomDelay(80, 150);
                        await page.mouse.up();
                        
                        // Wait to see if verification settles
                        await this.randomDelay(4000, 6000);
                        continue;
                    }
                }

                // 3. Scan frames for Turnstile / hCaptcha challenge
                const frames = page.frames();
                let challengeFrame = null;
                for (const frame of frames) {
                    try {
                        const url = frame.url().toLowerCase();
                        if (url.includes('challenges.cloudflare.com') || url.includes('turnstile') || url.includes('hcaptcha') || url.includes('recaptcha')) {
                            challengeFrame = frame;
                            break;
                        }
                    } catch (e) {
                        // Ignore cross-origin frame access errors
                    }
                }

                if (challengeFrame) {
                    this.log(`[Stealth Solver]: Active Cloudflare challenge frame detected.`);
                    
                    try {
                        // Retrieve the iframe element handle cleanly
                        let iframeElement = await challengeFrame.frameElement().catch(() => null);
                        if (!iframeElement) {
                            const iframeSelector = 'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[src*="hcaptcha"], iframe[src*="recaptcha"]';
                            await page.waitForSelector(iframeSelector, { visible: true, timeout: 3000 }).catch(() => null);
                            iframeElement = await page.$(iframeSelector);
                        }
                        
                        if (iframeElement) {
                            const rect = await iframeElement.boundingBox();
                            if (rect && rect.width > 0 && rect.height > 0) {
                                // Try progressive coordinate adjustments to handle layout/offset shifts
                                const offsetOffset = (attempt - 1) * 10; // 0px, 10px, 20px
                                const clickX = rect.x + 35 + offsetOffset;
                                const clickY = rect.y + (rect.height / 2);
                                
                                this.log(`[Stealth Solver]: Simulating natural mouse moves to Turnstile: [${Math.round(clickX)}, ${Math.round(clickY)}] (offset +${offsetOffset}px)...`);
                                
                                // Curved Bezier path moves
                                await page.mouse.move(clickX - 100, clickY - 80);
                                await this.randomDelay(150, 300);
                                await page.mouse.move(clickX - 40, clickY - 30, { steps: 5 });
                                await this.randomDelay(100, 200);
                                await page.mouse.move(clickX, clickY, { steps: 5 });
                                await this.randomDelay(200, 400);
                                
                                this.log(`[Stealth Solver]: Clicking Turnstile verification checkbox...`);
                                await page.mouse.down();
                                await this.randomDelay(80, 150); // Click hold time
                                await page.mouse.up();
                                
                                // Wait to see if verification settles
                                await this.randomDelay(4000, 6000);
                                continue;
                            }
                        }
                    } catch (clickErr) {
                        this.log(`[Stealth Solver Warning]: solveCaptcha click failed: ${clickErr.message}`);
                    }
                } else {
                    // Secondary check: Plain Cloudflare text challenge (waiting for iframe to appear)
                    this.log(`[Stealth Solver]: Challenge page detected but iframe/button not active yet. Pausing 3.5s for load...`);
                    await this.randomDelay(3500, 5000);
                }
            }
            
            this.log(`[Stealth Solver Warning]: Max solver attempts reached.`);
        } catch (e) {
            this.log(`[Stealth Solver Warning]: solveCaptcha error: ${e.message}`);
        }
    }

    /**
     * Stealthily evaluates if the current page has encountered a security block or challenge
     */
    async isPageBlocked(page) {
        if (!page) return false;
        try {
            let blocked = await page.evaluate(() => {
                const title = (document.title || '').toLowerCase();
                const txt = (document.body ? document.body.innerText : '').toLowerCase();
                
                // If there are profile links or a clear "no results" layout, we are not blocked
                const hasProfiles = Array.from(document.querySelectorAll('a')).some(link => {
                    const decoded = decodeURIComponent(link.href || '');
                    return decoded.includes('linkedin.com/in/') && !decoded.includes('q=');
                });
                if (hasProfiles) return false;

                const hasNoResults = txt.includes('no results') || txt.includes('did not match') || txt.includes('no spelling suggestions');
                if (hasNoResults) return false;

                // Specific security block and CAPTCHA signature texts
                const hasCfText = txt.includes('checking your browser') || 
                                 txt.includes('verify you are human') ||
                                 txt.includes('verify your identity') ||
                                 txt.includes('verifying you\'re not a bot') ||
                                 txt.includes('sorry, you have been blocked') ||
                                 txt.includes('why have i been blocked') ||
                                 txt.includes('access denied') ||
                                 txt.includes('unusual traffic from your computer') ||
                                 txt.includes('automated traffic');
                                 
                const hasBraveCaptcha = title === 'brave search' && txt.includes('verify');
                
                const hasCaptchaIframe = document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[src*="hcaptcha"], iframe[src*="recaptcha"]') !== null;
                
                const hasGoogleSorry = title.includes('sorry') || txt.includes('unusual traffic') || txt.includes('automated queries') || txt.includes('detected unusual traffic');

                return hasCfText || hasBraveCaptcha || hasGoogleSorry || (hasCaptchaIframe && (hasCfText || hasBraveCaptcha || txt.includes('captcha') || txt.includes('robot') || txt.includes('human') || txt.includes('security')));
            });

            if (blocked) {
                const url = page.url().toLowerCase();
                const isSearchEngine = url.includes('google.com') || 
                                       url.includes('duckduckgo.com') || 
                                       url.includes('bing.com') || 
                                       url.includes('brave.com') || 
                                       url.includes('yahoo.com');

                if (isSearchEngine) {
                    this.log(`[Block Handler]: Search engine block page detected (${url}). Skipping CAPTCHA solver.`);
                    return true;
                }

                this.log(`[Block Handler]: Captcha/Security block page detected. Attempting Turnstile/CAPTCHA solver...`);
                await this.solveCaptcha(page);
                
                // Re-evaluate block status
                blocked = await page.evaluate(() => {
                    const title = (document.title || '').toLowerCase();
                    const txt = (document.body ? document.body.innerText : '').toLowerCase();
                    
                    const hasProfiles = Array.from(document.querySelectorAll('a')).some(link => {
                        const decoded = decodeURIComponent(link.href || '');
                        return decoded.includes('linkedin.com/in/') && !decoded.includes('q=');
                    });
                    if (hasProfiles) return false;

                    const hasNoResults = txt.includes('no results') || txt.includes('did not match') || txt.includes('no spelling suggestions');
                    if (hasNoResults) return false;

                    const hasCfText = txt.includes('checking your browser') || 
                                     txt.includes('verify you are human') ||
                                     txt.includes('verify your identity') ||
                                     txt.includes('verifying you\'re not a bot') ||
                                     txt.includes('sorry, you have been blocked') ||
                                     txt.includes('why have i been blocked') ||
                                     txt.includes('access denied') ||
                                     txt.includes('unusual traffic from your computer') ||
                                     txt.includes('automated traffic');
                                     
                    const hasBraveCaptcha = title === 'brave search' && txt.includes('verify');
                    
                    const hasCaptchaIframe = document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[src*="hcaptcha"], iframe[src*="recaptcha"]') !== null;
                    
                    const hasGoogleSorry = title.includes('sorry') || txt.includes('unusual traffic') || txt.includes('automated queries') || txt.includes('detected unusual traffic');

                    return hasCfText || hasBraveCaptcha || hasGoogleSorry || (hasCaptchaIframe && (hasCfText || hasBraveCaptcha || txt.includes('captcha') || txt.includes('robot') || txt.includes('human') || txt.includes('security')));
                });
            }
            return blocked;
        } catch (e) {
            return false;
        }
    }

    /**
     * Universally queries search engines to hunt down a local business's official website.
     * Tries DuckDuckGo, Brave Search, and Bing sequentially. Filters out portal aggregates.
     */
    async huntWebsiteForBusiness(name, location, huntPage) {
        if (this.speedMode === 'fast') {
            this.log(`[Universal Web Hunt]: Fast mode active. Skipping website hunt for "${name}" to prioritize speed.`);
            return 'N/A';
        }

        if (!name || name === 'N/A') return 'N/A';

        // 1. Failsafe: check companyWebsiteCache first to avoid duplicate dork queries!
        const cacheKey = `${name.toLowerCase().trim()}_${location ? location.toLowerCase().trim() : ''}`;
        if (this.companyWebsiteCache && this.companyWebsiteCache.has(cacheKey)) {
            const cached = this.companyWebsiteCache.get(cacheKey);
            this.log(`Universal Web Hunt CACHE HIT: Found cached website for "${name}": ${cached}`);
            return cached;
        }

        const cleanLoc = location ? location.replace(/,?\s*[A-Z]{2}$/i, '').trim() : '';
        const searchQuery = `"${name}" ${cleanLoc}`;
        this.log(`Universal Web Hunt: Querying search engines for official website of "${name}" in "${cleanLoc}"...`);
        
        let searchResults = [];

        // 2. Raw HTTP Fetch from DuckDuckGo HTML (Instant!)
        if (!this.disabledEngines.has('DuckDuckGo')) {
            try {
                const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
                const res = await fetch(searchUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5'
                    }
                });
                if (res.ok) {
                    const html = await res.text();
                    const $ = cheerio.load(html);
                    
                    $('.result, .web-result').each((_, el) => {
                        const titleEl = $(el).find('.result__title a, a.result__a');
                        const href = titleEl.attr('href');
                        if (href) {
                            searchResults.push({ href });
                        }
                    });
                    if (searchResults.length > 0) {
                        this.trackEngineSuccess('DuckDuckGo');
                    }
                }
            } catch (e) {
                // Fallback to Puppeteer DDG
            }
        }

        // 3. Puppeteer DDG Fallback if raw fetch fails or gets blocked
        if (searchResults.length === 0 && !this.disabledEngines.has('DuckDuckGo')) {
            try {
                const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
                await this.safeNavigate(huntPage, searchUrl, { timeout: 15000 });
                await this.randomDelay(600, 1200);

                const isBlocked = await this.isPageBlocked(huntPage);

                if (!isBlocked) {
                    searchResults = await huntPage.evaluate(() => {
                        const items = Array.from(document.querySelectorAll('.result, .web-result'));
                        return items.map(item => {
                            const titleEl = item.querySelector('.result__title a, a.result__a');
                            const href = titleEl ? titleEl.href : '';
                            return { href };
                        }).filter(r => r.href);
                    });
                    if (searchResults.length > 0) {
                        this.trackEngineSuccess('DuckDuckGo');
                    }
                } else {
                    this.trackEngineFailure('DuckDuckGo', true);
                }
            } catch (e) {
                this.trackEngineFailure('DuckDuckGo', true);
            }
        }

        // 4. Engine 2 Fallback: Brave Search
        if (searchResults.length === 0 && !this.disabledEngines.has('BraveSearch') && this.speedMode !== 'medium') {
            try {
                const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(searchQuery)}`;
                await this.safeNavigate(huntPage, searchUrl, { timeout: 15000 });
                await this.randomDelay(600, 1200);

                searchResults = await huntPage.evaluate(() => {
                    const items = Array.from(document.querySelectorAll('.search-result, .result, .snippet, div[data-testid="result"]'));
                    return items.map(item => {
                        const titleEl = item.querySelector('a');
                        const href = titleEl ? titleEl.href : '';
                        return { href };
                    }).filter(r => r.href && !r.href.includes('brave.com') && !r.href.includes('search'));
                });
                if (searchResults.length > 0) {
                    this.trackEngineSuccess('BraveSearch');
                }
            } catch (e) {
                this.trackEngineFailure('BraveSearch', true);
            }
        }

        // 5. Engine 3 Fallback: Bing Search
        if (searchResults.length === 0 && !this.disabledEngines.has('Bing') && this.speedMode !== 'medium') {
            try {
                const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}`;
                await this.safeNavigate(huntPage, searchUrl, { timeout: 15000 });
                await this.randomDelay(600, 1200);

                searchResults = await huntPage.evaluate(() => {
                    const items = Array.from(document.querySelectorAll('.b_algo'));
                    return items.map(item => {
                        const titleEl = item.querySelector('h2 a');
                        const href = titleEl ? titleEl.href : '';
                        return { href };
                    }).filter(r => r.href);
                });
                if (searchResults.length > 0) {
                    this.trackEngineSuccess('Bing');
                }
            } catch (e) {
                this.trackEngineFailure('Bing', true);
            }
        }

        // 6. Engine 4 Fallback: Yahoo Search
        if (searchResults.length === 0 && !this.disabledEngines.has('Yahoo') && this.speedMode !== 'medium') {
            try {
                const searchUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(searchQuery)}`;
                await this.safeNavigate(huntPage, searchUrl, { timeout: 15000 });
                await this.randomDelay(600, 1200);

                searchResults = await huntPage.evaluate(() => {
                    const items = Array.from(document.querySelectorAll('.algo, .dd.algo'));
                    return items.map(item => {
                        const titleLink = item.querySelector('.compTitle a, a');
                        const href = titleLink ? titleLink.href : '';
                        return { href };
                    }).filter(r => r.href);
                });
                if (searchResults.length > 0) {
                    this.trackEngineSuccess('Yahoo');
                }
            } catch (e) {
                this.trackEngineFailure('Yahoo', true);
            }
        }

        for (const res of searchResults) {
            let url = res.href;
            if (url.includes('uddg=')) {
                const match = url.match(/[?&]uddg=([^&]+)/);
                if (match && match[1]) {
                    url = decodeURIComponent(match[1]);
                }
            }
            url = url.split('&')[0].split('?')[0].split('#')[0];
            if (url && !this.isPersonalDirectory(url) && !this.isBusinessDirectory(url) && !/facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com/i.test(url)) {
                this.log(`Universal Web Hunt SUCCESS: Found official website for "${name}": ${url}`);
                if (this.companyWebsiteCache) {
                    this.companyWebsiteCache.set(cacheKey, url);
                }
                return url;
            }
        }

        this.log(`Universal Web Hunt FAILED: Could not find official website for "${name}".`);
        return 'N/A';
    }

    async semanticallyCrawlWebsite(url, isHttpOnly = false, pageInstance = null) {
        if (!url || url === 'N/A' || !url.startsWith('http')) {
            return { email: 'N/A', phone: 'N/A', facebook: 'N/A', instagram: 'N/A', x: 'N/A', physicalAddress: 'N/A' };
        }

        if (!this.crawledWebsitesCache) {
            this.crawledWebsitesCache = new Map();
        }
        if (this.crawledWebsitesCache.has(url)) {
            this.log(`Semantic HTTP crawl CACHE HIT for website: ${url}`);
            return this.crawledWebsitesCache.get(url);
        }

        const result = await this._semanticallyCrawlWebsiteInternal(url, isHttpOnly, pageInstance);
        this.crawledWebsitesCache.set(url, result);
        return result;
    }

    async _semanticallyCrawlWebsiteInternal(url, isHttpOnly = false, pageInstance = null) {
        if (!url || url === 'N/A' || !url.startsWith('http')) {
            return { email: 'N/A', phone: 'N/A', facebook: 'N/A', instagram: 'N/A', x: 'N/A', physicalAddress: 'N/A' };
        }

        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        ];

        const fetchWithTimeout = async (targetUrl, timeoutMs = 8000) => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(targetUrl, {
                    signal: controller.signal,
                    headers: {
                        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5'
                    }
                });
                clearTimeout(id);
                return response;
            } catch (err) {
                clearTimeout(id);
                throw err;
            }
        };

        const extractDetails = (html, baseUrl) => {
            const $ = cheerio.load(html);
            const text = $('body').text() || '';
            
            // Emails
            const emails = [];

            // Decrypt Cloudflare obfuscated emails
            $('[data-cfemail]').each((_, el) => {
                const hex = $(el).attr('data-cfemail');
                if (hex) {
                    const decrypted = decryptCfEmail(hex);
                    if (decrypted && decrypted.includes('@')) {
                        emails.push(decrypted);
                    }
                }
            });

            // Decrypt Cloudflare obfuscated email links in href
            $('a[href*="/cdn-cgi/l/email-protection"]').each((_, el) => {
                const href = $(el).attr('href') || '';
                const parts = href.split('#');
                if (parts.length > 1) {
                    const hex = parts[1];
                    const decrypted = decryptCfEmail(hex);
                    if (decrypted && decrypted.includes('@')) {
                        emails.push(decrypted);
                    }
                }
            });

            // Extract from mailto: links
            $('a[href^="mailto:"]').each((_, el) => {
                let href = $(el).attr('href') || '';
                href = href.replace(/mailto:/i, '').trim();
                const email = href.split('?')[0].trim();
                if (email && email.includes('@')) {
                    emails.push(email.toLowerCase());
                }
            });

            const emailMatches = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi);
            if (emailMatches) {
                emailMatches.forEach(e => {
                    const ext = e.split('.').pop().toLowerCase();
                    if (!['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js'].includes(ext)) {
                        emails.push(e.trim().toLowerCase());
                    }
                });
            }

            // Phones
            const phones = [];
            $('a[href^="tel:"]').each((_, el) => {
                const num = $(el).attr('href').replace('tel:', '').trim();
                if (num) phones.push(num);
            });
            
            const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
            const textPhones = text.match(phoneRegex);
            if (textPhones) {
                textPhones.forEach(p => phones.push(p.trim()));
            }

            // Social media links & subpages
            let facebook = null;
            let instagram = null;
            let x = null;
            const links = [];
            
            $('a[href]').each((_, el) => {
                const href = $(el).attr('href').trim();
                const textLower = $(el).text().toLowerCase();
                if (href) {
                    try {
                        const absoluteUrl = new URL(href, baseUrl).toString();
                        const lowerUrl = absoluteUrl.toLowerCase();
                        
                        // Parse socials
                        if (lowerUrl.includes('facebook.com') && !facebook) {
                            facebook = absoluteUrl;
                        } else if (lowerUrl.includes('instagram.com') && !instagram) {
                            instagram = absoluteUrl;
                        } else if ((lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) && !x) {
                            x = absoluteUrl;
                        }
                        
                        if (new URL(absoluteUrl).hostname === new URL(baseUrl).hostname) {
                            if (textLower.includes('contact') || textLower.includes('about') || textLower.includes('team') || textLower.includes('reach') || textLower.includes('info')) {
                                links.push(absoluteUrl);
                            }
                        }
                    } catch (e) {
                        // Suppress invalid url errors
                    }
                }
            });

            // Extract address from bodyText
            const physicalAddress = this.extractAddress(text) || null;

            return { emails, phones, facebook, instagram, x, physicalAddress, links: [...new Set(links)] };
        };

        try {
            this.log(`Semantic HTTP crawling homepage: ${url}...`);
            const homeRes = await fetchWithTimeout(url);
            if (!homeRes.ok) throw new Error(`HTTP status ${homeRes.status}`);

            const homeHtml = await homeRes.text();
            const homeDetails = extractDetails(homeHtml, url);

            let collectedEmails = [...homeDetails.emails];
            let collectedPhones = [...homeDetails.phones];
            let facebook = homeDetails.facebook || 'N/A';
            let instagram = homeDetails.instagram || 'N/A';
            let x = homeDetails.x || 'N/A';
            let physicalAddress = homeDetails.physicalAddress || 'N/A';

            // If a contact/about subpage is found, crawl it as well!
            if (homeDetails.links.length > 0) {
                const contactUrl = homeDetails.links[0];
                this.log(`Semantic HTTP crawling contact subpage: ${contactUrl}...`);
                try {
                    const contactRes = await fetchWithTimeout(contactUrl, 6000);
                    if (contactRes.ok) {
                        const contactHtml = await contactRes.text();
                        const contactDetails = extractDetails(contactHtml, contactUrl);
                        collectedEmails.push(...contactDetails.emails);
                        collectedPhones.push(...contactDetails.phones);
                        if (contactDetails.facebook && facebook === 'N/A') facebook = contactDetails.facebook;
                        if (contactDetails.instagram && instagram === 'N/A') instagram = contactDetails.instagram;
                        if (contactDetails.x && x === 'N/A') x = contactDetails.x;
                        if (contactDetails.physicalAddress && physicalAddress === 'N/A') physicalAddress = contactDetails.physicalAddress;
                    }
                } catch (subErr) {
                    // Suppress subpage errors
                }
            }

            // High-Yield Quality check: if Cheerio extracted nothing, fallback to Puppeteer!
            if (collectedEmails.length === 0 && collectedPhones.length === 0) {
                throw new Error('Cheerio fetched 0 contact details');
            }

            return {
                email: collectedEmails.length > 0 ? [...new Set(collectedEmails)].join(', ') : 'N/A',
                phone: collectedPhones.length > 0 ? [...new Set(collectedPhones)].join(', ') : 'N/A',
                facebook,
                instagram,
                x,
                physicalAddress: physicalAddress !== 'N/A' ? this.cleanAddress(physicalAddress) : 'N/A'
            };

        } catch (err) {
            if (isHttpOnly) {
                this.log(`HTTP crawl failed or yielded 0 results for ${url} in HTTP-only mode.`);
                throw new Error('Crawl failed in HTTP-only mode. Requires browser fallback.');
            }
            this.log(`Semantic crawl failed or yielded 0 results for ${url} (${err.message}). Triggering Puppeteer browser fallback...`);
            
            // Puppeteer fallback failsafe!
            let tempPage = null;
            try {
                if (pageInstance && pageInstance.browser) {
                    tempPage = await pageInstance.browser().newPage();
                } else if (this.browser) {
                    tempPage = await this.browser.newPage();
                } else {
                    throw new Error('No active browser instance available for fallback crawl');
                }
                await this.setupPage(tempPage);
                await this.optimizePage(tempPage);
                await tempPage.setViewport({ width: 1280, height: 800 });

                await this.safeNavigate(tempPage, url, { timeout: 12000 });
                await this.randomDelay(300, 600);

                const extractFromPage = async (page) => {
                    return await page.evaluate(() => {
                        const bodyText = document.body ? document.body.innerText : '';
                        
                        let foundEmails = [];

                        // Decrypt Cloudflare obfuscated emails
                        const cfElements = document.querySelectorAll('[data-cfemail]');
                        cfElements.forEach(el => {
                            const hex = el.getAttribute('data-cfemail');
                            if (hex) {
                                try {
                                    let email = '';
                                    const key = parseInt(hex.substr(0, 2), 16);
                                    for (let i = 2; i < hex.length; i += 2) {
                                        email += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ key);
                                    }
                                    if (email && email.includes('@')) {
                                        foundEmails.push(email.trim().toLowerCase());
                                    }
                                } catch (e) {}
                            }
                        });

                        // Decrypt Cloudflare obfuscated email links in href
                        const cfLinks = document.querySelectorAll('a[href*="/cdn-cgi/l/email-protection"]');
                        cfLinks.forEach(a => {
                            const href = a.getAttribute('href') || '';
                            const parts = href.split('#');
                            if (parts.length > 1) {
                                const hex = parts[1];
                                try {
                                    let email = '';
                                    const key = parseInt(hex.substr(0, 2), 16);
                                    for (let i = 2; i < hex.length; i += 2) {
                                        email += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ key);
                                    }
                                    if (email && email.includes('@')) {
                                        foundEmails.push(email.trim().toLowerCase());
                                    }
                                } catch (e) {}
                            }
                        });

                        // Extract from mailto links
                        const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
                        mailtoLinks.forEach(a => {
                            let href = a.getAttribute('href') || '';
                            href = href.replace(/mailto:/i, '').trim();
                            const email = href.split('?')[0].trim();
                            if (email && email.includes('@')) {
                                foundEmails.push(email.toLowerCase());
                            }
                        });

                        const emailMatches = bodyText.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi);
                        if (emailMatches) {
                            emailMatches.forEach(e => {
                                const ext = e.split('.').pop().toLowerCase();
                                if (!['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js'].includes(ext)) {
                                    foundEmails.push(e.trim().toLowerCase());
                                }
                            });
                        }
                        
                        let foundPhones = [];
                        const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
                        telLinks.forEach(a => {
                            const num = a.getAttribute('href').replace('tel:', '').trim();
                            if (num) foundPhones.push(num);
                        });
                        const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
                        const textPhones = bodyText.match(phoneRegex);
                        if (textPhones) {
                            textPhones.forEach(p => foundPhones.push(p.trim()));
                        }
                        
                        const links = Array.from(document.querySelectorAll('a[href]')).map(a => {
                            return { text: a.innerText.toLowerCase(), href: a.href };
                        });
                        
                        return { emails: foundEmails, phones: foundPhones, links, bodyText };
                    });
                };

                let siteData = await extractFromPage(tempPage);
                let collectedEmails = [...siteData.emails];
                let collectedPhones = [...siteData.phones];
                let facebook = 'N/A';
                let instagram = 'N/A';
                let x = 'N/A';
                let physicalAddress = this.extractAddress(siteData.bodyText) || 'N/A';

                for (const l of siteData.links) {
                    if (l.href.includes('facebook.com') && facebook === 'N/A') facebook = l.href;
                    else if (l.href.includes('instagram.com') && instagram === 'N/A') instagram = l.href;
                    else if ((l.href.includes('twitter.com') || l.href.includes('x.com')) && x === 'N/A') x = l.href;
                }

                // Crawl contact/about subpage in Puppeteer fallback
                const contactLink = siteData.links.find(l => {
                    const text = l.text;
                    return text.includes('contact') || text.includes('about') || text.includes('team') || text.includes('reach') || text.includes('info');
                });

                if (contactLink && contactLink.href && contactLink.href !== url && contactLink.href.startsWith('http')) {
                    try {
                        await this.safeNavigate(tempPage, contactLink.href, { timeout: 12000 });
                        await this.randomDelay(500, 1000);
                        const subpageData = await extractFromPage(tempPage);
                        collectedEmails.push(...subpageData.emails);
                        collectedPhones.push(...subpageData.phones);
                        let subpageAddr = this.extractAddress(subpageData.bodyText);
                        if (subpageAddr && physicalAddress === 'N/A') physicalAddress = subpageAddr;

                        for (const l of subpageData.links) {
                            if (l.href.includes('facebook.com') && facebook === 'N/A') facebook = l.href;
                            else if (l.href.includes('instagram.com') && instagram === 'N/A') instagram = l.href;
                            else if ((l.href.includes('twitter.com') || l.href.includes('x.com')) && x === 'N/A') x = l.href;
                        }
                    } catch (subErr) {
                        // Ignore subpage crawl errors
                    }
                }

                return {
                    email: collectedEmails.length > 0 ? [...new Set(collectedEmails)].join(', ') : 'N/A',
                    phone: collectedPhones.length > 0 ? [...new Set(collectedPhones)].join(', ') : 'N/A',
                    facebook,
                    instagram,
                    x,
                    physicalAddress: physicalAddress !== 'N/A' ? this.cleanAddress(physicalAddress) : 'N/A'
                };

            } catch (puppeteerErr) {
                this.log(`Puppeteer browser fallback crawl also failed: ${puppeteerErr.message}`);
                return { email: 'N/A', phone: 'N/A', facebook: 'N/A', instagram: 'N/A', x: 'N/A', physicalAddress: 'N/A' };
            } finally {
                if (tempPage) {
                    await tempPage.close().catch(() => null);
                }
            }
        }
    }

    async safeCloseBrowser(browserInstance, pid) {
        if (!browserInstance) return;
        try {
            const closePromise = browserInstance.close();
            const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 5000));
            await Promise.race([closePromise, timeoutPromise]);
        } catch (e) {}
        if (pid) {
            try {
                process.kill(pid, 'SIGKILL');
            } catch (e) {}
        }
    }

    async close() {
        if (this.browser) {
            this.log('Closing browser...');
            const pid = this.browser.process() ? this.browser.process().pid : null;
            await this.safeCloseBrowser(this.browser, pid);
            this.browser = null;
        }
    }
}

