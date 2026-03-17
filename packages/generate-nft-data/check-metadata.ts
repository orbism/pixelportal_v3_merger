import { decode } from "fast-png";

const settingsPath = Deno.args[0];
if (!settingsPath) {
  console.error("Usage: deno task check <settings.json>");
  Deno.exit(1);
}

const settings = JSON.parse(await Deno.readTextFile(settingsPath));
const metadataDir = `${settings.output}/metadata`;

// Load trait image for hex lookup on failures
const traitImage = decode(await Deno.readFile(settings.trait.image));
const { width, channels } = traitImage;

function getTraitHex(x: number, y: number): string {
  const idx = (y * width + x) * channels;
  const r = traitImage.data[idx];
  const g = traitImage.data[idx + 1];
  const b = traitImage.data[idx + 2];
  return r.toString(16).padStart(2, "0") + g.toString(16).padStart(2, "0") + b.toString(16).padStart(2, "0");
}

function getNeighborHex(x: number, y: number): string {
  const imgWidth: number = traitImage.width;
  const imgHeight: number = traitImage.height;
  const parts: string[] = [];
  const dirs: Array<[string, number, number]> = [
    ["L", x - 1, y],
    ["R", x + 1, y],
    ["U", x, y - 1],
    ["D", x, y + 1],
  ];
  for (const [label, nx, ny] of dirs) {
    if (nx >= 0 && nx < imgWidth && ny >= 0 && ny < imgHeight) {
      parts.push(`${label}:#${getTraitHex(nx, ny)}`);
    } else {
      parts.push(`${label}:edge`);
    }
  }
  return parts.join(" ");
}

interface Failure {
  tokenId: string;
  pixelIndex: string;
  x: string;
  y: string;
  traitHex: string;
  neighbors: string;
}

let checked = 0;
const failures: Failure[] = [];

for await (const shardEntry of Deno.readDir(metadataDir)) {
  if (!shardEntry.isDirectory || !shardEntry.name.startsWith("metadata-sh")) continue;

  const shardPath = `${metadataDir}/${shardEntry.name}`;
  for await (const fileEntry of Deno.readDir(shardPath)) {
    if (!fileEntry.name.endsWith(".json")) continue;

    const filePath = `${shardPath}/${fileEntry.name}`;
    const data = JSON.parse(await Deno.readTextFile(filePath));
    const attr = (type: string) =>
      data.attributes?.find((a: { trait_type: string }) => a.trait_type === type)?.value ?? "?";

    if (attr("Object") === "None") {
      const x = attr("X Coordinate");
      const y = attr("Y Coordinate");
      const nx = Number(x);
      const ny = Number(y);
      failures.push({
        tokenId: fileEntry.name.replace("metadata-", "").replace(".json", ""),
        pixelIndex: attr("Index"),
        x,
        y,
        traitHex: x !== "?" && y !== "?" ? getTraitHex(nx, ny) : "?",
        neighbors: x !== "?" && y !== "?" ? getNeighborHex(nx, ny) : "?",
      });
    }

    checked++;
    if (checked % 50000 === 0) {
      console.log(`Checked ${checked} files...`);
    }
  }
}

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} metadata files have Object trait "None":`);
  for (const f of failures) {
    console.error(`  token ${f.tokenId} | pixel ${f.pixelIndex} | (${f.x}, ${f.y}) | trait hex #${f.traitHex} | neighbors: ${f.neighbors}`);
  }
  Deno.exit(1);
} else {
  console.log(`OK: All ${checked} metadata files have a valid Object trait.`);
}
