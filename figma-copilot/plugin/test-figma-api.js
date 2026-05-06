const fs = require('fs');
const content = fs.readFileSync('node_modules/@figma/plugin-typings/index.d.ts', 'utf8');
console.log("base64Encode present:", content.includes('base64Encode'));
