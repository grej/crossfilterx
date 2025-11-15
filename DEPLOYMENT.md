# Deployment Guide

The CrossfilterX demo requires specific CORS headers to enable SharedArrayBuffer support.

## ✅ Recommended: Netlify

Netlify is pre-configured and ready to deploy:

```bash
# Push your changes
git push

# Netlify will automatically deploy from your repo
```

**Configuration:** Already set up in `netlify.toml`

**URL:** https://crossfilterx.netlify.app

---

## Alternative: Cloudflare Pages

If you prefer Cloudflare Pages:

1. **Create a Cloudflare Pages project**
   - Connect your GitHub repo
   - Set build directory to `docs`
   - No build command needed

2. **Add Custom Headers**

   Create `docs/_headers`:
   ```
   /*
     Cross-Origin-Opener-Policy: same-origin
     Cross-Origin-Embedder-Policy: require-corp
   ```

3. **Deploy**
   - Cloudflare Pages will automatically deploy on push

---

## Alternative: GitHub Pages

⚠️ **Note:** GitHub Pages doesn't support custom headers, so SharedArrayBuffer won't work.

**Use case:** Good for documentation, not for the live demo.

To enable GitHub Pages:
1. Go to repo Settings → Pages
2. Source: Deploy from branch
3. Branch: `main`, folder: `/docs`
4. Save

The site will be at: `https://yourusername.github.io/crossfilterx`

**Limitation:** The demo will show an error about missing SharedArrayBuffer support.

---

## Current Status

- ✅ `netlify.toml` configured with CORS headers
- ✅ `docs/_headers` for Netlify fallback
- ✅ Demo page with SharedArrayBuffer detection
- ✅ Landing page at `/`
- ✅ Working demo at `/demo.html`

## To Deploy

### Netlify (Easiest)
1. Sign up at netlify.com
2. "New site from Git" → Choose your repo
3. Netlify auto-detects settings from `netlify.toml`
4. Click Deploy

### Cloudflare Pages
1. Sign up at pages.cloudflare.com  
2. Create new project → Choose your repo
3. Build settings:
   - Build command: (leave empty)
   - Build output: `docs`
4. Deploy

Both will automatically redeploy on every git push!
