figma.showUI(__html__, { width: 380, height: 620, title: "Figma Copilot" });

async function sendInitialContext() {
  try {
    // Small delay gives Figma time to sync manifest permissions on first load
    await new Promise(r => setTimeout(r, 150));
    let user: { id?: string; name?: string } | null = null;
    try {
      user = (figma as any).currentUser;
    } catch(e) {
      // "currentuser" permission not yet synced — silently continue
    }
    figma.ui.postMessage({
      type: "INIT",
      payload: {
        userId: user && user.id ? user.id : "anonymous",
        userName: user && user.name ? user.name : "Designer",
        tokens: getDesignTokens(),
      },
    });
  } catch(e) {
    // Silently swallow — plugin will still work without user info
    figma.ui.postMessage({ type: "INIT", payload: { userId: "anonymous", userName: "Designer", tokens: {} } });
  }
}

function getDesignTokens() {
  const colors = figma.getLocalPaintStyles()
    .filter((s) => s.paints.length > 0 && s.paints[0].type === "SOLID")
    .map((s) => {
      const c = (s.paints[0] as SolidPaint).color;
      return { name: s.name, id: s.id, color: { r: c.r, g: c.g, b: c.b } };
    });
  const textStyles = figma.getLocalTextStyles().map((s) => ({ name: s.name, fontSize: s.fontSize }));
  let variables: { name: string; id: string; type: string; color?: { r: number, g: number, b: number } }[] = [];
  try {
    const collections = figma.variables.getLocalVariableCollections();
    const defaultModeId = collections.length > 0 ? collections[0].defaultModeId : null;
    variables = figma.variables.getLocalVariables().map((v) => {
      let colorVal = undefined;
      if (v.resolvedType === "COLOR" && defaultModeId) {
        const val = v.valuesByMode[defaultModeId];
        if (val && typeof val === "object" && "r" in val) {
          colorVal = { r: (val as any).r, g: (val as any).g, b: (val as any).b };
        }
      }
      return { name: v.name, id: v.id, type: v.resolvedType, color: colorVal };
    });
  } catch (e) {}
  return { colors, textStyles, variables };
}

let nodesSerialized = 0;
const MAX_SERIALIZED_NODES = 500;

function serializeNode(node: SceneNode, depth: number): Record<string, unknown> {
  if (nodesSerialized >= MAX_SERIALIZED_NODES) return { id: node.id, name: node.name, type: node.type, note: "limit reached" };
  nodesSerialized++;

  const result: Record<string, unknown> = { id: node.id, name: node.name, type: node.type };
  if ("width" in node && typeof node.width === "number") { result.width = Math.round(node.width); result.height = Math.round(node.height); }
  if ("x" in node && typeof node.x === "number") { result.x = Math.round(node.x); result.y = Math.round(node.y); }
  if ("opacity" in node && typeof node.opacity === "number") result.opacity = node.opacity;
  if ("cornerRadius" in node && node.cornerRadius !== figma.mixed) result.cornerRadius = node.cornerRadius;
  if (node.type === "TEXT") { 
    result.characters = (node as TextNode).characters.slice(0, 500); 
    if ((node as TextNode).fontSize !== figma.mixed) result.fontSize = (node as TextNode).fontSize as number; 
  }
  if ("fills" in node && node.fills !== figma.mixed) {
    const fills = node.fills as Paint[];
    if (Array.isArray(fills) && fills.length > 0) {
      if (fills[0].type === "SOLID" && fills[0].color) {
        result.color = { r: parseFloat(fills[0].color.r.toFixed(3)), g: parseFloat(fills[0].color.g.toFixed(3)), b: parseFloat(fills[0].color.b.toFixed(3)) };
      }
    }
  }
  if ("strokes" in node) {
    const strokes = (node as any).strokes;
    if (Array.isArray(strokes) && strokes.length > 0 && strokes[0].type === "SOLID" && strokes[0].color) {
      result.strokeColor = { r: parseFloat(strokes[0].color.r.toFixed(3)), g: parseFloat(strokes[0].color.g.toFixed(3)), b: parseFloat(strokes[0].color.b.toFixed(3)) };
    }
  }
  if ("layoutMode" in node) {
    result.layoutMode = (node as any).layoutMode;
    const fn = node as any;
    result.paddingTop    = fn.paddingTop    || 0;
    result.paddingBottom = fn.paddingBottom || 0;
    result.paddingLeft   = fn.paddingLeft   || 0;
    result.paddingRight  = fn.paddingRight  || 0;
    result.itemSpacing   = fn.itemSpacing   || 0;
    if ("primaryAxisAlignItems" in node) result.primaryAxisAlignItems = (node as any).primaryAxisAlignItems;
    if ("counterAxisAlignItems" in node) result.counterAxisAlignItems = (node as any).counterAxisAlignItems;
  }
  if ("children" in node && depth < 3) {
    result.children = node.children.slice(0, 20).map((c) => serializeNode(c as SceneNode, depth + 1));
  }
  return result;
}

