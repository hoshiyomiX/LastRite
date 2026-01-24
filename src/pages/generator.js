export const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Aegir Generator</title>
    <style>
        :root { --primary: #00f2ea; --secondary: #ff0050; --bg: #0a0a0a; --surface: #161616; --text: #ffffff; --muted: #888888; }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', sans-serif; }
        body { background: var(--bg); color: var(--text); display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
        .container { background: var(--surface); padding: 2rem; border-radius: 16px; width: 100%; max-width: 500px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid #333; }
        h1 { text-align: center; margin-bottom: 2rem; background: linear-gradient(45deg, var(--primary), var(--secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800; }
        .form-group { margin-bottom: 1.5rem; }
        label { display: block; margin-bottom: 0.5rem; color: var(--muted); font-size: 0.9rem; }
        input, select { width: 100%; padding: 12px; background: #222; border: 1px solid #333; border-radius: 8px; color: var(--text); font-size: 1rem; transition: 0.3s; }
        input:focus, select:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 2px rgba(0, 242, 234, 0.2); }
        button { width: 100%; padding: 14px; background: linear-gradient(45deg, var(--primary), #00c2bb); border: none; border-radius: 8px; color: #000; font-weight: bold; font-size: 1.1rem; cursor: pointer; transition: 0.3s; }
        button:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 242, 234, 0.3); }
        #result { margin-top: 1.5rem; padding: 1rem; background: #222; border-radius: 8px; word-break: break-all; display: none; position: relative; }
        .copy-btn { position: absolute; top: 5px; right: 5px; background: #444; color: #fff; padding: 4px 8px; font-size: 0.8rem; width: auto; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Aegir Generator 🌊</h1>
        <div class="form-group">
            <label>Domain / SNI</label>
            <input type="text" id="domain" placeholder="example.com" value="">
        </div>
        <div class="form-group">
            <label>Format</label>
            <select id="format">
                <option value="raw">Raw (Clash/Meta)</option>
                <option value="v2ray">V2Ray (Base64)</option>
                <option value="clash">Clash Provider</option>
            </select>
        </div>
        <button onclick="generateLink()">Generate Link</button>
        <div id="result">
            <button class="copy-btn" onclick="copyToClipboard()">Copy</button>
            <code id="output"></code>
        </div>
    </div>
    <script>
        document.getElementById('domain').value = window.location.hostname;
        function generateLink() {
            const domain = document.getElementById('domain').value;
            const format = document.getElementById('format').value;
            const origin = window.location.origin;
            let finalUrl = "";
            if (format === 'clash') {
                finalUrl = origin + "/sub?host=" + domain + "&format=clash";
            } else if (format === 'v2ray') {
                finalUrl = origin + "/api/v1/sub?host=" + domain + "&format=v2ray";
            } else {
                finalUrl = origin + "/api/v1/sub?host=" + domain + "&format=raw";
            }
            document.getElementById('output').innerText = finalUrl;
            document.getElementById('result').style.display = 'block';
        }
        function copyToClipboard() {
            const text = document.getElementById('output').innerText;
            navigator.clipboard.writeText(text).then(() => {
                const btn = document.querySelector('.copy-btn');
                btn.innerText = 'Copied!';
                setTimeout(() => btn.innerText = 'Copy', 2000);
            });
        }
    </script>
</body>
</html>`;
