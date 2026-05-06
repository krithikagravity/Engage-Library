// State
let state = {
  userId: 'anonymous',
  userName: 'Designer',
  tokens: {},
  selection: null,
  fullContext: null,
  history: [],
  usage: 0,
  loading: false,
  limit: 100,
  _auditTimer: null,
  _activeTab: 'chat',
};

// Replace this with your actual Vercel backend URL after deploying
const BACKEND_URL = 'https://backend-kappa-flax-89.vercel.app/api/chat';

// Receive messages from Figma sandbox
window.onmessage = (event) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;

  switch (msg.type) {
    case 'INIT':
      state.userId = msg.payload.userId;
      state.userName = msg.payload.userName;
      state.tokens = msg.payload.tokens;
      updateUsagePill();
      break;

    case 'SELECTION_CHANGED':
      state.selection = msg.payload;
      updateSelectionBar();
      break;

    case 'ACTIONS_DONE':
      state.loading = false;
      updateSendBtn();
      break;

    case 'FULL_CONTEXT':
      state.fullContext = msg.payload;
      break;

    case 'COLOR_SUGGESTIONS':
      showColorSuggestions(msg.payload);
      state.loading = false;
      updateSendBtn();
      break;

    case 'AUDIT_DATA':
      showAuditPanel(msg.payload);
      break;

    case 'PAGE_SCAN':
      renderQuickEdit(msg.payload);
      break;

    case 'COMPONENT_AUDIT_DATA':
      renderComponentAudit(msg.payload);
      break;

    case 'PPTX_DATA':
      generatePPTX(msg.payload);
      break;
  }
};

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  state._activeTab = tab;
  document.getElementById('view-chat').style.display = tab === 'chat' ? 'flex' : 'none';
  document.getElementById('view-edit').style.display = tab === 'edit' ? 'flex' : 'none';
  document.getElementById('view-comp').style.display = tab === 'comp' ? 'flex' : 'none';
  document.getElementById('view-pptx').style.display = tab === 'pptx' ? 'flex' : 'none';
  document.getElementById('tab-chat').className = 'tab' + (tab === 'chat' ? ' active' : '');
  document.getElementById('tab-edit').className = 'tab' + (tab === 'edit' ? ' active' : '');
  document.getElementById('tab-comp').className = 'tab' + (tab === 'comp' ? ' active' : '');
  document.getElementById('tab-pptx').className = 'tab' + (tab === 'pptx' ? ' active' : '');
  if (tab === 'edit' && document.querySelector('.qe-empty')) scanPage();
}

function updateSelectionBar() {
  const bar = document.getElementById('selection-bar');
  const msBar = document.getElementById('multiscreen-bar');
  const msLabel = document.getElementById('multiscreen-label');
  if (!state.selection) {
    bar.innerHTML = '<span class="no-selection">No layer selected</span>';
    msBar.classList.remove('active');
    return;
  }
  if (state.selection.multiSelect) {
    const count = state.selection.count;
    const names = state.selection.nodes.slice(0, 3).map(n => n.name);
    const extra = count > 3 ? ` +${count - 3} more` : '';
    bar.innerHTML = `
      <span class="selection-tag">${count} screens selected</span>
      <span class="selection-type" style="font-size:9px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${names.join(', ')}${extra}</span>
    `;
    msLabel.textContent = `${count} screens — changes apply to all`;
    msBar.classList.add('active');
    return;
  }
  msBar.classList.remove('active');
  bar.innerHTML = `
    <span class="selection-tag">${state.selection.name}</span>
    <span class="selection-type">${state.selection.type}</span>
    ${state.selection.width ? `<span class="selection-type">${state.selection.width}×${state.selection.height}</span>` : ''}
  `;
}

function updateUsagePill() {
  const pill = document.getElementById('usage-pill');
  const remaining = state.limit - state.usage;
  pill.textContent = `${state.usage} / ${state.limit}`;
  pill.className = 'usage-pill';
  if (state.usage >= state.limit) pill.classList.add('full');
  else if (remaining <= 5) pill.classList.add('warn');
}

function updateSendBtn() {
  const btn = document.getElementById('send-btn');
  const input = document.getElementById('input');
  btn.disabled = state.loading || state.usage >= state.limit;
  input.disabled = state.loading || state.usage >= state.limit;
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 80) + 'px';
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function sendSuggestion(el) {
  state.history = [];
  document.getElementById('input').value = el.textContent;
  sendMessage();
}


