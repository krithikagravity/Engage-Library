# Figma Copilot

A persistent AI sidebar for Figma. Select a layer, ask anything, watch it happen.

---

## What it does

- Lives inside Figma as a persistent sidebar panel
- Knows what layer you have selected at all times
- Reads your design system (colors, text styles, variables)
- Executes actions directly on the canvas (rename, fix radius, set padding, etc.)
- 20 free messages per user per day, no login required

---

## Project structure

```
figma-copilot/
├── plugin/              ← Figma plugin code
│   ├── src/
│   │   ├── main.ts      ← Figma sandbox (talks to Figma API)
│   │   └── ui.html      ← Sidebar UI (talks to Claude backend)
│   ├── manifest.json
│   └── package.json
│
└── backend/             ← Vercel serverless backend
    ├── api/
    │   └── chat.js      ← API route (Claude + Redis usage cap)
    └── package.json
```

---

## Setup — Backend (Vercel)

### Step 1 — Get your services ready

**Anthropic API key:**
1. Go to https://console.anthropic.com
2. Sign up (free $5 credits included)
3. API Keys → Create Key → copy it

**Upstash Redis (for usage counting):**
1. Go to https://upstash.com → sign up (free tier)
2. Create Database → select your region
3. Copy the REST URL and REST Token from the dashboard

### Step 2 — Deploy to Vercel

```bash
# Clone or download this project
cd figma-copilot/backend

# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Follow the prompts, then add environment variables:
vercel env add ANTHROPIC_API_KEY
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN

# Redeploy with env vars
vercel --prod
```

Your backend URL will be something like: `https://figma-copilot-xyz.vercel.app`

---

## Setup — Plugin

### Step 1 — Update the backend URL

Open `plugin/src/ui.html` and find this line:

```javascript
const BACKEND_URL = 'https://your-app.vercel.app/api/chat';
```

Replace with your actual Vercel URL:

```javascript
const BACKEND_URL = 'https://figma-copilot-xyz.vercel.app/api/chat';
```

### Step 2 — Build the plugin

```bash
cd figma-copilot/plugin
npm install
npm run build
```

This creates `dist/main.js` and `dist/ui.html`.

### Step 3 — Load in Figma

1. Open Figma desktop app
2. Menu → Plugins → Development → Import plugin from manifest
3. Select `figma-copilot/plugin/manifest.json`
4. The plugin now appears under Plugins → Development → Figma Copilot

### Step 4 — Run it

1. Open any Figma file
2. Plugins → Development → Figma Copilot
3. Select a layer
4. Start asking questions

---

## What you can ask

| Ask | What happens |
|---|---|
| "Rename this layer" | Renames using Figma naming convention |
| "Audit this frame" | Lists design system violations |
| "Fix the corner radius" | Sets to match your design system |
| "What is this component?" | Explains the layer structure |
| "Fix the spacing" | Corrects padding to nearest grid unit |
| "Set opacity to 50%" | Executes directly on canvas |

---

## Customizing the daily cap

In `backend/api/chat.js`, change this line:

```javascript
const DAILY_CAP = 20;
```

---

## Adding more actions

In `plugin/src/main.ts`, add a new case to `executeAction()`:

```typescript
case 'SET_FILL_COLOR': {
  const node = figma.getNodeById(action.nodeId);
  if (node && 'fills' in node) {
    node.fills = [{ type: 'SOLID', color: action.value }];
  }
  break;
}
```

Then add the action description to the `SYSTEM_PROMPT` in `backend/api/chat.js` so Claude knows it can use it.

---

## Cost estimate

At 20 messages/day per user with Claude Sonnet:
- 1 user/day → ~$0.01/day
- 100 users/day → ~$1/day
- 1000 users/day → ~$10/day

Your $5 free Anthropic credits covers roughly 500 messages of testing.
