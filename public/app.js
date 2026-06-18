// Custom Modal Dialog Helpers
window.customAlert = function(message, title = 'Notification') {
    return new Promise((resolve) => {
        const modal = document.getElementById('customDialogModal');
        const titleEl = document.getElementById('customDialogTitle');
        const msgEl = document.getElementById('customDialogMessage');
        const inputContainer = document.getElementById('customDialogInputContainer');
        const cancelBtn = document.getElementById('customDialogCancelBtn');
        const confirmBtn = document.getElementById('customDialogConfirmBtn');
        const closeBtn = document.getElementById('customDialogCloseBtn');
        const backdrop = document.getElementById('customDialogBackdrop');

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;

        if (inputContainer) inputContainer.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';

        const closeAndResolve = () => {
            if (modal) modal.style.display = 'none';
            cleanup();
            resolve(true);
        };

        const cleanup = () => {
            if (confirmBtn) confirmBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (closeBtn) closeBtn.onclick = null;
            if (backdrop) backdrop.onclick = null;
        };

        if (confirmBtn) confirmBtn.onclick = closeAndResolve;
        if (closeBtn) closeBtn.onclick = closeAndResolve;
        if (backdrop) backdrop.onclick = closeAndResolve;

        if (modal) modal.style.display = 'flex';
    });
};

window.customConfirm = function(message, title = 'Confirm') {
    return new Promise((resolve) => {
        const modal = document.getElementById('customDialogModal');
        const titleEl = document.getElementById('customDialogTitle');
        const msgEl = document.getElementById('customDialogMessage');
        const inputContainer = document.getElementById('customDialogInputContainer');
        const cancelBtn = document.getElementById('customDialogCancelBtn');
        const confirmBtn = document.getElementById('customDialogConfirmBtn');
        const closeBtn = document.getElementById('customDialogCloseBtn');
        const backdrop = document.getElementById('customDialogBackdrop');

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;

        if (inputContainer) inputContainer.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'inline-block';

        const handleConfirm = () => {
            if (modal) modal.style.display = 'none';
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            if (modal) modal.style.display = 'none';
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            if (confirmBtn) confirmBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (closeBtn) closeBtn.onclick = null;
            if (backdrop) backdrop.onclick = null;
        };

        if (confirmBtn) confirmBtn.onclick = handleConfirm;
        if (cancelBtn) cancelBtn.onclick = handleCancel;
        if (closeBtn) closeBtn.onclick = handleCancel;
        if (backdrop) backdrop.onclick = handleCancel;

        if (modal) modal.style.display = 'flex';
    });
};

window.customPrompt = function(message, defaultValue = '', title = 'Prompt') {
    return new Promise((resolve) => {
        const modal = document.getElementById('customDialogModal');
        const titleEl = document.getElementById('customDialogTitle');
        const msgEl = document.getElementById('customDialogMessage');
        const inputContainer = document.getElementById('customDialogInputContainer');
        const inputEl = document.getElementById('customDialogInput');
        const cancelBtn = document.getElementById('customDialogCancelBtn');
        const confirmBtn = document.getElementById('customDialogConfirmBtn');
        const closeBtn = document.getElementById('customDialogCloseBtn');
        const backdrop = document.getElementById('customDialogBackdrop');

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;

        if (inputContainer) inputContainer.style.display = 'block';
        if (inputEl) inputEl.value = defaultValue;
        if (cancelBtn) cancelBtn.style.display = 'inline-block';

        const handleConfirm = () => {
            const val = inputEl ? inputEl.value : '';
            if (modal) modal.style.display = 'none';
            cleanup();
            resolve(val);
        };

        const handleCancel = () => {
            if (modal) modal.style.display = 'none';
            cleanup();
            resolve(null);
        };

        const cleanup = () => {
            if (confirmBtn) confirmBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (closeBtn) closeBtn.onclick = null;
            if (backdrop) backdrop.onclick = null;
        };

        if (confirmBtn) confirmBtn.onclick = handleConfirm;
        if (cancelBtn) cancelBtn.onclick = handleCancel;
        if (closeBtn) closeBtn.onclick = handleCancel;
        if (backdrop) backdrop.onclick = handleCancel;

        if (modal) modal.style.display = 'flex';
    });
};

