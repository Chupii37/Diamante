import blessed from 'blessed';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { getAddress, Wallet } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.on('uncaughtException', (err) => {
    try {
        fs.appendFileSync('crash_log.txt', `${new Date().toISOString()} - CRASH: ${err.stack}\n`);
    } catch (e) {}
    process.exit(1);
});

const CONFIG_FILE = path.join(__dirname, 'config.json');
const ACCOUNT_DATA_FILE = path.join(__dirname, 'account_data.json');
const USER_FILE = path.join(__dirname, 'user.txt');
const PROXY_FILE = path.join(__dirname, 'proxy.txt');
const WALLET_FILE = path.join(__dirname, 'wallet.txt');
const REFF_OUTPUT_FILE = path.join(__dirname, 'referrals.txt');

const API_BASE_URL = "https://campapi.diamante.io/api/v1";

const CONFIG_DEFAULT_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Origin": "https://campaign.diamante.io",
    "Access-Token": "key",
    "Referer": "https://campaign.diamante.io/"
};

let dailyConfig = {
    sendDiamRepetitions: 1,
    minSendAmount: 1,
    maxSendAmount: 10,
    cycleDelayHours: 24,
    cycleJitterMin: 2,    
    cycleJitterMax: 5,    
    referralCode: "", 
    referralCount: 1,
    reffDelayMin: 60, 
    reffDelayMax: 120 
};    

let screen;
let bots = [];
let recipientAddresses = [];
let accountData = {};
let globalStats = { total: 0, active: 0, sleeping: 0, errors: 0, proxies: 0, successTransfers: 0, reffCreated: 0 };
let proxies = [];
let isRunning = false; 

let isReferralProcessActive = false; 
let isReferralRunning = false;       
let referralLogs = [];               
let activeReffLogBox = null;         

let currentView = 'menu'; 
let menuPageIndex = 0;
let currentGroupIndex = 0;
let dashboardInterval = null; 
let activeMenuHandler = null; 
let resizeTimeout = null;

let wrapperBox, bannerBox, dashboardBox, statsBox, navBox, configForm, reffForm, backBtn;


function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, "utf8");
            dailyConfig = { ...dailyConfig, ...JSON.parse(data) };
        } else { saveConfig(); }
    } catch (e) {}
}

function saveConfig() { try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(dailyConfig, null, 2)); } catch (e) {} }

function loadAccountData() {
    try {
        if (fs.existsSync(ACCOUNT_DATA_FILE)) accountData = JSON.parse(fs.readFileSync(ACCOUNT_DATA_FILE, "utf8"));
    } catch (e) { accountData = {}; }
}

function saveAccountData() { try { fs.writeFileSync(ACCOUNT_DATA_FILE, JSON.stringify(accountData, null, 2)); } catch (e) {} }

function getShortAddress(address) { return address ? address.slice(0, 6) + "..." + address.slice(-4) : "N/A"; }

function generateRandomHandle() {
    const adjs = ['Crypto', 'Super', 'Mega', 'Hyper', 'Fast', 'Gold', 'Silver', 'Moon', 'Sun', 'Cyber', 'Based', 'Degen'];
    const nouns = ['King', 'Queen', 'Lion', 'Tiger', 'Whale', 'Shark', 'Falcon', 'Eagle', 'Wolf', 'Bear', 'Ape', 'Chad'];
    return `${adjs[Math.floor(Math.random()*adjs.length)]}${nouns[Math.floor(Math.random()*nouns.length)]}${Math.floor(Math.random()*9999)}`;
}

function logToReff(msg) {
    referralLogs.push(msg);
    if (referralLogs.length > 100) referralLogs.shift();
    if (activeReffLogBox && activeReffLogBox.parent) {
        activeReffLogBox.pushLine(msg);
        activeReffLogBox.setScrollPerc(100);
        screen.render();
    }
}


function callCurlCffi(payload, proxy = null, impersonate = "chrome120") {
    return new Promise((resolve) => {
        const script = path.join(__dirname, "connect.py");
        const args = [JSON.stringify(payload), proxy || "", impersonate || ""];
        
        execFile("python3", [script, ...args], { maxBuffer: 30 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                return resolve({ error: true, status_code: 0, text: stderr || err.message });
            }
            try {
                const parsed = JSON.parse(String(stdout).trim());
                parsed.status_code = parsed.status_code || parsed.status || 0;
                resolve(parsed);
            } catch (e) {
                resolve({ error: true, status_code: 0, text: String(stdout).slice(0, 100) });
            }
        });
    });
}

function callDiamanteAPI(url, method, payload, headers, proxy) {
    return new Promise((resolve) => {
        const script = path.join(__dirname, "api.py");
        const args = [
            url,
            method,
            payload ? JSON.stringify(payload) : "null",
            JSON.stringify(headers || {}),
            proxy || ""
        ];

        execFile("python3", [script, ...args], { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                return resolve({ error: true, status_code: 0, text: stderr || err.message });
            }
            try {
                const parsed = JSON.parse(String(stdout).trim());
                parsed.status_code = parsed.status_code || parsed.status || 0;
                resolve(parsed);
            } catch (e) {
                resolve({ error: true, status_code: 0, text: String(stdout).slice(0, 100) });
            }
        });
    });
}


