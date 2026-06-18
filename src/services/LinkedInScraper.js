import BaseScraper from './BaseScraper.js';
import { guessCorporateEmail } from '../utils/patternGuesser.js';
import * as cheerio from 'cheerio';
import { classifyRole } from '../utils/roleClassifier.js';
import Company from '../models/Company.js';
import Lead from '../models/Lead.js';

export default class LinkedInScraper extends BaseScraper {
    constructor(jobId) {
        super(jobId, 'LinkedIn');
    }

    extractCompanySizeFromSnippet(snippet) {
        if (!snippet) return 'N/A';
        const text = snippet.replace(/\s+/g, ' ');
        
        // Pattern 1: Standard "X-Y employees" or "X+ employees"
        const sizeRegex = /\b(\d{1,3}(?:,\d{3})*(?:\s*[-–]\s*\d{1,3}(?:,\d{3})*)?(?:\s*\+)?)\s*(?:employees|people|workers|staff|members|associates)\b/i;
        const match = text.match(sizeRegex);
        if (match && match[1]) {
            return match[1].trim().replace(/[,\s]/g, '').replace('–', '-');
        }
        
        // Pattern 2: "Company size X-Y" or "Company size: X-Y" (LinkedIn meta descriptions)
        const metaRegex = /company\s*size[:\s]+(\d{1,3}(?:,\d{3})*(?:\s*[-–]\s*\d{1,3}(?:,\d{3})*)?(?:\s*\+)?)/i;
        const metaMatch = text.match(metaRegex);
        if (metaMatch && metaMatch[1]) {
            return metaMatch[1].trim().replace(/[,\s]/g, '').replace('–', '-');
        }

        // Pattern 3: "X followers on LinkedIn" with size hint — extract follower count as fallback indicator
        const followerRegex = /\b(\d{1,3}(?:,\d{3})*(?:\+)?)\s*(?:followers|connections)\b/i;
        const followerMatch = text.match(followerRegex);
        if (followerMatch && followerMatch[1]) {
            const count = parseInt(followerMatch[1].replace(/,/g, ''), 10);
            // Rough estimate: followers often correlate to employee count ranges
            if (count <= 50) return '1-10';
            if (count <= 200) return '11-50';
            if (count <= 1000) return '51-200';
            if (count <= 5000) return '201-500';
            if (count <= 10000) return '501-1000';
            if (count <= 50000) return '1001-5000';
            if (count <= 100000) return '5001-10000';
            return '10001+';
        }

        return 'N/A';
    }