function appendMessage(role, text, actions) {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();

  const msgs = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;

  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = role === 'user' ? 'You' : 'Copilot';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;

  div.appendChild(label);
  div.appendChild(bubble);

  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function showTyping() {
  const msgs = document.getElementById('messages');
  const div = document.createElement('div');
  div.id = 'typing-indicator';
  div.className = 'msg ai';
  div.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  const t = document.getElementById('typing-indicator');
  if (t) t.remove();
}

async function sendMessage() {
  // Request full context (with text node scan) right before sending
  parent.postMessage({ pluginMessage: { type: 'GET_FULL_CONTEXT' } }, '*');
  await new Promise(function(resolve) {
    var handler = function(event) {
      if (event.data.pluginMessage && event.data.pluginMessage.type === 'FULL_CONTEXT') {
        state.fullContext = event.data.pluginMessage.payload;
        window.removeEventListener('message', handler);
        resolve(null);
      }
    };
    window.addEventListener('message', handler);
    setTimeout(resolve, 2000);
  });
  return _sendMessage();
}

async function _sendMessage() {
  const input = document.getElementById('input');
  const text = input.value.trim();
  if (!text || state.loading || state.usage >= state.limit) return;

  if (state.usage >= state.limit) {
    document.getElementById('limit-banner').style.display = 'block';
    return;
  }

  input.value = '';
  input.style.height = 'auto';
  appendMessage('user', text);

  state.loading = true;
  updateSendBtn();
  showTyping();

  state.history.push({ role: 'user', content: text });

  try {
    let sel = state.fullContext || state.selection;
    const msgLower = text.toLowerCase();
    const isAudit = msgLower.includes('audit') || msgLower.includes('fix spacing') || msgLower.includes('explain') || msgLower.includes('rename this frame');
    if (sel) {
      if (sel.multiSelect) {
        sel = {
          multiSelect: true,
          count: sel.count,
          nodes: (sel.nodes || []).map(function(n) { return {
            id: n.id, name: n.name, type: n.type,
            width: n.width, height: n.height,
            allTextNodes: (n.allTextNodes || []).slice(0, 50)
          }; })
        };
      } else {
        sel = {
          id: sel.id,
          name: sel.name,
          type: sel.type,
          color: sel.color,
          width: sel.width,
          height: sel.height,
          cornerRadius: sel.cornerRadius,
          paddingTop: sel.paddingTop,
          paddingLeft: sel.paddingLeft,
          allTextNodes: (sel.allTextNodes || []).slice(0, 50),
          children: (sel.children || []).slice(0, 30).map(c => ({
            id: c.id, name: c.name, type: c.type,
            color: c.color,
            width: c.width, height: c.height,
            x: c.x, y: c.y,
            paddingTop: c.paddingTop, paddingLeft: c.paddingLeft,
            cornerRadius: c.cornerRadius,
            children: (c.children || []).slice(0, 5).map(gc => ({
              id: gc.id, name: gc.name, type: gc.type,
              color: gc.color,
              characters: gc.characters
            }))
          }))
        };
      }
    }

    const res = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: state.userId,
        message: text,
        sessionHistory: state.history,
        selectionContext: sel,
        designTokens: state.tokens,
      }),
    });

    const data = await res.json();
    removeTyping();

    if (res.status === 429) {
      state.usage = state.limit;
      updateUsagePill();
      updateSendBtn();
      document.getElementById('limit-banner').style.display = 'block';
      appendMessage('ai', data.message || "You've reached your daily limit. Come back tomorrow!");
      return;
    }

    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    let { response, actions } = data;
    actions = actions || [];

    // Scrub raw JSON from response text
    if (response.includes('"newColor"') || response.includes('"nodeId"')) {
      response = "I've analyzed the current palette and suggested some aesthetic improvements to make your design look more premium and harmonious.";
    }
    if (!response || response.length < 8) {
      response = "I've analyzed your design and suggested some improvements below.";
    }

    state.usage++;
    updateUsagePill();
    state.history.push({ role: 'assistant', content: response });
    appendMessage('ai', response);

    // Send all actions to main.js (main.js handles SUGGEST_COLORS by posting COLOR_SUGGESTIONS back to window.onmessage)
    if (actions && actions.length > 0) {
      parent.postMessage({ pluginMessage: { type: 'EXECUTE_ACTIONS', actions: actions } }, '*');
    } else {
      state.loading = false;
      updateSendBtn();
    }

  } catch (err) {
    console.error('FETCH_ERROR:', err);
    removeTyping();
    appendMessage('ai', 'Error: ' + (err.message || 'Something went wrong') + '. Please try deploying your backend changes with "vercel --prod".');
    state.loading = false;
    updateSendBtn();
  }
}

// Request initial selection on load
parent.postMessage({ pluginMessage: { type: 'GET_SELECTION' } }, '*');
// Also request again after a short delay to ensure plugin is ready
setTimeout(function() {
  parent.postMessage({ pluginMessage: { type: 'GET_SELECTION' } }, '*');
}, 800);


