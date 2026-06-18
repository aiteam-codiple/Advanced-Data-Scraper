async function runTest() {
    const baseUrl = 'http://localhost:3000';
    console.log('Logging in to scraper app...');
    
    // Login to get a token
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: '123' })
    });
    
    if (!loginRes.ok) {
        throw new Error(`Login failed with status ${loginRes.status}: ${await loginRes.text()}`);
    }
    
    const { token } = await loginRes.json();
    console.log('Successfully authenticated! Token retrieved.');

    // Connect to SSE stream
    console.log('Connecting to SSE stream for real-time progress updates...');
    const sseRes = await fetch(`${baseUrl}/api/stream?token=${token}`);
    
    if (!sseRes.ok) {
        throw new Error(`Failed to connect to SSE: ${sseRes.statusText}`);
    }

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    
    let jobId = null;
    let isFinished = false;

    // Start processing the SSE stream asynchronously
    (async () => {
        let buffer = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // keep unfinished line
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (!jsonStr) continue;
                        
                        const data = JSON.parse(jsonStr);
                        if (data.status === 'connected') {
                            console.log(`[SSE]: ${data.message}`);
                            continue;
                        }

                        if (jobId && data.jobId !== jobId) continue;

                        if (data.message) {
                            console.log(`[Job Update]: ${data.message}`);
                        } else {
                            console.log(`[Job Progress]: Progress: ${data.progress}%, Leads: ${data.leadsCount}/${data.limit}, State: ${data.stateMessage}`);
                        }

                        if (data.isComplete || data.isError) {
                            console.log('Job completed/failed according to SSE stream. Closing stream...');
                            reader.cancel();
                            isFinished = true;
                            break;
                        }
                    }
                }
                if (isFinished) break;
            }
        } catch (err) {
            if (!isFinished) {
                console.error('SSE Stream Error:', err);
            }
        }
    })();

    // Trigger a scrape job for LinkedIn with small limit
    console.log('Triggering scraping job...');
    const scrapeRes = await fetch(`${baseUrl}/api/scrape`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            platform: 'GoogleMaps',
            query: 'Plumber',
            location: 'Chicago',
            maxEntries: 2,
            speedMode: 'fast'
        })
    });

    if (!scrapeRes.ok) {
        reader.cancel();
        throw new Error(`Scrape trigger failed with status ${scrapeRes.status}: ${await scrapeRes.text()}`);
    }

    const triggerData = await scrapeRes.json();
    jobId = triggerData.jobId;
    console.log(`Job triggered successfully! Job ID: ${jobId}`);

    // Wait until finished
    while (!isFinished) {
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('Test execution completed.');
}

runTest().catch(err => {
    console.error('Test Execution Failed:', err);
});
