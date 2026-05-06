const selection = [{ id: 1, type: "FRAME", x: 10, y: 10, width: 100, height: 100, parent: { id: 0 } }, { id: 2, type: "FRAME", x: 120, y: 10, width: 100, height: 100, parent: { id: 0 } }];
const parent = selection[0].parent;
if (parent) {
  console.log("Grouping", selection.length, "elements");
}
