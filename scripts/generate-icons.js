const sharp = require('sharp');
const sizes = [192, 512];
for (const size of sizes) {
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="#0A0A0A"/>
    <text x="50%" y="45%" font-family="Arial" font-weight="800"
      font-size="${size * 0.25}px" fill="white" text-anchor="middle"
      dominant-baseline="middle">&#x2715;</text>
    <text x="50%" y="68%" font-family="Arial" font-weight="800"
      font-size="${size * 0.18}px" fill="white" text-anchor="middle"
      dominant-baseline="middle">CFAC</text>
  </svg>`;
  sharp(Buffer.from(svg)).png().toFile(`public/icons/icon-${size}.png`)
    .then(() => console.log(`Generated icon-${size}.png`))
    .catch(err => console.error(`Failed icon-${size}:`, err));
}
