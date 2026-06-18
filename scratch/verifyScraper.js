

async function verifyJobCountAlignment() {
    const baseUrl = 'http://localhost:3000';
    console.log('Logging in as admin...');
    
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: '123' })
    });
    
    if (!loginRes.ok) {
        throw new Error(`Login failed with status ${loginRes.status}: ${await loginRes.text()}`);
    }
    
    const { token } = await loginRes.json();
    console.log('Successfully authenticated!');

    // Trigger a scrape job with a low limit to complete quickly
    console.log('Triggering a GoogleMaps scraping job with limit 6...');
    const scrapeRes = await fetch(`${baseUrl}/api/scrape`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            platform: 'googlemaps',
            query: 'Plumber',
            location: 'Evanston, IL',
            maxEntries: 6,
            speedMode: 'fast'
        })
    });

    if (!scrapeRes.ok) {
        throw new Error(`Scrape trigger failed with status ${scrapeRes.status}: ${await scrapeRes.text()}`);
    }

    const { jobId } = await scrapeRes.json();
    console.log(`Job triggered successfully! Job ID: ${jobId}`);

    // Poll the status of the job until it is completed
    console.log('Waiting for the scraping job to complete...');
    let isComplete = false;
    let attempts = 0;
    while (!isComplete && attempts < 120) {
        await new Promise(r => setTimeout(r, 2000));
        attempts++;
        const statusRes = await fetch(`${baseUrl}/api/scrape/${jobId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (statusRes.ok) {
            const statusData = await statusRes.json();
            console.log(`Polling status: ${statusData.status} (attempt ${attempts})`);
            if (statusData.status === 'completed') {
                isComplete = true;
                break;
            } else if (statusData.status === 'failed') {
                throw new Error(`Job failed with error: ${statusData.error}`);
            }
        }
    }

    if (!isComplete) {
        throw new Error('Scraping job timed out or failed to complete.');
    }

    // Retrieve active in-memory job details count
    const detailsRes = await fetch(`${baseUrl}/api/scrape/${jobId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const detailsData = await detailsRes.json();
    const previewCount = detailsData.data ? detailsData.data.length : 0;
    console.log(`Active in-memory job previewCount: ${previewCount}`);

    // Retrieve history list metadata count
    const historyRes = await fetch(`${baseUrl}/api/history`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const historyList = await historyRes.json();
    const historyItem = historyList.find(h => h.jobId === jobId);
    
    if (!historyItem) {
        throw new Error(`Could not find history record for job ${jobId}`);
    }
    const historyCount = historyItem.recordCount;
    console.log(`Database history recordCount: ${historyCount}`);

    console.log('--------------------------------------------------');
    if (previewCount === historyCount) {
        console.log('SUCCESS: previewCount and historyCount match perfectly!');
        console.log(`Count: ${previewCount} leads`);
    } else {
        console.log('FAIL: previewCount and historyCount mismatch!');
        console.log(`In-memory preview count: ${previewCount}`);
        console.log(`Database history count: ${historyCount}`);
        process.exit(1);
    }
    console.log('--------------------------------------------------');
}

verifyJobCountAlignment().catch(err => {
    console.error('Verification failed:', err);
    process.exit(1);
});
