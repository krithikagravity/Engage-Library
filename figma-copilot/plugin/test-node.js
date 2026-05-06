const pptxgen = require("pptxgenjs");

function convertColorToHex(c) {
  if (!c) return 'CCCCCC';
  const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
  return r + g + b;
}

let pres = new pptxgen();
let slide = pres.addSlide();
slide.background = { color: convertColorToHex({r:1, g:1, b:1}) };

pres.write({ outputType: "base64" }).then((base64) => {
  console.log("SUCCESS length:", base64.length);
}).catch(err => {
  console.error("ERROR:", err.message);
});