function serializeScreenForAudit(n: SceneNode): Record<string, unknown> {
  const base: any = { id: n.id, name: n.name, type: n.type };
  if ("width" in n) { base.width = Math.round(n.width); base.height = Math.round(n.height); }
  if ("x" in n) { base.x = Math.round((n as FrameNode).x); base.y = Math.round((n as FrameNode).y); }
  if ("layoutMode" in n) {
    const f = n as FrameNode;
    base.layoutMode = f.layoutMode;
    base.paddingTop = f.paddingTop; base.paddingBottom = f.paddingBottom;
    base.paddingLeft = f.paddingLeft; base.paddingRight = f.paddingRight;
    base.itemSpacing = f.itemSpacing;
  }
  if ("cornerRadius" in n && n.cornerRadius !== figma.mixed) base.cornerRadius = n.cornerRadius;
  if ("opacity" in n && typeof n.opacity === "number" && n.opacity < 1) base.opacity = n.opacity;
  if ("fills" in n && n.fills !== figma.mixed) {
    const fills = n.fills as Paint[];
    if (Array.isArray(fills) && fills.length > 0 && fills[0].type === "SOLID") {
      const c = (fills[0] as SolidPaint).color;
      base.color = { r: parseFloat(c.r.toFixed(3)), g: parseFloat(c.g.toFixed(3)), b: parseFloat(c.b.toFixed(3)) };
    }
  }
  if ("children" in n) {
    base.children = (n as FrameNode).children.slice(0, 30).map(c => serializeScreenForAudit(c as SceneNode));
  }
  return base;
}

let pptxNodesProcessed = 0;

function uint8ToBase64(bytes: Uint8Array): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64 = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    base64 += chars[b1 >> 2];
    base64 += chars[((b1 & 3) << 4) | (b2 >> 4)];
    base64 += i + 1 < bytes.length ? chars[((b2 & 15) << 2) | (b3 >> 6)] : "=";
    base64 += i + 2 < bytes.length ? chars[b3 & 63] : "=";
  }
  return base64;
}

function intersectBounds(a: {x:number, y:number, w:number, h:number}, b: {x:number, y:number, w:number, h:number}) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function extractTextNodes(frame: FrameNode): any[] {
  const frameBB = frame.absoluteBoundingBox;
  if (!frameBB) return [];
  const nodes: any[] = [];
  function traverse(node: SceneNode) {
    if (!node.visible) return;
    if (node.type === 'TEXT') {
      const tn = node as TextNode;
      const bb = tn.absoluteBoundingBox;
      if (!bb || !tn.characters.trim()) return;
      let color = '000000';
      const fills = Array.isArray(tn.fills) ? tn.fills : [];
      const sf = fills.find((f:any)=>f.type==='SOLID'&&f.visible!==false) as any;
      if (sf) color = [sf.color.r,sf.color.g,sf.color.b].map((c:number)=>Math.round(c*255).toString(16).padStart(2,'0')).join('');
      const fn = tn.fontName as any;
      nodes.push({
        text: tn.characters,
        x: bb.x - frameBB.x, y: bb.y - frameBB.y,
        width: bb.width, height: bb.height,
        fontSize: typeof tn.fontSize==='number' ? tn.fontSize : 16,
        fontFamily: fn?.family||'Arial',
        bold: fn?.style?.toLowerCase().includes('bold')||false,
        italic: fn?.style?.toLowerCase().includes('italic')||false,
        align: tn.textAlignHorizontal==='CENTER'?'center':tn.textAlignHorizontal==='RIGHT'?'right':'left',
        color,
      });
    }
    if ('children' in node) for (const c of (node as any).children) traverse(c);
  }
  if ('children' in frame) for (const c of (frame as any).children) traverse(c);
  return nodes;
}

