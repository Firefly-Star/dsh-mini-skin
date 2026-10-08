const v = await (await fetch('http://127.0.0.1:9335/json/version')).json();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
await new Promise((r) => setTimeout(r, 1500));
console.log('Browser.close sent');
