import sharp from 'sharp';

// Using the Building2 icon motif with the primary teal color (hsl(193, 83%, 36%))
const primaryColor = '#0F7694';

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${primaryColor}"/>
  
  <g transform="translate(128, 128) scale(10.6)" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/>
    <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>
    <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>
    <path d="M10 6h4"/>
    <path d="M10 10h4"/>
    <path d="M10 14h4"/>
    <path d="M10 18h4"/>
  </g>
</svg>`;

const outDir = './public';
await sharp(Buffer.from(svg)).png().toFile(`${outDir}/pwa-maskable-512x512.png`);
await sharp(Buffer.from(svg)).png().toFile(`${outDir}/pwa-512x512.png`);
await sharp(Buffer.from(svg)).resize(192, 192).png().toFile(`${outDir}/pwa-192x192.png`);
await sharp(Buffer.from(svg)).resize(180, 180).png().toFile(`${outDir}/apple-touch-icon.png`);
await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(`${outDir}/app-icon.png`);
console.log('Icons regenerated successfully');