document.addEventListener('DOMContentLoaded', () => {
    // Auth State Tracking
    let token = localStorage.getItem('scraper_token') || null;
    let currentUser = null;
    let eventSource = null;

    // Selectors for DOM elements
    const form = document.getElementById('scrapeForm');
    const platformSelect = document.getElementById('platform');
    const seniorityContainer = document.getElementById('seniorityContainer');
    const companySizeContainer = document.getElementById('companySizeContainer');
    const startBtn = document.getElementById('startBtn');
    const consoleOutput = document.getElementById('consoleOutput');
    const statusBadge = document.getElementById('statusBadge');
    const exportSection = document.getElementById('exportSection');
    const downloadCsvBtn = document.getElementById('downloadCsv');
    const downloadXlsxBtn = document.getElementById('downloadXlsx');
    const downloadZipBtn = document.getElementById('downloadZip');
    const timerBadge = document.getElementById('timerBadge');

    let currentLimit = 100;

    // Progress Toast Control Functions
    const progressCard = document.getElementById('scrapeProgressCard');
    const progressToastTitle = document.getElementById('progressToastTitle');
    const progressPercentText = document.getElementById('progressPercentText');
    const progressBarFill = document.getElementById('progressBarFill');
    const progressLeadsCountText = document.getElementById('progressLeadsCountText');
    
    let progressToastTimeout = null;

    function showProgressToast(limit) {
        if (progressToastTimeout) {
            clearTimeout(progressToastTimeout);
        }
        progressBarFill.style.background = ''; // Reset custom background colors
        progressBarFill.style.width = '0%';
        progressPercentText.textContent = '0%';
        progressLeadsCountText.textContent = `0 / ${limit} Leads extracted`;
        progressToastTitle.innerHTML = `<span id="progressToastSpinner" class="spinner-icon"></span> Extracting Leads...`;
        
        progressCard.classList.add('show');
    }

    function updateProgressToast(progress, leadsCount, limit, stateMessage) {
        if (!progressCard.classList.contains('show')) {
            progressCard.classList.add('show');
        }
        const pct = Math.min(Math.max(0, progress), 100);
        progressBarFill.style.width = `${pct}%`;
        progressPercentText.textContent = `${pct}%`;
        progressLeadsCountText.textContent = `${leadsCount} / ${limit} Leads extracted`;
        if (stateMessage) {
            progressToastTitle.innerHTML = `<span id="progressToastSpinner" class="spinner-icon"></span> ${stateMessage}`;
        } else {
            progressToastTitle.innerHTML = `<span id="progressToastSpinner" class="spinner-icon"></span> Extracting Leads...`;
        }
    }

    function completeProgressToast(leadsCount, limit) {
        progressBarFill.style.width = '100%';
        progressPercentText.textContent = '100%';
        progressBarFill.style.background = '#10b981'; // Green for success
        progressLeadsCountText.textContent = `Successfully extracted ${leadsCount} leads!`;
        progressToastTitle.innerHTML = `✅ Extraction Complete`;
        
        progressToastTimeout = setTimeout(() => {
            progressCard.classList.remove('show');
        }, 4000);
    }

    function errorProgressToast(message) {
        progressBarFill.style.width = '100%';
        progressPercentText.textContent = 'Error';
        progressBarFill.style.background = '#ef4444'; // Red for error
        progressLeadsCountText.textContent = message || 'Scraping job failed.';
        progressToastTitle.innerHTML = `❌ Extraction Failed`;
        
        progressToastTimeout = setTimeout(() => {
            progressCard.classList.remove('show');
        }, 6000);
    }

    // Tab Navigation Selectors
    const tabScraper = document.getElementById('tabScraper');
    const tabHistory = document.getElementById('tabHistory');
    const tabSettings = document.getElementById('tabSettings');
    const scraperTabPanel = document.getElementById('scraperTabPanel');
    const historyTabPanel = document.getElementById('historyTabPanel');
    const settingsTabPanel = document.getElementById('settingsTabPanel');
    const historyTableBody = document.getElementById('historyTableBody');

    // Scrape History Controls & Pagination Selectors
    const selectAllHistory = document.getElementById('selectAllHistory');
    const historyDateFilter = document.getElementById('historyDateFilter');
    const historyUserFilter = document.getElementById('historyUserFilter');
    const historySortSelect = document.getElementById('historySortSelect');
    const historyLimitSelect = document.getElementById('historyLimitSelect');
    const prevHistoryPageBtn = document.getElementById('prevHistoryPageBtn');
    const nextHistoryPageBtn = document.getElementById('nextHistoryPageBtn');
    const historyPageIndicator = document.getElementById('historyPageIndicator');
    const bulkActionsBtn = document.getElementById('bulkActionsBtn');
    const bulkActionsMenu = document.getElementById('bulkActionsMenu');
    const bulkDlCsvBtn = document.getElementById('bulkDlCsvBtn');
    const bulkDlXlsxBtn = document.getElementById('bulkDlXlsxBtn');
    const bulkDlZipBtn = document.getElementById('bulkDlZipBtn');
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
 
    // Selectors for Modal Leads Preview
    const previewModal = document.getElementById('previewModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const modalRecordCountBadge = document.getElementById('modalRecordCountBadge');
    const modalLeadsTableBody = document.getElementById('modalLeadsTableBody');
    const prevModalLeadsPageBtn = document.getElementById('prevModalLeadsPageBtn');
    const nextModalLeadsPageBtn = document.getElementById('nextModalLeadsPageBtn');
    const modalLeadsPageIndicator = document.getElementById('modalLeadsPageIndicator');
    const modalDownloadCsv = document.getElementById('modalDownloadCsv');
    const modalDownloadXlsx = document.getElementById('modalDownloadXlsx');
    const modalDownloadZip = document.getElementById('modalDownloadZip');

    let modalLeadsData = [];
    let currentModalTablePage = 1;
    const modalLeadsPerPage = 10;

    let currentJobId = null;
    let timerInterval = null;
    let timerStartTime = null;

    // History Table States
    let historyList = [];
    let selectedJobIds = new Set();
    let historyCurrentPage = 1;
    let historyRowsPerPage = 10;
    let currentPlatformFilter = 'all';

    // Categories array populated dynamically
    let categories = [];

    // Cascading Location Database
    const locationDb = {
        "US": {
            name: "United States",
            states: {
                "NY": {
                    name: "New York",
                    cities: ["New York City", "Buffalo", "Rochester", "Yonkers", "Syracuse"]
                },
                "CA": {
                    name: "California",
                    cities: ["Los Angeles", "San Francisco", "San Diego", "San Jose", "Sacramento"]
                },
                "TX": {
                    name: "Texas",
                    cities: ["Houston", "San Antonio", "Dallas", "Austin", "Fort Worth"]
                },
                "FL": {
                    name: "Florida",
                    cities: ["Miami", "Orlando", "Tampa", "Jacksonville", "Tallahassee"]
                },
                "IL": {
                    name: "Illinois",
                    cities: ["Chicago", "Aurora", "Naperville", "Rockford", "Joliet"]
                }
            }
        },
        "CA": {
            name: "Canada",
            states: {
                "ON": {
                    name: "Ontario",
                    cities: ["Toronto", "Ottawa", "Mississauga", "Hamilton", "London"]
                },
                "QC": {
                    name: "Quebec",
                    cities: ["Montreal", "Quebec City", "Laval", "Gatineau", "Sherbrooke"]
                },
                "BC": {
                    name: "British Columbia",
                    cities: ["Vancouver", "Victoria", "Surrey", "Burnaby", "Richmond"]
                }
            }
        },
        "GB": {
            name: "United Kingdom",
            states: {
                "ENG": {
                    name: "England",
                    cities: ["London", "Birmingham", "Manchester", "Leeds", "Liverpool"]
                },
                "SCT": {
                    name: "Scotland",
                    cities: ["Edinburgh", "Glasgow", "Aberdeen", "Dundee", "Inverness"]
                },
                "WLS": {
                    name: "Wales",
                    cities: ["Cardiff", "Swansea", "Newport", "Bangor", "St Asaph"]
                }
            }
        }
    };

    // Tracking active dropdown values
    let selectedCountryCode = "";
    let selectedStateCode = "";

    // Auth Fetch wrapper
    async function authFetch(url, options = {}) {
        options.headers = options.headers || {};
        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }
        const response = await fetch(url, options);
        if (response.status === 401) {
            logout();
            throw new Error('Session expired or unauthorized');
        }
        return response;
    }

    // Connect to SSE stream
    function initSSEStream() {
        if (eventSource) {
            eventSource.close();
        }
        
        eventSource = new EventSource(`/api/stream?token=${token}`);

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.jobId && data.jobId !== currentJobId) {
                return;
            }

            if (data.message) {
                appendLog(data.message, data.isError);
            }

            if (data.progress !== undefined || data.leadsCount !== undefined) {
                updateProgressToast(data.progress || 0, data.leadsCount || 0, data.limit || currentLimit, data.stateMessage);
            }

            if (data.isComplete) {
                updateStatus('Completed', 'completed');
                stopTimer('Completed');
                startBtn.disabled = false;
                exportSection.style.display = 'block';
                if (currentJobId) {
                    loadJobResults(currentJobId);
                }
                loadHistory(); // Reload history checklist
                completeProgressToast(data.leadsCount || (leadsData ? leadsData.length : 0), data.limit || currentLimit);
            }

            if (data.isError) {
                updateStatus('Error', 'error');
                stopTimer('Error');
                startBtn.disabled = false;
                errorProgressToast(data.message || 'Scraping job failed.');
            }
        };

        eventSource.onerror = (err) => {
            console.error("SSE Connection error", err);
        };
    }

    // Auth verification status checker
    async function checkAuthStatus() {
        const authContainer = document.getElementById('authContainer');
        const appContainer = document.getElementById('appContainer');

        if (!token) {
            authContainer.style.display = 'flex';
            appContainer.style.display = 'none';
            return;
        }

        try {
            const response = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                currentUser = data.user;

                // Toggle visibility
                authContainer.style.display = 'none';
                appContainer.style.display = 'flex';

                // Render session profile header info
                document.getElementById('userProfileHeader').style.display = 'flex';
                document.getElementById('userHeaderName').textContent = currentUser.username;
                document.getElementById('userHeaderRole').textContent = currentUser.role;
                
                // Set first letter avatar
                const userAvatar = document.getElementById('userAvatar');
                if (userAvatar && currentUser.username) {
                    userAvatar.textContent = currentUser.username.charAt(0).toUpperCase();
                }

                applyRoleUI();

                // Load initial authenticated datasets
                loadHistory();
                loadCategoriesDropdown();
                initSSEStream();
            } else {
                logout();
            }
        } catch (err) {
            console.error('Authentication check failed:', err);
            logout();
        }
    }

    function applyRoleUI() {
        const adminOnlyElements = document.querySelectorAll('.admin-only');
        const adminOnlyTh = document.querySelectorAll('.admin-only-th');
        const addCategoryContainer = document.getElementById('addCategoryContainer');
        const categoriesHelperText = document.getElementById('categoriesHelperText');
        const canManage = currentUser && (currentUser.role === 'admin' || currentUser.canManageCategories);

        if (currentUser && currentUser.role === 'admin') {
            adminOnlyElements.forEach(el => el.style.display = 'block');
            adminOnlyTh.forEach(el => el.style.display = 'table-cell');
        } else {
            adminOnlyElements.forEach(el => el.style.display = 'none');
            adminOnlyTh.forEach(el => el.style.display = 'none');
        }

        const historyUserFilterGroup = document.getElementById('historyUserFilterGroup');
        if (historyUserFilterGroup) {
            historyUserFilterGroup.style.display = (currentUser && currentUser.role === 'admin') ? 'flex' : 'none';
        }

        if (canManage) {
            if (addCategoryContainer) addCategoryContainer.style.display = 'flex';
            if (categoriesHelperText) categoriesHelperText.textContent = "Create, edit, or delete categories shown in the scraper query dropdown selector.";
            tabSettings.style.display = ''; // Show Settings tab
        } else {
            if (addCategoryContainer) addCategoryContainer.style.display = 'none';
            if (categoriesHelperText) categoriesHelperText.textContent = "View categories shown in the scraper query dropdown selector (Read-only for standard users).";
            tabSettings.style.display = 'none'; // Hide Settings tab completely
            if (settingsTabPanel.classList.contains('active')) {
                switchTab('scraper');
            }
        }
        const canDelete = currentUser && (currentUser.role === 'admin' || currentUser.canDeleteHistory === true);
        if (bulkDeleteBtn) bulkDeleteBtn.style.display = canDelete ? 'block' : 'none';
    }

    function logout() {
        localStorage.removeItem('scraper_token');
        token = null;
        currentUser = null;
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        checkAuthStatus();
    }

    platformSelect.addEventListener('change', () => {
        if (platformSelect.value === 'linkedin') {
            seniorityContainer.style.display = 'block';
            companySizeContainer.style.display = 'block';
        } else {
            seniorityContainer.style.display = 'none';
            companySizeContainer.style.display = 'none';
        }
    });

    // Sidebar Toggle Logic
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // Platform Selection Tabs Logic
    const platTabs = document.querySelectorAll('.plat-tab');
    platTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            platTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            platformSelect.value = tab.getAttribute('data-val');
            platformSelect.dispatchEvent(new Event('change'));
        });
    });

    // Maximum Entries Shortcuts Logic
    const maxEntriesInput = document.getElementById('maxEntries');
    const shortcutBtns = document.querySelectorAll('.entry-shortcuts:not(#speedModeShortcuts) .shortcut-btn');

    if (maxEntriesInput && shortcutBtns.length > 0) {
        shortcutBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.getAttribute('data-val');
                maxEntriesInput.value = val;
                
                shortcutBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                maxEntriesInput.dispatchEvent(new Event('change'));
            });
        });

        maxEntriesInput.addEventListener('input', () => {
            const val = maxEntriesInput.value.trim();
            shortcutBtns.forEach(btn => {
                if (btn.getAttribute('data-val') === val) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        });
    }

    // Speed Mode Shortcuts Logic
    const speedModeInput = document.getElementById('speedMode');
    const speedBtns = document.querySelectorAll('.speed-btn');

    if (speedModeInput && speedBtns.length > 0) {
        speedBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.getAttribute('data-val');
                speedModeInput.value = val;
                
                speedBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    }

    // Live Console Collapsible Toggle Logic - Removed collapsible state since it is always expanded when enabled
    function setConsoleVisibility(visible) {
        // No-op, console is always expanded
    }

    // Sidebar Console Enabled/Disabled Toggle Logic
    const toggleConsoleSidebarBtn = document.getElementById('toggleConsoleSidebarBtn');
    const scraperDashboardLayout = document.querySelector('.scraper-dashboard-layout');
    
    let isConsoleEnabled = localStorage.getItem('console_enabled') !== 'false';
    
    function applyConsoleState() {
        if (!toggleConsoleSidebarBtn || !scraperDashboardLayout) return;
        const consoleText = toggleConsoleSidebarBtn.querySelector('.nav-text');
        
        if (isConsoleEnabled) {
            scraperDashboardLayout.classList.remove('console-hidden');
            toggleConsoleSidebarBtn.classList.add('active');
            if (consoleText) consoleText.textContent = "Hide Console";
        } else {
            scraperDashboardLayout.classList.add('console-hidden');
            toggleConsoleSidebarBtn.classList.remove('active');
            if (consoleText) consoleText.textContent = "Show Console";
        }
    }

    if (toggleConsoleSidebarBtn && scraperDashboardLayout) {
        applyConsoleState();
        toggleConsoleSidebarBtn.addEventListener('click', () => {
            isConsoleEnabled = !isConsoleEnabled;
            localStorage.setItem('console_enabled', isConsoleEnabled);
            applyConsoleState();
        });
    }

    // Toggle tabs
    tabScraper.addEventListener('click', () => {
        switchTab('scraper');
    });

    tabHistory.addEventListener('click', () => {
        switchTab('history');
        loadHistory();
    });

    tabSettings.addEventListener('click', () => {
        switchTab('settings');
        loadSettings();
    });

    function switchTab(tabName) {
        tabScraper.classList.remove('active');
        tabHistory.classList.remove('active');
        tabSettings.classList.remove('active');
        scraperTabPanel.classList.remove('active');
        historyTabPanel.classList.remove('active');
        settingsTabPanel.classList.remove('active');

        if (tabName === 'scraper') {
            tabScraper.classList.add('active');
            scraperTabPanel.classList.add('active');
        } else if (tabName === 'history') {
            tabHistory.classList.add('active');
            historyTabPanel.classList.add('active');
        } else if (tabName === 'settings') {
            tabSettings.classList.add('active');
            settingsTabPanel.classList.add('active');
        }
    }

    // Platform Filter Tabs Event Listeners
    const platformTabBtns = document.querySelectorAll('.platform-tab-btn');
    platformTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            platformTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPlatformFilter = btn.getAttribute('data-platform');
            historyCurrentPage = 1;
            renderHistoryTable();
        });
    });

    function startTimer() {
        if (timerInterval) clearInterval(timerInterval);
        timerStartTime = Date.now();

        // Reset styles for running state
        timerBadge.style.display = 'inline-block';
        timerBadge.style.background = 'rgba(148, 163, 184, 0.15)';
        timerBadge.style.borderColor = 'rgba(148, 163, 184, 0.3)';
        timerBadge.style.color = '#cbd5e1';
        timerBadge.textContent = '00:00.0';

        timerInterval = setInterval(() => {
            const elapsed = Date.now() - timerStartTime;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            const deciseconds = Math.floor((elapsed % 1000) / 100);

            const minStr = String(minutes).padStart(2, '0');
            const secStr = String(seconds).padStart(2, '0');

            timerBadge.textContent = `${minStr}:${secStr}.${deciseconds}`;
        }, 100);
    }

    function stopTimer(finalStatus = '') {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        if (timerStartTime) {
            const elapsed = Date.now() - timerStartTime;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            const ms = elapsed % 1000;

            const timeMsg = `Scrape session completed in ${minutes}m ${seconds}s ${ms}ms.`;
            appendLog(timeMsg);

            if (finalStatus === 'Completed') {
                timerBadge.textContent = `Completed in ${minutes}:${String(seconds).padStart(2, '0')}.${Math.floor(ms / 100)}`;
                timerBadge.style.background = 'rgba(16, 185, 129, 0.2)';
                timerBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                timerBadge.style.color = '#34d399';
            } else if (finalStatus === 'Error') {
                timerBadge.textContent = `Failed in ${minutes}:${String(seconds).padStart(2, '0')}.${Math.floor(ms / 100)}`;
                timerBadge.style.background = 'rgba(239, 68, 68, 0.2)';
                timerBadge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                timerBadge.style.color = '#fca5a5';
            }
        }
    }

    // Dynamic dropdown loader for Category
    async function loadCategoriesDropdown() {
        try {
            const res = await authFetch('/api/categories');
            if (res.ok) {
                const data = await res.json();
                categories = data.map(c => c.name);
                // Initialize searchable dropdown behaviors with fetched values
                setupSearchableDropdown("categoryDropdown", "categoryList", "queryInput", categories, () => { });
            }
        } catch (err) {
            console.error('Failed to load category list:', err);
        }
    }

    const countries = Object.keys(locationDb).map(code => ({ value: code, text: locationDb[code].name }));
    setupSearchableDropdown("countryDropdown", "countryList", "countryInput", countries, (item) => {
        selectedCountryCode = item.value;
        selectedStateCode = "";

        // Reset and enable State dropdown
        const stateInput = document.getElementById("stateInput");
        stateInput.value = "";
        stateInput.disabled = false;

        const cityInput = document.getElementById("cityInput");
        cityInput.value = "";
        cityInput.disabled = true;

        const states = Object.keys(locationDb[selectedCountryCode].states).map(code => ({
            value: code,
            text: locationDb[selectedCountryCode].states[code].name
        }));

        setupSearchableDropdown("stateDropdown", "stateList", "stateInput", states, (stateItem) => {
            selectedStateCode = stateItem.value;

            // Reset and enable City dropdown
            cityInput.value = "";
            cityInput.disabled = false;

            const cities = locationDb[selectedCountryCode].states[selectedStateCode].cities;
            setupSearchableDropdown("cityDropdown", "cityList", "cityInput", cities, () => { });
        });
    });

    // Setup target seniority dropdown
    const seniorityItems = [
        { value: 'all', text: 'All Seniorities / Any' },
        { value: 'executive', text: 'C-Suite / Executive' },
        { value: 'vp_director', text: 'VP & Directors' },
        { value: 'manager', text: 'Managers & Leads' }
    ];
    const targetSeniorityInput = document.getElementById('seniorityInput');
    if (targetSeniorityInput) {
        targetSeniorityInput.value = 'All Seniorities / Any';
        setupSearchableDropdown("seniorityDropdown", "seniorityList", "seniorityInput", seniorityItems, (selected) => {
            document.getElementById('seniority').value = selected.value;
        });
    }

    // Setup target company size dropdown
    const companySizeItems = [
        { value: 'all', text: 'All Sizes / Any' },
        { value: '1-10', text: '1 - 10 employees' },
        { value: '11-50', text: '11 - 50 employees' },
        { value: '51-200', text: '51 - 200 employees' },
        { value: '201-500', text: '201 - 500 employees' },
        { value: '501-1000', text: '501 - 1,000 employees' },
        { value: '1001-5000', text: '1,001 - 5,000 employees' },
        { value: '5001-10000', text: '5,001 - 10,000 employees' },
        { value: '10001+', text: '10,001+ employees' }
    ];
    const targetCompanySizeInput = document.getElementById('companySizeInput');
    if (targetCompanySizeInput) {
        targetCompanySizeInput.value = 'All Sizes / Any';
        setupSearchableDropdown("companySizeDropdown", "companySizeList", "companySizeInput", companySizeItems, (selected) => {
            document.getElementById('companySize').value = selected.value;
        });
    }


    // Universal Dropdown Generator
    function setupSearchableDropdown(containerId, listId, inputId, items, onSelect) {
        const container = document.getElementById(containerId);
        const list = document.getElementById(listId);
        const input = document.getElementById(inputId);

        // Populate items initially
        renderList(items);

        // Toggle list visibility on click / focus
        input.addEventListener('focus', () => {
            closeAllDropdownsExcept(container);
            list.style.display = 'block';
        });

        input.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllDropdownsExcept(container);
            list.style.display = 'block';
        });

        // Filter list on search query typing
        input.addEventListener('input', () => {
            const val = input.value.toLowerCase().trim();
            const filtered = items.filter(item => {
                const text = typeof item === 'string' ? item : item.text;
                return text.toLowerCase().includes(val);
            });
            renderList(filtered);
        });

        function renderList(renderItems) {
            list.innerHTML = "";
            if (renderItems.length === 0) {
                const empty = document.createElement("div");
                empty.className = "dropdown-item no-results";
                empty.textContent = "No results found";
                list.appendChild(empty);
                return;
            }

            renderItems.forEach(item => {
                const text = typeof item === 'string' ? item : item.text;
                const value = typeof item === 'string' ? item : item.value;

                const div = document.createElement("div");
                div.className = "dropdown-item";
                div.textContent = text;
                div.addEventListener('click', (e) => {
                    e.stopPropagation();
                    input.value = text;
                    input.dataset.value = value;
                    list.style.display = 'none';
                    onSelect({ value, text });
                });
                list.appendChild(div);
            });
        }
    }

    function closeAllDropdownsExcept(exceptContainer = null) {
        document.querySelectorAll('.searchable-dropdown').forEach(dropdown => {
            if (dropdown !== exceptContainer) {
                const list = dropdown.querySelector('.dropdown-list');
                if (list) list.style.display = 'none';
            }
        });
    }

    // Close lists when clicking outside
    document.addEventListener('click', () => {
        closeAllDropdownsExcept();
    });

    // ScRef Form Submit handler
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const platform = platformSelect.value;
        const query = document.getElementById('queryInput').value;

        // Structure location as City, State
        const cityVal = document.getElementById('cityInput').value;
        const stateInput = document.getElementById('stateInput');
        const stateVal = stateInput.value;
        const stateCode = stateInput.dataset.value;

        let formattedLocation = `${cityVal}, ${stateVal}`;
        if (selectedCountryCode === "US" || selectedCountryCode === "CA") {
            formattedLocation = `${cityVal}, ${stateCode}`; // e.g. New York City, NY
        } else if (selectedCountryCode === "GB") {
            formattedLocation = `${cityVal}, ${stateVal}`; // e.g. London, England
        }

        const maxEntries = parseInt(document.getElementById('maxEntries').value, 10) || 100;
        currentLimit = maxEntries;
        const seniority = document.getElementById('seniority').value;
        const companySize = document.getElementById('companySize').value;
        const speedMode = document.getElementById('speedMode').value;

        // Reset UI
        if (!isConsoleEnabled) {
            isConsoleEnabled = true;
            localStorage.setItem('console_enabled', true);
            applyConsoleState();
        }
        setConsoleVisibility(true);
        consoleOutput.innerHTML = '';
        exportSection.style.display = 'none';
        if (document.getElementById('resultsTableSection')) {
            document.getElementById('resultsTableSection').style.display = 'none';
        }
        leadsData = [];
        startBtn.disabled = true;
        updateStatus('Running', 'running');
        startTimer();

        try {
            const response = await authFetch('/api/scrape', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ platform, query, location: formattedLocation, maxEntries, seniority, companySize, speedMode })
            });

            const data = await response.json();

            if (response.ok) {
                currentJobId = data.jobId;
                appendLog(`Job ${currentJobId} started on ${platform}...`);
                showProgressToast(currentLimit);
            } else {
                appendLog(`Failed to start job: ${data.error}`, true);
                updateStatus('Error', 'error');
                startBtn.disabled = false;
                errorProgressToast(data.error || 'Failed to start job.');
            }
        } catch (error) {
            appendLog(`Network error: ${error.message}`, true);
            updateStatus('Error', 'error');
            startBtn.disabled = false;
            errorProgressToast(error.message || 'Network error occurred.');
        }
    });

    downloadCsvBtn.addEventListener('click', () => {
        if (currentJobId) {
            window.location.href = `/api/download/${currentJobId}?format=csv&token=${token}`;
        }
    });

    downloadXlsxBtn.addEventListener('click', () => {
        if (currentJobId) {
            window.location.href = `/api/download/${currentJobId}?format=xlsx&token=${token}`;
        }
    });

    downloadZipBtn.addEventListener('click', () => {
        if (currentJobId) {
            window.location.href = `/api/download/${currentJobId}?format=zip&token=${token}`;
        }
    });

    prevModalLeadsPageBtn.addEventListener('click', () => {
        if (currentModalTablePage > 1) {
            currentModalTablePage--;
            renderModalLeadsTable();
        }
    });

    nextModalLeadsPageBtn.addEventListener('click', () => {
        const maxPage = Math.ceil(modalLeadsData.length / modalLeadsPerPage);
        if (currentModalTablePage < maxPage) {
            currentModalTablePage++;
            renderModalLeadsTable();
        }
    });

    modalDownloadCsv.addEventListener('click', () => {
        if (currentJobId) {
            window.location.href = `/api/download/${currentJobId}?format=csv&token=${token}`;
        }
    });

    modalDownloadXlsx.addEventListener('click', () => {
        if (currentJobId) {
            window.location.href = `/api/download/${currentJobId}?format=xlsx&token=${token}`;
        }
    });

    modalDownloadZip.addEventListener('click', () => {
        if (currentJobId) {
            window.location.href = `/api/download/${currentJobId}?format=zip&token=${token}`;
        }
    });

    closeModalBtn.addEventListener('click', () => {
        previewModal.style.display = 'none';
    });

    previewModal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-backdrop')) {
            previewModal.style.display = 'none';
        }
    });

    function appendLog(message, isError = false) {
        const line = document.createElement('div');
        line.className = `console-line ${isError ? 'error' : ''}`;

        const timestamp = new Date().toLocaleTimeString();
        line.textContent = `[${timestamp}] ${message}`;

        consoleOutput.appendChild(line);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }

    function updateStatus(text, className) {
        statusBadge.textContent = text;
        statusBadge.className = `badge ${className}`;
    }

    // Pagination & Preview Table State
    let leadsData = [];
    let currentTablePage = 1;
    const recordsPerPage = 10;

    const resultsTableSection = document.getElementById('resultsTableSection');
    const recordCountBadge = document.getElementById('recordCountBadge');
    const leadsTableBody = document.getElementById('leadsTableBody');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageIndicator = document.getElementById('pageIndicator');

    prevPageBtn.addEventListener('click', () => {
        if (currentTablePage > 1) {
            currentTablePage--;
            renderLeadsTable();
        }
    });

    nextPageBtn.addEventListener('click', () => {
        const maxPage = Math.ceil(leadsData.length / recordsPerPage);
        if (currentTablePage < maxPage) {
            currentTablePage++;
            renderLeadsTable();
        }
    });

    async function loadJobResults(jobId) {
        try {
            const response = await authFetch(`/api/scrape/${jobId}`);
            if (response.ok) {
                const resData = await response.json();
                if (resData.data && resData.data.length > 0) {
                    leadsData = resData.data;
                    currentTablePage = 1;

                    // Show results preview section
                    resultsTableSection.style.display = 'block';
                    recordCountBadge.textContent = `${leadsData.length} Records`;

                    renderLeadsTable();
                } else {
                    resultsTableSection.style.display = 'none';
                }
            }
        } catch (err) {
            console.error('Failed to load job results:', err);
        }
    }

    function renderLeadsTable() {
        leadsTableBody.innerHTML = '';

        recordCountBadge.textContent = `${leadsData.length} Records`;

        if (leadsData.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `<td colspan="9" style="text-align: center; color: #64748b;">No records found.</td>`;
            leadsTableBody.appendChild(emptyRow);

            pageIndicator.textContent = `Page 1 of 1`;
            prevPageBtn.disabled = true;
            nextPageBtn.disabled = true;
            return;
        }

        const startIndex = (currentTablePage - 1) * recordsPerPage;
        const endIndex = Math.min(startIndex + recordsPerPage, leadsData.length);
        const pageData = leadsData.slice(startIndex, endIndex);

        pageData.forEach(row => {
            const tr = document.createElement('tr');

            // Format LinkedIn Name link
            let nameCell = `<strong>${row.name || 'N/A'}</strong>`;
            if (row.profileUrl && row.profileUrl !== 'N/A' && row.profileUrl.startsWith('http')) {
                const status = row.linkedinStatus || 'Pending';
                nameCell = `<a href="${row.profileUrl}" target="_blank" class="table-linkedin-link" data-linkedin-status="${status}" title="LinkedIn Status: ${status}"><strong>${row.name}</strong></a>`;
            }

            // Format email cells with pills and statuses
            let emailCell = 'N/A';
            if (row.email && row.email !== 'N/A') {
                const badges = row.email.split(', ').map(e => {
                    const status = row.emailStatus || 'Pending';
                    return `<span class="table-email-badge" data-email-status="${status}" title="Email Deliverability: ${status}">${e}</span>`;
                }).join(' ');
                emailCell = `<div class="table-badges-container">${badges}</div>`;
            }

            // Format phone cells with pills and line types
            let phoneCell = 'N/A';
            if (row.phone && row.phone !== 'N/A') {
                const badges = row.phone.split(', ').map(p => {
                    const status = row.phoneStatus || 'Pending';
                    return `<span class="table-phone-badge" data-phone-status="${status}" title="Phone Line Type: ${status}">${p}</span>`;
                }).join(' ');
                phoneCell = `<div class="table-badges-container">${badges}</div>`;
            }

            // Format website link with status
            let websiteCell = 'N/A';
            if (row.website && row.website !== 'N/A') {
                const status = row.websiteStatus || 'Pending';
                websiteCell = `<a href="${row.website}" target="_blank" class="table-website-link" data-web-status="${status}" title="Website DNS Status: ${status}">${row.website}</a>`;
            }

            tr.innerHTML = `
                <td>${nameCell}</td>
                <td title="${row.title || 'N/A'}">${row.title || 'N/A'}</td>
                <td><span class="table-seniority-badge" data-seniority="${row.seniority || 'Individual Contributor'}">${row.seniority || 'Individual Contributor'}</span></td>
                <td><span class="table-dept-badge" data-dept="${row.department || 'Operations'}">${row.department || 'Operations'}</span></td>
                <td>${row.companySize || 'N/A'}</td>
                <td>${row.location || 'N/A'}</td>
                <td>${emailCell}</td>
                <td>${phoneCell}</td>
                <td>${websiteCell}</td>
            `;
            leadsTableBody.appendChild(tr);
        });

        // Update pagination buttons & indicator
        const totalPages = Math.ceil(leadsData.length / recordsPerPage) || 1;
        pageIndicator.textContent = `Page ${currentTablePage} of ${totalPages}`;

        prevPageBtn.disabled = currentTablePage === 1;
        nextPageBtn.disabled = currentTablePage === totalPages;
    }

    async function loadModalJobResults(jobId) {
        try {
            const response = await authFetch(`/api/scrape/${jobId}`);
            if (response.ok) {
                const resData = await response.json();
                if (resData.data && resData.data.length > 0) {
                    modalLeadsData = resData.data;
                    currentModalTablePage = 1;

                    // Show results preview modal popup
                    previewModal.style.display = 'flex';
                    modalRecordCountBadge.textContent = `${modalLeadsData.length} Records`;

                    renderModalLeadsTable();
                } else {
                    previewModal.style.display = 'none';
                }
            }
        } catch (err) {
            console.error('Failed to load modal job results:', err);
        }
    }

    function renderModalLeadsTable() {
        modalLeadsTableBody.innerHTML = '';

        modalRecordCountBadge.textContent = `${modalLeadsData.length} Records`;

        if (modalLeadsData.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `<td colspan="9" style="text-align: center; color: #64748b;">No records found.</td>`;
            modalLeadsTableBody.appendChild(emptyRow);

            modalLeadsPageIndicator.textContent = `Page 1 of 1`;
            prevModalLeadsPageBtn.disabled = true;
            nextModalLeadsPageBtn.disabled = true;
            return;
        }

        const startIndex = (currentModalTablePage - 1) * modalLeadsPerPage;
        const endIndex = Math.min(startIndex + modalLeadsPerPage, modalLeadsData.length);
        const pageData = modalLeadsData.slice(startIndex, endIndex);

        pageData.forEach(row => {
            const tr = document.createElement('tr');

            // Format LinkedIn Name link
            let nameCell = `<strong>${row.name || 'N/A'}</strong>`;
            if (row.profileUrl && row.profileUrl !== 'N/A' && row.profileUrl.startsWith('http')) {
                const status = row.linkedinStatus || 'Pending';
                nameCell = `<a href="${row.profileUrl}" target="_blank" class="table-linkedin-link" data-linkedin-status="${status}" title="LinkedIn Status: ${status}"><strong>${row.name}</strong></a>`;
            }

            // Format email cells with pills and statuses
            let emailCell = 'N/A';
            if (row.email && row.email !== 'N/A') {
                const badges = row.email.split(', ').map(e => {
                    const status = row.emailStatus || 'Pending';
                    return `<span class="table-email-badge" data-email-status="${status}" title="Email Deliverability: ${status}">${e}</span>`;
                }).join(' ');
                emailCell = `<div class="table-badges-container">${badges}</div>`;
            }

            // Format phone cells with pills and line types
            let phoneCell = 'N/A';
            if (row.phone && row.phone !== 'N/A') {
                const badges = row.phone.split(', ').map(p => {
                    const status = row.phoneStatus || 'Pending';
                    return `<span class="table-phone-badge" data-phone-status="${status}" title="Phone Line Type: ${status}">${p}</span>`;
                }).join(' ');
                phoneCell = `<div class="table-badges-container">${badges}</div>`;
            }

            // Format website link with status
            let websiteCell = 'N/A';
            if (row.website && row.website !== 'N/A') {
                const status = row.websiteStatus || 'Pending';
                websiteCell = `<a href="${row.website}" target="_blank" class="table-website-link" data-web-status="${status}" title="Website DNS Status: ${status}">${row.website}</a>`;
            }

            tr.innerHTML = `
                <td>${nameCell}</td>
                <td title="${row.title || 'N/A'}">${row.title || 'N/A'}</td>
                <td><span class="table-seniority-badge" data-seniority="${row.seniority || 'Individual Contributor'}">${row.seniority || 'Individual Contributor'}</span></td>
                <td><span class="table-dept-badge" data-dept="${row.department || 'Operations'}">${row.department || 'Operations'}</span></td>
                <td>${row.companySize || 'N/A'}</td>
                <td>${row.location || 'N/A'}</td>
                <td>${emailCell}</td>
                <td>${phoneCell}</td>
                <td>${websiteCell}</td>
            `;
            modalLeadsTableBody.appendChild(tr);
        });

        // Update pagination buttons & indicator
        const totalPages = Math.ceil(modalLeadsData.length / modalLeadsPerPage) || 1;
        modalLeadsPageIndicator.textContent = `Page ${currentModalTablePage} of ${totalPages}`;

        prevModalLeadsPageBtn.disabled = currentModalTablePage === 1;
        nextModalLeadsPageBtn.disabled = currentModalTablePage === totalPages;
    }

    function populateHistoryUserFilter() {
        if (!currentUser || currentUser.role !== 'admin') return;
        const select = document.getElementById('historyUserFilter');
        if (!select) return;
        
        const currentSelection = select.value;
        select.innerHTML = '<option value="all">All Users</option>';
        
        const uniqueUsers = new Set();
        historyList.forEach(item => {
            const username = item.userId ? (item.userId.username || 'Deleted User') : (item.username || 'Deleted User');
            if (username && username !== 'N/A') {
                uniqueUsers.add(username);
            }
        });
        
        Array.from(uniqueUsers).sort().forEach(username => {
            const opt = document.createElement('option');
            opt.value = username;
            opt.textContent = username;
            select.appendChild(opt);
        });
        
        select.value = currentSelection;
        if (!select.value) {
            select.value = 'all';
        }
    }

    // Dynamic History & De-duplication Loader
    async function loadHistory() {
        try {
            const response = await authFetch('/api/history');
            if (response.ok) {
                historyList = await response.json();
                populateHistoryUserFilter();
                renderHistoryTable();
            }
        } catch (err) {
            console.error('Failed to load history list:', err);
        }
    }

    function getFilteredHistory() {
        let filtered = historyList;
        if (currentPlatformFilter !== 'all') {
            filtered = filtered.filter(item => (item.platform || '').toLowerCase() === currentPlatformFilter);
        }
        const dateVal = historyDateFilter.value;
        if (dateVal) {
            filtered = filtered.filter(item => {
                const itemDate = new Date(item.timestamp).toLocaleDateString('en-CA');
                return itemDate === dateVal;
            });
        }
        if (historyUserFilter && historyUserFilter.value !== 'all') {
            filtered = filtered.filter(item => {
                const username = item.userId ? (item.userId.username || 'Deleted User') : (item.username || 'Deleted User');
                return username === historyUserFilter.value;
            });
        }
        return filtered;
    }

    function renderHistoryTable() {
        historyTableBody.innerHTML = '';

        // Apply Filtering by Platform and Date
        let filtered = getFilteredHistory();

        // Apply Sorting
        const sortVal = historySortSelect.value;
        if (sortVal === 'newest') {
            filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        } else if (sortVal === 'oldest') {
            filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        } else if (sortVal === 'leads-desc') {
            filtered.sort((a, b) => b.recordCount - a.recordCount);
        } else if (sortVal === 'leads-asc') {
            filtered.sort((a, b) => a.recordCount - b.recordCount);
        }

        // Apply Pagination
        const totalItems = filtered.length;
        const totalPages = Math.ceil(totalItems / historyRowsPerPage) || 1;

        if (historyCurrentPage > totalPages) {
            historyCurrentPage = totalPages;
        }
        if (historyCurrentPage < 1) {
            historyCurrentPage = 1;
        }

        const startIndex = (historyCurrentPage - 1) * historyRowsPerPage;
        const endIndex = Math.min(startIndex + historyRowsPerPage, totalItems);
        const pageData = filtered.slice(startIndex, endIndex);

        // Update pagination UI
        historyPageIndicator.textContent = `Page ${historyCurrentPage} of ${totalPages}`;
        prevHistoryPageBtn.disabled = historyCurrentPage === 1;
        nextHistoryPageBtn.disabled = historyCurrentPage === totalPages;

        if (pageData.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = `<td colspan="6" style="text-align: center; color: #64748b; padding: 2rem;">No records found.</td>`;
            historyTableBody.appendChild(row);

            selectAllHistory.checked = false;
            selectAllHistory.disabled = true;
            updateBulkBtnState();
            return;
        }

        selectAllHistory.disabled = false;
        const allVisibleSelected = pageData.every(item => selectedJobIds.has(item.jobId));
        selectAllHistory.checked = allVisibleSelected;

        // Render visible rows
        pageData.forEach(item => {
            const tr = document.createElement('tr');
            const dateStr = new Date(item.timestamp).toLocaleDateString();
            const isChecked = selectedJobIds.has(item.jobId) ? 'checked' : '';
            const isAdmin = currentUser && currentUser.role === 'admin';
            const scrapedBy = item.userId ? (item.userId.username || 'Deleted User') : (item.username || 'Deleted User');
            const scrapedByHtml = isAdmin ? `<td><span class="badge idle">${scrapedBy}</span></td>` : '';
            const showDelete = currentUser && (currentUser.role === 'admin' || currentUser.canDeleteHistory === true);
            const deleteButtonHtml = showDelete ? `<button class="action-btn delete-btn" data-delete-id="${item.jobId}">Delete</button>` : '';

            tr.innerHTML = `
                <td style="text-align: center; padding: 1rem 0.5rem;">
                    <input type="checkbox" class="history-row-cb" data-id="${item.jobId}" ${isChecked}>
                </td>
                <td>${dateStr}</td>
                <td>
                    <strong>${item.query}</strong>
                    <span class="badge idle" style="font-size: 0.75rem; padding: 0.15rem 0.5rem; margin-left: 0.5rem; background: rgba(148, 163, 184, 0.15); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.3);">${item.platform}</span>
                </td>
                <td>${item.location}</td>
                <td><span class="badge count">${item.recordCount} Leads</span></td>
                ${scrapedByHtml}
                <td class="history-actions">
                    <button class="action-btn dl-csv" data-id="${item.jobId}">CSV</button>
                    <button class="action-btn dl-xlsx" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border-color: rgba(16, 185, 129, 0.3);" data-id="${item.jobId}">Excel</button>
                    <button class="action-btn dl-csv" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border-color: rgba(168, 85, 247, 0.3);" data-view-id="${item.jobId}">Preview</button>
                    ${deleteButtonHtml}
                </td>
            `;
            historyTableBody.appendChild(tr);
        });

        // Checkbox Bindings
        document.querySelectorAll('.history-row-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = cb.getAttribute('data-id');
                if (cb.checked) {
                    selectedJobIds.add(id);
                } else {
                    selectedJobIds.delete(id);
                }
                updateBulkBtnState();

                const allCheckedOnPage = Array.from(document.querySelectorAll('.history-row-cb')).every(c => c.checked);
                selectAllHistory.checked = allCheckedOnPage;
            });
        });

        // Row Button Bindings
        document.querySelectorAll('.dl-csv').forEach(btn => {
            const id = btn.getAttribute('data-id');
            if (id) {
                btn.addEventListener('click', () => {
                    window.location.href = `/api/download/${id}?format=csv&token=${token}`;
                });
            }
        });

        document.querySelectorAll('.dl-xlsx').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                if (id) {
                    window.location.href = `/api/download/${id}?format=xlsx&token=${token}`;
                }
            });
        });

        document.querySelectorAll('[data-view-id]').forEach(btn => {
            const id = btn.getAttribute('data-view-id');
            btn.addEventListener('click', () => {
                currentJobId = id;
                loadModalJobResults(id);
            });
        });

        document.querySelectorAll('[data-delete-id]').forEach(btn => {
            const id = btn.getAttribute('data-delete-id');
            btn.addEventListener('click', async () => {
                if (await customConfirm(`Are you sure you want to delete run ${id} from database history?`)) {
                    try {
                        const response = await authFetch(`/api/history/${id}`, { method: 'DELETE' });
                        if (response.ok) {
                            selectedJobIds.delete(id);
                            if (currentJobId === id) {
                                currentJobId = null;
                                previewModal.style.display = 'none';
                            }
                            loadHistory();
                        }
                    } catch (err) {
                        console.error('Failed to delete history item:', err);
                    }
                }
            });
        });

        updateBulkBtnState();
    }

    function updateBulkBtnState() {
        const count = selectedJobIds.size;
        bulkActionsBtn.innerHTML = `Download Selected (${count}) <span class="arrow">&#9662;</span>`;
        bulkActionsBtn.disabled = count === 0;
        if (count === 0) {
            bulkActionsMenu.style.display = 'none';
        }
    }

    // Bulk & Control Event Listeners
    selectAllHistory.addEventListener('change', () => {
        const rowCheckboxes = document.querySelectorAll('.history-row-cb');
        const checked = selectAllHistory.checked;

        rowCheckboxes.forEach(cb => {
            cb.checked = checked;
            const id = cb.getAttribute('data-id');
            if (checked) {
                selectedJobIds.add(id);
            } else {
                selectedJobIds.delete(id);
            }
        });
        updateBulkBtnState();
    });

    historyDateFilter.addEventListener('change', () => {
        historyCurrentPage = 1;
        renderHistoryTable();
    });

    if (historyUserFilter) {
        historyUserFilter.addEventListener('change', () => {
            historyCurrentPage = 1;
            renderHistoryTable();
        });
    }

    historySortSelect.addEventListener('change', () => {
        renderHistoryTable();
    });

    historyLimitSelect.addEventListener('change', () => {
        historyRowsPerPage = parseInt(historyLimitSelect.value, 10);
        historyCurrentPage = 1;
        renderHistoryTable();
    });

    prevHistoryPageBtn.addEventListener('click', () => {
        if (historyCurrentPage > 1) {
            historyCurrentPage--;
            renderHistoryTable();
        }
    });

    nextHistoryPageBtn.addEventListener('click', () => {
        let filtered = getFilteredHistory();
        const maxPage = Math.ceil(filtered.length / historyRowsPerPage) || 1;
        if (historyCurrentPage < maxPage) {
            historyCurrentPage++;
            renderHistoryTable();
        }
    });

    bulkActionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isClosed = bulkActionsMenu.style.display !== 'flex';
        bulkActionsMenu.style.display = isClosed ? 'flex' : 'none';
    });

    document.addEventListener('click', () => {
        bulkActionsMenu.style.display = 'none';
    });

    bulkDlCsvBtn.addEventListener('click', () => {
        if (selectedJobIds.size > 0) {
            const idsList = Array.from(selectedJobIds).join(',');
            window.location.href = `/api/download/${idsList}?format=csv&token=${token}`;
        }
    });

    bulkDlXlsxBtn.addEventListener('click', () => {
        if (selectedJobIds.size > 0) {
            const idsList = Array.from(selectedJobIds).join(',');
            window.location.href = `/api/download/${idsList}?format=xlsx&token=${token}`;
        }
    });

    bulkDlZipBtn.addEventListener('click', () => {
        if (selectedJobIds.size > 0) {
            const idsList = Array.from(selectedJobIds).join(',');
            window.location.href = `/api/download/${idsList}?format=zip&token=${token}`;
        }
    });

    bulkDeleteBtn.addEventListener('click', async () => {
        const count = selectedJobIds.size;
        if (count > 0 && await customConfirm(`Are you sure you want to delete the ${count} selected runs from database history?`)) {
            const idsArray = Array.from(selectedJobIds);
            for (const id of idsArray) {
                try {
                    await authFetch(`/api/history/${id}`, { method: 'DELETE' });
                } catch (err) {
                    console.error(`Failed to delete ${id}:`, err);
                }
            }
            selectedJobIds.clear();
            loadHistory();
        }
    });

    // ==========================================================================
    // AUTHENTICATION SCREEN INTERFACE EVENT LISTENERS
    // ==========================================================================
    const authForm = document.getElementById('authForm');
    const authSubmitBtn = document.getElementById('authSubmitBtn');
    const authErrorMsg = document.getElementById('authErrorMsg');
    const togglePasswordVisibility = document.getElementById('togglePasswordVisibility');
    const authPasswordInput = document.getElementById('authPassword');

    if (togglePasswordVisibility && authPasswordInput) {
        const EYE_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

        togglePasswordVisibility.addEventListener('click', () => {
            const type = authPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            authPasswordInput.setAttribute('type', type);
            togglePasswordVisibility.innerHTML = type === 'password' ? EYE_SVG : EYE_OFF_SVG;
        });
    }

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('authUsername').value;
        const password = document.getElementById('authPassword').value;

        authErrorMsg.style.display = 'none';
        authSubmitBtn.disabled = true;

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                localStorage.setItem('scraper_token', data.token);
                token = data.token;
                authForm.reset();
                await checkAuthStatus();
            } else {
                authErrorMsg.textContent = data.error || 'Authentication failed.';
                authErrorMsg.style.display = 'block';
            }
        } catch (err) {
            authErrorMsg.textContent = 'Network error: ' + err.message;
            authErrorMsg.style.display = 'block';
        } finally {
            authSubmitBtn.disabled = false;
        }
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        logout();
    });


    // ==========================================================================
    // SETTINGS PAGE LOGIC & SUB-TAB NAVIGATION
    // ==========================================================================
    const settingsNavBtns = document.querySelectorAll('.settings-nav-btn');
    const settingsSubpanels = document.querySelectorAll('.settings-subpanel');

    function loadSettings() {
        // Find current active settings subtab
        const activeBtn = document.querySelector('.settings-nav-btn.active');
        if (activeBtn) {
            const subtab = activeBtn.getAttribute('data-subtab');
            if (subtab === 'categories') {
                loadSettingsCategories();
            } else if (subtab === 'users') {
                loadSettingsUsers();
            }
        }
    }

    settingsNavBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetSubtab = btn.getAttribute('data-subtab');
            
            settingsNavBtns.forEach(b => b.classList.remove('active'));
            settingsSubpanels.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetPanel = document.getElementById(`subtab-${targetSubtab}`);
            if (targetPanel) targetPanel.classList.add('active');

            if (targetSubtab === 'categories') {
                loadSettingsCategories();
            } else if (targetSubtab === 'users') {
                loadSettingsUsers();
            }
        });
    });

    // 1. Change Password (Removed from settings per requirements)
    // 2. Categories CRUD Settings
    const addCategoryBtn = document.getElementById('addCategoryBtn');
    const newCategoryNameInput = document.getElementById('newCategoryName');

    addCategoryBtn.addEventListener('click', async () => {
        const name = newCategoryNameInput.value;
        if (!name || name.trim() === '') {
            await customAlert('Please enter a category name.');
            return;
        }

        try {
            const response = await authFetch('/api/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim() })
            });
            const result = await response.json();

            if (response.ok) {
                newCategoryNameInput.value = '';
                loadSettingsCategories();
                loadCategoriesDropdown();
            } else {
                await customAlert(`Error: ${result.error}`);
            }
        } catch (err) {
            console.error(err);
        }
    });

    async function loadSettingsCategories() {
        const categoriesTableBody = document.getElementById('categoriesTableBody');
        categoriesTableBody.innerHTML = '<tr><td colspan="2" style="text-align: center;">Loading categories...</td></tr>';
        
        try {
            const res = await authFetch('/api/categories');
            if (res.ok) {
                const data = await res.json();
                categoriesTableBody.innerHTML = '';
                
                if (data.length === 0) {
                    categoriesTableBody.innerHTML = '<tr><td colspan="2" style="text-align: center; color: #64748b;">No categories found.</td></tr>';
                    return;
                }

                const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.canManageCategories);

                data.forEach(cat => {
                    const tr = document.createElement('tr');
                    
                    let actionCell = '';
                    if (isAdmin) {
                        actionCell = `
                            <td style="text-align: right;">
                                <button class="action-btn edit-btn edit-cat-btn" data-id="${cat._id}" data-name="${cat.name}">Edit</button>
                                <button class="action-btn delete-btn delete-cat-btn" data-id="${cat._id}" data-name="${cat.name}">Delete</button>
                            </td>
                        `;
                    } else {
                        actionCell = `<td style="text-align: right; color: #64748b; font-style: italic;">Read-Only</td>`;
                    }

                    tr.innerHTML = `
                        <td><strong>${cat.name}</strong></td>
                        ${actionCell}
                    `;
                    categoriesTableBody.appendChild(tr);
                });

                if (isAdmin) {
                    document.querySelectorAll('.edit-cat-btn').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            const id = btn.getAttribute('data-id');
                            const currentName = btn.getAttribute('data-name');
                            const newName = await customPrompt('Edit category name:', currentName);
                            
                            if (newName === null) return;
                            if (newName.trim() === '') {
                                await customAlert('Category name cannot be empty.');
                                return;
                            }

                            try {
                                const response = await authFetch(`/api/categories/${id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ name: newName.trim() })
                                });
                                const result = await response.json();
                                if (response.ok) {
                                    loadSettingsCategories();
                                    loadCategoriesDropdown();
                                } else {
                                    await customAlert(`Error: ${result.error}`);
                                }
                            } catch (err) {
                                console.error(err);
                            }
                        });
                    });

                    document.querySelectorAll('.delete-cat-btn').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            const id = btn.getAttribute('data-id');
                            const name = btn.getAttribute('data-name');
                            
                            if (await customConfirm(`Are you sure you want to delete category "${name}"?`)) {
                                try {
                                    const response = await authFetch(`/api/categories/${id}`, {
                                        method: 'DELETE'
                                    });
                                    const result = await response.json();
                                    if (response.ok) {
                                        loadSettingsCategories();
                                        loadCategoriesDropdown();
                                    } else {
                                        await customAlert(`Error: ${result.error}`);
                                    }
                                } catch (err) {
                                    console.error(err);
                                }
                            }
                        });
                    });
                }
            }
        } catch (err) {
            console.error('Failed to load category settings:', err);
        }
    }

    // 3. User accounts CRUD Settings (Admin-only)
    const createUserForm = document.getElementById('createUserForm');
    const createUserFormContainer = document.getElementById('createUserFormContainer');
    const openCreateUserBtn = document.getElementById('openCreateUserBtn');
    const cancelCreateUserBtn = document.getElementById('cancelCreateUserBtn');
    const createUserErrorMsg = document.getElementById('createUserErrorMsg');

    openCreateUserBtn.addEventListener('click', () => {
        createUserFormContainer.style.display = 'block';
        createUserErrorMsg.style.display = 'none';
    });

    cancelCreateUserBtn.addEventListener('click', () => {
        createUserFormContainer.style.display = 'none';
        createUserForm.reset();
    });

    createUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('newUserUsername').value;
        const password = document.getElementById('newUserPassword').value;
        const role = document.getElementById('newUserRole').value;
        const canManageCategories = document.getElementById('newUserCanManageCategories').checked;
        const canDeleteHistory = document.getElementById('newUserCanDeleteHistory').checked;

        createUserErrorMsg.style.display = 'none';

        try {
            const response = await authFetch('/api/auth/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, role, canManageCategories, canDeleteHistory })
            });

            const result = await response.json();

            if (response.ok) {
                createUserFormContainer.style.display = 'none';
                createUserForm.reset();
                loadSettingsUsers();
            } else {
                createUserErrorMsg.textContent = result.error || 'Failed to create user account.';
                createUserErrorMsg.style.display = 'block';
            }
        } catch (err) {
            createUserErrorMsg.textContent = 'Network error: ' + err.message;
            createUserErrorMsg.style.display = 'block';
        }
    });

    async function loadSettingsUsers() {
        const usersTableBody = document.getElementById('usersTableBody');
        usersTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Loading users...</td></tr>';
        
        try {
            const res = await authFetch('/api/auth/users');
            if (res.ok) {
                const users = await res.json();
                usersTableBody.innerHTML = '';
                
                if (users.length === 0) {
                    usersTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #64748b;">No users found.</td></tr>';
                    return;
                }

                users.forEach(user => {
                    const tr = document.createElement('tr');
                    const createdDate = new Date(user.createdAt).toLocaleDateString();
                    const isSelf = currentUser && user._id === currentUser.id;

                    tr.innerHTML = `
                        <td><strong>${user.username}</strong> ${isSelf ? '<span class="badge count" style="font-size: 0.7rem; padding: 0.15rem 0.4rem;">You</span>' : ''}</td>
                        <td><span class="badge ${user.role === 'admin' ? 'completed' : 'idle'}" style="font-size: 0.8rem; text-transform: uppercase;">${user.role}</span></td>
                        <td style="font-family: monospace; font-size: 0.9rem; color: #cbd5e1;">${user.password || 'N/A'}</td>
                        <td style="text-align: center; vertical-align: middle;">
                            <label class="switch" title="Toggle category management permission" style="margin-bottom: 0;">
                                <input type="checkbox" class="toggle-perm-user-checkbox" data-id="${user._id}" data-username="${user.username}" ${user.canManageCategories ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </td>
                        <td style="text-align: center; vertical-align: middle;">
                            <label class="switch" title="Toggle delete history permission" style="margin-bottom: 0;">
                                <input type="checkbox" class="toggle-delete-history-checkbox" data-id="${user._id}" data-username="${user.username}" ${user.canDeleteHistory ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </td>
                        <td>${createdDate}</td>
                        <td style="text-align: right;">
                            <button class="action-btn edit-btn edit-user-modal-btn" data-id="${user._id}" data-username="${user.username}" data-role="${user.role}">Edit</button>
                            <button class="action-btn delete-btn delete-user-btn" data-id="${user._id}" data-username="${user.username}" ${isSelf ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''}>Delete</button>
                        </td>
                    `;
                    usersTableBody.appendChild(tr);
                });

                document.querySelectorAll('.edit-user-modal-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.getAttribute('data-id');
                        const username = btn.getAttribute('data-username');
                        const role = btn.getAttribute('data-role');
                        
                        document.getElementById('editUserId').value = id;
                        document.getElementById('editUserUsername').value = username;
                        document.getElementById('editUserOriginalRole').value = role;
                        document.getElementById('editUserRole').value = role;
                        document.getElementById('editUserPassword').value = '';
                        
                        document.getElementById('editUserModal').style.display = 'flex';
                    });
                });

                document.querySelectorAll('.toggle-perm-user-checkbox').forEach(checkbox => {
                    checkbox.addEventListener('change', async (e) => {
                        const id = checkbox.getAttribute('data-id');
                        const username = checkbox.getAttribute('data-username');
                        const targetPerm = e.target.checked;
                        
                        if (await customConfirm(`Change category management permission for "${username}" to ${targetPerm ? 'YES' : 'NO'}?`)) {
                            try {
                                const response = await authFetch(`/api/auth/users/${id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ canManageCategories: targetPerm })
                                });
                                const result = await response.json();
                                if (!response.ok) {
                                    await customAlert(`Error: ${result.error}`);
                                    e.target.checked = !targetPerm; // Revert switch if error
                                }
                            } catch (err) {
                                console.error(err);
                                e.target.checked = !targetPerm; // Revert switch if error
                            }
                        } else {
                            e.target.checked = !targetPerm; // Revert switch if cancelled
                        }
                    });
                });

                document.querySelectorAll('.toggle-delete-history-checkbox').forEach(checkbox => {
                    checkbox.addEventListener('change', async (e) => {
                        const id = checkbox.getAttribute('data-id');
                        const username = checkbox.getAttribute('data-username');
                        const targetPerm = e.target.checked;
                        
                        if (await customConfirm(`Change delete history permission for "${username}" to ${targetPerm ? 'YES' : 'NO'}?`)) {
                            try {
                                const response = await authFetch(`/api/auth/users/${id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ canDeleteHistory: targetPerm })
                                });
                                const result = await response.json();
                                if (!response.ok) {
                                    await customAlert(`Error: ${result.error}`);
                                    e.target.checked = !targetPerm; // Revert switch if error
                                }
                            } catch (err) {
                                console.error(err);
                                e.target.checked = !targetPerm; // Revert switch if error
                            }
                        } else {
                            e.target.checked = !targetPerm; // Revert switch if cancelled
                        }
                    });
                });

                document.querySelectorAll('.delete-user-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const id = btn.getAttribute('data-id');
                        const username = btn.getAttribute('data-username');
                        
                        if (await customConfirm(`Are you sure you want to permanently delete user account "${username}"?`)) {
                            try {
                                const response = await authFetch(`/api/auth/users/${id}`, {
                                    method: 'DELETE'
                                });
                                const result = await response.json();
                                if (response.ok) {
                                    await customAlert(`User account ${username} has been deleted.`);
                                    loadSettingsUsers();
                                } else {
                                    await customAlert(`Error: ${result.error}`);
                                }
                            } catch (err) {
                                console.error(err);
                            }
                        }
                    });
                });

            }
        } catch (err) {
            console.error('Failed to load user settings:', err);
        }
    }


    // Edit User Modal Logic
    const editUserModal = document.getElementById('editUserModal');
    const closeEditUserModalBtn = document.getElementById('closeEditUserModalBtn');
    const cancelEditUserBtn = document.getElementById('cancelEditUserBtn');
    const editUserForm = document.getElementById('editUserForm');

    function closeEditUserModal() {
        if (editUserModal) editUserModal.style.display = 'none';
    }

    if (closeEditUserModalBtn) closeEditUserModalBtn.addEventListener('click', closeEditUserModal);
    if (cancelEditUserBtn) cancelEditUserBtn.addEventListener('click', closeEditUserModal);

    if (editUserModal) {
        editUserModal.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-backdrop')) {
                closeEditUserModal();
            }
        });
    }

    if (editUserForm) {
        editUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('editUserId').value;
            const newPassword = document.getElementById('editUserPassword').value;
            const newRole = document.getElementById('editUserRole').value;
            
            const payload = {};
            if (newPassword.trim() !== '') {
                payload.password = newPassword.trim();
            }
            payload.role = newRole;

            try {
                const response = await authFetch(`/api/auth/users/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (response.ok) {
                    closeEditUserModal();
                    loadSettingsUsers(); // Refresh the table
                } else {
                    await customAlert(`Error: ${result.error}`);
                }
            } catch (err) {
                console.error(err);
                await customAlert('An error occurred while updating the user.');
            }
        });
    }

    // Run check on DOM load
    checkAuthStatus();
});