async function extractFrameForPPTX(frame: FrameNode): Promise<Record<string, unknown>> {
  const base: any = { id: frame.id, name: frame.name, width: frame.width, height: frame.height, type: 'FRAME' };

  let originalClips = true;
  if ('clipsContent' in frame) { originalClips=(frame as any).clipsContent; (frame as any).clipsContent=true; }

  // 1. Gather ALL text nodes in the frame (including inside components)
  const allText: TextNode[] = [];
  function gatherText(node: SceneNode) {
    if (node.type==='TEXT') allText.push(node as TextNode);
    if ('children' in node) for (const c of (node as any).children) gatherText(c);
  }
  if ('children' in frame) for (const c of (frame as any).children) gatherText(c);

  // 2. Hide text → export pixel-perfect PNG with no text → restore text
  const originalOpacities = new Map<TextNode, number>();
  for (const t of allText) {
    originalOpacities.set(t, t.opacity);
    t.opacity = 0; // opacity=0 preserves auto-layout, visible=false breaks it!
  }

  try {
    const bytes = await frame.exportAsync({format:'PNG',constraint:{type:'SCALE',value:1}});
    base.backgroundImage = uint8ToBase64(bytes);
  } catch(e1) {
    try {
      const bytes2 = await frame.exportAsync({format:'PNG',constraint:{type:'SCALE',value:0.5}});
      base.backgroundImage = uint8ToBase64(bytes2);
    } catch(_) { figma.notify('Frame export failed.',{error:true}); }
  }

  for (const t of allText) {
    t.opacity = originalOpacities.get(t) ?? 1;
  }

  if ('clipsContent' in frame) (frame as any).clipsContent = originalClips;

  // 3. Extract text node data for native PowerPoint text boxes
  base.textNodes = extractTextNodes(frame);
  return base;
}


function getSelectionContext() {
  nodesSerialized = 0;
  const selection = figma.currentPage.selection;
  if (selection.length === 0) return null;
  if (selection.length > 1) {
    return {
      multiSelect: true,
      count: selection.length,
      nodes: selection.map(n => {
        const basic: any = { id: n.id, name: n.name, type: n.type };
        if ("width" in n) { basic.width = Math.round(n.width); basic.height = Math.round(n.height); }
        if ("fills" in n && n.fills !== figma.mixed) {
          const fills = n.fills as Paint[];
          if (Array.isArray(fills) && fills.length > 0 && fills[0].type === "SOLID") {
            const c = (fills[0] as SolidPaint).color;
            basic.color = { r: parseFloat(c.r.toFixed(3)), g: parseFloat(c.g.toFixed(3)), b: parseFloat(c.b.toFixed(3)) };
          }
        }
        try {
          if ("findAll" in n) {
            const textNodes = (n as FrameNode).findAll(tn => tn.type === "TEXT") as TextNode[];
            basic.allTextNodes = textNodes.slice(0, 50).map(tn => {
              try { return { id: tn.id, name: tn.name, characters: tn.characters }; } catch(e) { return null; }
            }).filter(Boolean);
          }
        } catch(e) {}
        return basic;
      })
    };
  }
  let finalPayload: any;
  try {
    const node = selection[0];
    const serialized = serializeNode(node, 0);
    if (node.parent && "children" in node.parent) {
      const siblings = (node.parent as ChildrenMixin).children;
      serialized.currentIndex = siblings.indexOf(node as SceneNode);
      serialized.totalSiblings = siblings.length;
    }
    let allTexts: { id: string; name: string; characters: string }[] = [];
    try {
      if ("findAll" in node) {
        const textNodes = (node as FrameNode).findAll(n => n.type === "TEXT") as TextNode[];
        allTexts = textNodes.slice(0, 50).map(n => {
          try { return { id: n.id, name: n.name, characters: n.characters }; } catch(e) { return null; }
        }).filter(Boolean) as { id: string; name: string; characters: string }[];
      }
    } catch(e) {}
    serialized.allTextNodes = allTexts;
    finalPayload = serialized;
  } catch (e) {
    const node = selection[0];
    finalPayload = { id: node.id, name: node.name, type: node.type };
  }
  // Sanitize via JSON stringify to completely eliminate any lingering figma.mixed or symbols 
  // that would cause figma.ui.postMessage to throw a serialization crash!
  return JSON.parse(JSON.stringify(finalPayload));
}

figma.on("selectionchange", () => {
  try {
    figma.ui.postMessage({ type: "SELECTION_CHANGED", payload: getSelectionContext() });
  } catch (e) {
    figma.ui.postMessage({ type: "SELECTION_CHANGED", payload: null });
  }
});

