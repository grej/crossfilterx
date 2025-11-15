# CrossfilterX Live Demo

This directory contains the GitHub Pages / Netlify demo site for CrossfilterX.

## ⚠️ Important: SharedArrayBuffer Requirements

CrossfilterX requires `SharedArrayBuffer`, which needs these HTTP headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Deployment Options

#### Option 1: Netlify (Recommended)

Deploy to Netlify for automatic header support via `_headers` file.

The `_headers` file in this directory will automatically configure the required headers.

#### Option 2: Local Development

Run locally with proper headers:

```bash
# From repository root
npm run dev
```

#### Option 3: GitHub Pages (Limited)

**Note:** GitHub Pages does **not** support custom headers, so SharedArrayBuffer won't work.
The demo page will display an error message explaining this limitation.

## Features

The demo showcases:

- **Multiple dataset sizes** (1K to 500K rows)
- **Real-time filtering** with interactive sliders
- **Performance metrics** (filter time, row counts)
- **4 coordinated charts** showing different dimensions
- **Responsive design** for mobile and desktop

## Browser Support

Requires browsers with SharedArrayBuffer support:
- Chrome 92+
- Firefox 79+
- Safari 15.2+
- Edge 92+
