# VCCE Server

A lightweight TCP file-system server that powers the **VCCE** code editor.

[VCCE on Gumroad](https://victorchanet.gumroad.com/l/vcce)

---

## ✨ What is VCCE?
[VCCE] is a cross-platform code editor focused on Lua-based game development. It communicates with a local Node.js server to perform fast, secure file-system operations (read, write, rename, etc.). **VCCE Server** is that companion service.

## 🚀 Installation
```bash
# Install globally from npm (requires Node 20+)
npm install -g vcce
```
The installer provisions the global command `vcce`.

## 🔧 Usage
```bash
# Start the server on the default port (7071)
vcce
```
Options:
```bash
PORT=9000 vcce    # change listening port
```

When the server is running, launch the VCCE editor. It will automatically connect to `127.0.0.1:7071` (or the port you set). If it cannot connect, the editor shows an error prompt like:
```
Cannot connect to VCCE Server (127.0.0.1)
Please start the VCCE Node.js server and try again.
```

## 📦 Publishing & CI
Every push to the `main` branch triggers GitHub Actions to:
1. Bump the package version (`X.Y.Z-<run>`).
2. Publish the build to npm under the **public** scope.
Set the secret `NPM_TOKEN` with publish permissions for this to work.

## 🛠️ Development
1. Clone the repo and install deps:
   ```bash
   git clone https://github.com/<your-user>/VCCE_Server.git
   cd VCCE_Server
   npm ci
   ```
2. Run locally:
   ```bash
   npm start    # or node index.js
   ```
3. From another terminal, you can test with `nc` or by opening VCCE.

## 🤝 Contributing
Pull requests and issue reports are welcome! Please lint and test before submitting.

## 📄 License
MIT