figma.ui.onmessage = async (msg) => {
  if (msg.type === "GET_SELECTION") {
    figma.ui.postMessage({ type: "SELECTION_CHANGED", payload: getSelectionContext() });
  } else if (msg.type === "GET_FULL_CONTEXT") {
    figma.ui.postMessage({ type: "FULL_CONTEXT", payload: getSelectionContext() });
  } else if (msg.type === "AUDIT_SELECTION") {
    const selection = figma.currentPage.selection;
    const screens = selection.map(n => serializeScreenForAudit(n as SceneNode));
    figma.ui.postMessage({ type: "AUDIT_DATA", payload: screens });
  } else if (msg.type === "APPLY_AUTOLAYOUT") {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.notify('⚠️ Select a frame first', { error: true });
    } else {
      for (const node of selection) {
        applyAutoLayout(node);
      }
      figma.notify('✅ Auto layout applied!');
    }
  } else if (msg.type === "EXPORT_PPTX") {
    try {
      const selection = figma.currentPage.selection;
      if (selection.length === 0) {
        figma.ui.postMessage({ type: "PPTX_DATA", payload: { error: "Please select at least one frame to export." } });
      } else {
        const frames = selection.filter(n => n.type === "FRAME" || n.type === "COMPONENT" || n.type === "INSTANCE") as FrameNode[];
        const total = frames.length;

        // Signal how many frames to expect
        figma.ui.postMessage({ type: "PPTX_START", total });

        // Send each frame independently to avoid hitting Figma's postMessage size limit
        for (let i = 0; i < frames.length; i++) {
          figma.ui.postMessage({ type: "PPTX_PROGRESS", count: `Exporting frame ${i + 1} of ${total}...` });
          const serialized = await extractFrameForPPTX(frames[i]);
          figma.ui.postMessage({ type: "PPTX_FRAME", frame: JSON.parse(JSON.stringify(serialized)), index: i, total });
        }
      }
    } catch(e) {
      figma.ui.postMessage({ type: "PPTX_DATA", payload: { error: String(e) } });
    }
  } else if (msg.type === "EXECUTE_ACTIONS") {
    await executeActions(msg.actions);
  } else if (msg.type === "APPLY_DARK_MODE") {
    const selectedNodes = figma.currentPage.selection;
    if (selectedNodes.length > 0) {
      selectedNodes.forEach((node) => processLayers(node));
      figma.notify('Intelligent Dark Mode applied!');
    } else {
      figma.notify('Please select a frame or layers.');
    }
  } else if (msg.type === "CLOSE") {
    figma.closePlugin();
  }
};

const ICON_THRESHOLD = 32;

function isIcon(node) {
  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') return true;
  if (node.width <= ICON_THRESHOLD && node.height <= ICON_THRESHOLD) return true;
  if ('children' in node && node.children.length > 0) {
    const allVector = node.children.every(c =>
      ['VECTOR','BOOLEAN_OPERATION','ELLIPSE','RECTANGLE','LINE','STAR','POLYGON'].includes(c.type)
    );
    if (allVector) return true;
  }
  return false;
}