// Re-fetch selection every time user clicks the input box
document.getElementById('input').addEventListener('focus', () => {
  parent.postMessage({ pluginMessage: { type: 'GET_SELECTION' } }, '*');
});

function toHex(r, g, b) {
  function c(x) { var h = Math.round(x * 255).toString(16); return h.length === 1 ? '0' + h : h; }
  return '#' + c(r) + c(g) + c(b);
}

function colorDistance(c1, c2) {
  return Math.pow(c1.r - c2.r, 2) + Math.pow(c1.g - c2.g, 2) + Math.pow(c1.b - c2.b, 2);
}

function findClosestToken(r, g, b, isText) {
  var closest = null;
  var minDiff = 2.0; // Large threshold to always snap to *something* if tokens exist
  if (state.tokens) {
    var checkList = function(list) {
      if (!list) return;
      list.forEach(function(t) {
        if (t.color) {
          var penalty = 0;
          var nameLower = t.name.toLowerCase();
          if (isText && (nameLower.indexOf('surface') > -1 || nameLower.indexOf('bg') > -1 || nameLower.indexOf('background') > -1 || nameLower.indexOf('border') > -1)) penalty += 0.3;
          if (!isText && (nameLower.indexOf('text') > -1 || nameLower.indexOf('icon') > -1 || nameLower.indexOf('typography') > -1)) penalty += 0.3;
          var dist = colorDistance({r:r,g:g,b:b}, t.color) + penalty;
          if (dist < minDiff) {
            minDiff = dist;
            closest = t;
          }
        }
      });
    };
    checkList(state.tokens.variables);
    checkList(state.tokens.colors);
  }
  return closest;
}

function showColorSuggestions(suggestions) {
  if (!suggestions || suggestions.length === 0) return;
  var container = document.createElement('div');
  container.style.cssText = 'background:#1e1e1e;border:1px solid #333;border-radius:8px;padding:12px;margin:8px 0;';

  var title = document.createElement('div');
  title.style.cssText = 'font-size:11px;color:#aaa;margin-bottom:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;';
  title.textContent = 'Color Suggestions';
  container.appendChild(title);

  suggestions.forEach(function(s) {
    try {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';

      var oldR = (s.oldColor && s.oldColor.r != null) ? s.oldColor.r : 0.5;
      var oldG = (s.oldColor && s.oldColor.g != null) ? s.oldColor.g : 0.5;
      var oldB = (s.oldColor && s.oldColor.b != null) ? s.oldColor.b : 0.5;

      var newR = (s.newColor && s.newColor.r != null) ? s.newColor.r : 0.5;
      var newG = (s.newColor && s.newColor.g != null) ? s.newColor.g : 0.5;
      var newB = (s.newColor && s.newColor.b != null) ? s.newColor.b : 0.5;

      var isText = (s.nodeName || '').toLowerCase().indexOf('text') > -1;
      var matchedToken = findClosestToken(newR, newG, newB, isText);
      if (matchedToken) {
         newR = matchedToken.color.r;
         newG = matchedToken.color.g;
         newB = matchedToken.color.b;
         s.matchedToken = matchedToken;
      }

      var oldSwatch = document.createElement('div');
      oldSwatch.style.cssText = 'width:24px;height:24px;border-radius:4px;border:1px solid #444;flex-shrink:0;';
      oldSwatch.style.background = toHex(oldR, oldG, oldB);

      var arrow = document.createElement('div');
      arrow.style.cssText = 'color:#666;font-size:12px;';
      arrow.textContent = '→';

      var newSwatch = document.createElement('div');
      newSwatch.style.cssText = 'width:24px;height:24px;border-radius:4px;border:1px solid #444;flex-shrink:0;';
      newSwatch.style.background = toHex(newR, newG, newB);

      var label = document.createElement('div');
      label.style.cssText = 'font-size:11px;color:#ccc;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      var labelText = s.nodeName || 'Layer';
      if (matchedToken) labelText += ' (' + matchedToken.name + ')';
      label.textContent = labelText;

      var applyRowBtn = document.createElement('button');
      applyRowBtn.textContent = 'Apply';
      applyRowBtn.style.cssText = 'padding:4px 8px;border-radius:4px;border:none;background:#2d3748;color:#fff;font-size:10px;cursor:pointer;';
      applyRowBtn.onclick = function() {
        var act = { type: 'SET_FILL_COLOR', nodeId: s.nodeId, r: newR, g: newG, b: newB, a: 1 };
        if (s.matchedToken) {
           if (s.matchedToken.type === 'COLOR') act.variableId = s.matchedToken.id;
           else act.styleId = s.matchedToken.id;
        }
        parent.postMessage({ pluginMessage: { type: 'EXECUTE_ACTIONS', actions: [act] } }, '*');
        applyRowBtn.textContent = 'Applied';
        applyRowBtn.style.background = '#48bb78';
      };

      row.appendChild(oldSwatch);
      row.appendChild(arrow);
      row.appendChild(newSwatch);
      row.appendChild(label);
      row.appendChild(applyRowBtn);
      container.appendChild(row);
    } catch(e) { console.error('Row error:', e, s); }
  });

  var btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px;margin-top:10px;';

  var applyBtn = document.createElement('button');
  applyBtn.textContent = 'Apply all';
  applyBtn.style.cssText = 'flex:1;padding:6px;border-radius:6px;border:none;background:#5c6bc0;color:#fff;font-size:12px;cursor:pointer;';
  applyBtn.onclick = function() {
    var acts = suggestions.map(function(s) {
      var act = { type: 'SET_FILL_COLOR', nodeId: s.nodeId,
        r: (s.matchedToken ? s.matchedToken.color.r : ((s.newColor && s.newColor.r != null) ? s.newColor.r : 0.5)),
        g: (s.matchedToken ? s.matchedToken.color.g : ((s.newColor && s.newColor.g != null) ? s.newColor.g : 0.5)),
        b: (s.matchedToken ? s.matchedToken.color.b : ((s.newColor && s.newColor.b != null) ? s.newColor.b : 0.5)),
        a: 1 };
      if (s.matchedToken) {
         if (s.matchedToken.type === 'COLOR') act.variableId = s.matchedToken.id;
         else act.styleId = s.matchedToken.id;
      }
      return act;
    });
    parent.postMessage({ pluginMessage: { type: 'EXECUTE_ACTIONS', actions: acts } }, '*');
    container.remove();
  };

  var dismissBtn = document.createElement('button');
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.style.cssText = 'flex:1;padding:6px;border-radius:6px;border:1px solid #444;background:transparent;color:#aaa;font-size:12px;cursor:pointer;';
  dismissBtn.onclick = function() { container.remove(); };

  btns.appendChild(applyBtn);
  btns.appendChild(dismissBtn);
  container.appendChild(btns);

  var messages = document.getElementById('messages');
  messages.appendChild(container);
  messages.scrollTop = messages.scrollHeight;
}

