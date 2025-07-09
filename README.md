# VCCE Server

A lightweight TCP file-system server that powers the **VCCE** code editor.

[VCCE on Gumroad](https://victorchanet.gumroad.com/l/vcce)

---

## ✨ What is VCCE?
[VCCE] is a juicy retro code editor. It communicates with a local Node.js server to perform fast, secure file-system operations (read, write, rename, etc.). **VCCE Server** is that companion service.

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

When the server is running, launch the VCCE editor. It will automatically connect to `127.0.0.1:7071` (or the port you set). If it cannot connect, the editor shows an error prompt like:
```
Cannot connect to VCCE Server (127.0.0.1)
Please start the VCCE Node.js server and try again.
```