function applyAutoLayout(node, depth = 0) {
  if (depth > 30) { console.log('AutoLayout: Depth limit reached'); return; }
  if (!('children' in node)) { console.log('AutoLayout: Node has no children', node.name); return; }
  if (node.type === 'GROUP') { console.log('AutoLayout: Skipping Group node', node.name); return; }
  if (isIcon(node)) { console.log('AutoLayout: Node identified as Icon', node.name); return; }

  // Recurse children first (bottom up)
  for (const child of node.children) {
    applyAutoLayout(child, depth + 1);
  }

  const children = [...node.children];
  if (children.length < 2) { console.log('AutoLayout: Less than 2 children, skipping', node.name); return; }

  // Skip if any child is absolutely positioned way outside
  const validChildren = children.filter(c => 
    c.x >= -10 && c.y >= -10 &&
    c.x < node.width + 10 &&
    c.y < node.height + 10
  );
  if (validChildren.length < 2) { console.log('AutoLayout: Less than 2 valid children (within bounds), skipping', node.name); return; }

  // 1. OVERLAP DETECTION
  for (let i = 0; i < validChildren.length; i++) {
    for (let j = i + 1; j < validChildren.length; j++) {
      const a = validChildren[i];
      const b = validChildren[j];
      const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      const overlapArea = overlapX * overlapY;
      if (overlapArea > 0) {
        const smallerArea = Math.min(a.width * a.height, b.width * b.height);
        if (smallerArea > 0 && overlapArea / smallerArea > 0.20) return;
      }
    }
  }

  // 2. GRID DETECTION
  const uniqueY = [];
  const uniqueX = [];
  for (const c of validChildren) {
    if (!uniqueY.some(y => Math.abs(y - c.y) < 5)) uniqueY.push(c.y);
    if (!uniqueX.some(x => Math.abs(x - c.x) < 5)) uniqueX.push(c.x);
  }
  if (uniqueY.length >= 2 && uniqueX.length >= 2) {
    console.log('AutoLayout: Grid detected (items on multiple rows/cols), skipping', node.name);
    return;
  }

  console.log('AutoLayout: Success! Applying to', node.name, 'Direction:', direction);

  // Detect direction
  const yValues = validChildren.map(c => c.y);
  const xValues = validChildren.map(c => c.x);
  const ySpread = Math.max(...yValues) - Math.min(...yValues);
  const xSpread = Math.max(...xValues) - Math.min(...xValues);
  const direction = xSpread > ySpread ? 'HORIZONTAL' : 'VERTICAL';

  // 3. ALIGNMENT DETECTION
  let counterAxisAlignItems = 'MIN';
  if (direction === 'HORIZONTAL') {
    const centers = validChildren.map(c => c.y + c.height / 2);
    const ends = validChildren.map(c => c.y + c.height);
    const varCenters = Math.max(...centers) - Math.min(...centers);
    const varEnds = Math.max(...ends) - Math.min(...ends);
    const varMins = Math.max(...yValues) - Math.min(...yValues);
    if (varCenters < 5 && varCenters < varMins) counterAxisAlignItems = 'CENTER';
    else if (varEnds < 5 && varEnds < varMins) counterAxisAlignItems = 'MAX';
  } else {
    const centers = validChildren.map(c => c.x + c.width / 2);
    const ends = validChildren.map(c => c.x + c.width);
    const varCenters = Math.max(...centers) - Math.min(...centers);
    const varEnds = Math.max(...ends) - Math.min(...ends);
    const varMins = Math.max(...xValues) - Math.min(...xValues);
    if (varCenters < 5 && varCenters < varMins) counterAxisAlignItems = 'CENTER';
    else if (varEnds < 5 && varEnds < varMins) counterAxisAlignItems = 'MAX';
  }

  // Sort children by position
  const sorted = [...validChildren].sort((a, b) =>
    direction === 'HORIZONTAL' ? a.x - b.x : a.y - b.y
  );

  // 4. CALCULATE GAPS & UNEVEN GAP HANDLING
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const gap = direction === 'HORIZONTAL'
      ? curr.x - (prev.x + prev.width)
      : curr.y - (prev.y + prev.height);
    if (gap >= 0 && gap < 200) gaps.push(gap);
  }
  
  let primaryAxisAlignItems = 'MIN';
  let itemSpacing = 0;
  
  if (gaps.length > 0) {
    const maxGap = Math.max(...gaps);
    const minGap = Math.min(...gaps);
    if (maxGap - minGap > 10) {
      primaryAxisAlignItems = 'SPACE_BETWEEN';
    } else {
      itemSpacing = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    }
  }

  // Calculate padding
  const paddingLeft = Math.max(0, Math.round(Math.min(...xValues)));
  const paddingTop = Math.max(0, Math.round(Math.min(...yValues)));
  const paddingRight = Math.max(0, Math.round(
    node.width - Math.max(...validChildren.map(c => c.x + c.width))
  ));
  const paddingBottom = Math.max(0, Math.round(
    node.height - Math.max(...validChildren.map(c => c.y + c.height))
  ));

  try {
    // Save dimensions BEFORE applying auto layout
    const w = node.width;
    const h = node.height;

    node.layoutMode = direction;
    node.itemSpacing = itemSpacing;
    node.primaryAxisAlignItems = primaryAxisAlignItems;
    node.counterAxisAlignItems = counterAxisAlignItems;
    node.paddingLeft = paddingLeft;
    node.paddingTop = paddingTop;
    node.paddingRight = paddingRight;
    node.paddingBottom = paddingBottom;

    // Keep FIXED sizing to preserve original dimensions
    node.primaryAxisSizingMode = 'FIXED';
    node.counterAxisSizingMode = 'FIXED';

    // Restore dimensions after auto layout changes them
    node.resize(w, h);

  } catch (e) {
    console.warn('Skipped:', node.name, e.message);
    try { node.layoutMode = 'NONE'; } catch (err) {}
  }
}


interface FCAction {
  type: string;
  nodeId?: string;
  name?: string;
  value?: unknown;
  direction?: string;
  offsetX?: number;
  offsetY?: number;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  r?: number;
  g?: number;
  b?: number;
  a?: number;
  variableId?: string;
  styleId?: string;
  layoutMode?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
}

