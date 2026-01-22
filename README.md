# 💎 Diamante Testnet Automation

A high-performance, CLI-based automation tool for the Diamante Blockchain Testnet campaign. This bot handles daily logins, faucet claims, and transactions using a smart cycle system with a dashboard UI (Blessed).

## ✨ Features

- **🖥️ TUI Dashboard:** Monitor multiple accounts, logs, and stats in a terminal interface.
- **🔄 Auto Daily Cycle:** Automatically logins, claims faucet, and performs transactions every 24 hours.
- **🛡️ Anti-Fingerprint:** Uses `curl_cffi` (Python) for TLS fingerprint spoofing to bypass 403 blocks.
- **🌐 Proxy Support:** Supports HTTP/SOCKS5 proxies per account.
- **👥 Referral Generator:** Built-in tool to generate referrals with random handles and wallets.
- **⚡ Smart Jitter:** Random delays between actions to mimic human behavior.

## 🛠️ Prerequisites

1.  **Node.js** (v18 or higher)
2.  **Python 3.10+** (Required for the connection scripts)
3.  **Pip** (Python package manager)

## 📥 Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Chupii37/Diamante.git
    cd Diamante
    ```

2.  **Install Node.js dependencies:**
    ```bash
    npm install
    ```

3.  **Install Python dependencies:**
    ```bash
    pip install curl_cffi
    ```
    *Note: If you get an error.*
    ```bash
    pip3 install curl_cffi --break-system-packages
    ```
    
## ⚙️ Configuration

Create the following files in the root directory before running:

### 1. `user.txt` (Required)
Put your Wallet Address here, one per line.
```bash
nano user.txt
```

### 2. `proxy.txt` (Optional)
Put your proxies here (HTTP or SOCKS5), one per line. The bot rotates them for accounts.
```bash
nano proxy.txt
```

## 🚀 Usage
Start the bot using:
```bash
npm start
```

## ⚠️ Disclaimer
This tool is for educational purposes only. Use it at your own risk. The author is not responsible for any bans or penalties incurred by using this software.

## ☕ Fuel the Machine (Treats & Caffeine)
If this code saved your fingers from repetitive clicking, consider buying me a "digital beverage." Here is the menu of acceptable caffeinated transactions:

The "Git Push" Espresso: Short, dark, and strong enough to fix merge conflicts at 3 AM.

The "Panic Kernel" Cold Brew: Iced coffee so potent it halts the CPU.

Latte of Lesser Lag: A smooth blend that reduces ping and increases dopamine.

The "Syntax Sugar" Frappé: Pure sweetness, zero nutritional value, but makes the code look pretty.

Deprecation Decaf: (Please don't buy this, it's just sad water).

[Buy me a coffee☕](https://saweria.co/chupii)
