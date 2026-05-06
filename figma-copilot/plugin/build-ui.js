const fs = require('fs');
const https = require('https');

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function run() {
  let ui = fs.readFileSync('src/ui.html', 'utf8');
  
  // Remove the CDN tags from the source
  ui = ui.replace('<script src="https://cdn.jsdelivr.net/gh/gitbrent/pptxgenjs@3.12.0/libs/jszip.min.js"></script>', '');
  ui = ui.replace('<script src="https://cdn.jsdelivr.net/gh/gitbrent/pptxgenjs@3.12.0/dist/pptxgen.min.js"></script>', '');

  console.log("Downloading JSZip...");
  const jszip = await download('https://cdn.jsdelivr.net/gh/gitbrent/pptxgenjs@3.12.0/libs/jszip.min.js');
  console.log("Downloading PptxGenJS...");
  const pptxgen = await download('https://cdn.jsdelivr.net/gh/gitbrent/pptxgenjs@3.12.0/dist/pptxgen.min.js');

  const inlinedScripts = `\n<script>\n${jszip}\n${pptxgen}\n</script>\n`;
  
  // Insert before the closing head tag
  ui = ui.replace('</head>', inlinedScripts + '</head>');
  
  fs.writeFileSync('dist/ui.html', ui);
  console.log("Inlined scripts into dist/ui.html");
}
run();