function findFirstTextChild(node: BaseNode): TextNode | null {
  if (node.type === "TEXT") return node as TextNode;
  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      const found = findFirstTextChild(child);
      if (found) return found;
    }
  }
  return null;
}

async function replaceTextInSelection(fromText: string, toText: string): Promise<number> {
  const selection = figma.currentPage.selection;
  let changed = 0;
  for (const frame of selection) {
    if (!("findAll" in frame)) continue;
    const textNodes = (frame as FrameNode).findAll(n => n.type === "TEXT") as TextNode[];
    for (const tn of textNodes) {
      try {
        if (tn.characters.includes(fromText)) {
          try { await figma.loadFontAsync(tn.fontName as FontName); }
          catch(e) { await figma.loadFontAsync({ family: "Inter", style: "Regular" }); tn.fontName = { family: "Inter", style: "Regular" }; }
          tn.characters = tn.characters.split(fromText).join(toText);
          changed++;
        }
      } catch(e) { console.error("REPLACE_TEXT err", e); }
    }
  }
  return changed;
}

async function executeActions(actions: FCAction[]) {
  console.log("FC_EXEC", actions.length, JSON.stringify(actions));
  let reorderDone = false;
  for (const action of actions) {
    if (action.type === "REORDER" || action.type === "DETACH_AND_REORDER") {
      if (reorderDone) { console.log("FC_SKIP_REORDER"); continue; }
      reorderDone = true;
    }
    try { await executeAction(action); } catch (e) { console.error("FC_FAIL", action.type, e); }
  }
  try { const sel = figma.currentPage.selection; figma.currentPage.selection = []; figma.currentPage.selection = sel; } catch (e) {}
  figma.ui.postMessage({ type: "ACTIONS_DONE" });
  figma.notify("Copilot finished applying changes ✨");
}

