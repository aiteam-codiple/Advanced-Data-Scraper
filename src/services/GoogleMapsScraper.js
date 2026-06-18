import BaseScraper from './BaseScraper.js';

export default class GoogleMapsScraper extends BaseScraper {
    constructor(jobId) {
        super(jobId, 'GoogleMaps');
    }

    async scrape(query, location, limit = 100, dedupSets = null, seniority = null) {
        this.limit = limit;
        await this.initBrowser();
        const results = [];
        const uniqueLinks = new Set();
        const targetLinkCount = limit * 3.0; // Safety margin to account for name/website duplicates
        
        try {
            let queries = [query];
            let locations = [location];
            const originalLimit = limit + (dedupSets && dedupSets.cachedUrls ? dedupSets.cachedUrls.size : 0);
            let maxSearchAttempts = 1;
            if (originalLimit >= 50) {
                this.log(`Bulk limit of ${originalLimit} detected. Activating query and location expansion (incremental target: ${limit})...`);
                queries = this.getQueryVariations(query);
                locations = this.getLocationSubdivisions(location);
                maxSearchAttempts = Math.min(250, Math.max(20, Math.ceil(limit / 2)));
            }

            // Step 1: Accumulate unique places links via smart partitioning
            let searchAttempts = 0;
            linkGathering:
            for (const q of queries) {
                for (const loc of locations) {
                    if (uniqueLinks.size >= targetLinkCount) break linkGathering;
                    if (searchAttempts >= maxSearchAttempts) {
                        this.log(`Reached maximum search attempts limit of ${maxSearchAttempts}. Stopping link gathering.`);
                        break linkGathering;
                    }
                    searchAttempts++;

                    const searchQuery = `${q} in ${loc}`;
                    const url = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
                    this.log(`Gathering Maps links for: "${searchQuery}"`);
                    this.setProgress(0, 2, 'Searching Google Maps...');

                    try {
                        await this.optimizePage(this.page);
                        await this.safeNavigate(this.page, url, { timeout: 25000 });
                        
                        try {
                            await this.page.waitForSelector('div[role="feed"]', { timeout: 10000 });
                        } catch (err) {
                            const isBlocked = await this.isPageBlocked(this.page);
                            if (isBlocked) {
                                this.log('Search blocked by CAPTCHA. Attempting solve...');
                                await this.solveCaptcha(this.page);
                                await this.randomDelay(1000, 2000);
                                try {
                                    await this.page.waitForSelector('div[role="feed"]', { timeout: 10000 });
                                } catch (retryErr) {
                                    this.log(`No results feed found for "${searchQuery}". Moving to next partition...`);
                                    continue;
                                }
                            } else {
                                this.log(`No results feed found for "${searchQuery}". Moving to next partition...`);
                                continue;
                            }
                        }

                        let noNewScrolls = 0;
                        const maxScrollsWithoutChange = 3;
                        let lastFeedCount = 0;

                        while (noNewScrolls < maxScrollsWithoutChange && uniqueLinks.size < targetLinkCount) {
                            const currentLinks = await this.page.evaluate(() => {
                                const links = Array.from(document.querySelectorAll('div[role="feed"] > div:has(a) a'));
                                return links.map(l => l.href).filter(href => href && href.includes('/maps/place/'));
                            });
                            
                            const uniqueCurrent = [...new Set(currentLinks)];
                            const searchPct = Math.min(2 + Math.round((uniqueLinks.size / targetLinkCount) * 8), 10);
                            this.setProgress(0, searchPct, 'Finding business listings...');
                            
                            for (const link of uniqueCurrent) {
                                const lUrl = this.normalizeUrl(link);
                                if (dedupSets && (
                                    (dedupSets.dedupUrls && dedupSets.dedupUrls.has(lUrl)) || 
                                    (dedupSets.cachedUrls && dedupSets.cachedUrls.has(lUrl))
                                )) {
                                    continue; // Skip duplicate link early!
                                }
                                if (uniqueLinks.size < targetLinkCount) {
                                    uniqueLinks.add(link);
                                }
                            }

                            if (uniqueLinks.size >= targetLinkCount) break;

                            if (uniqueCurrent.length === lastFeedCount) {
                                noNewScrolls++;
                                await this.randomDelay(800, 1500);
                            } else {
                                noNewScrolls = 0;
                                lastFeedCount = uniqueCurrent.length;
                            }

                            await this.page.evaluate(() => {
                                const feed = document.querySelector('div[role="feed"]');
                                if (feed) feed.scrollBy(0, 1200);
                            });
                            await this.randomDelay(500, 1000);
                        }

                    } catch (e) {
                        this.log(`Skipped search query "${searchQuery}" due to timeout or error: ${e.message}`);
                    }
                }
            }

            const itemLinks = Array.from(uniqueLinks);
            this.log(`Finished link gathering. Total unique links to deep-crawl: ${itemLinks.length}`);

            // Step 2: Parallel panel data gathering using cluster queue
            const preliminaryResults = [];
            this.log(`Starting parallel panel gathering with ${this.maxWorkers} workers for ${itemLinks.length} places...`);
            
            await this.runClusterQueue(itemLinks.map((link, idx) => ({ link, idx })), async (task, workerPage, workerId) => {
                if (preliminaryResults.length >= limit * 2.5) return null;
                
                const { link, idx } = task;
                const harvestPct = 10 + Math.round((idx / itemLinks.length) * 30);
                this.setProgress(0, harvestPct, 'Exploring business panels...');
                
                try {
                    await this.optimizePage(workerPage);
                    await this.safeNavigate(workerPage, link, { timeout: 22000 });
                    await workerPage.waitForSelector('h1.DUwDvf', { timeout: 8000 }).catch(() => null);
                    const isBlocked = await this.isPageBlocked(workerPage);
                    if (isBlocked) {
                        this.log(`[Worker ${workerId}]: Google Maps place view blocked. Solving CAPTCHA...`);
                        await this.solveCaptcha(workerPage);
                    }
                    await this.randomDelay(100, 300);
                } catch (navError) {
                    return null;
                }

                try {
                    const data = await workerPage.evaluate(() => {
                        const nameEl = document.querySelector('h1.DUwDvf');
                        const name = nameEl ? nameEl.innerText.trim() : 'N/A';
                        
                        let locationVal = 'N/A';
                        const addressBtn = document.querySelector('[data-item-id="address"]');
                        if (addressBtn) {
                            locationVal = addressBtn.innerText.replace(/[^\x20-\x7E]/g, '').trim();
                        } else {
                            const btns = Array.from(document.querySelectorAll('button'));
                            for (const b of btns) {
                                const id = b.getAttribute('data-item-id') || '';
                                if (id.startsWith('address')) {
                                    locationVal = b.innerText.trim();
                                    break;
                                }
                            }
                        }

                        let phone = 'N/A';
                        const buttons = Array.from(document.querySelectorAll('button'));
                        for (const btn of buttons) {
                            const aria = btn.getAttribute('aria-label') || '';
                            const ariaLower = aria.toLowerCase();
                            if (ariaLower.includes('phone') || ariaLower.includes('call ')) {
                                let text = btn.textContent.replace(/[^\x20-\x7E]/g, '').trim();
                                if (/\d{4,}/.test(text)) {
                                    phone = text;
                                    break;
                                }
                                let cleaned = aria.replace(/phone number|phone:|call/gi, '').trim();
                                if (/\d{4,}/.test(cleaned)) {
                                    phone = cleaned;
                                    break;
                                }
                            }
                        }

                        if (phone === 'N/A') {
                            const phoneBtn = document.querySelector('[data-item-id^="phone:tel:"]');
                            if (phoneBtn) {
                                phone = phoneBtn.getAttribute('data-item-id').replace('phone:tel:', '');
                            }
                        }

                        let website = 'N/A';
                        const websiteBtn = document.querySelector('[data-item-id^="authority:"]');
                        if (websiteBtn && websiteBtn.href) {
                            website = websiteBtn.href;
                        } else {
                            const links = Array.from(document.querySelectorAll('a'));
                            for (const a of links) {
                                const aria = a.getAttribute('aria-label') || '';
                                const href = a.getAttribute('href') || '';
                                if (aria.toLowerCase().includes('website') || href.startsWith('http')) {
                                    if (aria.toLowerCase().includes('website') && !href.includes('google.com')) {
                                        website = a.href;
                                        break;
                                    }
                                }
                            }
                        }

                        return { name, location: locationVal, phone, website };
                    });

                    if (!data || !data.name || data.name === 'N/A') {
                        return null;
                    }

                    const isDup = this.isDuplicate(data.name, link, data.website, dedupSets);
                    if (isDup) {
                        return null;
                    }

                    preliminaryResults.push({
                        name: data.name,
                        location: data.location,
                        phone: data.phone,
                        website: data.website,
                        googleMapUrl: link
                    });
                    return data;

                } catch (parseErr) {
                    return null;
                }
            }, this.maxWorkers, () => preliminaryResults.length >= limit * 1.5);

            this.log(`Finished panel gathering. Collected ${preliminaryResults.length} locations. Starting ${this.maxWorkers}x parallel deep website crawling...`);

            // Step 3: Utilize Technique 1: Centralized Headless Worker Cluster Queue
            let homeTimeout = 12000;
            let contactTimeout = 8000;
            if (this.speedMode === 'fast') {
                homeTimeout = 8000;
                contactTimeout = 5000;
            } else if (this.speedMode === 'slow') {
                homeTimeout = 15000;
                contactTimeout = 10000;
            }
            await this.runClusterQueue(preliminaryResults, async (item, workerPage, workerId) => {
                if (results.length >= limit) return null;
                workerPage._blockJSAndCSS = false;
                const primaryPhoneFormatted = this.formatPhone(item.phone) || 'N/A';
                const safePrimaryPhone = primaryPhoneFormatted !== 'N/A' && primaryPhoneFormatted.startsWith('+') ? ` ${primaryPhoneFormatted}` : primaryPhoneFormatted;

                let personalEmails = [];
                let businessEmails = [];
                let websitePhones = [];
                let websiteAddress = null;
                let facebook = 'N/A';
                let instagram = 'N/A';
                let x = 'N/A';

                // High-Yield Web Hunt Fallback:
                if (!item.website || item.website === 'N/A') {
                    this.log(`[Google Maps website hunt fallback]: No website listed on Maps for "${item.name}". Hunting search engines...`);
                    item.website = await this.huntWebsiteForBusiness(item.name, item.location || location, workerPage);
                }

                if (item.website && item.website !== 'N/A' && item.website.startsWith('http')) {
                    try {
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

                        // Navigate using the cluster's worker page
                        await this.optimizePage(workerPage, true);
                        await this.safeNavigate(workerPage, item.website, { timeout: homeTimeout });
                        await this.randomDelay(200, 400);
                        let siteData = await extractFromPage(workerPage);
                        
                        let collectedEmails = [...siteData.emails];
                        let collectedPhones = [...siteData.phones];

                        // Try to extract address from homepage
                        let addr = this.extractAddress(siteData.bodyText);
                        if (addr) websiteAddress = addr;

                        // Harvest social links from homepage
                        for (const l of siteData.links) {
                            if (l.href.includes('facebook.com') && facebook === 'N/A') {
                                facebook = l.href;
                            } else if (l.href.includes('instagram.com') && instagram === 'N/A') {
                                instagram = l.href;
                            } else if ((l.href.includes('twitter.com') || l.href.includes('x.com')) && x === 'N/A') {
                                x = l.href;
                            }
                        }

                        // Dynamic Contact Page Crawling to double email/phone yields
                        const contactLink = siteData.links.find(l => {
                            const text = l.text;
                            return text.includes('contact') || text.includes('about') || text.includes('team') || text.includes('reach') || text.includes('info');
                        });

                        if (contactLink && contactLink.href && contactLink.href !== item.website && contactLink.href.startsWith('http')) {
                            try {
                                await this.safeNavigate(workerPage, contactLink.href, { timeout: contactTimeout });
                                await this.randomDelay(200, 400);
                                const subpageData = await extractFromPage(workerPage);
                                collectedEmails.push(...subpageData.emails);
                                collectedPhones.push(...subpageData.phones);

                                let subpageAddr = this.extractAddress(subpageData.bodyText);
                                if (subpageAddr && !websiteAddress) {
                                    websiteAddress = subpageAddr;
                                }

                                // Harvest social links from subpage
                                for (const l of subpageData.links) {
                                    if (l.href.includes('facebook.com') && facebook === 'N/A') {
                                        facebook = l.href;
                                    } else if (l.href.includes('instagram.com') && instagram === 'N/A') {
                                        instagram = l.href;
                                    } else if ((l.href.includes('twitter.com') || l.href.includes('x.com')) && x === 'N/A') {
                                        x = l.href;
                                    }
                                }
                            } catch (subpageErr) {
                                // Ignore subpage issues
                            }
                        }

                        // Classify into Personal vs Business Emails
                        const uniqueEmails = [...new Set(collectedEmails)];
                        for (const email of uniqueEmails) {
                            if (this.isPersonalEmail(email)) {
                                personalEmails.push(email);
                            } else {
                                businessEmails.push(email);
                            }
                        }

                        const formattedWebsitePhonesSet = new Set();
                        for (const rawPhone of collectedPhones) {
                            const formatted = this.formatPhone(rawPhone);
                            if (formatted && formatted !== 'N/A') {
                                formattedWebsitePhonesSet.add(formatted);
                            }
                        }
                        websitePhones = Array.from(formattedWebsitePhonesSet);

                    } catch (siteErr) {
                        // Ignore site crawling timeout/failures
                    }
                }

                // Format phone numbers safely to prevent Excel scientific notations
                const allBusinessPhones = new Set();
                if (safePrimaryPhone !== 'N/A') allBusinessPhones.add(safePrimaryPhone);
                for (const p of websitePhones) {
                    allBusinessPhones.add(p);
                }

                // Social URLs are preserved from website crawl but skip deep social crawling for speed
                let personalPhones = [];

                const rawLocation = (item.location && item.location !== 'N/A' && item.location.length > 10)
                    ? item.location
                    : (websiteAddress || item.location || 'N/A');

                // Final duplicate check in worker queue (especially for websites found during fallback hunt)
                if (this.isDuplicate(item.name, item.googleMapUrl, item.website, dedupSets)) {
                    this.log(`Skipping duplicate lead discovered during deep crawl: "${item.name}"`);
                    return null;
                }

                const allEmails = [...new Set([...personalEmails, ...businessEmails])];
                const allPhones = [...new Set([...personalPhones, ...allBusinessPhones])];

                const resultObj = {
                    name: item.name,
                    profileUrl: item.googleMapUrl,
                    title: 'N/A',
                    location: this.cleanAddress(rawLocation) !== 'N/A' ? this.cleanAddress(rawLocation) : this.cleanLocation(rawLocation, rawLocation || 'N/A'),
                    email: allEmails.length > 0 ? allEmails.join(', ') : 'N/A',
                    phone: allPhones.length > 0 ? allPhones.join(', ') : 'N/A',
                    website: item.website
                };
                results.push(resultObj);
                const crawlPct = 40 + Math.round((results.length / limit) * 59);
                this.setProgress(results.length, crawlPct, 'Deep crawling websites...');
                return resultObj;
            }, this.maxWorkers, () => results.length >= limit);

            this.log(`Finished scraping Maps. Total listings extracted: ${results.length}`);
            return results.slice(0, limit);
            
        } catch (error) {
            this.log(`Error during scraping session: ${error.message}`);
            throw error;
        } finally {
            await this.close();
        }
    }
}
