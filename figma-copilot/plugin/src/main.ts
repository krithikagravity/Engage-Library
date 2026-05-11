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
  } else if (msg.type === "FIX_SPACING") {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({ type: 'FIX_SPACING_DONE', payload: { message: '⚠️ Nothing selected. Please select a frame or component first.' } });
      return;
    }

    // Snap a value to the nearest multiple of 4 (standard 8pt grid, half-grid = 4)
    function snap4(v: number): number { return Math.round(v / 4) * 4; }

    const changes: string[] = [];
    let totalFixed = 0;

    function fixNode(node: SceneNode) {
      // ── FRAME / AUTO-LAYOUT PADDING & SPACING ─────────────────────────────
      if ('layoutMode' in node) {
        const f = node as FrameNode;

        if (f.layoutMode !== 'NONE') {
          // Frame has auto-layout — fix padding and gap
          const newPL = snap4(f.paddingLeft);
          const newPR = snap4(f.paddingRight);
          const newPT = snap4(f.paddingTop);
          const newPB = snap4(f.paddingBottom);
          const newIS = snap4(f.itemSpacing);

          const padChanged =
            newPL !== f.paddingLeft || newPR !== f.paddingRight ||
            newPT !== f.paddingTop  || newPB !== f.paddingBottom;
          const gapChanged = newIS !== f.itemSpacing;

          if (padChanged || gapChanged) {
            if (padChanged) {
              f.paddingLeft   = newPL;
              f.paddingRight  = newPR;
              f.paddingTop    = newPT;
              f.paddingBottom = newPB;
            }
            if (gapChanged) f.itemSpacing = newIS;
            totalFixed++;
            changes.push(
              `"${f.name}": padding → ${newPT}/${newPR}/${newPB}/${newPL}px, gap → ${newIS}px`
            );
          }
        } else {
          // Frame has NO auto layout — padding props are invisible without it.
          // For pure text frames: enable auto-layout + set padding so it's actually visible.
          const textChildren = [...f.children].filter(c => c.type === 'TEXT');
          if (textChildren.length >= 1 && f.children.length === textChildren.length) {
            try {
              const w = f.width;
              const h = f.height;
              // Enable auto layout centered so text stays in place
              f.layoutMode = 'HORIZONTAL';
              f.primaryAxisAlignItems = 'CENTER';
              f.counterAxisAlignItems = 'CENTER';
              f.primaryAxisSizingMode = 'FIXED';
              f.counterAxisSizingMode = 'FIXED';
              // Set 8px padding on all sides (good default for label frames)
              const pad = 8;
              f.paddingLeft   = pad;
              f.paddingRight  = pad;
              f.paddingTop    = pad;
              f.paddingBottom = pad;
              f.itemSpacing   = 0;
              f.resize(w, h);
              totalFixed++;
              changes.push(`"${f.name}": enabled auto layout + 8px padding (text is now centered)`);
            } catch (e: any) {
              changes.push(`"${f.name}": could not fix — ${e.message}`);
            }
          }
        }
      }

      // ── TEXT NODES: line height ───────────────────────────────────────────
      if (node.type === 'TEXT') {
        const t = node as TextNode;
        const fontSize = t.fontSize;
        if (typeof fontSize === 'number') {
          const targetLH = Math.round(
            fontSize <= 13 ? fontSize * 1.6 :
            fontSize <= 20 ? fontSize * 1.5 :
            fontSize <= 32 ? fontSize * 1.35 :
                             fontSize * 1.2
          );
          const lh = t.lineHeight as LineHeight;
          const lhPx = lh.unit === 'PIXELS' ? lh.value
                     : lh.unit === 'PERCENT' ? (lh.value / 100) * fontSize
                     : 0;
          if (lh.unit === 'AUTO' || Math.abs(lhPx - targetLH) > 3) {
            try {
              t.lineHeight = { unit: 'PIXELS', value: targetLH };
              totalFixed++;
              changes.push(`"${t.name}": line height → ${targetLH}px (was ${lh.unit === 'AUTO' ? 'auto' : Math.round(lhPx) + 'px'})`);
            } catch (_) {}
          }
        }
      }

      // ── RECURSE ────────────────────────────────────────────────────────────
      if ('children' in node) {
        for (const child of (node as ChildrenMixin).children) {
          fixNode(child as SceneNode);
        }
      }
    }

    for (const node of selection) {
      fixNode(node);
    }

    const message = totalFixed === 0
      ? `ℹ️ Scanned ${selection.length} element(s). Spacing values are already consistent (padding + gaps on 4px grid, line heights normalized).`
      : `✅ Fixed ${totalFixed} spacing issue${totalFixed > 1 ? 's' : ''}:\n\n${changes.slice(0, 8).join('\n')}${changes.length > 8 ? `\n…and ${changes.length - 8} more` : ''}`;

    figma.notify(totalFixed > 0 ? '✅ Spacing fixed!' : 'ℹ️ Spacing looks good');
    figma.ui.postMessage({ type: 'FIX_SPACING_DONE', payload: { message } });
  } else if (msg.type === "APPLY_AUTOLAYOUT") {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.notify('⚠️ Select elements first', { error: true });

    } else if (selection.length === 1 && 'layoutMode' in selection[0]) {
      // Single frame — apply auto layout exactly like Figma Shift+A
      applyAutoLayoutNative(selection[0] as FrameNode);
      figma.notify('✅ Auto layout applied!');

    } else {
      // Multiple items (or non-frame single) — wrap in a new auto-layout frame
      try {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of selection) {
          const b = (node as any).absoluteBoundingBox;
          if (b) {
            minX = Math.min(minX, b.x);     minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
          }
        }
        if (minX === Infinity) {
          figma.notify('⚠️ Could not read bounds', { error: true });
          return;
        }

        const parent = selection[0].parent || figma.currentPage;
        const parentAbsBox = (parent !== figma.currentPage && 'absoluteBoundingBox' in parent)
          ? (parent as any).absoluteBoundingBox : { x: 0, y: 0 };

        const frame = figma.createFrame();
        frame.resize(maxX - minX, maxY - minY);
        frame.name = 'Auto Layout Frame';
        frame.fills = [];
        frame.clipsContent = false;
        parent.appendChild(frame);
        frame.x = minX - parentAbsBox.x;
        frame.y = minY - parentAbsBox.y;

        for (const node of selection) {
          frame.appendChild(node); // Figma preserves absolute position automatically
        }

        // Now read actual child positions inside the wrapper and apply native auto layout
        applyAutoLayoutNative(frame);
        figma.currentPage.selection = [frame];
        figma.notify('✅ Auto layout applied!');
      } catch (e: any) {
        console.error('AutoLayout Error:', e);
        figma.notify(`⚠️ Failed: ${e.message}`, { error: true });
      }
    }  } else if (msg.type === "EXPORT_PPTX") {
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

function isIcon(node: any) {
  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') return true;
  if (node.width <= ICON_THRESHOLD && node.height <= ICON_THRESHOLD) return true;
  if ('children' in node && node.children.length > 0) {
    const allVector = node.children.every((c: any) =>
      ['VECTOR','BOOLEAN_OPERATION','ELLIPSE','RECTANGLE','LINE','STAR','POLYGON'].includes(c.type)
    );
    if (allVector) return true;
  }
  return false;
}

/**
 * Replicates Figma's native Shift+A behavior on a FrameNode.
 * Reads current child positions and sets layoutMode / spacing / padding / alignment
 * so items remain exactly where they are after auto layout is enabled.
 */
function applyAutoLayoutNative(frame: FrameNode) {
  const children = [...frame.children].filter((c: any) => 'x' in c) as SceneNode[];
  if (children.length === 0) return;

  const items = children.map((c: any) => ({
    node: c, x: c.x as number, y: c.y as number,
    w: c.width as number, h: c.height as number
  }));

  if (items.length === 1) {
    const it = items[0];
    try {
      frame.layoutMode = 'HORIZONTAL';
      frame.paddingLeft   = Math.max(0, Math.round(it.x));
      frame.paddingTop    = Math.max(0, Math.round(it.y));
      frame.paddingRight  = Math.max(0, Math.round(frame.width  - it.x - it.w));
      frame.paddingBottom = Math.max(0, Math.round(frame.height - it.y - it.h));
      frame.itemSpacing = 0;
      frame.primaryAxisSizingMode = 'FIXED';
      frame.counterAxisSizingMode = 'FIXED';
    } catch (e: any) { console.warn('AutoLayout single child failed:', e.message); }
    return;
  }

  // ── Direction ─────────────────────────────────────────────────────────────
  // Use the START positions (top-left corners) of items to determine primary axis.
  // Figma: if x-positions vary more than y-positions → HORIZONTAL.
  const xs = items.map(i => i.x), ys = items.map(i => i.y);
  const xSpread = Math.max(...xs) - Math.min(...xs);
  const ySpread = Math.max(...ys) - Math.min(...ys);
  const direction: 'HORIZONTAL' | 'VERTICAL' = xSpread >= ySpread ? 'HORIZONTAL' : 'VERTICAL';

  // ── Sort by primary axis ──────────────────────────────────────────────────
  const sorted = [...items].sort((a, b) =>
    direction === 'HORIZONTAL' ? a.x - b.x : a.y - b.y
  );

  // ── Gaps between adjacent items ───────────────────────────────────────────
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], curr = sorted[i];
    const gap = direction === 'HORIZONTAL'
      ? curr.x - (prev.x + prev.w)
      : curr.y - (prev.y + prev.h);
    if (gap >= -1) gaps.push(Math.max(0, gap)); // allow -1 rounding tolerance
  }

  // ── Spacing mode ──────────────────────────────────────────────────────────
  // Figma: if all gaps are equal → fixed itemSpacing
  //        if gaps vary by > 2px → SPACE_BETWEEN
  let primaryAxisAlignItems = 'MIN';
  let itemSpacing = 0;
  if (gaps.length > 0) {
    const minG = Math.min(...gaps), maxG = Math.max(...gaps);
    const avgG = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    if (maxG - minG > 2) {
      primaryAxisAlignItems = 'SPACE_BETWEEN';
      itemSpacing = 0;
    } else {
      itemSpacing = avgG;
    }
  }

  // ── Padding (distance from frame edges to the item group) ─────────────────
  const paddingLeft   = Math.max(0, Math.round(Math.min(...items.map(i => i.x))));
  const paddingTop    = Math.max(0, Math.round(Math.min(...items.map(i => i.y))));
  const paddingRight  = Math.max(0, Math.round(frame.width  - Math.max(...items.map(i => i.x + i.w))));
  const paddingBottom = Math.max(0, Math.round(frame.height - Math.max(...items.map(i => i.y + i.h))));

  // ── Counter-axis alignment ─────────────────────────────────────────────────
  // Figma checks whether items are top/center/bottom aligned on the cross axis.
  let counterAxisAlignItems = 'MIN';
  if (direction === 'HORIZONTAL') {
    const centers  = items.map(i => i.y + i.h / 2);
    const bottoms  = items.map(i => i.y + i.h);
    const varCtr   = Math.max(...centers) - Math.min(...centers);
    const varTop   = Math.max(...ys) - Math.min(...ys);
    const varBot   = Math.max(...bottoms) - Math.min(...bottoms);
    if      (varCtr <= 2)                          counterAxisAlignItems = 'CENTER';
    else if (varBot <= 2 && varBot < varTop)       counterAxisAlignItems = 'MAX';
  } else {
    const centers  = items.map(i => i.x + i.w / 2);
    const rights   = items.map(i => i.x + i.w);
    const varCtr   = Math.max(...centers) - Math.min(...centers);
    const varLeft  = Math.max(...xs) - Math.min(...xs);
    const varRight = Math.max(...rights) - Math.min(...rights);
    if      (varCtr <= 2)                          counterAxisAlignItems = 'CENTER';
    else if (varRight <= 2 && varRight < varLeft)  counterAxisAlignItems = 'MAX';
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  try {
    const w = frame.width, h = frame.height;
    frame.layoutMode              = direction;
    frame.itemSpacing             = itemSpacing;
    frame.primaryAxisAlignItems   = primaryAxisAlignItems as any;
    frame.counterAxisAlignItems   = counterAxisAlignItems as any;
    frame.paddingLeft             = paddingLeft;
    frame.paddingTop              = paddingTop;
    frame.paddingRight            = paddingRight;
    frame.paddingBottom           = paddingBottom;
    frame.primaryAxisSizingMode   = 'FIXED';
    frame.counterAxisSizingMode   = 'FIXED';
    frame.resize(w, h); // lock dimensions — items stay put
    console.log(`AutoLayout: ${direction} spacing=${itemSpacing} pad=${paddingLeft},${paddingTop},${paddingRight},${paddingBottom} ctr=${counterAxisAlignItems} primary=${primaryAxisAlignItems}`);
  } catch (e: any) {
    console.warn('applyAutoLayoutNative failed:', e.message);
    try { frame.layoutMode = 'NONE'; } catch (_) {}
  }
}

// Compatibility alias
function applyAutoLayout(node: any) {
  if ('layoutMode' in node) applyAutoLayoutNative(node as FrameNode);
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