async function executeAction(action: FCAction) {
  switch (action.type) {
    case "RENAME_LAYER": {
      const node = action.nodeId ? (figma.getNodeById(action.nodeId) || figma.currentPage.findOne(n => n.id === action.nodeId)) : null;
      if (node && action.name) node.name = action.name;
      break;
    }
    case "SET_CORNER_RADIUS": {
      const node = action.nodeId ? figma.getNodeById(action.nodeId) : null;
      if (node && "cornerRadius" in node) (node as RectangleNode).cornerRadius = action.value as number;
      break;
    }
    case "SET_OPACITY": {
      const node = action.nodeId ? figma.getNodeById(action.nodeId) : null;
      if (node && "opacity" in node) (node as FrameNode).opacity = action.value as number;
      break;
    }
    case "SET_PADDING": {
      const node = action.nodeId ? figma.getNodeById(action.nodeId) : null;
      if (node && "paddingTop" in node) {
        const frame = node as FrameNode;
        const val = action.value as number;
        frame.paddingTop = val; frame.paddingBottom = val;
        frame.paddingLeft = val; frame.paddingRight = val;
      }
      break;
    }
    case "DELETE_NODE": {
      let node = action.nodeId ? figma.getNodeById(action.nodeId) : null;
      if (!node && action.nodeId) {
        try { node = figma.currentPage.findOne(n => n.id === action.nodeId); } catch(e) {}
      }
      if (node && !node.removed) {
        try { node.remove(); } catch(e) { console.warn("Could not delete node", e); }
      }
      break;
    }
    case "SET_TEXT": {
      let node: BaseNode | null = action.nodeId ? (figma.getNodeById(action.nodeId) || figma.currentPage.findOne(n => n.id === action.nodeId)) : null;
      if (node && node.type !== "TEXT") node = findFirstTextChild(node);
      const textToSet = action.value !== undefined ? action.value : (action as any).text;
      if (node && node.type === "TEXT" && textToSet !== undefined) {
        try { await figma.loadFontAsync(node.fontName as FontName); }
        catch (e) { await figma.loadFontAsync({ family: "Inter", style: "Regular" }); node.fontName = { family: "Inter", style: "Regular" }; }
        node.characters = String(textToSet);
      }
      break;
    }
    case "REPLACE_TEXT_IN_SELECTION": {
      const from = (action as any).from || (action as any).fromText || (action as any).oldText;
      const to = (action as any).to || (action as any).toText || (action as any).newText || action.value;
      if (from !== undefined && to !== undefined) {
        await replaceTextInSelection(String(from), String(to));
      }
      break;
    }
    case "SET_SIZE": {
      const node = action.nodeId ? figma.getNodeById(action.nodeId) : null;
      if (node && "resize" in node) (node as FrameNode).resize(action.width as number, action.height as number);
      break;
    }
    case "SET_FILL_COLOR": {
      const node = action.nodeId ? (figma.getNodeById(action.nodeId) || figma.currentPage.findOne(n => n.id === action.nodeId)) : null;
      if (node && "fills" in node) {
        try {
          if (action.variableId) {
             const newBound = Object.assign({}, (node as any).boundVariables || {});
             const v = figma.variables.getVariableById(action.variableId as string);
             if (v) {
               newBound["fills"] = figma.variables.createVariableAlias(v);
               (node as any).boundVariables = newBound;
             }
          } else if (action.styleId) {
             if ((node as any).boundVariables && (node as any).boundVariables["fills"]) {
               const newBound = Object.assign({}, (node as any).boundVariables);
               delete newBound["fills"];
               (node as any).boundVariables = newBound;
             }
             (node as any).fillStyleId = action.styleId;
          } else {
            if ("fillStyleId" in node) (node as any).fillStyleId = "";
            if ((node as any).boundVariables && (node as any).boundVariables["fills"]) {
               const newBound = Object.assign({}, (node as any).boundVariables);
               delete newBound["fills"];
               (node as any).boundVariables = newBound;
            }
            (node as RectangleNode).fills = [{ type: "SOLID", color: { r: Number(action.r) || 0, g: Number(action.g) || 0, b: Number(action.b) || 0 }, opacity: Number(action.a) || 1 }];
          }
        } catch (err) {
          console.error("FC_SET_FILL_ERR", err);
          figma.notify("Could not change color of some layers. They might be locked or inside a component instance.");
        }
      }
      break;
    }
    case "DUPLICATE_NODE": {
      const node = action.nodeId ? figma.getNodeById(action.nodeId) : null;
      if (node && "clone" in node) {
        const clone = (node as any).clone() as SceneNode;
        if ("x" in clone && "x" in node) { clone.x = (node as FrameNode).x + (action.offsetX || 100); clone.y = (node as FrameNode).y + (action.offsetY || 0); }
        figma.currentPage.selection = [clone];
        figma.viewport.scrollAndZoomIntoView([clone]);
      }
      break;
    }

    case "CREATE_FRAME": {
      const frame = figma.createFrame();
      frame.name = action.name || "New Frame";
      frame.resize(action.width || 375, action.height || 812);
      frame.x = action.x || 0; frame.y = action.y || 0;
      figma.currentPage.appendChild(frame);
      figma.currentPage.selection = [frame];
      figma.viewport.scrollAndZoomIntoView([frame]);
      break;
    }
    case "SET_POSITION": {
      const node = action.nodeId ? figma.getNodeById(action.nodeId) : null;
      if (node && "x" in node) {
        if (action.x !== undefined) (node as FrameNode).x = action.x as number;
        if (action.y !== undefined) (node as FrameNode).y = action.y as number;
      }
      break;
    }
    case "MOVE_BY": {
      const node = action.nodeId ? figma.getNodeById(action.nodeId) : null;
      if (node && "x" in node) {
        (node as FrameNode).x += (action as any).dx || 0;
        (node as FrameNode).y += (action as any).dy || 0;
      }
      break;
    }
    case "REORDER":
    case "DETACH_AND_REORDER": {
      const node = figma.currentPage.selection[0];
      console.log("FC_REORDER", node ? node.name : "none", node ? node.type : "none");
      if (node && node.parent) {
        const parent = node.parent;
        const index = (parent as ChildrenMixin).children.indexOf(node as SceneNode);
        const direction = action.direction || (action.value as string);
        console.log("FC_REORDER_IDX", index, direction);
        const detached = node.type === "INSTANCE" ? (node as InstanceNode).detachInstance() : node as SceneNode;
        if (direction === "down") {
          if (index < (parent as ChildrenMixin).children.length - 1) {
            (parent as ChildrenMixin).insertChild(index + 2, detached);
          }
        } else {
          if (index > 0) {
            (parent as ChildrenMixin).insertChild(index - 1, detached);
          }
        }
        figma.currentPage.selection = [detached];
      }
      break;
    }
    case "NAVIGATE_TO": {
      const node = action.nodeId ? figma.getNodeById(action.nodeId) : null;
      if (node && "x" in node) {
        figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
        figma.currentPage.selection = [node as SceneNode];
      }
      break;
    }
    case "SUGGEST_COLORS": {
      if ((action as any).suggestions) {
        figma.ui.postMessage({ type: "COLOR_SUGGESTIONS", payload: (action as any).suggestions });
      }
      break;
    }
    case "SET_AUTO_LAYOUT": {
      // Apply auto-layout to a frame node
      const node = action.nodeId ? figma.getNodeById(action.nodeId) : null;
      if (node && "layoutMode" in node) {
        const f = node as FrameNode;
        const mode = ((action as any).layoutMode || 'VERTICAL') as 'HORIZONTAL' | 'VERTICAL';
        f.layoutMode = mode;
        if ((action as any).itemSpacing != null) f.itemSpacing = Number((action as any).itemSpacing);
        if ((action as any).paddingTop != null) f.paddingTop = Number((action as any).paddingTop);
        if ((action as any).paddingBottom != null) f.paddingBottom = Number((action as any).paddingBottom);
        if ((action as any).paddingLeft != null) f.paddingLeft = Number((action as any).paddingLeft);
        if ((action as any).paddingRight != null) f.paddingRight = Number((action as any).paddingRight);
        // Default to hug contents
        f.primaryAxisSizingMode = 'AUTO';
        f.counterAxisSizingMode = 'AUTO';
      }
      break;
    }
  }
}