class DiamanteBot {
    constructor(address, proxy = null, id) {
        this.address = getAddress(address);
        this.proxy = proxy;
        this.id = id;
        
        this.status = 'Idle';
        this.balance = '0.00';
        this.nextAction = 'Waiting to Start';
        this.userId = null;
        this.accessToken = null;
        this.deviceId = null;
        
        this.faucetClaimed = false;
        this.txCount = 0;
        this.lastClaimTime = 0; 
        
        this.cycleJitter = 0; 

        this.logs = [];
        this.container = null;
        this.accountPane = null;
        this.logPane = null;
        this.isRendered = false;
        this.isActive = false; 
        
        this.countdownInterval = null;
    }

    updateStatus(newStatus) {
        this.status = newStatus;
        this.refreshDisplay();
        updateDashboard();
    }

    addLog(msg, type = 'info') {
        if (msg.includes("network guardians are syncing")) {
            msg = "Network Syncing (Temp Fail)";
        }
        
        const time = new Date().toLocaleTimeString('en-GB', {hour12: false});
        let coloredMsg = msg;
        if (type === 'success') coloredMsg = chalk.green(msg);
        else if (type === 'error') coloredMsg = chalk.redBright(msg);
        else if (type === 'warn') coloredMsg = chalk.yellow(msg);
        else if (type === 'debug') coloredMsg = chalk.blue(msg);

        const finalLog = `${chalk.cyan(time)} ${coloredMsg}`;

        this.logs.push(finalLog);
        if (this.logs.length > 50) this.logs.shift();

        if (this.isRendered && this.logPane) {
            this.logPane.pushLine(finalLog);
            
            if (this.logPane.getLines().length > 50) {
                this.logPane.shiftLine(0);
            }

            this.logPane.setScrollPerc(100); 
            screen.render();
        }
    }

    refreshDisplay() {
        if (!this.isRendered || !this.accountPane) return;
        
        let statusColor = chalk.white;
        let shortStatus = this.status;
        if (this.status === 'Processing') { shortStatus = 'Process'; statusColor = chalk.greenBright; }
        else if (this.status === 'Waiting Cycle') { shortStatus = 'Wait Cycle'; statusColor = chalk.magenta; }
        else if (this.status.includes('Error') || this.status.includes('Blocked')) { shortStatus = 'Error'; statusColor = chalk.red; }
        else if (this.status === 'Stopped') { shortStatus = 'Stop'; statusColor = chalk.yellow; }

        const faucetText = this.faucetClaimed ? "YES" : "NO";

        let safeNext = this.nextAction || "";
        safeNext = safeNext.replace("Retry Delay", "Retry").replace("Sync Wait", "Sync");
        if (safeNext.length > 18) safeNext = safeNext.substring(0, 16) + "..";

        const content = 
            `{bold}Addr:{/bold} ${getShortAddress(this.address)}\n` +
            `{bold}Bal :{/bold} ${chalk.yellow(Math.floor(this.balance * 100) / 100)}\n` +
            `{bold}Fauc:{/bold} ${faucetText}\n` +
            `{bold}Tx  :{/bold} ${this.txCount}/${dailyConfig.sendDiamRepetitions}\n` +
            `{bold}Sts :{/bold} ${statusColor(shortStatus)}\n` +
            `{bold}Next:{/bold} ${chalk.cyan(safeNext)}`;
            
        this.accountPane.setContent(content);
        screen.render();
    }

    async smartSleep(minSeconds = 5, maxSeconds = 10, reason = "Wait") {
        if (!this.isActive) return;
        this.updateStatus('Waiting');
        
        if(isNaN(minSeconds)) minSeconds = 5;
        if(isNaN(maxSeconds)) maxSeconds = 10;
        
        const ms = Math.floor(Math.random() * (maxSeconds - minSeconds + 1) + minSeconds) * 1000;
        const steps = 10;
        const stepMs = ms / steps;

        this.addLog(`Wait ${Math.round(ms/1000)}s (${reason})...`, 'warn');

        for (let i = 0; i < steps; i++) {
            if (!this.isActive) break;
            const remaining = Math.round((ms - (i * stepMs)) / 1000);
            this.nextAction = `Wait: ${remaining}s (${reason})`;
            this.refreshDisplay();
            await new Promise(r => setTimeout(r, stepMs));
        }
        
        if (this.isActive) {
            this.nextAction = 'Resuming...';
            this.updateStatus('Processing');
            this.refreshDisplay();
        }
    }

    getHeaders() {
        const headers = { ...CONFIG_DEFAULT_HEADERS };
        if (this.accessToken) {
            headers["Cookie"] = `access_token=${this.accessToken}`;
        }
        return headers;
    }