    cleanCompanyName(name) {
        if (!name) return '';
        let cleaned = name.trim();
        cleaned = cleaned.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '');
        cleaned = cleaned.split('/')[0];
        cleaned = cleaned.replace(/\.(com|org|net|co\.uk|org\.uk|net\.uk|co|gov|edu|online|io|info|biz|me|us|uk|ca|tech)\b/gi, '');
        cleaned = cleaned.replace(/[-_]+/g, ' ');
        cleaned = cleaned.replace(/\s+/g, ' ');
        return cleaned.trim();
    }

    parseRange(str) {
        if (!str || str === 'N/A') return null;
        const clean = str.replace(/,/g, '');
        const nums = clean.match(/\d+/g);
        if (!nums || nums.length === 0) return null;
        if (clean.includes('+')) {
            return { min: parseInt(nums[0], 10), max: Infinity };
        }
        if (nums.length === 1) {
            return { min: parseInt(nums[0], 10), max: parseInt(nums[0], 10) };
        }
        return { min: parseInt(nums[0], 10), max: parseInt(nums[1], 10) };
    }

    matchesCompanySize(leadsSize, targetSize) {
        if (!targetSize || targetSize === 'all') return true;
        // If company size couldn't be resolved, include the lead rather than dropping it
        if (!leadsSize || leadsSize === 'N/A') return true;
        
        const leadRange = this.parseRange(leadsSize);
        const targetRange = this.parseRange(targetSize);
        
        if (!leadRange || !targetRange) return true;
        
        return leadRange.min <= targetRange.max && leadRange.max >= targetRange.min;
    }

    async runHttpQueue(tasks, workerFn, concurrency = 30) {
        const results = [];
        let index = 0;
        
        const workers = Array.from({ length: Math.min(tasks.length, concurrency) }).map(async (_, workerId) => {
            while (index < tasks.length) {
                const currentIdx = index++;
                const task = tasks[currentIdx];
                if (!task) break;
                try {
                    const res = await workerFn(task, currentIdx, workerId + 1);
                    if (res) results.push(res);
                } catch (err) {
                    // Suppress
                }
            }
        });
        
        await Promise.all(workers);
        return results;
    }

    async harvestProfilesInParallel(query, location, limit, dedupSets = null, seniority = null) {
        const originalLimit = limit + (dedupSets && dedupSets.cachedUrls ? dedupSets.cachedUrls.size : 0);
        this.log(`Enterprise Harvester: Generating parallel search partitions based on original limit of ${originalLimit} (incremental target: ${limit})...`);
        
        const safetyMultiplier = limit > 500 ? 2.5 : 3.0;
        let maxPages = 3;
        if (originalLimit <= 50) {
            maxPages = 3;
        } else if (originalLimit <= 100) {
            maxPages = 4;
        } else if (originalLimit <= 500) {
            maxPages = 5;
        } else {
            maxPages = 6;
        }

        let queryVariations = this.getQueryVariations(query);
        let locationSubdivisions = this.getLocationSubdivisions(location);
        
        // Dynamic scaling of partitions to guarantee sufficient profile yields for large runs
        if (originalLimit <= 10) {
            queryVariations = queryVariations.slice(0, 2);
            locationSubdivisions = locationSubdivisions.slice(0, 1);
        } else if (originalLimit <= 50) {
            queryVariations = queryVariations.slice(0, 6);
            locationSubdivisions = locationSubdivisions.slice(0, 2);
        } else if (originalLimit <= 100) {
            queryVariations = queryVariations.slice(0, 12);
            locationSubdivisions = locationSubdivisions.slice(0, 3);
        } else if (originalLimit <= 500) {
            queryVariations = queryVariations.slice(0, 18);
            locationSubdivisions = locationSubdivisions.slice(0, 5);
        } else if (originalLimit <= 1000) {
            queryVariations = queryVariations.slice(0, 24);
            locationSubdivisions = locationSubdivisions.slice(0, 6);
        } else {
            // Bulk runs (e.g. 2000) scale query & location partitions for massive search variety
            queryVariations = queryVariations.slice(0, 24);
            locationSubdivisions = locationSubdivisions.slice(0, 8);
        }
        
        const partitionTasks = [];
        const mapSeniorityOptionToSearch = (opt) => {
            if (!opt) return '';
            const cleanOpt = opt.toLowerCase().trim();
            if (cleanOpt === 'executive') {
                return ' ("CEO" OR "Founder" OR "President" OR "Owner" OR "Chief" OR "Co-Founder" OR "CFO" OR "CTO" OR "COO" OR "Executive")';
            }
            if (cleanOpt === 'vp_director') {
                return ' ("VP" OR "Vice President" OR "Director" OR "Head")';
            }
            if (cleanOpt === 'manager') {
                return ' ("Manager" OR "Lead" OR "Supervisor")';
            }
            return '';
        };
        const seniorityQuerySuffix = mapSeniorityOptionToSearch(seniority);

        for (const qVar of queryVariations) {
            for (const locSub of locationSubdivisions) {
                let searchQuery = `site:linkedin.com/in "${qVar}"`;
                if (locSub) {
                    searchQuery += ` ${locSub}`;
                }
                if (seniorityQuerySuffix) {
                    searchQuery += seniorityQuerySuffix;
                }
                partitionTasks.push({ queryStr: searchQuery, location: locSub });
            }
        }
        
        this.log(`Generated ${partitionTasks.length} distinct search partitions. Launching parallel browser harvester...`);
        
        const harvestedItems = [];
        const uniqueUrls = new Set();
        
        // Initialize browser if not already done
        if (!this.browser) {
            await this.initBrowser();
        }
        
        // Dynamic scaling of worker concurrency based on target limit
        const concurrency = this.maxWorkers;
        
        // Dynamic scaling of active partitions fetched to ensure we meet the target limit
        let activePartitionsCount = Math.min(partitionTasks.length, Math.ceil(originalLimit / 3) + 5);
        if (seniority && seniority !== 'all') {
            activePartitionsCount = Math.min(partitionTasks.length, Math.ceil(originalLimit / 1.5) + 10);
        }
        await this.runClusterQueue(partitionTasks.slice(0, activePartitionsCount), async (task, workerPage, workerId) => {
            if (harvestedItems.length >= limit * safetyMultiplier) {
                return; // Already harvested sufficient safety margin!
            }
            const engines = ['Yahoo', 'BraveSearch', 'Bing', 'DuckDuckGo'].filter(e => !this.disabledEngines.has(e));
            if (engines.length === 0) engines.push('Yahoo');
            
            // Sequential search engine attempt inside the worker tab
            for (const engine of engines) {
                let pageNum = 1;
                let addedFromEngine = 0;
                
                while (pageNum <= maxPages) {
                    if (harvestedItems.length >= limit * safetyMultiplier) {
                        break;
                    }
                    
                    let url = '';
                    if (engine === 'BraveSearch') {
                        if (pageNum > 1) break; // Brave Search public web UI does not support pagination parameters
                        url = `https://search.brave.com/search?q=${encodeURIComponent(task.queryStr)}`;
                    } else if (engine === 'Bing') {
                        url = `https://www.bing.com/search?q=${encodeURIComponent(task.queryStr)}&first=${(pageNum - 1) * 10 + 1}`;
                    } else if (engine === 'DuckDuckGo') {
                        if (pageNum > 1) break; // DuckDuckGo static HTML does not support page params easily
                        url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(task.queryStr)}`;
                    } else if (engine === 'Yahoo') {
                        url = `https://search.yahoo.com/search?p=${encodeURIComponent(task.queryStr)}&b=${(pageNum - 1) * 10 + 1}`;
                    }
                    
                    try {
                        this.log(`[Worker ${workerId}]: Querying ${engine} Page ${pageNum} for partition: ${task.queryStr}`);
                        await this.safeNavigate(workerPage, url, { timeout: 12000 });
                        await workerPage.waitForFunction(() => {
                            const hasProfiles = Array.from(document.querySelectorAll('a')).some(link => {
                                const decoded = decodeURIComponent(link.href || '');
                                return decoded.includes('linkedin.com/in/') && !decoded.includes('q=');
                            });
                            return hasProfiles ||
                                   document.body.innerText.includes('No results') ||
                                   document.body.innerText.includes('did not match') ||
                                   document.body.innerText.includes('captcha') ||
                                   document.body.innerText.includes('unusual traffic');
                        }, { timeout: 10000 }).catch(() => null);
                        await this.randomDelay(200, 500);
                        
                        const isBlocked = await this.isPageBlocked(workerPage);
                        
                        if (isBlocked) {
                            this.trackEngineFailure(engine, true);
                            break; // Try next engine
                        }
                        
                        const pageResults = await workerPage.evaluate((activeEngine) => {
                            const results = [];
                            const getTargetUrl = (h) => {
                                if (!h) return '';
                                const dec = decodeURIComponent(h);
                                if (dec.includes('uddg=')) {
                                    const m = dec.match(/[?&]uddg=([^&]+)/);
                                    if (m && m[1]) return decodeURIComponent(m[1]);
                                }
                                if (dec.includes('u=')) {
                                    const m = dec.match(/[?&]u=([^&]+)/);
                                    if (m && m[1]) return decodeURIComponent(m[1]);
                                }
                                if (dec.includes('/RU=')) {
                                    const m = dec.match(/\/RU=([^/]+)/);
                                    if (m && m[1]) return decodeURIComponent(m[1]);
                                }
                                return dec;
                            };

                            const isValidName = (n) => {
                                if (!n || n === 'N/A') return false;
                                const lower = n.toLowerCase().trim();
                                const junkTerms = [
                                    'professional', 'professional profile', 'linkedin member', 'linkedin', 
                                    'google', 'bing', 'yahoo', 'duckduckgo', 'images', 'search', 'find', 
                                    'all', 'any', 'about', 'member', 'profile', 'directory', 'business', 
                                    'dentist', 'dentists', 'plumber', 'plumbers', 'attorney', 'attorneys', 
                                    'lawyer', 'lawyers', 'real estate', 'realtor', 'services', 'expert', 
                                    'specialist', 'clinic', 'office', 'medical', 'dental', 'care'
                                ];
                                if (junkTerms.includes(lower)) return false;
                                if (lower.startsWith('professional') || lower.startsWith('linkedin') || lower.startsWith('google') || lower.startsWith('search')) return false;
                                if (lower.includes('site:linkedin.com') || lower.includes('linkedin.com')) return false;
                                if (lower.length > 50 || lower.length < 2) return false;
                                return true;
                            };

                            const links = Array.from(document.querySelectorAll('a'));
                            links.forEach(a => {
                                const href = a.href;
                                const targetUrl = getTargetUrl(href);
                                const hostAndPath = targetUrl.split('?')[0].split('#')[0];
                                if (!hostAndPath.includes('linkedin.com/in/')) return;
                                
                                const fullTitle = a.innerText.trim() || '';
                                const lines = fullTitle.split('\n').map(l => l.trim()).filter(Boolean);
                                const lastLine = lines[lines.length - 1] || '';
                                if (lastLine.toLowerCase().includes('linkedin.com') || lastLine === '') return;
                                
                                let cleanTitle = lastLine.replace(/\| LinkedIn/gi, '').replace(/- LinkedIn/gi, '').trim();
                                const parts = cleanTitle.split(/\s*[-|·•]\s*/);
                                const name = parts[0] ? parts[0].trim() : 'N/A';
                                const title = parts.slice(1).join(' - ').trim() || 'N/A';
                                
                                const parent = a.closest('.search-result, .result, div[data-testid="result"], .snippet, .b_algo, .web-result, .algo, .dd.algo') || a.parentElement?.parentElement;
                                const snippetEl = parent ? parent.querySelector('.snippet, p, .snippet-description, .b_caption, .b_snippet, .result__snippet, .compText') : null;
                                const snippet = snippetEl ? snippetEl.innerText.trim() : '';
                                
                                let email = 'N/A';
                                const emailMatch = snippet.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
                                if (emailMatch) email = emailMatch[0];
                                
                                let phone = 'N/A';
                                const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
                                const phoneMatch = snippet.match(phoneRegex);
                                if (phoneMatch) phone = phoneMatch[0];
                                
                                let location = 'N/A';
                                const locMatch = snippet.match(/(?:Location|Loc):\s*([^·•\n]*?)(?:\s*·|\s*$)/i) || snippet.match(/^([^·•\n]*?)\s*·\s*/);
                                if (locMatch) location = locMatch[1].trim();
                                
                                if (name && href && name !== 'N/A' && isValidName(name)) {
                                    results.push({ name, url: targetUrl, title, location, email, phone });
                                }
                            });
                            return results;
                        }, engine);
                        
                        if (pageResults && pageResults.length > 0) {
                            this.trackEngineSuccess(engine);
                            let addedThisPage = 0;
                            for (const item of pageResults) {
                                let finalUrl = item.url;
                                if (finalUrl.includes('uddg=')) {
                                    const match = finalUrl.match(/[?&]uddg=([^&]+)/);
                                    if (match && match[1]) {
                                        finalUrl = decodeURIComponent(match[1]);
                                    }
                                }
                                finalUrl = finalUrl.split('&')[0].split('?')[0].split('#')[0];
                                if (!finalUrl.includes('linkedin.com/in/')) continue;
                                
                                const canonUrl = this.normalizeUrl(finalUrl);
                                if (uniqueUrls.has(canonUrl)) continue;
                                
                                if (dedupSets && dedupSets.cachedUrls && dedupSets.cachedUrls.has(canonUrl)) {
                                    continue; // Skip active cache leads completely!
                                }

                                let isDbHit = false;
                                if (dedupSets && dedupSets.dedupUrls && dedupSets.dedupUrls.has(canonUrl)) {
                                    isDbHit = true;
                                } else if (this.isDuplicate(item.name, finalUrl, 'N/A', dedupSets)) {
                                    continue; // Skip duplicate LinkedIn profile
                                }

                                // On-the-fly seniority filtering in Node.js context
                                if (seniority && seniority !== 'all') {
                                    const classification = classifyRole(item.title);
                                    const mapSeniorityOptionToDb = (opt) => {
                                        const cleanOpt = opt.toLowerCase().trim();
                                        if (cleanOpt === 'executive') return 'C-Suite / Executive';
                                        if (cleanOpt === 'vp_director') return 'VP / Director';
                                        if (cleanOpt === 'manager') return 'Manager / Lead';
                                        return null;
                                    };
                                    const targetDbSeniority = mapSeniorityOptionToDb(seniority);
                                    if (targetDbSeniority && classification.seniority !== targetDbSeniority) {
                                        continue; // Skip profile if it doesn't match requested seniority
                                    }
                                }

                                uniqueUrls.add(canonUrl);
                                
                                harvestedItems.push({
                                    name: item.name,
                                    url: finalUrl,
                                    title: item.title,
                                    location: item.location !== 'N/A' ? item.location : task.location || 'N/A',
                                    email: item.email,
                                    phone: item.phone,
                                    isDbHit
                                });
                                addedThisPage++;
                            }
                            
                            const harvestPct = Math.round((harvestedItems.length / (limit * safetyMultiplier)) * 40);
                            this.setProgress(0, harvestPct, 'Harvesting LinkedIn profiles...');
                            this.log(`[Worker ${workerId}]: Scraped ${addedThisPage} unique profiles from ${engine} Page ${pageNum} for partition: ${task.queryStr}`);
                            addedFromEngine += addedThisPage;
                            
                            // If we didn't add any new profiles from this page, it might mean the remaining pages are also duplicate/empty.
                            // We can still try next pages, but let's break if the page had 0 results matching at all.
                        } else {
                            break; // No results on this page, stop paging this engine
                        }
                    } catch (navErr) {
                        this.log(`[Worker ${workerId}]: Harvester error for ${engine} Page ${pageNum}: ${navErr.message}`);
                        this.trackEngineFailure(engine, true);
                        break; // Try next engine
                    }
                    pageNum++;
                }
                
                if (addedFromEngine > 0) {
                    // Count partition as success if we added profiles
                }
            }
        }, concurrency, () => harvestedItems.length >= limit * safetyMultiplier);
        
        this.log(`Enterprise Harvester Completed: Successfully harvested ${harvestedItems.length} unique profiles in parallel.`);
        return harvestedItems;
    }

    async scrape(query, location, limit = 100, dedupSets = null, seniority = null, companySize = null) {
        this.limit = limit;
        const results = [];
        const uniqueUrls = new Set();
        
        try {
            // 1. Initialize browser first so that the parallel harvester has worker access!
            await this.initBrowser();
            
            // 2. Harvest all LinkedIn profiles first in parallel!
            const harvestedProfiles = await this.harvestProfilesInParallel(query, location, limit, dedupSets, seniority);
            let allProfiles = [...harvestedProfiles];
            
            // Populate uniqueUrls set with harvested profiles to prevent duplicates
            for (const p of harvestedProfiles) {
                uniqueUrls.add(p.url);
            }
              // Failsafe: if harvester yielded less than the limit, run a quick browser search
            if (allProfiles.length < limit) {
                this.log(`Enterprise Harvester yielded ${allProfiles.length}/${limit} profiles. Initializing browser failsafe harvester...`);
                const q = query;
                const loc = location;
                const mapSeniorityOptionToSearch = (opt) => {
                    if (!opt) return '';
                    const cleanOpt = opt.toLowerCase().trim();
                    if (cleanOpt === 'executive') {
                        return ' ("CEO" OR "Founder" OR "President" OR "Owner" OR "Chief" OR "Co-Founder" OR "CFO" OR "CTO" OR "COO" OR "Executive")';
                    }
                    if (cleanOpt === 'vp_director') {
                        return ' ("VP" OR "Vice President" OR "Director" OR "Head")';
                    }
                    if (cleanOpt === 'manager') {
                        return ' ("Manager" OR "Lead" OR "Supervisor")';
                    }
                    return '';
                };
                const seniorityQuerySuffix = mapSeniorityOptionToSearch(seniority);
                let searchQuery = `site:linkedin.com/in "${q}" ${loc}`;
                if (seniorityQuerySuffix) {
                    searchQuery += seniorityQuerySuffix;
                }
                
                const originalLimit = limit + (dedupSets && dedupSets.cachedUrls ? dedupSets.cachedUrls.size : 0);
                const safetyMultiplier = limit > 500 ? 2.5 : 3.0;
                const engines = ['Yahoo', 'BraveSearch', 'Bing', 'DuckDuckGo'].filter(e => !this.disabledEngines.has(e));
                if (engines.length === 0) engines.push('Yahoo');
                
                let maxPages = 2;
                if (originalLimit <= 50) {
                    maxPages = 2;
                } else if (originalLimit <= 100) {
                    maxPages = 3;
                } else if (originalLimit <= 500) {
                    maxPages = 4;
                } else {
                    maxPages = 6;
                }
                
                engineLoop:
                for (const engine of engines) {
                    if (allProfiles.length >= limit * safetyMultiplier) break;
                    
                    let pageNum = 1;
                    while (pageNum <= maxPages && allProfiles.length < limit * safetyMultiplier) {
                        let url = '';
                        if (engine === 'BraveSearch') {
                            if (pageNum > 1) break; // Brave Search public web UI does not support pagination parameters
                            url = `https://search.brave.com/search?q=${encodeURIComponent(searchQuery)}`;
                        } else if (engine === 'Bing') {
                            url = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}&first=${(pageNum - 1) * 10 + 1}`;
                        } else if (engine === 'DuckDuckGo') {
                            if (pageNum > 1) break; // DuckDuckGo static HTML does not support page params easily
                            url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
                        } else if (engine === 'Yahoo') {
                            url = `https://search.yahoo.com/search?p=${encodeURIComponent(searchQuery)}&b=${(pageNum - 1) * 10 + 1}`;
                        }
                        
                        try {
                            this.log(`Failsafe Harvester: Querying ${engine} Page ${pageNum}...`);
                            await this.safeNavigate(this.page, url, { timeout: 12000 });
                            await this.page.waitForFunction(() => {
                                return Array.from(document.querySelectorAll('a')).some(link => {
                                    const decoded = decodeURIComponent(link.href || '');
                                    return decoded.includes('linkedin.com/in/') && !decoded.includes('q=');
                                }) ||
                                       document.body.innerText.includes('No results') ||
                                       document.body.innerText.includes('did not match') ||
                                       document.body.innerText.includes('captcha') ||
                                       document.body.innerText.includes('unusual traffic');
                            }, { timeout: 10000 }).catch(() => null);
                            await this.randomDelay(200, 500);
                            
                            const isBlocked = await this.isPageBlocked(this.page);
                            if (isBlocked) {
                                this.trackEngineFailure(engine, true);
                                break; // Try next engine
                            }
                            
                            const pageResults = await this.page.evaluate(() => {
                                const results = [];
                                const getTargetUrl = (h) => {
                                    if (!h) return '';
                                    const dec = decodeURIComponent(h);
                                    if (dec.includes('uddg=')) {
                                        const m = dec.match(/[?&]uddg=([^&]+)/);
                                        if (m && m[1]) return decodeURIComponent(m[1]);
                                    }
                                    if (dec.includes('u=')) {
                                        const m = dec.match(/[?&]u=([^&]+)/);
                                        if (m && m[1]) return decodeURIComponent(m[1]);
                                    }
                                    if (dec.includes('/RU=')) {
                                        const m = dec.match(/\/RU=([^/]+)/);
                                        if (m && m[1]) return decodeURIComponent(m[1]);
                                    }
                                    return dec;
                                };

                                const isValidName = (n) => {
                                    if (!n || n === 'N/A') return false;
                                    const lower = n.toLowerCase().trim();
                                    const junkTerms = [
                                        'professional', 'professional profile', 'linkedin member', 'linkedin', 
                                        'google', 'bing', 'yahoo', 'duckduckgo', 'images', 'search', 'find', 
                                        'all', 'any', 'about', 'member', 'profile', 'directory', 'business', 
                                        'dentist', 'dentists', 'plumber', 'plumbers', 'attorney', 'attorneys', 
                                        'lawyer', 'lawyers', 'real estate', 'realtor', 'services', 'expert', 
                                        'specialist', 'clinic', 'office', 'medical', 'dental', 'care'
                                    ];
                                    if (junkTerms.includes(lower)) return false;
                                    if (lower.startsWith('professional') || lower.startsWith('linkedin') || lower.startsWith('google') || lower.startsWith('search')) return false;
                                    if (lower.includes('site:linkedin.com') || lower.includes('linkedin.com')) return false;
                                    if (lower.length > 50 || lower.length < 2) return false;
                                    return true;
                                };

                                const items = Array.from(document.querySelectorAll('.search-result, .result, div[data-testid="result"], .snippet, .algo, .dd.algo, .b_algo'));
                                items.forEach(item => {
                                    const titleLink = item.querySelector('.compTitle a, a');
                                    if (!titleLink) return;
                                    const href = titleLink.href;
                                    
                                    const targetUrl = getTargetUrl(href);
                                    const hostAndPath = targetUrl.split('?')[0].split('#')[0];
                                    if (!hostAndPath.includes('linkedin.com/in/')) return;
                                    
                                    const titleEl = item.querySelector('h3, h2 a, a');
                                    const fullTitle = titleEl ? titleEl.innerText.trim() : titleLink.innerText.trim();
                                    const lines = fullTitle.split('\n').map(l => l.trim()).filter(Boolean);
                                    const lastLine = lines[lines.length - 1] || '';
                                    if (lastLine.toLowerCase().includes('linkedin.com') || lastLine === '') return;
                                    
                                    let cleanTitle = lastLine.replace(/\| LinkedIn/gi, '').replace(/- LinkedIn/gi, '').trim();
                                    const parts = cleanTitle.split(/\s*[-|·•]\s*/);
                                    const name = parts[0] ? parts[0].trim() : 'N/A';
                                    const title = parts.slice(1).join(' - ').trim() || 'N/A';
                                    
                                    const parent = item.closest('.search-result, .result, div[data-testid="result"], .snippet, .algo, .dd.algo, .b_algo') || item.parentElement?.parentElement;
                                    const snippetEl = parent ? parent.querySelector('.snippet, p, .snippet-description, .compText, .b_caption') : null;
                                    const snippet = snippetEl ? snippetEl.innerText.trim() : '';
                                    
                                    let email = 'N/A';
                                    const emailMatch = snippet.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
                                    if (emailMatch) email = emailMatch[0];
                                    
                                    let phone = 'N/A';
                                    const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
                                    const phoneMatch = snippet.match(phoneRegex);
                                    if (phoneMatch) phone = phoneMatch[0];
                                    
                                    let location = 'N/A';
                                    const locMatch = snippet.match(/(?:Location|Loc):\s*([^·•\n]*?)(?:\s*·|\s*$)/i) || snippet.match(/^([^·•\n]*?)\s*·\s*/);
                                    if (locMatch) location = locMatch[1].trim();
                                    
                                    if (name && href && name !== 'N/A' && isValidName(name)) {
                                        results.push({ name, url: targetUrl, title, location, email, phone });
                                    }
                                });
                                return results;
                            });
                            
                            if (pageResults && pageResults.length > 0) {
                                this.trackEngineSuccess(engine);
                                let addedThisPage = 0;
                                for (const pr of pageResults) {
                                    let finalUrl = pr.url.split('&')[0].split('?')[0].split('#')[0];
                                    const canonUrl = this.normalizeUrl(finalUrl);
                                    if (uniqueUrls.has(canonUrl)) continue;
                                    
                                    if (dedupSets && dedupSets.cachedUrls && dedupSets.cachedUrls.has(canonUrl)) {
                                        continue; // Skip active cache leads completely!
                                    }

                                    let isDbHit = false;
                                    if (dedupSets && dedupSets.dedupUrls && dedupSets.dedupUrls.has(canonUrl)) {
                                        isDbHit = true;
                                    } else if (this.isDuplicate(pr.name, finalUrl, 'N/A', dedupSets)) {
                                        continue; // Skip duplicate LinkedIn profile
                                    }

                                    // On-the-fly seniority filtering in Node.js context
                                    if (seniority && seniority !== 'all') {
                                        const classification = classifyRole(pr.title);
                                        const mapSeniorityOptionToDb = (opt) => {
                                            const cleanOpt = opt.toLowerCase().trim();
                                            if (cleanOpt === 'executive') return 'C-Suite / Executive';
                                            if (cleanOpt === 'vp_director') return 'VP / Director';
                                            if (cleanOpt === 'manager') return 'Manager / Lead';
                                            return null;
                                        };
                                        const targetDbSeniority = mapSeniorityOptionToDb(seniority);
                                        if (targetDbSeniority && classification.seniority !== targetDbSeniority) {
                                            continue; // Skip profile if it doesn't match requested seniority
                                        }
                                    }

                                    uniqueUrls.add(canonUrl);
                                    allProfiles.push({
                                        name: pr.name,
                                        url: finalUrl,
                                        title: pr.title,
                                        location: pr.location !== 'N/A' ? pr.location : loc,
                                        email: pr.email,
                                        phone: pr.phone,
                                        isDbHit
                                    });
                                    addedThisPage++;
                                }
                                 const harvestPct = Math.round((allProfiles.length / (limit * safetyMultiplier)) * 40);
                                 this.setProgress(0, harvestPct, 'Harvesting profiles (failsafe)...');
                                this.log(`Failsafe Harvester: Scraped ${addedThisPage} profiles from ${engine} Page ${pageNum}.`);
                                if (addedThisPage === 0) {
                                    break; // Try next engine
                                }
                            } else {
                                break; // Try next engine
                            }
                        } catch (e) {
                            this.log(`Failsafe harvester page ${pageNum} failed for ${engine}: ${e.message}`);
                            this.trackEngineFailure(engine, true);
                            break; // Try next engine
                        }
                        pageNum++;
                    }
                }
            }

            // Slice down to buffer target (limit * safetyMultiplier) to process in concurrency pool
            const safetyMultiplier = limit > 500 ? 2.5 : 3.5;
            const safetyLimit = Math.min(allProfiles.length, Math.ceil(limit * safetyMultiplier));
            const profilesToProcess = allProfiles.slice(0, safetyLimit);

            const dbHitProfiles = [];
            const newProfilesToProcess = [];

            for (const profile of profilesToProcess) {
                if (profile.isDbHit) {
                    dbHitProfiles.push(profile);
                } else {
                    newProfilesToProcess.push(profile);
                }
            }

            // Process database hits instantly
            if (dbHitProfiles.length > 0) {
                this.log(`Instantly resolving ${dbHitProfiles.length} matching leads already present in database...`);
                for (const p of dbHitProfiles) {
                    if (results.length >= limit) break;
                    try {
                        const canonUrl = this.normalizeUrl(p.url);
                        const existingLead = await Lead.findOne({
                            $or: [
                                { profileUrl: p.url },
                                { profileUrl: canonUrl }
                            ]
                        }).exec();
                        if (existingLead) {
                            const leadObj = existingLead.toObject();
                            const leadCompanySize = leadObj.companySize || 'N/A';
                            if (companySize && companySize !== 'all') {
                                if (leadCompanySize && leadCompanySize !== 'N/A' && !this.matchesCompanySize(leadCompanySize, companySize)) {
                                    this.log(`Skipping cached lead "${leadObj.name}" due to company size mismatch ("${leadCompanySize}" vs target "${companySize}")`);
                                    continue;
                                }
                                if (leadCompanySize === 'N/A') {
                                    this.log(`Including cached lead "${leadObj.name}" with unresolved company size`);
                                }
                            }

                            results.push({
                                name: leadObj.name,
                                profileUrl: leadObj.profileUrl,
                                title: leadObj.title || 'N/A',
                                seniority: leadObj.seniority || 'Individual Contributor',
                                department: leadObj.department || 'Operations',
                                location: leadObj.location || 'N/A',
                                email: leadObj.email || 'N/A',
                                phone: leadObj.phone || 'N/A',
                                website: leadObj.website || 'N/A',
                                companySize: leadCompanySize,
                                isResolved: true // Flag to skip re-validation in api.js
                            });

                            // Update queries in DB
                            if (query) {
                                let cleanQ = query.toLowerCase().trim();
                                if (cleanQ.endsWith('s') && cleanQ.length > 3) {
                                    if (cleanQ.endsWith('ies')) {
                                        cleanQ = cleanQ.slice(0, -3) + 'y';
                                    } else {
                                        cleanQ = cleanQ.slice(0, -1);
                                    }
                                }
                                await Lead.updateOne({ _id: existingLead._id }, { $addToSet: { queries: cleanQ } });
                            }
                        }
                    } catch (dbErr) {
                        this.log(`Failed to resolve existing lead ${p.url} from DB: ${dbErr.message}`);
                    }
                    const resolvePct = 40 + Math.round((results.length / limit) * 5);
                    this.setProgress(results.length, resolvePct, 'Resolving cached leads...');
                }
            }

            this.log(`Database resolution complete. Results count so far: ${results.length}/${limit}.`);

            if (results.length >= limit) {
                this.log(`Target limit of ${limit} reached via database resolution. Skipping enrichment pipelines.`);
                return results.slice(0, limit);
            }
            
            this.log(`High-Concurrency Enrichment Pipeline: Processing ${newProfilesToProcess.length} leads in parallel...`);
            
            const failedItems = [];
            
            // 3. High-Speed pure HTTP enrichment queue (concurrency = 30 workers, instant!)
            await this.runHttpQueue(newProfilesToProcess, async (item, itemIdx) => {
                if (results.length >= limit) return;
                
                try {
                    // Hunt website & crawled details in HTTP-only mode (huntPage = null, isHttpOnly = true)
                    const deepDetails = await this.huntForContactDetails(item.name, item.title, item.location, null, true);
                    
                    if (deepDetails.website === 'N/A') {
                        throw new Error('No website found in HTTP-only mode. Requires browser fallback.');
                    }

                    if (this.isDuplicate(item.name, item.url, deepDetails.website, dedupSets)) {
                        this.log(`Skipping duplicate lead enriched via HTTP: "${item.name}"`);
                        return;
                    }
                    
                    let personalEmails = [];
                    let businessEmails = [];
                    let personalPhones = [];
                    let businessPhones = [];
                    
                    if (item.phone && item.phone !== 'N/A') {
                        const formatted = this.formatPhone(item.phone);
                        if (formatted && formatted !== 'N/A') personalPhones.push(formatted);
                    }
                    if (item.email && item.email !== 'N/A') {
                        if (this.isPersonalEmail(item.email)) personalEmails.push(item.email);
                        else businessEmails.push(item.email);
                    }
                    
                    if (deepDetails.personalEmail !== 'N/A') {
                        deepDetails.personalEmail.split(', ').forEach(e => personalEmails.push(e));
                    }
                    if (deepDetails.businessEmail !== 'N/A') {
                        deepDetails.businessEmail.split(', ').forEach(e => businessEmails.push(e));
                    }
                    if (deepDetails.personalPhone !== 'N/A') {
                        deepDetails.personalPhone.split(', ').forEach(p => personalPhones.push(p));
                    }
                    if (deepDetails.businessPhone !== 'N/A') {
                        deepDetails.businessPhone.split(', ').forEach(p => businessPhones.push(p));
                    }
                    
                    let cleanLoc = 'N/A';
                    if (deepDetails.physicalAddress && deepDetails.physicalAddress !== 'N/A') {
                        cleanLoc = this.cleanAddress(deepDetails.physicalAddress);
                    }
                    if (cleanLoc === 'N/A') {
                        cleanLoc = this.cleanLocation(item.location || 'N/A', item.location || 'N/A');
                    }
                    
                    let resolvedCompanySize = deepDetails.companySize || 'N/A';
                    if (companySize && companySize !== 'all') {
                        if (resolvedCompanySize && resolvedCompanySize !== 'N/A' && !this.matchesCompanySize(resolvedCompanySize, companySize)) {
                            this.log(`Skipping lead "${item.name}" enriched via HTTP due to company size mismatch ("${resolvedCompanySize}" vs target "${companySize}")`);
                            return;
                        }
                        if (resolvedCompanySize === 'N/A') {
                            this.log(`Including lead "${item.name}" with unresolved company size (HTTP enrichment)`);
                        }
                    }
                    
                    const allEmails = [...new Set([...personalEmails, ...businessEmails])];
                    const allPhones = [...new Set([...personalPhones, ...businessPhones])];
                    
                    const classification = classifyRole(item.title);
                    results.push({
                        name: item.name,
                        profileUrl: item.url,
                        title: item.title,
                        seniority: classification.seniority,
                        department: classification.department,
                        location: cleanLoc,
                        email: allEmails.length > 0 ? allEmails.join(', ') : 'N/A',
                        phone: allPhones.length > 0 ? allPhones.join(', ') : 'N/A',
                        website: deepDetails.website,
                        companySize: resolvedCompanySize
                    });
                    const httpPct = 45 + Math.round((results.length / limit) * 40);
                    this.setProgress(results.length, httpPct, 'Enriching contacts (high-speed)...');
                } catch (err) {
                    // Fallback to failed items queue
                    failedItems.push(item);
                }
            }, 30);
            
            const pctCompleted = Math.round((results.length / limit) * 100);
            this.log(`HTTP enrichment complete. Gathered ${results.length}/${limit} entries (${pctCompleted}%).`);

            // 4. Browser fallback cluster queue (concurrency = 6 browser tabs)
            // Engage only if we haven't reached the limit from the high-speed HTTP runs!
            if (results.length < limit && failedItems.length > 0) {
                this.log(`[Browser Failsafe Fallback]: HTTP enrichment under target. Spawning 6 browser workers to process ${failedItems.length} failed items...`);
                
                const remainingLimit = limit - results.length;
                const fallbackTasks = failedItems.slice(0, remainingLimit * 3.5);
                
                await this.runClusterQueue(fallbackTasks, async (item, workerPage, workerId) => {
                    if (results.length >= limit) return;
                    
                    try {
                        const deepDetails = await this.huntForContactDetails(item.name, item.title, item.location, workerPage, false);
                        
                        if (this.isDuplicate(item.name, item.url, deepDetails.website, dedupSets)) {
                            this.log(`Skipping duplicate lead enriched via Browser: "${item.name}"`);
                            return;
                        }
                        
                        let personalEmails = [];
                        let businessEmails = [];
                        let personalPhones = [];
                        let businessPhones = [];
                        
                        if (item.phone && item.phone !== 'N/A') {
                            const formatted = this.formatPhone(item.phone);
                            if (formatted && formatted !== 'N/A') personalPhones.push(formatted);
                        }
                        if (item.email && item.email !== 'N/A') {
                            if (this.isPersonalEmail(item.email)) personalEmails.push(item.email);
                            else businessEmails.push(item.email);
                        }
                        
                        if (deepDetails.personalEmail !== 'N/A') {
                            deepDetails.personalEmail.split(', ').forEach(e => personalEmails.push(e));
                        }
                        if (deepDetails.businessEmail !== 'N/A') {
                            deepDetails.businessEmail.split(', ').forEach(e => businessEmails.push(e));
                        }
                        if (deepDetails.personalPhone !== 'N/A') {
                            deepDetails.personalPhone.split(', ').forEach(p => personalPhones.push(p));
                        }
                        if (deepDetails.businessPhone !== 'N/A') {
                            deepDetails.businessPhone.split(', ').forEach(p => businessPhones.push(p));
                        }
                        
                        let cleanLoc = 'N/A';
                        if (deepDetails.physicalAddress && deepDetails.physicalAddress !== 'N/A') {
                            cleanLoc = this.cleanAddress(deepDetails.physicalAddress);
                        }
                        if (cleanLoc === 'N/A') {
                            cleanLoc = this.cleanLocation(item.location || 'N/A', item.location || 'N/A');
                        }
                        
                        let resolvedCompanySize = deepDetails.companySize || 'N/A';
                        if (companySize && companySize !== 'all') {
                            if (resolvedCompanySize && resolvedCompanySize !== 'N/A' && !this.matchesCompanySize(resolvedCompanySize, companySize)) {
                                this.log(`Skipping lead "${item.name}" enriched via Browser due to company size mismatch ("${resolvedCompanySize}" vs target "${companySize}")`);
                                return;
                            }
                            if (resolvedCompanySize === 'N/A') {
                                this.log(`Including lead "${item.name}" with unresolved company size (Browser enrichment)`);
                            }
                        }
                        
                        const allEmails = [...new Set([...personalEmails, ...businessEmails])];
                        const allPhones = [...new Set([...personalPhones, ...businessPhones])];
                        
                        const classification = classifyRole(item.title);
                        const resultObj = {
                            name: item.name,
                            profileUrl: item.url,
                            title: item.title,
                            seniority: classification.seniority,
                            department: classification.department,
                            location: cleanLoc,
                            email: allEmails.length > 0 ? allEmails.join(', ') : 'N/A',
                            phone: allPhones.length > 0 ? allPhones.join(', ') : 'N/A',
                            website: deepDetails.website,
                            companySize: resolvedCompanySize
                        };
                        results.push(resultObj);
                        const browserPct = 85 + Math.round((results.length / limit) * 10);
                        this.setProgress(results.length, browserPct, 'Enriching contacts (browser)...');
                        return resultObj;
                    } catch (fallbackErr) {
                        this.log(`[Fallback Worker Error]: ${fallbackErr.message}\n${fallbackErr.stack}`);
                    }
                }, 6, () => results.length >= limit);
            }

            this.log(`Finished Enterprise LinkedIn scraping session. Total profiles extracted: ${results.length}`);
            return results.slice(0, limit);
            
        } catch (error) {
            this.log(`Error during LinkedIn scraping session: ${error.message}`);
            throw error;
        } finally {
            await this.close();
        }
    }

    async huntForContactDetails(name, title, location, huntPage = null, isHttpOnly = false) {
        this.log(`Deep Hunting business website & contacts for "${name}" ("${title}")...`);
        
        let personalEmails = [];
        let businessEmails = [];
        let personalPhones = [];
        let businessPhones = [];
        
        let physicalAddress = 'N/A';
        let website = 'N/A';
        let facebook = 'N/A';
        let instagram = 'N/A';
        let x = 'N/A';
        let foundCompanySize = 'N/A';
        
        let shouldClosePage = false;

        try {
            if (!huntPage && !isHttpOnly) {
                huntPage = await this.browser.newPage();
                await this.setupPage(huntPage);
                await this.optimizePage(huntPage);
                await huntPage.setViewport({ width: 1280 + Math.floor(Math.random() * 200), height: 800 + Math.floor(Math.random() * 150) });
                shouldClosePage = true;
            }
            
            if (huntPage) {
                await huntPage.setViewport({ width: 1280 + Math.floor(Math.random() * 200), height: 800 + Math.floor(Math.random() * 150) });
            }

            // Clean helper for redirect URLs
            const cleanUrl = (rawUrl) => {
                if (!rawUrl) return null;
                let url = rawUrl;
                if (url.includes('uddg=')) {
                    const match = url.match(/[?&]uddg=([^&]+)/);
                    if (match && match[1]) {
                        url = decodeURIComponent(match[1]);
                    }
                }
                return url;
            };

            const cleanLoc = location.replace(/,?\s*[A-Z]{2}$/i, '').trim();
            
            // Senior Software Engineer Upgrade: Extract company/employer name from the LinkedIn title
            let company = null;
            if (title && title !== 'N/A') {
                const atMatch = title.match(/(?:^|.*\s)at\s+([^·|,-]+)/i);
                if (atMatch && atMatch[1]) {
                    company = atMatch[1].trim();
                } else {
                    const atSignMatch = title.match(/(?:^|.*\s)@\s+([^·|,-]+)/i);
                    if (atSignMatch && atSignMatch[1]) {
                        company = atSignMatch[1].trim();
                    } else {
                        const commaMatch = title.split(',');
                        if (commaMatch.length > 1) {
                            const lastPart = commaMatch[commaMatch.length - 1].trim();
                            if (lastPart.length > 3 && !/New York|NY|California|CA|Chicago|United States/i.test(lastPart)) {
                                company = lastPart;
                            }
                        }
                    }
                }
            }

            if (!company && title && title !== 'N/A') {
                // Split by common title/company delimiters: dash, vertical bar, bullet
                const parts = title.split(/\s*[-|·•]\s*/);
                if (parts.length > 1) {
                    const lastPart = parts[parts.length - 1].trim();
                    // Reject generic locations or "LinkedIn"
                    if (lastPart.length > 2 && !/linkedin/i.test(lastPart) && !/usa/i.test(lastPart) && !/united states/i.test(lastPart)) {
                        company = lastPart;
                    }
                }
            }

            if (company) {
                // Split by slashes, pipes, or generic separators and take the first part
                company = company.split(/[|/]/)[0].trim();
                // Strip special characters like double quotes, brackets, or dots
                company = company.replace(/["'().]/g, '').trim();
                
                // Exclude generic company terms
                const genericCompanies = /^(self[- ]employed|freelance|freelancer|independent contractor|retiree|consultant|n\/a|unknown|student|unemployed)$/i;
                if (genericCompanies.test(company)) {
                    company = null;
                }
            }

            if (company) {
                company = this.cleanCompanyName(company);
            }

            // Multi-step query definitions for deep hunting
            const queriesToTry = [];
            let foundWebsite = null;

            // Direct Domain check: if the title itself contains a domain name (e.g. smilesny.com)
            if (title && title !== 'N/A') {
                const domainMatch = title.match(/\b([a-zA-Z0-9-]+\.[a-zA-Z]{2,6})\b/);
                if (domainMatch && domainMatch[1]) {
                    const domain = domainMatch[1];
                    const isGenericDomain = /linkedin\.com|gmail\.com|yahoo\.com|outlook\.com/i.test(domain);
                    if (!isGenericDomain) {
                        foundWebsite = `https://${domain}`;
                        this.log(`[Deep Hunt - Title Direct Domain Match]: Instantly found domain "${domain}" in title "${title}"`);
                    }
                }
            }
            
            if (company && company.length > 2) {
                queriesToTry.push({
                    type: 'Person + Company + Location',
                    query: `"${name}" "${company}" ${cleanLoc}`
                });
                queriesToTry.push({
                    type: 'Person + Company',
                    query: `"${name}" "${company}"`
                });
                queriesToTry.push({
                    type: 'Company + Location',
                    query: `"${company}" ${cleanLoc}`
                });
                queriesToTry.push({
                    type: 'Company Only',
                    query: `"${company}"`
                });
            }

            // Always add person-based fallback queries to guarantee we search for their business website
            queriesToTry.push({
                type: 'Person + Location',
                query: `"${name}" ${cleanLoc}`
            });
            queriesToTry.push({
                type: 'Person + Title + Location',
                query: `"${name}" "${title.split(/[|/,-]/)[0].trim()}" ${cleanLoc}`
            });

            let searchResults = [];
            let engineUsed = 'DuckDuckGo';

            foundCompanySize = 'N/A';

            // Check company cache first to avoid redundant search engine queries!
            if (company && company.length > 2) {
                const companyKey = company.toLowerCase().trim();
                try {
                    const cachedCompany = await Company.findOne({ name: companyKey }).exec();
                    if (cachedCompany) {
                        foundWebsite = cachedCompany.website;
                        foundCompanySize = cachedCompany.companySize || 'N/A';
                        this.log(`[Deep Hunt - MongoDB Hit]: Instantly found cached website/size for company "${company}": ${foundWebsite} [Size: ${foundCompanySize}]`);
                    }
                } catch (dbErr) {
                    this.log(`Failed to query Company cache in MongoDB: ${dbErr.message}`);
                }
            }

            // Sequential search engine executor helper
            const executeSearchQuery = async (queryStr) => {
                let results = [];
                
                // 1. Raw HTTP Fetch from DuckDuckGo HTML (Instant! <200ms)
                if (!this.disabledEngines.has('DuckDuckGo')) {
                    try {
                        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryStr)}`;
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
                                const snippetEl = $(el).find('.result__snippet');
                                const href = titleEl.attr('href');
                                const snippetText = snippetEl.text() || '';
                                if (href) {
                                    results.push({ href, snippetText });
                                }
                            });
                            
                            if (results.length > 0) {
                                this.log(`[Deep Hunt - DDG Raw Fetch SUCCESS]: Retrieved ${results.length} search results in <200ms for query: ${queryStr}`);
                                this.trackEngineSuccess('DuckDuckGo');
                                return results;
                            }
                        }
                    } catch (e) {
                        this.log(`[Deep Hunt - DDG Raw Fetch Warning]: Raw fetch failed for "${queryStr}": ${e.message}`);
                    }
                }

                if (isHttpOnly) {
                    throw new Error('Search blocked or failed in HTTP-only mode. Requires browser fallback.');
                }

                // 2. Puppeteer DuckDuckGo Static HTML Fallback
                if (results.length === 0 && !this.disabledEngines.has('DuckDuckGo')) {
                    try {
                        // Static HTML DDG is fast and doesn't run JS/Turnstile blocks
                        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryStr)}`;
                        await this.safeNavigate(huntPage, searchUrl, { timeout: 12000 });
                        await this.randomDelay(100, 300);

                        const isBlocked = await this.isPageBlocked(huntPage);

                        if (!isBlocked) {
                            results = await huntPage.evaluate(() => {
                                const items = Array.from(document.querySelectorAll('.result, .web-result'));
                                return items.map(item => {
                                    const titleEl = item.querySelector('.result__title a, a.result__a');
                                    const snippetEl = item.querySelector('.result__snippet, .snippet, p, span');
                                    const href = titleEl ? titleEl.href : '';
                                    const snippetText = snippetEl ? snippetEl.innerText : '';
                                    return { href, snippetText };
                                }).filter(r => r.href);
                            });
                            this.log(`[Deep Hunt - DDG Browser SUCCESS]: Retrieved ${results.length} search results via static DDG.`);
                            this.trackEngineSuccess('DuckDuckGo');
                        } else {
                            this.trackEngineFailure('DuckDuckGo', true);
                        }
                    } catch (e) {
                        this.trackEngineFailure('DuckDuckGo', true);
                    }
                }

                // 3. Brave Search Fallback
                if (results.length === 0 && !this.disabledEngines.has('BraveSearch')) {
                    try {
                        const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(queryStr)}`;
                        await this.safeNavigate(huntPage, searchUrl, { timeout: 12000 });
                        await this.randomDelay(100, 300);

                        results = await huntPage.evaluate(() => {
                            const items = Array.from(document.querySelectorAll('.search-result, .result, .snippet, div[data-testid="result"]'));
                            return items.map(item => {
                                const titleEl = item.querySelector('a');
                                const snippetEl = item.querySelector('.snippet-description, p, .snippet');
                                const href = titleEl ? titleEl.href : '';
                                const snippetText = snippetEl ? snippetEl.innerText : '';
                                return { href, snippetText };
                            }).filter(r => r.href && !r.href.includes('brave.com') && !r.href.includes('search'));
                        });
                        this.log(`[Deep Hunt - Brave Browser SUCCESS]: Retrieved ${results.length} search results.`);
                        if (results.length > 0) {
                            this.trackEngineSuccess('BraveSearch');
                        }
                    } catch (e) {
                        this.trackEngineFailure('BraveSearch', true);
                    }
                }

                // 4. Bing Fallback
                if (results.length === 0 && !this.disabledEngines.has('Bing')) {
                    try {
                        const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(queryStr)}`;
                        await this.safeNavigate(huntPage, searchUrl, { timeout: 12000 });
                        await this.randomDelay(100, 300);

                        results = await huntPage.evaluate(() => {
                            const items = Array.from(document.querySelectorAll('.b_algo'));
                            return items.map(item => {
                                const titleEl = item.querySelector('h2 a');
                                const snippetEl = item.querySelector('.b_caption p, .b_snippet');
                                const href = titleEl ? titleEl.href : '';
                                const snippetText = snippetEl ? snippetEl.innerText : '';
                                return { href, snippetText };
                            }).filter(r => r.href);
                        });
                        this.log(`[Deep Hunt - Bing Browser SUCCESS]: Retrieved ${results.length} search results.`);
                        if (results.length > 0) {
                            this.trackEngineSuccess('Bing');
                        }
                    } catch (e) {
                        this.trackEngineFailure('Bing', true);
                    }
                }

                // 5. Yahoo Fallback
                if (results.length === 0 && !this.disabledEngines.has('Yahoo')) {
                    try {
                        const searchUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(queryStr)}`;
                        await this.safeNavigate(huntPage, searchUrl, { timeout: 12000 });
                        await this.randomDelay(100, 300);

                        results = await huntPage.evaluate(() => {
                            const items = Array.from(document.querySelectorAll('.algo, .dd.algo'));
                            return items.map(item => {
                                const titleLink = item.querySelector('.compTitle a, a');
                                const snippetEl = item.querySelector('.compText, p');
                                const href = titleLink ? titleLink.href : '';
                                const snippetText = snippetEl ? snippetEl.innerText : '';
                                return { href, snippetText };
                            }).filter(r => r.href);
                        });
                        this.log(`[Deep Hunt - Yahoo Browser SUCCESS]: Retrieved ${results.length} search results.`);
                        if (results.length > 0) {
                            this.trackEngineSuccess('Yahoo');
                        }
                    } catch (e) {
                        this.trackEngineFailure('Yahoo', true);
                    }
                }

                return results;
            };

            // Run the queries sequentially until we find a high-yield business website
            queryLoop:
            for (const qItem of queriesToTry) {
                if (foundWebsite) break queryLoop;
                this.log(`[Deep Hunt Stage - ${qItem.type}]: Searching for: ${qItem.query}...`);
                searchResults = await executeSearchQuery(qItem.query);
                
                if (searchResults.length > 0) {
                    for (const res of searchResults) {
                        const url = cleanUrl(res.href);
                        if (!url) continue;
                        
                        if (url.includes('linkedin.com/company/')) {
                            const size = this.extractCompanySizeFromSnippet(res.snippetText);
                            if (size && size !== 'N/A') {
                                foundCompanySize = size;
                            }
                        }
                        
                        const isPersonalDir = this.isPersonalDirectory(url);
                        const isSocial = /facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com/i.test(url);
                        const isDir = this.isBusinessDirectory(url);
                        
                        if (!isPersonalDir && !isSocial && !isDir) {
                            foundWebsite = url;
                            this.log(`[Deep Hunt SUCCESS]: Found business website via Stage "${qItem.type}": ${foundWebsite}`);
                            break queryLoop;
                        }
                    }
                }
            }

            if (foundWebsite && (!company || company.length <= 2)) {
                const domain = foundWebsite.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0];
                const domainCompany = this.cleanCompanyName(domain);
                if (domainCompany && domainCompany.length > 2) {
                    company = domainCompany;
                }
            }

            if (company && company.length > 2 && foundCompanySize === 'N/A') {
                const companySearchQuery = `site:linkedin.com/company "${company}"`;
                this.log(`[Deep Hunt Company Size]: Resolving size via query: ${companySearchQuery}`);
                try {
                    const sizeResults = await executeSearchQuery(companySearchQuery);
                    for (const res of sizeResults) {
                        const url = cleanUrl(res.href);
                        if (url && url.includes('linkedin.com/company/')) {
                            const size = this.extractCompanySizeFromSnippet(res.snippetText);
                            if (size && size !== 'N/A') {
                                foundCompanySize = size;
                                break;
                            }
                        }
                    }
                } catch (sizeErr) {
                    this.log(`Failed resolving company size via targeted query: ${sizeErr.message}`);
                }
            }

            if (foundWebsite) {
                website = foundWebsite;
                if (company && company.length > 2) {
                    const companyKey = company.toLowerCase().trim();
                    try {
                        const domain = foundWebsite.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0];
                        await Company.updateOne(
                            { name: companyKey },
                            { 
                                $set: { 
                                    name: companyKey, 
                                    website: foundWebsite, 
                                    domain: domain,
                                    companySize: foundCompanySize
                                } 
                            },
                            { upsert: true }
                        );
                        this.log(`[Deep Hunt - MongoDB Save]: Saved company website/size for "${company}": ${foundWebsite} [Size: ${foundCompanySize}]`);
                    } catch (dbErr) {
                        this.log(`Failed to save Company website in MongoDB: ${dbErr.message}`);
                    }
                }
            } else if (company && company.length > 2 && foundCompanySize !== 'N/A') {
                const companyKey = company.toLowerCase().trim();
                try {
                    await Company.updateOne(
                        { name: companyKey },
                        { 
                            $set: { 
                                name: companyKey, 
                                companySize: foundCompanySize
                            } 
                        },
                        { upsert: true }
                    );
                    this.log(`[Deep Hunt - MongoDB Save Size Only]: Saved company size for "${company}": [Size: ${foundCompanySize}]`);
                } catch (dbErr) {
                    this.log(`Failed to save Company size in MongoDB: ${dbErr.message}`);
                }
            }

            // 2. Loop through all search results and parse snippets
            for (const res of searchResults) {
                const url = cleanUrl(res.href);
                if (!url) continue;
                
                const snippet = res.snippetText || '';
                
                const emailMatches = snippet.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi);
                const phoneRegex = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
                const phoneMatches = snippet.match(phoneRegex);
                
                const isPersonalDir = this.isPersonalDirectory(url);
                const isSocial = /facebook\.com|instagram\.com|twitter\.com|x\.com/i.test(url);
                
                // Extract social media links
                if (isSocial) {
                    if (url.includes('facebook.com') && facebook === 'N/A') {
                        facebook = url;
                    } else if (url.includes('instagram.com') && instagram === 'N/A') {
                        instagram = url;
                    } else if ((url.includes('twitter.com') || url.includes('x.com')) && x === 'N/A') {
                        x = url;
                    }
                }
                
                if (emailMatches) {
                    for (const email of emailMatches) {
                        if (isPersonalDir || this.isPersonalEmail(email)) {
                            personalEmails.push(email);
                        } else {
                            businessEmails.push(email);
                        }
                    }
                }
                
                if (phoneMatches) {
                    for (const rawPhone of phoneMatches) {
                        const formatted = this.formatPhone(rawPhone);
                        if (formatted && formatted !== 'N/A') {
                            if (isPersonalDir) {
                                personalPhones.push(formatted);
                            } else {
                                businessPhones.push(formatted);
                            }
                        }
                    }
                }
                
                // Extract address from snippet if possible
                const address = this.extractAddress(snippet);
                if (address && physicalAddress === 'N/A') {
                    physicalAddress = address;
                }
            }

            if (website && website !== 'N/A' && website.startsWith('http')) {
                try {
                    const siteData = await this.semanticallyCrawlWebsite(website, isHttpOnly, huntPage);
                    
                    if (siteData.email && siteData.email !== 'N/A') {
                        siteData.email.split(', ').forEach(e => {
                            if (this.isPersonalEmail(e)) personalEmails.push(e);
                            else businessEmails.push(e);
                        });
                    }
                    
                    if (siteData.phone && siteData.phone !== 'N/A') {
                        siteData.phone.split(', ').forEach(p => {
                            const formatted = this.formatPhone(p);
                            if (formatted && formatted !== 'N/A') businessPhones.push(formatted);
                        });
                    }
                    
                    if (siteData.facebook && siteData.facebook !== 'N/A') facebook = siteData.facebook;
                    if (siteData.instagram && siteData.instagram !== 'N/A') instagram = siteData.instagram;
                    if (siteData.x && siteData.x !== 'N/A') x = siteData.x;
                    if (siteData.physicalAddress && siteData.physicalAddress !== 'N/A') {
                        const cleanedAddr = this.cleanAddress(siteData.physicalAddress);
                        if (cleanedAddr && cleanedAddr !== 'N/A') physicalAddress = cleanedAddr;
                    }
                } catch (crawlErr) {
                    this.log(`Deep crawl error for website ${website}: ${crawlErr.message}`);
                    if (isHttpOnly) {
                        throw crawlErr;
                    }
                }

                // 4. Run Corporate Email Pattern Guessing Engine using domain and person name
                const domainMatch = website.match(/^(?:https?:\/\/)?(?:www\.)?([^\/]+)/i);
                const domain = domainMatch ? domainMatch[1] : null;
                if (domain) {
                    const nameParts = name.trim().split(/\s+/);
                    const firstName = nameParts[0];
                    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
                    
                    if (firstName) {
                        this.log(`Attempting email pattern guessing for "${name}" on "${domain}"...`);
                        try {
                            const guessedEmail = await guessCorporateEmail(firstName, lastName, domain);
                            if (guessedEmail && guessedEmail !== 'N/A') {
                                this.log(`Verified guessed corporate email: ${guessedEmail}`);
                                businessEmails.push(guessedEmail);
                            }
                        } catch (guessErr) {
                            // Suppress guessing error
                        }
                    }
                }
            }

        } catch (err) {
            this.log(`Error during deep contact search: ${err.message}`);
            if (isHttpOnly) {
                throw err;
            }
        } finally {
            if (huntPage && shouldClosePage) {
                await huntPage.close().catch(() => null);
            }
        }

        return {
            personalEmail: personalEmails.length > 0 ? [...new Set(personalEmails)].join(', ') : 'N/A',
            businessEmail: businessEmails.length > 0 ? [...new Set(businessEmails)].join(', ') : 'N/A',
            personalPhone: personalPhones.length > 0 ? [...new Set(personalPhones)].join(', ') : 'N/A',
            businessPhone: businessPhones.length > 0 ? [...new Set(businessPhones)].join(', ') : 'N/A',
            physicalAddress: physicalAddress,
            website: website,
            facebook: facebook,
            instagram: instagram,
            x: x,
            companySize: foundCompanySize
        };
    }
}