sendInitialContext().catch(() => {
  // Last-resort catch — plugin still works without user info
  try { figma.ui.postMessage({ type: "INIT", payload: { userId: "anonymous", userName: "Designer", tokens: {} } }); } catch(_) {}
});
setTimeout(() => {
  try { figma.ui.postMessage({ type: "SELECTION_CHANGED", payload: getSelectionContext() }); } catch(e) {}
}, 300);

// --- Extreme Contrast Generator Functions ---

function extremeAdjustLuminance(color: RGB, nodeType: string): RGB {
  const { h, s, l } = rgbToHsl(color.r, color.g, color.b);

  let newL = l;
  let newS = s;

  if (nodeType === 'TEXT' || nodeType === 'VECTOR' || nodeType === 'BOOLEAN_OPERATION') {
    if (l < 0.5) {
      newL = 0.9 - (l * 0.3);
    } else {
      newL = Math.max(l, 0.8);
    }
  } else {
    if (l >= 0.95) {
      newL = 0.08;
      newS = 0;
    } else if (l >= 0.8 || (l >= 0.7 && s < 0.4)) {
      newL = 0.15 + (0.95 - l) * 0.5;
      newS = s * 0.5;
    } else if (l < 0.25) {
      newL = l + 0.05;
      newS = s * 0.8;
    } else {
      newL = l;
      newS = s * 0.9;
    }
  }

  return hslToRgb(h, newS, clamp(newL));
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 1; g /= 1; b /= 1;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): RGB {
  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l; 
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 3) return q;
      if (t < 1 / 2) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: clamp(r),
    g: clamp(g),
    b: clamp(b)
  };
}

function processPaints(paints: ReadonlyArray<Paint>, nodeType: string): Paint[] {
  return paints.map((paint) => {
    if (paint.type === "SOLID") {
      const newColor = extremeAdjustLuminance(paint.color, nodeType);
      return Object.assign({}, paint, { color: newColor });
    } else if (
      paint.type === "GRADIENT_LINEAR" ||
      paint.type === "GRADIENT_RADIAL" ||
      paint.type === "GRADIENT_ANGULAR" ||
      paint.type === "GRADIENT_DIAMOND"
    ) {
      const newStops = paint.gradientStops.map((stop) => {
        const newColor = extremeAdjustLuminance(stop.color, nodeType);
        return Object.assign({}, stop, { color: { r: newColor.r, g: newColor.g, b: newColor.b, a: stop.color.a } });
      });
      return Object.assign({}, paint, { gradientStops: newStops });
    }
    return paint;
  });
}

function processLayers(node: SceneNode) {
  if ("fills" in node && node.fills) {
    if (node.fills === figma.mixed) {
      if (node.type === "TEXT") {
        node.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } }];
      }
    } else if (Array.isArray(node.fills)) {
      node.fills = processPaints(node.fills, node.type);
    }
  }

  if ("strokes" in node && node.strokes) {
    if (Array.isArray(node.strokes)) {
      node.strokes = processPaints(node.strokes, node.type);
    }
  }

  if ("effects" in node && node.effects && Array.isArray(node.effects)) {
    const effects = node.effects.map((effect) => {
      if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
        const newColor = extremeAdjustLuminance(effect.color, node.type);
        return Object.assign({}, effect, { color: { r: newColor.r, g: newColor.g, b: newColor.b, a: effect.color.a } });
      }
      return effect;
    });
    node.effects = effects;
  }

  if ("children" in node && node.children) {
    node.children.forEach((child) => processLayers(child));
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
