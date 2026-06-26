const fs = require("fs");

const htmlPath = "C:/Users/edwar/Downloads/focus_media_client_gps_fixed.html";
const html = fs.readFileSync(htmlPath, "utf8");
const match = html.match(/const\s+LOCATIONS\s*=\s*(\[[\s\S]*?\]);/);
if (!match) {
  throw new Error("LOCATIONS not found");
}

const locations = Function(`"use strict"; return (${match[1]});`)();
const category = process.argv[2];
const filtered = category ? locations.filter((location) => location.category === category) : locations;

console.log(
  JSON.stringify(
    filtered.map((location) => ({
      nr: location.nr,
      code: location.code,
      category: location.category,
      address: location.address,
      rateCard: location.rateCard,
      availability: location.availability,
      lat: location.lat,
      lng: location.lng,
      photo: location.photo
    })),
    null,
    2
  )
);
