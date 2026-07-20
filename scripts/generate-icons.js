import sharp from 'sharp';
import { readFileSync } from 'fs';

const svg = readFileSync('static/icon.svg');

async function generateIcons() {
  await sharp(svg).resize(192, 192).png().toFile('static/icon-192.png');
  await sharp(svg).resize(512, 512).png().toFile('static/icon-512.png');
  console.log('Generated icon-192.png and icon-512.png');
}

generateIcons().catch(console.error);
