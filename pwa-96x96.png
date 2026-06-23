import sharp from 'sharp';
import fs from 'fs';

// Maskable safe zone: content fits within central 80% (51.2px margin on 512px canvas)
// We make full bleed = green gradient (no dark blue frame), and place network graphic centered.
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8BE38F"/>
      <stop offset="50%" stop-color="#5BC9A1"/>
      <stop offset="100%" stop-color="#3FAE94"/>
    </linearGradient>
    <radialGradient id="node" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#D4F5E3"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
      <feOffset dx="0" dy="3" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.25"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Full-bleed green background (no frame) -->
  <rect width="512" height="512" fill="url(#bg)"/>

  <!-- Network graphic centered, sized to safe zone (~360px wide) -->
  <g transform="translate(76, 76)" filter="url(#shadow)">
    <!-- Connecting lines -->
    <g stroke="#1F4D8B" stroke-width="14" stroke-linecap="round" fill="none">
      <line x1="180" y1="180" x2="180" y2="55"/>
      <line x1="180" y1="180" x2="295" y2="115"/>
      <line x1="180" y1="180" x2="65"  y2="165"/>
      <line x1="180" y1="180" x2="115" y2="295"/>
      <line x1="180" y1="180" x2="265" y2="295"/>
    </g>
    <!-- Center node -->
    <circle cx="180" cy="180" r="42" fill="url(#node)" stroke="#1F4D8B" stroke-width="14"/>
    <!-- Outer nodes -->
    <circle cx="180" cy="55"  r="34" fill="url(#node)" stroke="#1F4D8B" stroke-width="12"/>
    <circle cx="295" cy="115" r="34" fill="url(#node)" stroke="#1F4D8B" stroke-width="12"/>
    <circle cx="65"  cy="165" r="34" fill="url(#node)" stroke="#1F4D8B" stroke-width="12"/>
    <circle cx="115" cy="295" r="34" fill="url(#node)" stroke="#1F4D8B" stroke-width="12"/>
    <circle cx="265" cy="295" r="34" fill="url(#node)" stroke="#1F4D8B" stroke-width="12"/>
  </g>
</svg>`;

const outDir = 'artifacts/construction-supervision/public';
await sharp(Buffer.from(svg)).png().toFile(`${outDir}/pwa-maskable-512x512.png`);
// Also regenerate the regular 512 and 192 to match (no blue frame)
await sharp(Buffer.from(svg)).png().toFile(`${outDir}/pwa-512x512.png`);
await sharp(Buffer.from(svg)).resize(192, 192).png().toFile(`${outDir}/pwa-192x192.png`);
await sharp(Buffer.from(svg)).resize(180, 180).png().toFile(`${outDir}/apple-touch-icon.png`);
await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(`${outDir}/app-icon.png`);
console.log('done');