// ── Audit ─────────────────────────────────────────────────────────────────────

function triggerAudit() {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();
  const msgs = document.getElementById('messages');

  // Show loading panel
  const loading = document.createElement('div');
  loading.id = 'audit-loading-panel';
  loading.className = 'audit-panel';
  loading.innerHTML = '<div class="audit-loading">🔍 Scanning all screens for issues…</div>';
  msgs.appendChild(loading);
  msgs.scrollTop = msgs.scrollHeight;

  // Request deep audit data from main.ts
  parent.postMessage({ pluginMessage: { type: 'AUDIT_SELECTION' } }, '*');

  // Fallback: if no AUDIT_DATA arrives in 3s, use existing selection context
  state._auditTimer = setTimeout(function() {
    const existing = document.getElementById('audit-loading-panel');
    if (existing) {
      existing.remove();
      runAuditFromContext(state.fullContext || state.selection);
    }
  }, 3000);
}

function showAuditPanel(screens) {
  clearTimeout(state._auditTimer);
  const loading = document.getElementById('audit-loading-panel');
  if (loading) loading.remove();

  if (!screens || screens.length === 0) {
    runAuditFromContext(state.fullContext || state.selection);
    return;
  }

  const issues = collectAuditIssues(screens);
  renderAuditPanel(issues, screens.length);
}

function runAuditFromContext(ctx) {
  if (!ctx) {
    appendMessage('ai', 'Please select one or more frames to audit.');
    return;
  }
  const screens = ctx.multiSelect ? (ctx.nodes || []) : [ctx];
  const issues = collectAuditIssues(screens);
  renderAuditPanel(issues, screens.length);
}

function exportPPTX() {
  const status = document.getElementById('pptx-status');
  if (status) status.innerHTML = '<div class="audit-loading">📥 Extracting frames...</div>';
  parent.postMessage({ pluginMessage: { type: 'EXPORT_PPTX' } }, '*');
}

function convertColorToHex(c) {
  if (!c) return 'CCCCCC';
  const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
  return r + g + b;
}

