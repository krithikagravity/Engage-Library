const selection = [{
  absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 100 }
}, {
  absoluteBoundingBox: { x: 120, y: 10, width: 100, height: 100 }
}];
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const node of selection) {
  const box = node.absoluteBoundingBox;
  if (box) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
}
console.log(minX, minY, maxX - minX, maxY - minY);