    async updateBalance() {
        const url = `${API_BASE_URL}/transaction/get-balance/${this.userId}`;
        const proxyArg = this.proxy ? this.proxy.url : "";
        
        for(let i=0; i<3; i++) {
            try {
                const balRes = await callDiamanteAPI(url, "GET", null, this.getHeaders(), proxyArg);
                if (balRes.json && balRes.json.success) {
                    const newBal = Number(balRes.json.data.balance).toFixed(2);
                    this.balance = newBal;
                    this.addLog(`Balance: ${this.balance} DIAM`, 'info');
                    this.refreshDisplay();
                    return;
                }
            } catch(e) {}
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    async login() {
        if (!this.isActive) return false;
        this.updateStatus('Processing');
        this.addLog('Logging in...', 'info');

        let savedData = accountData[this.address.toLowerCase()];
        let savedDeviceId = null;
        
        if (typeof savedData === 'string') {
            savedDeviceId = savedData;
            accountData[this.address.toLowerCase()] = { deviceId: savedDeviceId, lastClaimTime: 0 };
        } else if (savedData && savedData.deviceId) {
            savedDeviceId = savedData.deviceId;
            this.lastClaimTime = savedData.lastClaimTime || 0;
        }

        if (!savedDeviceId) {
            savedDeviceId = `DEV${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
            accountData[this.address.toLowerCase()] = { deviceId: savedDeviceId, lastClaimTime: 0 };
            saveAccountData();
        }
        this.deviceId = savedDeviceId;

        const payload = {
            address: this.address,
            deviceId: this.deviceId,
            deviceSource: "web_app",
            deviceType: "Windows",
            browser: "Chrome",
            ipAddress: "0.0.0.0",
            latitude: 12.9715987,
            longitude: 77.5945627,
            countryCode: "Unknown",
            country: "Unknown",
            continent: "Unknown",
            continentCode: "Unknown",
            region: "Unknown",
            regionCode: "Unknown",
            city: "Unknown"
        };

        const proxyArg = this.proxy ? this.proxy.url : "";
        const res = await callCurlCffi(payload, proxyArg, "chrome120");

        if (res.status_code === 403) {
            this.addLog('Login Blocked (403). Cooldown 60s.', 'error');
            this.updateStatus('403 Blocked');
            await this.smartSleep(60, 65, "403 Cooldown");
            return false;
        }

        const data = res.json?.data || res.json;
        if (!data) {
            this.addLog(`Login Failed: ${res.text ? res.text.slice(0, 50) : "No Data"}`, 'error');
            return false;
        }

        let token = data.accessToken;
        if (!token && res.headers && res.headers["set-cookie"]) {
            const sc = Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"][0] : res.headers["set-cookie"];
            const match = sc.match(/access_token=([^;]+)/);
            if (match) token = match[1];
        }

        if (!token) {
            this.addLog('No access token found.', 'error');
            return false;
        }

        this.accessToken = token;
        this.userId = data.userId || (data.user && data.user.userId);

        if (data.isSocialExists !== "VERIFIED") {
            this.addLog('Account not registered!', 'error');
            this.updateStatus('Not Registered');
            return false;
        }

        this.addLog('Login Successful', 'success');
        return true;
    }

    async runDailyCycle() {
        if (!this.isActive) return;

        this.accessToken = null; 
        this.addLog("Cycle Start: Refreshing Session (Re-Login)...", "warn");

        const loginSuccess = await this.login();
        
        if (!loginSuccess) {
            this.addLog("Re-Login Failed! Retrying in 10m...", "error");
            this.runCountdown(10 * 60 * 1000, "Retry Login"); 
            return;
        }

        this.updateStatus('Processing');
        const proxyArg = this.proxy ? this.proxy.url : "";
        
        if (this.txCount >= dailyConfig.sendDiamRepetitions) {
             this.txCount = 0;
             this.faucetClaimed = false; 
        }
        
        this.refreshDisplay();

        await this.smartSleep(15, 30, "Pre-Balance");
        await this.updateBalance();

        if (!this.isActive) return;

        await this.smartSleep(30, 60, "Pre-Faucet");
        this.addLog('Checking Faucet...', 'debug');
        
        const faucetUrl = `${API_BASE_URL}/transaction/fund-wallet/${this.userId}`;
        const faucetRes = await callDiamanteAPI(faucetUrl, "GET", null, this.getHeaders(), proxyArg);
        
        if (faucetRes.status_code === 403) {
            this.addLog("Faucet 403. Cooling down...", "error");
            await this.smartSleep(60, 70, "403 Cooldown");
            this.faucetClaimed = false; 
        } else if (faucetRes.json && faucetRes.json.success) {
            this.addLog(`Faucet: +${faucetRes.json.data.fundedAmount} DIAM`, 'success');
            this.faucetClaimed = true; 
            
            this.lastClaimTime = Date.now();
            if(accountData[this.address.toLowerCase()]) {
                accountData[this.address.toLowerCase()].lastClaimTime = this.lastClaimTime;
                saveAccountData();
            }

            await this.updateBalance();
        } else {
            const msg = faucetRes.json?.message || `Status ${faucetRes.status_code}`;
            if(msg && msg.includes("once per day")) {
                this.addLog("Faucet already claimed today.", "warn");
                this.faucetClaimed = true; 
                if (!this.lastClaimTime || this.lastClaimTime === 0) {
                      this.lastClaimTime = Date.now();
                      if(accountData[this.address.toLowerCase()]) {
                        accountData[this.address.toLowerCase()].lastClaimTime = this.lastClaimTime;
                        saveAccountData();
                    }
                }
            } else {
                this.addLog(`Faucet: ${msg}`, 'warn');
                this.faucetClaimed = false; 
            }
        }
        this.refreshDisplay();

        if (Number(this.balance) < dailyConfig.minSendAmount) {
            this.addLog("Insufficient Balance. Waiting for next Cycle.", "error");
            this.updateStatus('Waiting Cycle');
            this.scheduleNextCycle(); 
            return; 
        }

        if (recipientAddresses.length > 0) {
            await this.smartSleep(45, 90, "Pre-Tx");

            for (let i = this.txCount; i < dailyConfig.sendDiamRepetitions; i++) {
                if(!this.isActive) break;
                if (i > 0) await this.smartSleep(60, 120, "Inter-Tx Delay");

                if (!this.accessToken) {
                    this.addLog("Token lost mid-process. Re-logging...", "error");
                    await this.login();
                }

                let recipient;
                do { recipient = recipientAddresses[Math.floor(Math.random() * recipientAddresses.length)]; } 
                while (recipient.toLowerCase() === this.address.toLowerCase());

                const amount = Math.random() * (dailyConfig.maxSendAmount - dailyConfig.minSendAmount) + dailyConfig.minSendAmount;
                const amtFixed = Number(amount.toFixed(4));
                
                const txUrl = `${API_BASE_URL}/transaction/transfer`;
                const txPayload = { "toAddress": recipient, "amount": amtFixed, "userId": this.userId };
                const txHeaders = this.getHeaders();
                txHeaders["Content-Type"] = "application/json";

                for (let attempt = 1; attempt <= 5; attempt++) {
                    if (!this.isActive) break;
                    this.addLog(`Sending ${amtFixed} DIAM (Attempt ${attempt}/5)...`, 'info');
                    
                    const txRes = await callDiamanteAPI(txUrl, "POST", txPayload, txHeaders, proxyArg);
                    
                    if (txRes.json && (txRes.json.success === true || txRes.json.message === "Success")) {
                        this.addLog(`Sent ${amtFixed} DIAM to ${getShortAddress(recipient)}`, 'success');
                        globalStats.successTransfers++;
                        this.txCount++; 
                        
                        await this.smartSleep(8, 8, "Syncing Balance");
                        await this.updateBalance();
                        this.refreshDisplay();
                        break; 
                    } 
                    
                    const msg = txRes.json?.message || `Status ${txRes.status_code}`;
                    
                    if (msg.toLowerCase().includes("insufficient")) {
                        this.addLog("Tx Fail: Insufficient Balance. STOPPING.", "error");
                        this.updateStatus('Waiting Cycle');
                        this.scheduleNextCycle();
                        return; 
                    }

                    if (txRes.status_code === 401) {
                        this.addLog("Token Expired (401). Re-logging...", "error");
                        await this.login(); 
                        attempt--; 
                        await this.smartSleep(5, 10, "After Relogin");
                        continue;
                    }

                    if (txRes.status_code === 403) {
                        this.addLog('Tx 403. Cooling down.', 'error');
                        await this.smartSleep(60, 70, "403 Cooldown");
                    } else {
                        this.addLog(`Tx Fail: ${msg}`, 'warn');
                        if (msg.includes("syncing")) await this.smartSleep(30, 40, "Sync Wait");
                    }
                    
                    if (attempt < 5) await this.smartSleep(15, 25, "Retry Delay");
                }
            }
        } else {
            this.addLog('No recipients loaded. Skipping Tx.', 'warn');
        }

        if (this.isActive) {
            this.updateStatus('Waiting Cycle');
            if (this.faucetClaimed || this.txCount > 0) {
                this.addLog('Daily tasks done. Waiting 24h + Jitter.', 'success');
                this.scheduleNextCycle();
            } else {
                this.addLog('Tasks incomplete. Retrying in 1h.', 'warn');
                const retryDelay = 60 * 60 * 1000; 
                this.runCountdown(retryDelay, "Retry");
            }
        }
    }

    scheduleNextCycle() {
        
        const cycleDuration = 24 * 60 * 60 * 1000; 

        if (!this.cycleJitter) {
            const jitterMin = (dailyConfig.cycleJitterMin || 2) * 60 * 60 * 1000;
            const jitterMax = (dailyConfig.cycleJitterMax || 5) * 60 * 60 * 1000;
            this.cycleJitter = Math.floor(Math.random() * (jitterMax - jitterMin + 1)) + jitterMin;
        }

        const targetTimestamp = Date.now() + cycleDuration; 

        this.runDynamicCountdown("Cycle", targetTimestamp);
    }

    runDynamicCountdown(type, targetTimestamp = 0) {
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        
        this.countdownInterval = setInterval(() => {
            if(!this.isActive) {
                clearInterval(this.countdownInterval);
                return;
            }

            let targetTime;
            
            if (type === "Cycle") {
                targetTime = targetTimestamp + this.cycleJitter;
            } else {
                targetTime = Date.now() + 60000; 
            }

            let remaining = targetTime - Date.now();
            
            if (remaining <= 0) {
                clearInterval(this.countdownInterval);
                this.cycleJitter = 0; 
                this.runDailyCycle();
            } else {
                this.updateCountdown(remaining, type);
            }
        }, 1000);
    }

    runCountdown(durationMs, type) {
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        let targetTime = Date.now() + durationMs;
        
        this.countdownInterval = setInterval(() => {
            if(!this.isActive) {
                clearInterval(this.countdownInterval);
                return;
            }
            let remaining = targetTime - Date.now();
            if (remaining <= 0) {
                clearInterval(this.countdownInterval);
                this.runDailyCycle();
            } else {
                this.updateCountdown(remaining, type);
            }
        }, 1000);
    }

    updateCountdown(ms, type) {
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        this.nextAction = `Next ${type}: ${h}h ${m}m ${s}s`;
        this.refreshDisplay();
    }

    async start() {
        if(this.isActive) return;
        this.isActive = true;
        
        const delay = Math.floor(Math.random() * 10000);
        this.nextAction = `Start in ${delay/1000}s`;
        this.refreshDisplay();
        await new Promise(r => setTimeout(r, delay));

        while (this.isActive) {
            const success = await this.login();
            if (success) {
                this.runDailyCycle();
                break; 
            } else {
                this.addLog("Login failed. Retrying in 2m...", "warn");
                await this.smartSleep(120, 130, "Login Retry");
            }
        }
    }

    stop() {
        this.isActive = false;
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        this.updateStatus('Stopped');
        this.nextAction = 'Stopped by User';
        this.addLog('Process Stopped.', 'warn');
        this.refreshDisplay();
    }

    attachUI(screenObj, top, left, height, width) {
        this.isRendered = true;
        
        this.container = blessed.box({
            parent: screenObj,
            top: `${top}%`,
            left: `${left}%`,
            width: `${width}%`,
            height: `${height}%`,
            transparent: true
        });

        this.accountPane = blessed.box({ 
            parent: this.container, 
            top: 0, 
            left: 0, 
            width: '35%', 
            height: '100%', 
            label: ` Account ${this.id} `, 
            padding: { left: 1 }, 
            tags: true, 
            border: { type: 'line', fg: 'cyan' } 
        });

        this.logPane = blessed.box({ 
            parent: this.container, 
            top: 0, 
            left: '35%', 
            width: '65%', 
            height: '100%', 
            label: ' Logs ', 
            content: this.logs.join('\n'), 
            tags: true, 
            scrollable: true, 
            alwaysScroll: true, 
            wrap: true, 
            padding: { left: 1 }, 
            scrollbar: { ch: ' ', style: { bg: 'cyan' } }, 
            border: { type: 'line', fg: 'white' } 
        });
        
        this.refreshDisplay();
    }

    detachUI(screenObj) {
        this.isRendered = false;
        if (this.container) { screenObj.remove(this.container); this.container.destroy(); }
        this.container = null;
        this.accountPane = null;
        this.logPane = null;
    }
}


async function runAutoReferral(reffCode, count) {
    isReferralRunning = true;
    isReferralProcessActive = true;
    
    logToReff(`Starting background generation of ${count}...`);
    
    for (let i = 0; i < count; i++) {
        if (!isReferralProcessActive) {
            logToReff("Process stopped by user.");
            break;
        }

        const wallet = Wallet.createRandom();
        const address = getAddress(wallet.address);
        const handle = generateRandomHandle();
        const proxy = proxies.length > 0 ? proxies[Math.floor(Math.random() * proxies.length)] : null;
        
        logToReff(`[${i+1}/${count}] Creating ${handle}...`);

        try {
            if (!isReferralProcessActive) break;

            const deviceId = `DEV${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
            
            const loginPayload = {
                address: address,
                deviceId: deviceId,
                deviceSource: "web_app",
                deviceType: "Windows",
                browser: "Chrome",
                ipAddress: "0.0.0.0",
                latitude: 12.9715987,
                longitude: 77.5945627,
                countryCode: "Unknown",
                country: "Unknown",
                continent: "Unknown",
                continentCode: "Unknown",
                region: "Unknown",
                regionCode: "Unknown",
                city: "Unknown"
            };

             const proxyUrl = proxy ? (proxy.startsWith('socks') ? proxy : proxy) : ""; 
            
            const loginRes = await callCurlCffi(loginPayload, proxyUrl, "chrome120");
            
            if (loginRes.status_code === 403) {
                logToReff(`[${i+1}/${count}] Failed: IP Blocked (403). Retrying in 60s...`);
                for(let w=0; w<60; w++) {
                    if (!isReferralProcessActive) break;
                    await new Promise(r => setTimeout(r, 1000));
                }
                i--; 
                continue;
            }

            const data = loginRes.json?.data || loginRes.json;
            if (data) {
                const userId = data.userId || (data.user && data.user.userId);
                let token = data.accessToken;
                
                if (!token && loginRes.headers && loginRes.headers["set-cookie"]) {
                    const sc = Array.isArray(loginRes.headers["set-cookie"]) ? loginRes.headers["set-cookie"][0] : loginRes.headers["set-cookie"];
                    const match = sc.match(/access_token=([^;]+)/);
                    if (match) token = match[1];
                }

                if (token) {
                    if (!isReferralProcessActive) break;

                    const thinkTime = Math.floor(Math.random() * 3000) + 2000;
                    await new Promise(r => setTimeout(r, thinkTime));

                    const regPayload = { "userId": userId, "walletAddress": address, "socialHandle": handle, "referralCode": reffCode };
                    const regHeaders = { ...CONFIG_DEFAULT_HEADERS, "Cookie": `access_token=${token}`, "Content-Type": "application/json" };
                    const regRes = await callDiamanteAPI(`${API_BASE_URL}/auth/register`, "POST", regPayload, regHeaders, proxyUrl);
                    
                    if (regRes.json && regRes.json.success) {
                        logToReff(`[${i+1}/${count}] Success! Saved.`);
                        fs.appendFileSync(REFF_OUTPUT_FILE, `${address}|${wallet.privateKey}|${handle}\n`);
                        globalStats.reffCreated++;
                    } else {
                        logToReff(`[${i+1}/${count}] Register Failed: ${regRes.json?.message || "Unknown"}`);
                    }
                } else {
                    logToReff(`[${i+1}/${count}] No Token received.`);
                }
            } else {
                logToReff(`[${i+1}/${count}] Login Failed.`);
            }
        } catch (error) {
            logToReff(`[${i+1}/${count}] Error: ${error.message}`);
        }
        
        if (i < count - 1) {
             const delay = Math.floor(Math.random() * (dailyConfig.reffDelayMax - dailyConfig.reffDelayMin + 1) + dailyConfig.reffDelayMin) * 1000;
             logToReff(`[Wait] Cooling down ${Math.round(delay/1000)}s...`);
             const steps = delay / 1000;
             for(let s=0; s<steps; s++) {
                 if(!isReferralProcessActive) break;
                 await new Promise(r => setTimeout(r, 1000));
             }
        }
    }
    logToReff("Referral generation finished.");
    isReferralRunning = false;
    isReferralProcessActive = false;
    
    if (currentView === 'reff' && activeReffLogBox && activeReffLogBox.parent) {
        screen.render();
    }
}

function cleanupUI() {
    if (wrapperBox) wrapperBox.destroy();
    if (configForm) configForm.destroy();
    if (reffForm) reffForm.destroy();
    if (backBtn) backBtn.destroy();
    
    wrapperBox = null;
    configForm = null;
    reffForm = null;
    backBtn = null;
    
    activeReffLogBox = null;

    bots.forEach(b => b.detachUI(screen));
    
    if (activeMenuHandler) {
        screen.removeListener('keypress', activeMenuHandler);
        activeMenuHandler = null;
    }
}

function renderCurrentView() {
    cleanupUI();
    if (screen.width < 10 || screen.height < 5) return;

    if (currentView === 'menu') showMainMenu(false);
    else if (currentView === 'config') showConfigMenu(false);
    else if (currentView === 'reff') showReferralMenu(false);
    else if (currentView === 'group') showGroupDetails(currentGroupIndex, false);
    
    screen.render();
}

function updateDashboard() {
    if (statsBox && currentView === 'menu') {
        let activeCount = 0;
        let waitingCount = 0;
        
        bots.forEach(b => {
            if (b.status === 'Processing' || b.status === 'Waiting') activeCount++;
            else if (b.status === 'Waiting Cycle') waitingCount++;
        });

        globalStats.active = activeCount;
        globalStats.sleeping = waitingCount;

        const sysStatus = isRunning ? chalk.green("RUNNING") : chalk.yellow("STOPPED");
        const genStatus = isReferralRunning ? chalk.green("ON") : chalk.red("OFF");
        
        const content = ` {bold}System:{/bold} ${sysStatus}   {bold}Gen:{/bold} ${genStatus}   {bold}Active:{/bold} ${chalk.green(globalStats.active)}   {bold}Wait:{/bold} ${chalk.magenta(globalStats.sleeping)}   {bold}Reffs:{/bold} ${chalk.yellow(globalStats.reffCreated)}`;
        statsBox.setContent(content);
        screen.render();
    }
}

function showConfigMenu(doClear = true) {
    currentView = 'config';
    if(doClear) cleanupUI();

    const isSmall = screen.height < 25; 
    const boxHeight = isSmall ? 17 : 22; 
    const gap = isSmall ? 0 : 1; 
    const borderStyle = isSmall ? undefined : { type: 'line', fg: 'yellow' };

    const form = blessed.form({ 
        parent: screen, keys: true, left: 'center', top: 'center', width: '50%', height: boxHeight, 
        label: isSmall ? undefined : ' Configuration ', 
        border: borderStyle, 
        bg: 'black', 
        padding: { top: 1, left: 2, right: 2, bottom: 1 } 
    });
    
    const inputCount = blessed.textbox({ parent: form, top: 1, left: 'center', height: 3, width: '90%', keys: true, inputOnFocus: true, border: { type: 'line' }, value: String(dailyConfig.sendDiamRepetitions) });
    blessed.text({ parent: form, top: 0, left: 0, content: 'Transactions Per Day:' });

    const inputMin = blessed.textbox({ parent: form, top: 5 + gap, left: 'center', height: 3, width: '90%', keys: true, inputOnFocus: true, border: { type: 'line' }, value: String(dailyConfig.minSendAmount) });
    blessed.text({ parent: form, top: 4 + gap, left: 0, content: 'Min Amount (DIAM):' });

    const inputMax = blessed.textbox({ parent: form, top: 9 + (gap * 2), left: 'center', height: 3, width: '90%', keys: true, inputOnFocus: true, border: { type: 'line' }, value: String(dailyConfig.maxSendAmount) });
    blessed.text({ parent: form, top: 8 + (gap * 2), left: 0, content: 'Max Amount (DIAM):' });

    const btnTop = isSmall ? 13 : 16; 

    const saveBtn = blessed.button({ parent: form, top: btnTop, left: 2, width: 14, height: 3, content: ' SAVE ', align: 'center', valign: 'middle', style: { bg: 'green', fg: 'black', focus: { bg: 'white' } }, border: {type: 'line'} });
    const cancelBtn = blessed.button({ parent: form, top: btnTop, right: 2, width: 14, height: 3, content: ' CANCEL ', align: 'center', valign: 'middle', style: { bg: 'red', fg: 'white', focus: { bg: 'white', fg: 'black' } }, border: {type: 'line'} });

    const submit = () => {
        dailyConfig.sendDiamRepetitions = parseInt(inputCount.value) || 1;
        dailyConfig.minSendAmount = parseFloat(inputMin.value) || 0.0001;
        dailyConfig.maxSendAmount = parseFloat(inputMax.value) || 0.01;
        saveConfig();
        showMainMenu(true);
    };

    const cancel = () => showMainMenu(true);

    saveBtn.on('press', submit);
    cancelBtn.on('press', cancel);
    
    inputCount.on('submit', () => inputMin.focus());
    inputMin.on('submit', () => inputMax.focus());
    inputMax.on('submit', () => saveBtn.focus());
    
    activeMenuHandler = (ch, key) => { if (key.name === 'escape') cancel(); };
    screen.onceKey(['escape'], cancel);

    inputCount.focus();
    configForm = form;
    screen.append(form);
    screen.render();
}

function showReferralMenu(doClear = true) {
    currentView = 'reff';
    if(doClear) cleanupUI();

    const isSmall = screen.height < 25; 
    const boxHeight = isSmall ? 18 : 24;
    const logHeight = isSmall ? 3 : 8;
    const btnTop = isSmall ? 13 : 18;
    
    const form = blessed.form({ 
        parent: screen, keys: true, left: 'center', top: 'center', width: '60%', height: boxHeight, 
        border: isSmall ? undefined : { type: 'line', fg: 'magenta' }, 
        bg: 'black', padding: { top: 1, left: 2, right: 2, bottom: 1 } 
    });
    
    const inputCode = blessed.textbox({ parent: form, top: 1, left: 'center', height: 3, width: '90%', keys: true, inputOnFocus: true, border: { type: 'line' }, value: dailyConfig.referralCode || "" });
    blessed.text({ parent: form, top: 0, left: 0, content: 'Referral Code:' });

    const inputCount = blessed.textbox({ parent: form, top: 5, left: 'center', height: 3, width: '90%', keys: true, inputOnFocus: true, border: { type: 'line' }, value: String(dailyConfig.referralCount || 1) });
    blessed.text({ parent: form, top: 4, left: 0, content: 'Quantity to Generate:' });

    const logBox = blessed.box({ parent: form, top: 8, left: 'center', width: '90%', height: logHeight, border: {type: 'line'}, label: ' Logs ', scrollable: true, alwaysScroll: true });
    
    activeReffLogBox = logBox;
    if (referralLogs.length > 0) {
        logBox.setContent(referralLogs.join('\n'));
        logBox.setScrollPerc(100);
    }

    const startBtn = blessed.button({ 
        parent: form, top: btnTop, left: 2, width: 10, height: 3, content: ' START ', 
        style: { bg: 'green', fg: 'black', focus: { bg: 'white', fg: 'black' } }, // Turns white on select
        border: {type: 'line'} 
    });
    
    const stopBtn = blessed.button({ 
        parent: form, top: btnTop, left: 2, width: 10, height: 3, content: ' STOP ', 
        style: { bg: 'red', fg: 'white', focus: { bg: 'white', fg: 'black' } }, // Turns white on select
        border: {type: 'line'}, hidden: true 
    });
    
    const backBtnRef = blessed.button({ 
        parent: form, top: btnTop, right: 2, width: 10, height: 3, content: ' BACK ', 
        style: { bg: 'blue', fg: 'white', focus: { bg: 'white', fg: 'black' } }, // Turns white on select
        border: {type: 'line'} 
    });

    if (isReferralRunning) {
        startBtn.hide();
        stopBtn.show();
        inputCode.readOnly = true;
        inputCount.readOnly = true;
        stopBtn.focus();
    } else {
        inputCode.focus();
    }

    const startAction = async () => {
        const code = inputCode.value;
        dailyConfig.referralCode = code;
        dailyConfig.referralCount = parseInt(inputCount.value);
        saveConfig();
        
        startBtn.hide(); 
        stopBtn.show();
        stopBtn.focus();
        inputCode.readOnly = true;
        inputCount.readOnly = true;
        screen.render();
        
        runAutoReferral(code, dailyConfig.referralCount);
    };

    const stopAction = () => {
        isReferralProcessActive = false; 
        logToReff("Stopping requested...");
        startBtn.show();
        stopBtn.hide();
        inputCode.readOnly = false;
        inputCount.readOnly = false;
        startBtn.focus();
        screen.render();
    };

    startBtn.on('press', startAction);
    stopBtn.on('press', stopAction);
    
    backBtnRef.on('press', () => {
        activeReffLogBox = null; 
        showMainMenu(true);
    });
    
    inputCode.on('submit', () => inputCount.focus());
    inputCount.on('submit', () => startBtn.focus());
    
    reffForm = form;
    screen.append(form);
    screen.render();
}

function showMainMenu(doClear = true) {
    currentView = 'menu';
    if(doClear) cleanupUI();

    wrapperBox = blessed.box({ parent: screen, top: 0, left: 0, width: '100%', height: '100%' });

    const isSmall = screen.width < 100; 
    const bigBanner = `
{center}
{red-fg}
 ██████╗ ███████╗██████╗      ██╗  ██╗ █████╗ ███╗   ██╗██████╗ 
 ██╔══██╗██╔════╝██╔══██╗     ██║  ██║██╔══██╗████╗  ██║██╔══██╗
 ██████╔╝█████╗  ██║  ██║     ███████║███████║██╔██╗ ██║██║  ██║
 ██╔══██╗██╔══╝  ██║  ██║     ██╔══██║██╔══██║██║╚██╗██║██║  ██║
 ██║  ██║███████╗██████╔╝     ██║  ██║██║  ██║██║ ╚████║██████╔╝
 ╚═╝  ╚═╝╚══════╝╚═════╝      ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ 
{/red-fg}
{bold}{white-fg}DIAMANTE TESTNET AUTOMATION{/white-fg}{/bold}
{/center}`;

    const smallBanner = `
{center}
{bold}{red-fg}== RED HAND =={/red-fg}{/bold}
{white-fg}Diamante Testnet Automation{/white-fg}
{/center}`;

    const bannerContent = isSmall ? smallBanner : bigBanner;
    const bannerHeight = isSmall ? 5 : 10;

    bannerBox = blessed.box({ parent: wrapperBox, top: 0, left: 'center', width: '100%', height: bannerHeight, content: bannerContent, tags: true, style: { bg: 'black' } });

    dashboardBox = blessed.box({ parent: wrapperBox, top: bannerHeight, left: 'center', width: '100%', height: `100%-${bannerHeight}`, border: { type: 'line', fg: 'cyan' }, style: { bg: 'black' } });

    statsBox = blessed.box({ parent: dashboardBox, top: 1, left: 'center', width: '90%', height: 3, tags: true, border: { type: 'line', fg: 'white' }, label: ' Status ' });
    updateDashboard();

    const listBox = blessed.box({ parent: dashboardBox, top: 5, left: 2, width: '40%', height: 'shrink', tags: true });
    
    const startText = isRunning ? "{bold}{red-fg}[S] Stop Daily Activity{/red-fg}{/bold}" : "{bold}{green-fg}[S] Start Daily Activity{/green-fg}{/bold}";
    
    navBox = blessed.box({ parent: dashboardBox, top: 5, left: '50%', width: '40%', height: 'shrink', tags: true });
    navBox.setContent(`${startText}\n{bold}[C]{/bold} Configuration\n{bold}[R]{/bold} Auto Referral\n{bold}[Q]{/bold} Quit\n\nPage ${menuPageIndex+1}/${Math.ceil(bots.length/4) || 1}\nUse Arrow Keys to navigate.`);

    const totalGroups = Math.ceil(bots.length / 4);
    const startGroup = menuPageIndex * 5;
    const endGroup = Math.min(startGroup + 5, totalGroups);
    
    let listContent = "";
    for (let i = startGroup; i < endGroup; i++) {
        listContent += `{bold}{cyan-fg}[${i - startGroup + 1}]{/cyan-fg}{/bold} Group ${i + 1} (Accs ${i*4+1}-${Math.min((i+1)*4, bots.length)})\n\n`;
    }
    
    listBox.setContent(listContent || "No accounts loaded.");
    
    screen.render();

    const menuHandler = (ch, key) => {
        if (currentView !== 'menu') return;
        
        if (key.name === 'c') showConfigMenu(true);
        else if (key.name === 'r') showReferralMenu(true);
        else if (key.name === 'q') process.exit(0);
        else if (key.name === 's') {
            if (!isRunning) {
                isRunning = true;
                bots.forEach(b => b.start());
            } else {
                isRunning = false;
                bots.forEach(b => b.stop());
            }
            showMainMenu(true);
        }
        else if (/[1-5]/.test(ch)) {
            const selection = parseInt(ch) - 1;
            const absIndex = (menuPageIndex * 5) + selection;
            if (absIndex < totalGroups) showGroupDetails(absIndex, true);
        }
        else if (key.name === 'right' && endGroup < totalGroups) { menuPageIndex++; showMainMenu(true); }
        else if (key.name === 'left' && menuPageIndex > 0) { menuPageIndex--; showMainMenu(true); }
    };
    
    activeMenuHandler = menuHandler;
    screen.on('keypress', menuHandler);
}

function showGroupDetails(groupIndex, doClear = true) {
    currentView = 'group';
    if(doClear) cleanupUI();
    currentGroupIndex = groupIndex;

    const startIdx = groupIndex * 4;
    const endIdx = Math.min((groupIndex + 1) * 4, bots.length);
    const subset = bots.slice(startIdx, endIdx);

    subset.forEach((bot, index) => {
        const row = Math.floor(index / 2);
        const col = index % 2;
        bot.attachUI(screen, row * 44, col * 50, 42, 50);
    });

    backBtn = blessed.box({
        parent: screen, bottom: 0, right: 2, width: 20, height: 3, content: '[B] Back to Menu', align: 'center', valign: 'middle', tags: true, border: { type: 'line', fg: 'white' }, style: { fg: 'white', bg: 'black', hover: { bg: 'grey' } }
    });
    
    backBtn.on('click', () => showMainMenu(true));

    screen.render();

    const groupHandler = (ch, key) => {
        if (currentView !== 'group') return;
        if (key.name === 'b' || key.name === 'escape') showMainMenu(true);
    };
    
    activeMenuHandler = groupHandler;
    screen.on('keypress', groupHandler);
}


async function main() {
    loadConfig();
    loadAccountData();

    let addresses = [];
    try { addresses = fs.readFileSync(USER_FILE, 'utf8').split('\n').map(a=>a.trim()).filter(a=>a); } catch(e) { console.log("Create user.txt!"); process.exit(); }
    try { recipientAddresses = fs.readFileSync(WALLET_FILE, 'utf8').split('\n').map(a=>a.trim()).filter(a=>a); } catch(e) {}
    try { proxies = fs.readFileSync(PROXY_FILE, 'utf8').split('\n').map(a=>a.trim()).filter(a=>a); } catch(e) {}

    globalStats.total = addresses.length;

    addresses.forEach((addr, i) => {
        const p = proxies.length ? { url: proxies[i%proxies.length], type: proxies[i%proxies.length].startsWith('socks')?'socks5':'http'} : null;
        const bot = new DiamanteBot(addr, p, i+1);
        bots.push(bot);
    });

    screen = blessed.screen({ smartCSR: true, title: 'DIAMANTE BOT' });
    screen.enableMouse(); 

    screen.on('resize', () => {
        if(resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            renderCurrentView();
        }, 100);
    });

    dashboardInterval = setInterval(updateDashboard, 1000);
    showMainMenu(true);
}

main();