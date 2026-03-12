// Screenshot helper
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const [,, htmlFile, outFile, port = '3399'] = process.argv;

const html = fs.readFileSync(htmlFile, 'utf8');

const server = http.createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    return; // keep open, send nothing
  }
  if (req.url === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ projectMap: {} }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});

server.listen(parseInt(port), async () => {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 820 });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0', timeout: 8000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2500));
  const canvas = await page.$('canvas');
  if (canvas) {
    await canvas.screenshot({ path: outFile });
  } else {
    await page.screenshot({ path: outFile });
  }
  await browser.close();
  server.close();
  console.log('Screenshot saved:', outFile);
});
