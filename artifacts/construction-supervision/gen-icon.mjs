import sharp from 'sharp';

const mark = `<g fill="none" stroke="#D4A35A" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">
  <path d="M54 119V61h72v58H54Z"/>
  <path d="M54 89h72M90 61v58"/>
  <path d="m70 103 13 13 30-36" stroke="#fff"/>
</g>`;
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 180 180"><rect width="180" height="180" rx="36" fill="#17354B"/>${mark}</svg>`;
const lockupSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="330" viewBox="0 0 300 110"><rect width="300" height="110" rx="16" fill="#17354B"/><g fill="none" stroke="#D4A35A" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"><path d="M36 76V32h40v44H36Z"/><path d="M36 53h40M56 32v44"/><path d="m45 64 9 9 16-23" stroke="#fff"/></g><text x="100" y="70" fill="#fff" font-size="48" font-weight="700" font-family="Arial,sans-serif" letter-spacing="3">RIKAZ</text></svg>`;

const publicDir = './public';
for (const size of [72, 96, 128, 144, 152, 192, 384, 512]) {
  await sharp(Buffer.from(iconSvg)).resize(size, size).png().toFile(`${publicDir}/pwa-${size}x${size}.png`);
}
await sharp(Buffer.from(iconSvg)).resize(512, 512).png().toFile(`${publicDir}/pwa-maskable-512x512.png`);
await sharp(Buffer.from(iconSvg)).resize(180, 180).png().toFile(`${publicDir}/apple-touch-icon.png`);
await sharp(Buffer.from(iconSvg)).resize(512, 512).png().toFile(`${publicDir}/app-icon.png`);
await sharp(Buffer.from(iconSvg)).resize(512, 512).png().toFile('../attendance-mobile/assets/images/icon.png');
await sharp(Buffer.from(lockupSvg)).png().toFile('../attendance-mobile/assets/images/rikaz-lockup.png');
console.log('RIKAZ PWA and mobile icons regenerated');
