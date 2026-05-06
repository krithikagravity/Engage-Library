const fs = require('fs');
const content = fs.readFileSync('node_modules/@figma/plugin-typings/index.d.ts', 'utf8');
console.log("btoa present:", content.includes('function btoa('));