function generatePPTX(frames) {
  const status = document.getElementById('pptx-status');
  if (frames.error) {
    if (status) status.innerHTML = '<div class="audit-loading" style="color:#f87171;">❌ ' + frames.error + '</div>';
    return;
  }
  if (!frames || frames.length === 0) {
    if (status) status.innerHTML = '<div class="audit-loading" style="color:#f87171;">❌ No frames to export.</div>';
    return;
  }
  
  if (status) status.innerHTML = '<div class="audit-loading">📥 Generating PPTX...</div>';

  try {
    let pres = new pptxgen();
    
    // Scale factor to convert Figma pixels to PPTX inches (approx 96 DPI)
    const scale = 1 / 96;

    frames.forEach(frame => {
      let slide = pres.addSlide();
      
      if (frame.color) {
        slide.background = { color: convertColorToHex(frame.color) };
      }
      
      const frameX = frame.x || 0;
      const frameY = frame.y || 0;
      
      function walkShapes(n) {
        // Compute relative positions
        let rx = (n.x || 0);
        let ry = (n.y || 0);
        let rw = (n.width || 100);
        let rh = (n.height || 100);

        if (n.type === "TEXT") {
          let opts = {
            x: rx * scale, y: ry * scale, w: rw * scale, h: rh * scale,
            fontSize: n.fontSize || 12,
            color: convertColorToHex(n.color),
            valign: n.textAlignVertical === "CENTER" ? "middle" : (n.textAlignVertical === "BOTTOM" ? "bottom" : "top"),
            align: n.textAlignHorizontal === "CENTER" ? "center" : (n.textAlignHorizontal === "RIGHT" ? "right" : "left"),
            margin: 0
          };
          slide.addText(n.characters || "", opts);
        } else if (n.type === "RECTANGLE" || n.type === "FRAME" || n.type === "GROUP") {
          // If it has a color, draw it as a shape, unless it's the root frame
          if (n.id !== frame.id && n.color) {
             let opts = {
               x: rx * scale, y: ry * scale, w: rw * scale, h: rh * scale,
               fill: { color: convertColorToHex(n.color) }
             };
             slide.addShape(pres.ShapeType.rect, opts);
          }
        }
        
        if (n.children) {
          n.children.forEach(c => walkShapes(c));
        }
      }
      
      if (frame.children) {
        frame.children.forEach(c => walkShapes(c));
      }
    });

    pres.write({ outputType: "blob" }).then((blob) => {
      const url = URL.createObjectURL(blob);
      if (status) {
        status.innerHTML = `
          <div style="margin-top:10px;">
            <a href="${url}" download="Figma_Export.pptx" class="comp-scan-btn" style="background:#4ade80; border-color:#4ade80; color:#111; text-decoration:none; display:inline-block; text-align:center; font-weight:600;">
              💾 Click to Save PPTX
            </a>
          </div>
        `;
      }
    }).catch((err) => {
      if (status) status.innerHTML = '<div class="audit-loading" style="color:#f87171;">❌ PPTX Write Error: ' + err.message + '</div>';
    });
  } catch (err) {
    if (status) status.innerHTML = '<div class="audit-loading" style="color:#f87171;">❌ PPTX Generation Error: ' + err.message + '</div>';
  }
}



function collectAuditIssues(screens) {
  var issues = { spacing: [], padding: [], alignment: [], radius: [], opacity: [], naming: [] };

  screens.forEach(function(screen) {
    var sn = screen.name || 'Unnamed';
    var children = screen.children || [];

    // Padding inconsistency within screen
    var padValues = children
      .filter(function(c) { return c.paddingTop != null; })
      .map(function(c) { return c.paddingTop + '/' + c.paddingBottom + '/' + c.paddingLeft + '/' + c.paddingRight; });
    var uniquePads = [...new Set(padValues)];
    if (uniquePads.length > 1) {
      issues.padding.push({ level: 'warn', screen: sn, msg: 'Inconsistent padding across ' + padValues.length + ' children (' + uniquePads.slice(0, 2).join(' vs ') + ')' });
    }

    // itemSpacing inconsistency
    var spacingVals = children
      .filter(function(c) { return c.itemSpacing != null; })
      .map(function(c) { return c.itemSpacing; });
    var uniqueSpacing = [...new Set(spacingVals)];
    if (uniqueSpacing.length > 1) {
      issues.spacing.push({ level: 'warn', screen: sn, msg: 'Mixed item spacing: ' + uniqueSpacing.join('px, ') + 'px' });
    }

    // Width mismatches among siblings with same type
    var byType = {};
    children.forEach(function(c) {
      if (!byType[c.type]) byType[c.type] = [];
      byType[c.type].push(c);
    });
    Object.keys(byType).forEach(function(t) {
      var group = byType[t];
      if (group.length < 2) return;
      var widths = [...new Set(group.map(function(c) { return c.width; }).filter(Boolean))];
      if (widths.length > 1) {
        issues.alignment.push({ level: 'warn', screen: sn, msg: t + ' siblings have different widths: ' + widths.join('px, ') + 'px' });
      }
    });

    // Corner radius
    var radii = children
      .filter(function(c) { return c.cornerRadius != null && c.cornerRadius > 0; })
      .map(function(c) { return c.cornerRadius; });
    var uniqueRadii = [...new Set(radii)];
    if (uniqueRadii.length > 2) {
      issues.radius.push({ level: 'warn', screen: sn, msg: 'Multiple corner radii: ' + uniqueRadii.join('px, ') + 'px' });
    }

    // Low opacity nodes
    children.forEach(function(c) {
      if (c.opacity != null && c.opacity < 1) {
        issues.opacity.push({ level: 'warn', screen: sn, msg: (c.name || c.type) + ' has opacity ' + Math.round(c.opacity * 100) + '%' });
      }
    });

    // Generic layer names
    children.forEach(function(c) {
      var name = (c.name || '').toLowerCase();
      if (/^(frame|group|rectangle|ellipse|vector|component) \d+$/i.test(c.name || '')) {
        issues.naming.push({ level: 'error', screen: sn, msg: '"' + c.name + '" has a generic auto-generated name' });
      }
    });
  });

  // Cross-screen consistency (multi-screen only)
  if (screens.length > 1) {
    var screenPaddings = screens.map(function(s) { return s.paddingTop; }).filter(function(v) { return v != null; });
    var uniqueScreenPads = [...new Set(screenPaddings)];
    if (uniqueScreenPads.length > 1) {
      issues.padding.push({ level: 'error', screen: 'Cross-screen', msg: 'Frame-level padding differs across screens: ' + uniqueScreenPads.join('px, ') + 'px' });
    }
  }

  return issues;
}

