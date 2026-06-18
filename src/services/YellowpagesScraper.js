import BaseScraper from './BaseScraper.js';
import * as cheerio from 'cheerio';

export default class YellowpagesScraper extends BaseScraper {
    constructor(jobId) {
        super(jobId, 'Yellowpages');
    }

    async scrape(query, location, limit = 100, dedupSets = null, seniority = null) {
        this.limit = limit;
        await this.initBrowser();
        const results = [];
        const preliminaryResults = [];
        const uniqueKeys = new Set(); // To prevent duplicates

        try {
            let queries = [query];
            let locations = [location];
            const originalLimit = limit + (dedupSets && dedupSets.cachedUrls ? dedupSets.cachedUrls.size : 0);
            let maxSearchAttempts = 1;
            if (originalLimit >= 50) {
                this.log(`Bulk limit of ${originalLimit} detected. Enabling query and location expansion (incremental target: ${limit})...`);
                queries = this.getQueryVariations(query);
                locations = this.getLocationSubdivisions(location);
                maxSearchAttempts = Math.min(250, Math.max(20, Math.ceil(limit / 2)));
            }

            // Step 1: Collect profiles from Yellowpages search pages across partitions
            let searchAttempts = 0;
            partitionLoop:
            for (const q of queries) {
                for (const loc of locations) {
                    if (preliminaryResults.length >= limit * 3.0) break partitionLoop;
                    if (searchAttempts >= maxSearchAttempts) {
                        this.log(`Reached maximum search attempts limit of ${maxSearchAttempts}. Stopping partition loop.`);
                        break partitionLoop;
                    }
                    searchAttempts++;

                    const url = `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(q)}&geo_location_terms=${encodeURIComponent(loc)}`;
                    this.log(`Navigating YP search partition directly: "${q}" in "${loc}"`);

                    let directSuccess = false;
                    try {
                        await this.optimizePage(this.page);
                        await this.safeNavigate(this.page, url, { timeout: 45000 });
                        
                        const isBlocked = await this.isPageBlocked(this.page);
                        if (!isBlocked) {
                            try {
                                await this.page.waitForSelector('.result', { timeout: 15000 });
                                directSuccess = true;
                            } catch (selectorErr) {
                                this.log('No results list found on YP page directly.');
                            }
                        } else {
                            this.log('Direct YP search route blocked by security.');
                        }
                    } catch (e) {
                        this.log(`Direct YP search route failed or timed out: ${e.message}`);
                    }

                    if (directSuccess) {
                        try {
                            let hasNextPage = true;
                            let pageNum = 1;
                            const originalLimit = limit + (dedupSets && dedupSets.cachedUrls ? dedupSets.cachedUrls.size : 0);
                            const maxPagesPerPartition = Math.ceil(originalLimit / 10) || 5;

                            while (hasNextPage && pageNum <= maxPagesPerPartition && preliminaryResults.length < limit * 3.0) {
                                this.log(`Extracting YP data from page ${pageNum} for "${q}" in "${loc}"...`);

                                const pageResults = await this.page.evaluate(() => {
                                    const items = Array.from(document.querySelectorAll('.result'));
                                    return items.map(item => {
                                        const nameEl = item.querySelector('.business-name');
                                        const phoneEl = item.querySelector('.phones.phone.primary');
                                        const addressEl = item.querySelector('.street-address');
                                        const localityEl = item.querySelector('.locality');
                                        const websiteEl = item.querySelector('.track-visit-website');
                                        
                                        return {
                                            name: nameEl ? nameEl.textContent.trim() : 'N/A',
                                            rawPhone: phoneEl ? phoneEl.textContent.trim() : 'N/A',
                                            address: addressEl && localityEl ? `${addressEl.textContent.trim()} ${localityEl.textContent.trim()}` : '',
                                            ypUrl: nameEl && nameEl.href ? nameEl.href.split('?')[0].split('#')[0] : null,
                                            website: websiteEl && websiteEl.href ? websiteEl.href : 'N/A'
                                        };
                                    }).filter(r => r.name !== 'N/A');
                                });

                                for (const item of pageResults) {
                                    if (item.ypUrl && this.isDuplicate(item.name, item.ypUrl, item.website, dedupSets)) {
                                        continue; // Skip duplicate lead on-the-fly
                                    }
                                    const key = `${item.name.toLowerCase()}-${item.rawPhone}`;
                                    if (!uniqueKeys.has(key) && preliminaryResults.length < limit * 3.0) {
                                        uniqueKeys.add(key);
                                        preliminaryResults.push(item);
                                    }
                                }

                                const harvestPct = Math.round((preliminaryResults.length / (limit * 3.0)) * 30);
                                this.setProgress(0, harvestPct, 'Harvesting Yellowpages listings...');
                                this.log(`Extracted ${pageResults.length} profiles from page ${pageNum}. Current unique harvested: ${preliminaryResults.length}`);

                                if (preliminaryResults.length >= limit * 3.0) break;

                                const nextButtonHref = await this.page.evaluate(() => {
                                    const btn = document.querySelector('a.next.ajax-page');
                                    return btn ? btn.href : null;
                                });
                                
                                if (nextButtonHref) {
                                    await this.randomDelay(1500, 3000);
                                    await this.safeNavigate(this.page, nextButtonHref, { timeout: 30000 });
                                    pageNum++;
                                } else {
                                    hasNextPage = false;
                                }
                            }
                        } catch (directErr) {
                            this.log(`Error during direct YP partition crawling: ${directErr.message}`);
                        }
                    } else {
                        // Fallback: Search Engine Harvesting for YP profiles!
                        this.log(`[YP Fallback]: Initiating Search Engine dorking for "${q}" in "${loc}"...`);
                        
                        const cleanLoc = loc.replace(',', '');
                        const searchQueries = [
                            `site:yellowpages.com "${q}" "${loc}" inurl:mip`,
                            `site:yellowpages.com "${q}" ${cleanLoc} inurl:mip`,
                            `site:yellowpages.com ${q} ${cleanLoc} inurl:mip`,
                            `site:yellowpages.com "${q}" ${cleanLoc}`,
                            `site:yellowpages.com ${q} ${cleanLoc}`
                        ];
                        
                        const engines = ['DuckDuckGo', 'BraveSearch', 'Bing'].filter(e => !this.disabledEngines.has(e));
                        if (engines.length === 0) engines.push('DuckDuckGo');

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
                            if (dec.includes('yellowpages.com')) {
                                if (dec.startsWith('//')) {
                                    return 'https:' + dec;
                                }
                                return dec;
                            }
                            return dec;
                        };

                        queryLoop:
                        for (const searchQ of searchQueries) {
                            if (preliminaryResults.length >= limit * 2.2) break queryLoop;

                            engineLoop:
                            for (const engine of engines) {
                                if (preliminaryResults.length >= limit * 2.2) break engineLoop;

                                let sUrl = '';
                                if (engine === 'BraveSearch') {
                                    sUrl = `https://search.brave.com/search?q=${encodeURIComponent(searchQ)}`;
                                } else if (engine === 'Bing') {
                                    sUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchQ)}`;
                                } else if (engine === 'DuckDuckGo') {
                                    sUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQ)}`;
                                }

                                try {
                                    let harvested = [];
                                    if (engine === 'DuckDuckGo') {
                                        this.log(`[YP Fallback]: Querying DuckDuckGo HTML directly via HTTP for "${searchQ}"...`);
                                        const res = await fetch(sUrl, {
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
                                                    const targetUrl = getTargetUrl(href);
                                                    const hostAndPath = targetUrl.split('?')[0].split('#')[0];
                                                    
                                                    if (hostAndPath.includes('yellowpages.com/') && hostAndPath.includes('/mip/') && !hostAndPath.includes('search')) {
                                                        const titleText = titleEl.text().trim() || '';
                                                        if (titleText.length > 2 && !titleText.toLowerCase().includes('yellow pages')) {
                                                            let name = titleText.replace(/ - New York.*$/i, '').replace(/ - .*$/i, '').replace(/ \| Yellow.*$/i, '').trim();
                                                            harvested.push({ name, url: hostAndPath });
                                                        }
                                                    }
                                                }
                                            });
                                        } else {
                                            this.log(`[YP Fallback]: DuckDuckGo HTTP request returned status ${res.status}`);
                                        }
                                    } else {
                                        // For BraveSearch or Bing, use Puppeteer navigation
                                        this.log(`[YP Fallback]: Querying ${engine} in browser for "${searchQ}"...`);
                                        await this.safeNavigate(this.page, sUrl, { timeout: 30000 });
                                        await this.randomDelay(800, 1800);
                                        
                                        const isBlocked = await this.isPageBlocked(this.page);
                                        if (isBlocked) {
                                            this.trackEngineFailure(engine, true);
                                            continue;
                                        }

                                        const pageHarvested = await this.page.evaluate(() => {
                                            const results = [];
                                            const getTargetUrlInner = (h) => {
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
                                                return dec;
                                            };

                                            const links = Array.from(document.querySelectorAll('a'));
                                            links.forEach(a => {
                                                const href = a.href;
                                                const targetUrl = getTargetUrlInner(href);
                                                const hostAndPath = targetUrl.split('?')[0].split('#')[0];
                                                
                                                if (hostAndPath.includes('yellowpages.com/') && hostAndPath.includes('/mip/') && !hostAndPath.includes('search')) {
                                                    const titleText = a.innerText.trim() || '';
                                                    if (titleText.length > 2 && !titleText.toLowerCase().includes('yellow pages')) {
                                                        let name = titleText.replace(/ - New York.*$/i, '').replace(/ - .*$/i, '').replace(/ \| Yellow.*$/i, '').trim();
                                                        results.push({ name, url: hostAndPath });
                                                    }
                                                }
                                            });
                                            return results;
                                        });
                                        if (pageHarvested) harvested = pageHarvested;
                                    }

                                    if (harvested && harvested.length > 0) {
                                        this.trackEngineSuccess(engine);
                                        let addedCount = 0;
                                        for (const item of harvested) {
                                            if (this.isDuplicate(item.name, item.url, 'N/A', dedupSets)) {
                                                continue;
                                            }
                                            const key = `${item.name.toLowerCase()}-${item.url.toLowerCase()}`;
                                            if (!uniqueKeys.has(key) && preliminaryResults.length < limit * 2.2) {
                                                uniqueKeys.add(key);
                                                preliminaryResults.push({
                                                    name: item.name,
                                                    ypUrl: item.url,
                                                    rawPhone: 'N/A',
                                                    address: 'N/A',
                                                    website: 'N/A'
                                                });
                                                addedCount++;
                                            }
                                        }
                                        const harvestPct = Math.round((preliminaryResults.length / (limit * 2.2)) * 30);
                                        this.setProgress(0, harvestPct, 'Harvesting listings (fallback)...');
                                        this.log(`[YP Fallback]: Harvested ${addedCount} unique profiles from ${engine} for "${searchQ}". Total candidates: ${preliminaryResults.length}`);
                                    }
                                } catch (searchErr) {
                                    this.log(`[YP Fallback]: Search engine ${engine} failed: ${searchErr.message}`);
                                    this.trackEngineFailure(engine, true);
                                }
                            }
                        }
                    }
                }
            }

            this.log(`Finished crawling YP search/fallback pages. Found ${preliminaryResults.length} candidate profiles. Starting parallel deep website extraction...`);

            // Step 2: Utilize Headless Worker Cluster Queue to enrich candidate details
            await this.runClusterQueue(preliminaryResults, async (item, workerPage, workerId) => {
                if (results.length >= limit) return null;
                workerPage._blockJSAndCSS = false;

                let homeTimeout = 14000;
                let contactTimeout = 10000;
                if (this.speedMode === 'fast') {
                    homeTimeout = 8000;
                    contactTimeout = 6000;
                } else if (this.speedMode === 'slow') {
                    homeTimeout = 18000;
                    contactTimeout = 14000;
                }

                let finalName = item.name;
                if (!finalName || finalName === 'N/A') return null;
                let finalPhone = item.rawPhone;
                let finalAddress = item.address;
                let finalWebsite = item.website;

                // Scrape details from MIP page if details are N/A (because it was harvested from search engine)
                if (item.ypUrl && (finalPhone === 'N/A' || finalAddress === 'N/A' || finalWebsite === 'N/A')) {
                    try {
                        const cleanYpUrl = item.ypUrl.split('?')[0].split('#')[0];
                        this.log(`[Worker ${workerId}]: Scraping MIP profile page: ${cleanYpUrl}`);
                        await this.optimizePage(workerPage);
                        await this.safeNavigate(workerPage, cleanYpUrl, { timeout: 25000 });
                        await this.randomDelay(200, 500);

                        const isBlocked = await this.isPageBlocked(workerPage);
                        if (isBlocked) {
                            this.log(`[Worker ${workerId}]: MIP profile page got blocked: ${cleanYpUrl}`);
                            return null;
                        }

                        const profileDetails = await workerPage.evaluate(() => {
                            const nameEl = document.querySelector('.sales-info h1, h1.dock-title, h1.fn, h1');
                            const phoneEl = document.querySelector('.phone.primary, .phones.phone.primary, .phone, a.phone, [href^="tel:"]');
                            const addressEl = document.querySelector('.address, .street-address, .address span');
                            const websiteEl = document.querySelector('.track-visit-website, a.website-link, a.custom-link');
                            
                            return {
                                name: nameEl ? nameEl.innerText.trim() : 'N/A',
                                phone: phoneEl ? phoneEl.innerText.replace(/phone number|phone:|call/gi, '').trim() : 'N/A',
                                address: addressEl ? addressEl.innerText.replace(/\n/g, ' ').trim() : 'N/A',
                                website: websiteEl ? websiteEl.href : 'N/A'
                            };
                        });

                        if (profileDetails.name !== 'N/A') finalName = profileDetails.name;
                        if (profileDetails.phone !== 'N/A') finalPhone = profileDetails.phone;
                        if (profileDetails.address !== 'N/A') finalAddress = profileDetails.address;
                        if (profileDetails.website !== 'N/A') finalWebsite = profileDetails.website;

                    } catch (navErr) {
                        this.log(`[Worker ${workerId}]: Failed parsing MIP merchant details: ${navErr.message}`);
                    }
                }

                // Final duplicate check in worker queue
                if (this.isDuplicate(finalName, item.ypUrl, finalWebsite, dedupSets)) {
                    this.log(`Skipping duplicate lead: "${finalName}"`);
                    return null;
                }

                if (results.length >= limit) return null;

                const primaryPhoneFormatted = this.formatPhone(finalPhone) || 'N/A';
                const safePrimaryPhone = primaryPhoneFormatted !== 'N/A' && primaryPhoneFormatted.startsWith('+') ? ` ${primaryPhoneFormatted}` : primaryPhoneFormatted;

                let personalEmails = [];
                let businessEmails = [];
                let websitePhones = [];
                let websiteAddress = null;
                let facebook = 'N/A';
                let instagram = 'N/A';
                let x = 'N/A';

                // High-Yield Web Hunt Fallback:
                if (!finalWebsite || finalWebsite === 'N/A') {
                    this.log(`[YP website hunt fallback]: No website listed on Yellowpages for "${finalName}". Hunting search engines...`);
                    finalWebsite = await this.huntWebsiteForBusiness(finalName, finalAddress || location, workerPage);
                }

                if (finalWebsite && finalWebsite !== 'N/A' && finalWebsite.startsWith('http')) {
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

                        await this.optimizePage(workerPage, true);
                        await this.safeNavigate(workerPage, finalWebsite, { timeout: homeTimeout });
                        await this.randomDelay(200, 400);
                        let siteData = await extractFromPage(workerPage);
                        
                        let collectedEmails = [...siteData.emails];
                        let collectedPhones = [...siteData.phones];

                        let addr = this.extractAddress(siteData.bodyText);
                        if (addr) websiteAddress = addr;

                        for (const l of siteData.links) {
                            if (l.href.includes('facebook.com') && facebook === 'N/A') {
                                facebook = l.href;
                            } else if (l.href.includes('instagram.com') && instagram === 'N/A') {
                                instagram = l.href;
                            } else if ((l.href.includes('twitter.com') || l.href.includes('x.com')) && x === 'N/A') {
                                x = l.href;
                            }
                        }

                        const contactLink = siteData.links.find(l => {
                            const text = l.text;
                            return text.includes('contact') || text.includes('about') || text.includes('team') || text.includes('reach') || text.includes('info');
                        });

                        if (contactLink && contactLink.href && contactLink.href !== finalWebsite && contactLink.href.startsWith('http')) {
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
                                // Ignore
                            }
                        }

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

                    } catch (e) {
                        // Ignore website crawl errors
                    }
                }

                const allBusinessPhones = new Set();
                if (safePrimaryPhone !== 'N/A') allBusinessPhones.add(safePrimaryPhone);
                for (const p of websitePhones) {
                    allBusinessPhones.add(p);
                }

                let personalPhones = [];
                const socialScrapes = await Promise.all([
                    this.scrapeSocialContacts(facebook, workerPage.browser()),
                    this.scrapeSocialContacts(instagram, workerPage.browser()),
                    this.scrapeSocialContacts(x, workerPage.browser())
                ]);
                
                for (const sc of socialScrapes) {
                    if (sc.email) {
                        personalEmails.push(sc.email);
                    }
                    if (sc.phone) {
                        const formatted = this.formatPhone(sc.phone);
                        if (formatted && formatted !== 'N/A') {
                            personalPhones.push(formatted);
                        }
                    }
                }

                const rawLocation = (finalAddress && finalAddress !== 'N/A' && finalAddress.length > 10)
                    ? finalAddress
                    : (websiteAddress || finalAddress || 'N/A');

                const allEmails = [...new Set([...personalEmails, ...businessEmails])];
                const allPhones = [...new Set([...personalPhones, ...allBusinessPhones])];

                const resultObj = {
                    name: finalName,
                    profileUrl: item.ypUrl,
                    title: 'N/A',
                    location: this.cleanAddress(rawLocation) !== 'N/A' ? this.cleanAddress(rawLocation) : this.cleanLocation(rawLocation, rawLocation || 'N/A'),
                    email: allEmails.length > 0 ? allEmails.join(', ') : 'N/A',
                    phone: allPhones.length > 0 ? allPhones.join(', ') : 'N/A',
                    website: finalWebsite
                };
                results.push(resultObj);
                const crawlPct = 30 + Math.round((results.length / limit) * 65);
                this.setProgress(results.length, crawlPct, 'Extracting contact details...');
                return resultObj;
            }, this.maxWorkers, () => results.length >= limit);

            this.log(`Finished scraping Yellowpages. Total profiles extracted: ${results.length}`);
            return results.slice(0, limit);

        } catch (error) {
            this.log(`Error during Yellowpages scraping session: ${error.message}`);
            throw error;
        } finally {
            await this.close();
        }
    }
}
