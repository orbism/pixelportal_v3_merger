import { decode, encode } from "fast-png";

interface Settings {
  image: string;
  indexOffset: number;
  output: string;
  imageExtension?: string; // defaults to "png"
}

const settingsPath = Deno.args[0];
if (!settingsPath) {
  console.error("Usage: deno task images <settings.json>");
  Deno.exit(1);
}

const settings: Settings = JSON.parse(await Deno.readTextFile(settingsPath));
const imageExtension = settings.imageExtension ?? "png";

const nftImage = decode(await Deno.readFile(settings.image));
const { width, height, channels } = nftImage;
console.log(`NFT image: ${width}x${height}, ${channels} channels`);

const imageDir = `${settings.output}/image`;
const totalPixels = width * height;
const totalShards = 1 + Math.floor((totalPixels - 1) / 5000);

function getShard(pixelIndex: number): string {
  return (1 + Math.floor(pixelIndex / 5000)).toString();
}

console.log(`Generating ${totalPixels} pixel images across ${totalShards} shards...`);

for (let s = 1; s <= totalShards; s++) {
  await Deno.mkdir(`${imageDir}/pixels_sh${s}`, { recursive: true });
}

let count = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const pixelIndex = y * width + x;
    const index = pixelIndex + settings.indexOffset;
    const shard = getShard(pixelIndex);

    const srcIdx = pixelIndex * channels;
    const imgSize = 350;
    const imgData = new Uint8Array(imgSize * imgSize * channels);
    for (let i = 0; i < imgSize * imgSize; i++) {
      for (let c = 0; c < channels; c++) {
        imgData[i * channels + c] = nftImage.data[srcIdx + c];
      }
    }
    const pixelPng = encode({ width: imgSize, height: imgSize, data: imgData, channels });
    await Deno.writeFile(`${imageDir}/pixels_sh${shard}/${index}.${imageExtension}`, pixelPng);

    count++;
    if (count % 50000 === 0) {
      console.log(`  ${count}/${totalPixels} (${((count / totalPixels) * 100).toFixed(1)}%)`);
    }
  }
}

console.log(`Done. Generated ${count} pixel images in ${imageDir}`);
console.log("Next: upload the image directory to IPFS, then add the CID as \"ipfsImageDirCid\" in your settings and run generate-metadata.");
