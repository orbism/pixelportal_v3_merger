import { decode } from "fast-png";

interface Settings {
  image: string;
  name: string;
  description: string;
  externalUrlPrefix: string;
  ipfsDomain?: string;
  ipfsImageDirCid?: string;
  imageUrlPrefix?: string;
  indexOffset: number;
  output: string;
  metadataTemplate: string;
  imageExtension?: string; // defaults to "png"
  trait: {
    image: string;
    traits: Record<string, string>; // hex -> trait name
  };
}

const settingsPath = Deno.args[0];
if (!settingsPath) {
  console.error("Usage: deno task metadata <settings.json>");
  Deno.exit(1);
}

const settings: Settings = JSON.parse(await Deno.readTextFile(settingsPath));

const template = await Deno.readTextFile(settings.metadataTemplate);
const imageExtension = settings.imageExtension ?? "png";

let imageUrlPrefix: string;
if (settings.imageUrlPrefix) {
  imageUrlPrefix = settings.imageUrlPrefix;
} else if (settings.ipfsDomain && settings.ipfsImageDirCid) {
  imageUrlPrefix = `https://${settings.ipfsDomain}/ipfs/${settings.ipfsImageDirCid}`;
} else {
  console.error("Settings must include either \"imageUrlPrefix\" or both \"ipfsDomain\" and \"ipfsImageDirCid\".");
  Deno.exit(1);
}

console.log(`Image URL prefix: ${imageUrlPrefix}`);

const nftImage = decode(await Deno.readFile(settings.image));
const { width, height, channels } = nftImage;
console.log(`NFT image: ${width}x${height}, ${channels} channels`);

const traitImage = decode(await Deno.readFile(settings.trait.image));
if (traitImage.width !== width || traitImage.height !== height) {
  console.error(`Trait image dimensions (${traitImage.width}x${traitImage.height}) don't match NFT image (${width}x${height})`);
  Deno.exit(1);
}

function getPixelHex(data: Uint8Array | Uint8ClampedArray | Uint16Array, ch: number, x: number, y: number): string {
  const idx = (y * width + x) * ch;
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  return r.toString(16).padStart(2, "0") + g.toString(16).padStart(2, "0") + b.toString(16).padStart(2, "0");
}

function getTraitName(x: number, y: number): string {
  const hex = getPixelHex(traitImage.data, traitImage.channels, x, y);
  return settings.trait.traits[hex] ?? "None";
}

function getShard(pixelIndex: number): string {
  return (1 + Math.floor(pixelIndex / 5000)).toString();
}

const metadataDir = `${settings.output}/metadata`;
const totalPixels = width * height;
const totalShards = 1 + Math.floor((totalPixels - 1) / 5000);

console.log(`Generating ${totalPixels} metadata files across ${totalShards} shards...`);

for (let s = 1; s <= totalShards; s++) {
  await Deno.mkdir(`${metadataDir}/metadata-sh${s}`, { recursive: true });
}

let count = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const pixelIndex = y * width + x;
    const index = pixelIndex + settings.indexOffset;
    const hex = getPixelHex(nftImage.data, channels, x, y);
    const traitName = getTraitName(x, y);
    const shard = getShard(pixelIndex);

    const populated = template
      .replaceAll("{name}", settings.name)
      .replaceAll("{description}", settings.description)
      .replaceAll("{external_url_prefix}", settings.externalUrlPrefix)
      .replaceAll("{image_url_prefix}", imageUrlPrefix)
      .replaceAll("{index}", index.toString())
      .replaceAll("{x}", x.toString())
      .replaceAll("{y}", y.toString())
      .replaceAll("{hex}", hex)
      .replaceAll("{shard}", shard)
      .replaceAll("{pixel_index}", pixelIndex.toString())
      .replaceAll("{image_object}", traitName)
      .replaceAll("{image_extension}", imageExtension);
    const metadata = JSON.stringify(JSON.parse(populated));

    await Deno.writeTextFile(`${metadataDir}/metadata-sh${shard}/metadata-${index}.json`, metadata);

    count++;
    if (count % 50000 === 0) {
      console.log(`  ${count}/${totalPixels} (${((count / totalPixels) * 100).toFixed(1)}%)`);
    }
  }
}

console.log(`Done. Generated ${count} metadata files in ${metadataDir}`);