function renderAuditPanel(issues, screenCount) {
  var msgs = document.getElementById('messages');
  var panel = document.createElement('div');
  panel.className = 'audit-panel';

  var hdr = document.createElement('div');
  hdr.className = 'audit-panel-header';
  var total = Object.values(issues).reduce(function(s, arr) { return s + arr.length; }, 0);
  hdr.innerHTML = '<span class="audit-icon">🔍</span>' +
    '<span class="audit-panel-title">Audit — ' + screenCount + ' screen' + (screenCount > 1 ? 's' : '') + ', ' + total + ' issue' + (total !== 1 ? 's' : '') + '</span>' +
    '<button class="audit-close" onclick="this.closest(\".audit-panel\").remove()">×</button>';
  panel.appendChild(hdr);

  var sections = [
    { key: 'padding',   icon: '⬜', label: 'Padding' },
    { key: 'spacing',   icon: '↕', label: 'Spacing' },
    { key: 'alignment', icon: '⇿', label: 'Alignment' },
    { key: 'radius',    icon: '⬡', label: 'Corner Radius' },
    { key: 'opacity',   icon: '◑', label: 'Opacity' },
    { key: 'naming',    icon: '🏷', label: 'Layer Naming' },
  ];

  sections.forEach(function(sec) {
    var items = issues[sec.key];
    if (!items || items.length === 0) return;
    var section = document.createElement('div');
    section.className = 'audit-section';
    var title = document.createElement('div');
    title.className = 'audit-section-title';
    title.textContent = sec.icon + '  ' + sec.label;
    section.appendChild(title);
    items.forEach(function(item) {
      var row = document.createElement('div');
      row.className = 'audit-item ' + (item.level || 'warn');
      row.innerHTML = '<span class="audit-item-text">' + item.msg + '</span>' +
        '<span class="audit-item-badge">' + item.screen + '</span>';
      section.appendChild(row);
    });
    panel.appendChild(section);
  });

  if (total === 0) {
    var ok = document.createElement('div');
    ok.className = 'audit-item ok';
    ok.innerHTML = '<span class="audit-item-text">No issues found. Looks great! ✨</span>';
    panel.appendChild(ok);
  }

  msgs.appendChild(panel);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Quick Edit (Browse & Edit) ────────────────────────────────────────────────

function scanPage() {
  var panel = document.getElementById('qe-panel');
  panel.innerHTML = '<div class="qe-empty" style="padding:20px 0;">🔍 Scanning file\u2026</div>';
  parent.postMessage({ pluginMessage: { type: 'SCAN_PAGE' } }, '*');
}

function renderQuickEdit(frames) {
  var panel = document.getElementById('qe-panel');
  if (!frames || frames.length === 0) {
    panel.innerHTML = '<div class="qe-empty">No frames found. Open a Figma file with frames and try again.</div>';
    return;
  }
  panel.innerHTML = '';
  frames.forEach(function(frame) {
    var hasText = frame.textNodes && frame.textNodes.length > 0;
    var hasColor = frame.colorNodes && frame.colorNodes.length > 0;
    if (!hasText && !hasColor) return;

    var card = document.createElement('div');
    card.className = 'qe-frame';
    var totalItems = (frame.textNodes || []).length + (frame.colorNodes || []).length;

    var header = document.createElement('div');
    header.className = 'qe-frame-header';
    header.innerHTML =
      '<span class="qe-frame-name">' + escHtml(frame.name) + '</span>' +
      '<span class="qe-frame-count">' + totalItems + ' items</span>' +
      '<span class="qe-chevron">\u25b6</span>';
    header.onclick = function() { card.classList.toggle('open'); };
    card.appendChild(header);

    var items = document.createElement('div');
    items.className = 'qe-items';

    // Text nodes
    if (hasText) {
      var tLabel = document.createElement('div');
      tLabel.className = 'qe-section-label';
      tLabel.textContent = 'Text';
      items.appendChild(tLabel);
      frame.textNodes.forEach(function(tn) {
        var row = document.createElement('div');
        row.className = 'qe-item';
        var lbl = document.createElement('div');
        lbl.className = 'qe-item-label';
        lbl.title = tn.name;
        lbl.textContent = tn.name;
        var inp = document.createElement('input');
        inp.className = 'qe-item-input';
        inp.type = 'text';
        inp.value = tn.characters;
        inp.placeholder = 'Enter new text\u2026';
        var btn = document.createElement('button');
        btn.className = 'qe-apply-btn';
        btn.textContent = 'Save';
        btn.onclick = (function(nodeId, inputEl, btnEl) {
          return function() {
            var newText = inputEl.value;
            parent.postMessage({ pluginMessage: { type: 'EXECUTE_ACTIONS', actions: [{ type: 'SET_TEXT', nodeId: nodeId, value: newText }] } }, '*');
            btnEl.textContent = 'Saved \u2713';
            btnEl.className = 'qe-apply-btn done';
            setTimeout(function() { btnEl.textContent = 'Save'; btnEl.className = 'qe-apply-btn'; }, 2000);
          };
        })(tn.id, inp, btn);
        row.appendChild(lbl);
        row.appendChild(inp);
        row.appendChild(btn);
        items.appendChild(row);
      });
    }

    // Color nodes
    if (hasColor) {
      var cLabel = document.createElement('div');
      cLabel.className = 'qe-section-label';
      cLabel.textContent = 'Colors';
      items.appendChild(cLabel);
      frame.colorNodes.forEach(function(cn) {
        var row = document.createElement('div');
        row.className = 'qe-item';
        var lbl = document.createElement('div');
        lbl.className = 'qe-item-label';
        lbl.title = cn.name;
        lbl.textContent = cn.name;
        // Color picker input
        var picker = document.createElement('input');
        picker.type = 'color';
        picker.style.cssText = 'width:28px;height:28px;border:none;border-radius:4px;cursor:pointer;padding:0;background:none;';
        // Convert 0-1 r/g/b to hex
        function toH(v) { var s = Math.round(v * 255).toString(16); return s.length < 2 ? '0' + s : s; }
        picker.value = '#' + toH(cn.r) + toH(cn.g) + toH(cn.b);
        var hexLbl = document.createElement('span');
        hexLbl.style.cssText = 'font-size:10px;font-family:"DM Mono",monospace;color:var(--text3);flex:1;';
        hexLbl.textContent = picker.value;
        picker.oninput = function() { hexLbl.textContent = picker.value; };
        var btn = document.createElement('button');
        btn.className = 'qe-apply-btn';
        btn.textContent = 'Apply';
        btn.onclick = (function(nodeId, pickerEl, btnEl) {
          return function() {
            var hex = pickerEl.value.replace('#','');
            var r = parseInt(hex.substr(0,2),16)/255;
            var g = parseInt(hex.substr(2,2),16)/255;
            var b = parseInt(hex.substr(4,2),16)/255;
            parent.postMessage({ pluginMessage: { type: 'EXECUTE_ACTIONS', actions: [{ type: 'SET_FILL_COLOR', nodeId: nodeId, r: r, g: g, b: b, a: 1 }] } }, '*');
            btnEl.textContent = 'Done \u2713';
            btnEl.className = 'qe-apply-btn done';
            setTimeout(function() { btnEl.textContent = 'Apply'; btnEl.className = 'qe-apply-btn'; }, 2000);
          };
        })(cn.id, picker, btn);
        row.appendChild(lbl);
        row.appendChild(picker);
        row.appendChild(hexLbl);
        row.appendChild(btn);
        items.appendChild(row);
      });
    }

    card.appendChild(items);
    panel.appendChild(card);
    // Auto-open first frame
    if (panel.children.length === 1) card.classList.add('open');
  });

  // Rescan button at bottom
  var rescan = document.createElement('button');
  rescan.className = 'qe-scan-btn';
  rescan.textContent = '\u21ba Rescan';
  rescan.onclick = scanPage;
  panel.appendChild(rescan);
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Componentize Tab ──────────────────────────────────────────────────────────

function runComponentAudit() {
  var panel = document.getElementById('comp-panel');
  panel.innerHTML = '<div class="comp-empty" style="padding:20px 0;">🔍 Scanning frame structure\u2026</div>';
  parent.postMessage({ pluginMessage: { type: 'COMPONENT_AUDIT' } }, '*');
}

function renderComponentAudit(results) {
  var panel = document.getElementById('comp-panel');
  panel.innerHTML = '';

  // Handle error payload
  if (!Array.isArray(results)) {
    var err = (results && results.error) ? results.error : 'No selection. Select a frame first.';
    panel.innerHTML = '<div class="comp-empty">' + escHtml(err) +
      '<button class="comp-scan-btn" onclick="runComponentAudit()">🔍 Try again</button></div>';
    return;
  }

  var totalIssues = 0;
  results.forEach(function(frameResult) {
    var issues = frameResult.issues || [];
    totalIssues += issues.length;

    // Frame header
    var frameHdr = document.createElement('div');
    frameHdr.style.cssText = 'font-size:10px;font-family:"DM Mono",monospace;color:var(--text3);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px;';
    frameHdr.textContent = '📐 ' + frameResult.name + (frameResult.width ? ' (' + frameResult.width + '×' + frameResult.height + ')' : '');
    panel.appendChild(frameHdr);

    if (issues.length === 0) {
      var ok = document.createElement('div');
      ok.className = 'comp-issue';
      ok.style.borderLeft = '3px solid #4ade80';
      ok.innerHTML = '<div class="comp-issue-title">✅ Looks good!</div><div class="comp-issue-msg">No missing auto-layout or component opportunities found.</div>';
      panel.appendChild(ok);
      return;
    }

    issues.forEach(function(issue) {
      var card = document.createElement('div');
      card.className = 'comp-issue ' + (issue.severity || 'warn');

      var typeLabels = {
        'MISSING_AUTO_LAYOUT': 'Missing Auto-Layout',
        'RAW_GROUP': 'Raw Group',
        'REPEATED_ELEMENTS': 'Component Candidate',
      };
      var typeLabel = typeLabels[issue.type] || issue.type;

      card.innerHTML =
        '<div class="comp-issue-title">' + escHtml(typeLabel) + '</div>' +
        '<div class="comp-issue-msg">' + escHtml(issue.message) + '</div>' +
        '<div class="comp-issue-row"></div>';

      var row = card.querySelector('.comp-issue-row');

      // Badge
      var badge = document.createElement('span');
      badge.className = 'comp-badge ' + (issue.severity || 'warn');
      badge.textContent = escHtml(issue.nodeName);
      row.appendChild(badge);

      // Suggestion hint
      if (issue.suggestion) {
        var hint = document.createElement('span');
        hint.style.cssText = 'font-size:9px;color:var(--text3);flex:1;';
        hint.textContent = issue.suggestion;
        row.appendChild(hint);
      }

      // Apply fix button (only for auto-fixable issues)
      if (issue.fixAction) {
        var fixBtn = document.createElement('button');
        fixBtn.className = 'comp-fix-btn';
        fixBtn.textContent = 'Apply';
        fixBtn.onclick = (function(action, btn) {
          return function() {
            parent.postMessage({ pluginMessage: { type: 'EXECUTE_ACTIONS', actions: [action] } }, '*');
            btn.textContent = 'Done ✓';
            btn.className = 'comp-fix-btn done';
          };
        })(issue.fixAction, fixBtn);
        row.appendChild(fixBtn);
      }

      // Navigate to node button
      if (issue.nodeId) {
        var navBtn = document.createElement('button');
        navBtn.className = 'comp-nav-btn';
        navBtn.textContent = '→ Select';
        navBtn.onclick = (function(nodeId) {
          return function() {
            parent.postMessage({ pluginMessage: { type: 'EXECUTE_ACTIONS', actions: [{ type: 'NAVIGATE_TO', nodeId: nodeId }] } }, '*');
          };
        })(issue.nodeId);
        row.appendChild(navBtn);
      }

      panel.appendChild(card);
    });
  });

  // Summary + rescan
  var summary = document.createElement('div');
  summary.style.cssText = 'font-size:10px;color:var(--text3);text-align:center;padding:8px 0 4px;';
  summary.textContent = totalIssues + ' issue' + (totalIssues !== 1 ? 's' : '') + ' found across ' + results.length + ' frame' + (results.length !== 1 ? 's' : '');
  panel.appendChild(summary);

  var rescan = document.createElement('button');
  rescan.className = 'comp-scan-btn';
  rescan.textContent = '↺ Rescan';
  rescan.onclick = runComponentAudit;
  panel.appendChild(rescan);
}

