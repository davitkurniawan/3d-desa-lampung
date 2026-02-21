const debugEl = document.getElementById("debug");
function log(msg) {
  if (debugEl) debugEl.textContent = String(msg);
  try { console.log(msg); } catch {}
}

if (!window.THREE) {
  log("Gagal memuat Three.js (cek koneksi internet/CDN).");
}

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
const sidebarEl = document.getElementById("sidebar");
const overlayEl = document.getElementById("sidebar-overlay");
const mobileToggleBtn = document.getElementById("mobile-toggle");
function getCanvasSize() {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width || canvas.clientWidth || window.innerWidth));
  const h = Math.max(1, Math.floor(rect.height || canvas.clientHeight || window.innerHeight));
  return { w, h };
}
{
  const { w, h } = getCanvasSize();
  renderer.setSize(w, h, false);
}

const scene = new THREE.Scene();
scene.background = null;

const initialSize = getCanvasSize();
const camera = new THREE.PerspectiveCamera(45, initialSize.w / initialSize.h, 0.1, 1000);
camera.position.set(0, 0, 2.2);

let controls;
if (THREE.OrbitControls) {
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.35;
  controls.zoomSpeed = 0.6;
  controls.minDistance = 1.2;
  controls.maxDistance = 6;
} else {
  log("OrbitControls tidak tersedia. Kontrol kamera dinonaktifkan.");
  controls = {
    target: new THREE.Vector3(),
    update() {}
  };
}

const light = new THREE.DirectionalLight(0xffffff, 2.2);
light.position.set(4, 3, 2);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

let region = { minLat: -5.9, maxLat: -3.5, minLon: 103.4, maxLon: 106.1 };
let regionWidth = region.maxLon - region.minLon;
let regionHeight = region.maxLat - region.minLat;
let mapWidth = 2.4;
let mapHeight = mapWidth * (regionHeight / regionWidth);
let mapRoot = null;
let plane = null;
let boundaryGroup = null;
let fillGroup = null;
let kabBoundaryGroup = null;
let kabFillGroup = null;
let labelGroup = null;
function buildMapScene() {
  if (mapRoot) {
    scene.remove(mapRoot);
  }
  mapWidth = 2.4;
  mapHeight = mapWidth * (regionHeight / regionWidth);
  mapRoot = new THREE.Group();
  scene.add(mapRoot);
  // Tanpa bidang latar; hanya garis batas dari GeoJSON
  plane = null;
  boundaryGroup = new THREE.Group();
  fillGroup = new THREE.Group();
  kabBoundaryGroup = new THREE.Group();
  kabFillGroup = new THREE.Group();
  labelGroup = new THREE.Group();
  mapRoot.add(boundaryGroup);
  mapRoot.add(fillGroup);
  mapRoot.add(kabBoundaryGroup);
  mapRoot.add(kabFillGroup);
  mapRoot.add(labelGroup);
  renderer.render(scene, camera);
}
buildMapScene();

let map;
let baseLayer;
let transactionLayer = null;
function setMapFallback(enabled) {
  const el = document.getElementById("map");
  if (!el) return;
  if (enabled) el.classList.add("map-fallback");
  else el.classList.remove("map-fallback");
}
function initLeaflet() {
  map = L.map("map", {
    zoomControl: true,
    attributionControl: true
  }).setView([-4.9, 105.2], 8);
  try {
    baseLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    });
    baseLayer.on("load", () => setMapFallback(false));
    baseLayer.on("tileerror", () => setMapFallback(true));
    baseLayer.addTo(map);
  } catch (e) {
    setMapFallback(true);
  }
  transactionLayer = L.layerGroup().addTo(map);
}
initLeaflet();
function setupMobileUI() {
  function setOpen(open) {
    if (!sidebarEl) return;
    if (open) {
      sidebarEl.classList.add("open");
      if (overlayEl) overlayEl.style.display = "block";
    } else {
      sidebarEl.classList.remove("open");
      if (overlayEl) overlayEl.style.display = "none";
    }
  }
  if (mobileToggleBtn) {
    mobileToggleBtn.addEventListener("click", () => {
      const open = !sidebarEl.classList.contains("open");
      setOpen(open);
    });
  }
  if (overlayEl) {
    overlayEl.addEventListener("click", () => setOpen(false));
  }
  window.matchMedia("(max-width: 768px)").addEventListener("change", e => {
    isMobile = e.matches;
  });
}
setupMobileUI();

function latLonToMapVec3(lat, lon) {
  const nx = (lon - region.minLon) / regionWidth - 0.5;
  const ny = (lat - region.minLat) / regionHeight - 0.5;
  const x = nx * mapWidth;
  const y = ny * mapHeight;
  return new THREE.Vector3(x, y, 0);
}

function latLonToLeafletPoint(lat, lon) {
  if (!map) return { x: 0, y: 0 };
  const p = map.project([lat, lon], map.getZoom());
  return p;
}

function focusLampung() {
  camera.position.set(0, 0, 2.2);
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.update();
}

const commodityColors = {
  Padi: 0x56d364,
  Jagung: 0xffb454,
  Singkong: 0xf778ba,
  Kopi: 0xb0885b,
  Sayur: 0x3fb950,
  Telur: 0xffd700,
  Ayam: 0xe9967a,
  Daging: 0xdc3545,
  Ikan: 0x00c2ff
};
let transactionTotals = {};
let speedScale = 1.0;
const baseStep = 0.004;
const baseIntervalMs = 33;
let priceFactor = 1.0;
let crossProvEnabled = true;
let showFlowLines = false;
let lineDensity = 0.3;
let isMobile = window.matchMedia("(max-width: 768px)").matches;
if (isMobile) lineDensity = 0.2;

const villageGroup = new THREE.Group();
const flowsRoot = new THREE.Group();
mapRoot.add(villageGroup);
mapRoot.add(flowsRoot);

const legendEl = document.getElementById("legend");
function updateLegend({ desaCount = 0, flowCount = 0 }) {
  const items = Object.entries(commodityColors).map(([name, color]) => {
    return `<div class="legend-item"><div class="swatch" style="background:#${color.toString(16).padStart(6, "0")}"></div><div>${name}</div></div>`;
  }).join("");
  legendEl.innerHTML = `<div>Total Desa: ${desaCount}</div><div>Total Arus Aktif: ${flowCount}</div>${items}`;
}

function createVillagePoints(latLonList) {
  const group = L.layerGroup().addTo(map);
  for (const d of latLonList) {
    const m = L.circleMarker([d.lat, d.lon], {
      radius: 5,
      color: "#00c2ff",
      weight: 1,
      fillColor: "#00c2ff",
      fillOpacity: 0.9
    });
    m.addTo(group);
  }
}

function makeArcPoints(a, b, height = 0.15, segments = 64) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.z += height;
  const curve = new THREE.CubicBezierCurve3(a, mid, mid, b);
  const pts = curve.getPoints(segments);
  return pts;
}

const commodityIcons = {
  Padi: "🌾",
  Jagung: "🌽",
  Singkong: "🍠",
  Kopi: "☕️",
  Sayur: "🥦",
  Telur: "🥚",
  Ayam: "🍗",
  Daging: "🥩",
  Ikan: "🐟"
};
const commodityBasePrice = {
  Padi: 12000,
  Jagung: 6500,
  Singkong: 3000,
  Kopi: 80000,
  Sayur: 7000,
  Telur: 28000,
  Ayam: 40000,
  Daging: 130000,
  Ikan: 35000
};
function formatQty(kg) {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${Math.round(kg)} kg`;
}
function formatCurrency(n) {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(2)} M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(2)} jt`;
  return `Rp ${n.toLocaleString("id-ID")}`;
}
function updateTransactionLegend(totals) {
  const el = document.getElementById("txn-legend");
  if (!el) return;
  const rows = Object.keys(commodityColors).map(name => {
    const t = totals[name] || { qty: 0, value: 0 };
    return `<tr><td>${name}</td><td class="right">${formatQty(t.qty)}</td><td class="right">${formatCurrency(Math.round(t.value))}</td></tr>`;
  }).join("");
  const sum = Object.values(totals).reduce((a, b) => a + (b.value || 0), 0);
  el.innerHTML = `<div style="margin-bottom:6px;color:#8ab4f8;font-weight:600">Nilai Transaksi Per Hari</div><table><thead><tr><th>Komoditas</th><th class="right">Volume</th><th class="right">Nilai</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="2" style="font-weight:600">Total</td><td class="right" style="font-weight:600">${formatCurrency(Math.round(sum))}</td></tr></tfoot></table>`;
}
function makeArcLL(a, b, k = 0.25, segments = 64) {
  const ax = a.lon, ay = a.lat;
  const bx = b.lon, by = b.lat;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const cx = mx + px * len * k;
  const cy = my + py * len * k;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx;
    const y = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by;
    pts.push([y, x]);
  }
  return pts;
}
function createFlow(from, to, commodity, color, destName = "") {
  const layer = L.layerGroup();
  const pts = [[from.lat, from.lon], [to.lat, to.lon]];
  let t = Math.random();
  const qtyKg = Math.round(300 + Math.random() * 7000);
  const value = qtyKg * (commodityBasePrice[commodity] || 5000) * priceFactor;
  const iconHtml = `<div class="commodity-marker"><span class="emoji">${commodityIcons[commodity] || "📦"}</span><span class="qty">${formatQty(qtyKg)}</span><span class="dest">→ ${destName || ""}</span></div>`;
  const mover = L.marker([from.lat, from.lon], {
    icon: L.divIcon({ html: iconHtml, className: "", iconSize: [0, 0] })
  }).addTo(layer);
  const valueHtml = `<div class="value-label">${formatCurrency(value)}</div>`;
  const valueMarker = L.marker([from.lat, from.lon], {
    icon: L.divIcon({ html: valueHtml, className: "", iconSize: [0, 0] })
  }).addTo(transactionLayer);
  let path = null;
  if (showFlowLines) {
    const arc = makeArcLL({ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }, 0.22, 64);
    path = L.polyline(arc, {
      color: `#${color.toString(16).padStart(6, "0")}`,
      weight: 1,
      opacity: 0.35
    }).addTo(layer);
    setTimeout(() => {
      const p = path && path._path;
      if (p) {
        p.style.strokeDasharray = "10 12";
        let d = 0;
        layer._dash = setInterval(() => {
          d += 2 * speedScale;
          p.style.strokeDashoffset = -d + "px";
        }, baseIntervalMs);
      }
    }, 0);
  }
  const trailLayer = L.layerGroup().addTo(layer);
  const trailPoints = [];
  const puffCount = isMobile ? 8 : 12;
  const puffs = [];
  for (let i = 0; i < puffCount; i++) {
    const op = Math.max(0, 0.6 - i * 0.05);
    const puff = L.circleMarker([from.lat, from.lon], {
      radius: 2 + Math.max(0, 1 - i * 0.06),
      color: `#${color.toString(16).padStart(6, "0")}`,
      weight: 0,
      fillColor: `#${color.toString(16).padStart(6, "0")}`,
      fillOpacity: op
    });
    puff.addTo(trailLayer);
    puffs.push(puff);
  }
  let alpha = 1;
  let fading = false;
  function step() {
    t += baseStep * speedScale;
    if (t >= 0.98) fading = true;
    const lat = pts[0][0] + (pts[1][0] - pts[0][0]) * t;
    const lon = pts[0][1] + (pts[1][1] - pts[0][1]) * t;
    mover.setLatLng([lat, lon]);
    valueMarker.setLatLng([lat, lon]);
    if (path) {
      const origin = { lat: pts[0][0], lon: pts[0][1] };
      const current = { lat, lon };
      const dynamicArc = makeArcLL(origin, current, 0.22, 32);
      path.setLatLngs(dynamicArc);
    }
    trailPoints.push([lat, lon]);
    const maxTrail = puffCount * 2;
    if (trailPoints.length > maxTrail) trailPoints.shift();
    for (let i = 0; i < puffs.length; i++) {
      const index = trailPoints.length - 1 - i * 2;
      if (index >= 0 && trailPoints[index]) {
        puffs[i].setLatLng(trailPoints[index]);
        puffs[i].setStyle({ fillOpacity: Math.max(0, 0.6 - i * 0.05) * alpha });
      } else {
        puffs[i].setStyle({ fillOpacity: 0 });
      }
    }
    if (fading) {
      alpha -= 0.06 * speedScale;
      const mi = mover._icon, vi = valueMarker._icon, pi = path && path._path;
      if (mi) mi.style.opacity = String(Math.max(0, alpha));
      if (vi) vi.style.opacity = String(Math.max(0, alpha));
      if (pi) pi.style.opacity = String(Math.max(0, alpha));
      if (alpha <= 0) {
        t = 0;
        alpha = 1;
        fading = false;
        const mi2 = mover._icon, vi2 = valueMarker._icon, pi2 = path && path._path;
        if (mi2) mi2.style.opacity = "1";
        if (vi2) vi2.style.opacity = "1";
        if (pi2) pi2.style.opacity = "1";
        mover.setLatLng(pts[0]);
        valueMarker.setLatLng(pts[0]);
        trailPoints.length = 0;
        for (let i = 0; i < puffs.length; i++) {
          puffs[i].setLatLng(pts[0]);
          puffs[i].setStyle({ fillOpacity: Math.max(0, 0.6 - i * 0.05) });
        }
      }
    }
  }
  layer._anim = setInterval(step, baseIntervalMs);
  layer._qtyKg = qtyKg;
  layer._value = value;
  layer._commodity = commodity;
  return layer;
}

const provincialCapitals = [
  { name: "Aceh - Banda Aceh", lat: 5.5483, lon: 95.3238 },
  { name: "Sumatera Utara - Medan", lat: 3.5952, lon: 98.6722 },
  { name: "Sumatera Barat - Padang", lat: -0.9492, lon: 100.3543 },
  { name: "Riau - Pekanbaru", lat: 0.5071, lon: 101.4478 },
  { name: "Jambi - Jambi", lat: -1.6100, lon: 103.6157 },
  { name: "Sumatera Selatan - Palembang", lat: -2.9909, lon: 104.7566 },
  { name: "Bengkulu - Bengkulu", lat: -3.7956, lon: 102.2590 },
  { name: "Lampung - Bandar Lampung", lat: -5.4296, lon: 105.2623 },
  { name: "Kep. Bangka Belitung - Pangkalpinang", lat: -2.1291, lon: 106.1099 },
  { name: "Kep. Riau - Tanjung Pinang", lat: 0.9171, lon: 104.4469 },
  { name: "DKI Jakarta - Jakarta", lat: -6.2088, lon: 106.8456 },
  { name: "Jawa Barat - Bandung", lat: -6.9175, lon: 107.6191 },
  { name: "Jawa Tengah - Semarang", lat: -6.9667, lon: 110.4167 },
  { name: "DIY - Yogyakarta", lat: -7.7956, lon: 110.3695 },
  { name: "Jawa Timur - Surabaya", lat: -7.2575, lon: 112.7521 },
  { name: "Banten - Serang", lat: -6.1202, lon: 106.1503 },
  { name: "Bali - Denpasar", lat: -8.6700, lon: 115.2126 },
  { name: "NTB - Mataram", lat: -8.5833, lon: 116.1167 },
  { name: "NTT - Kupang", lat: -10.1781, lon: 123.6070 },
  { name: "Kalimantan Barat - Pontianak", lat: -0.0263, lon: 109.3425 },
  { name: "Kalimantan Tengah - Palangka Raya", lat: -2.2160, lon: 113.9138 },
  { name: "Kalimantan Selatan - Banjarbaru", lat: -3.4430, lon: 114.8450 },
  { name: "Kalimantan Timur - Samarinda", lat: -0.5022, lon: 117.1536 },
  { name: "Kalimantan Utara - Tanjung Selor", lat: 2.8380, lon: 117.3756 },
  { name: "Sulawesi Utara - Manado", lat: 1.4748, lon: 124.8421 },
  { name: "Sulawesi Tengah - Palu", lat: -0.8970, lon: 119.8707 },
  { name: "Sulawesi Selatan - Makassar", lat: -5.1477, lon: 119.4327 },
  { name: "Sulawesi Tenggara - Kendari", lat: -3.9954, lon: 122.5440 },
  { name: "Gorontalo - Gorontalo", lat: 0.5464, lon: 123.0586 },
  { name: "Sulawesi Barat - Mamuju", lat: -2.6762, lon: 118.8889 },
  { name: "Maluku - Ambon", lat: -3.6547, lon: 128.1900 },
  { name: "Maluku Utara - Sofifi", lat: 0.7353, lon: 127.5505 },
  { name: "Papua Barat - Manokwari", lat: -0.8610, lon: 134.0781 },
  { name: "Papua Barat Daya - Sorong", lat: -0.8830, lon: 131.2670 },
  { name: "Papua - Jayapura", lat: -2.5916, lon: 140.6689 },
  { name: "Papua Tengah - Nabire", lat: -3.3636, lon: 135.4930 },
  { name: "Papua Pegunungan - Wamena", lat: -4.0865, lon: 138.9430 },
  { name: "Papua Selatan - Merauke", lat: -8.4932, lon: 140.4018 }
];

function generateFlows(desa, commodities) {
  const flowsByCommodity = {};
  transactionTotals = {};
  for (const c of commodities) {
    const color = commodityColors[c];
    const group = L.layerGroup().addTo(map);
    transactionTotals[c] = { qty: 0, value: 0 };
    if (crossProvEnabled) {
      const capsAll = provincialCapitals.filter(cap => cap.name.indexOf("Lampung") === -1);
      const sampleCount = Math.max(4, Math.floor(capsAll.length * lineDensity));
      const caps = capsAll.slice().sort(() => Math.random() - 0.5).slice(0, sampleCount);
      for (const cap of caps) {
        const iA = Math.floor(Math.random() * desa.length);
        const flow = createFlow(desa[iA], { lat: cap.lat, lon: cap.lon }, c, color, cap.name.split(" - ")[1]);
        flow.addTo(group);
        transactionTotals[c].qty += flow._qtyKg;
        transactionTotals[c].value += flow._value;
      }
      group._flowCount = caps.length;
    } else {
      const baseCount = Math.min(24, Math.floor(desa.length * 1.2));
      const count = Math.max(6, Math.floor(baseCount * lineDensity));
      for (let i = 0; i < count; i++) {
        const iA = Math.floor(Math.random() * desa.length);
        let iB = Math.floor(Math.random() * desa.length);
        if (iB === iA) iB = (iB + 1) % desa.length;
        const flow = createFlow(desa[iA], desa[iB], c, color, "Lampung");
        flow.addTo(group);
        transactionTotals[c].qty += flow._qtyKg;
        transactionTotals[c].value += flow._value;
      }
      group._flowCount = count;
    }
    flowsByCommodity[c] = group;
  }
  updateTransactionLegend(transactionTotals);
  return flowsByCommodity;
}

function setCommodityVisibility(groupMap, enabledMap) {
  for (const [c, layer] of Object.entries(groupMap)) {
    if (enabledMap[c]) {
      if (!map.hasLayer(layer)) layer.addTo(map);
    } else {
      if (map.hasLayer(layer)) layer.remove();
    }
}
}


function animate() {
  const { w: width, h: height } = getCanvasSize();
  const needResize = canvas.width !== width || canvas.height !== height;
  if (needResize) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  flowsRoot.traverse(obj => {
    if (obj.isMesh && obj.userData.arcPositions) {
      const pts = obj.userData.arcPositions;
      obj.userData.t += 0.006;
      if (obj.userData.t > 1) obj.userData.t = 0;
      const index = Math.floor(obj.userData.t * (pts.length - 1));
      const p = pts[index];
      obj.position.copy(p);
    }
  });
  renderer.render(scene, camera);
}

let desaData = [];
let flowGroups = {};
async function loadLampungGeo() {
  try {
    const res = await fetch("./data/lampung.geojson", { cache: "no-store" });
    const gj = await res.json();
    updateRegionFromGeoJSON(gj);
    buildMapScene();
    mapRoot.add(villageGroup);
    mapRoot.add(flowsRoot);
    drawGeoJSONBoundary(gj);
  } catch {
    const fallback = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [104.735, -5.98], [104.97, -5.86], [105.33, -5.84], [105.65, -5.72],
          [105.79, -5.52], [105.97, -5.15], [106.05, -4.90], [105.98, -4.65],
          [105.82, -4.42], [105.63, -4.24], [105.33, -4.08], [105.06, -4.02],
          [104.77, -3.96], [104.52, -4.08], [104.41, -4.32], [104.38, -4.58],
          [104.44, -4.86], [104.54, -5.10], [104.62, -5.36], [104.68, -5.65],
          [104.73, -5.90], [104.735, -5.98]
        ]]
      }
    };
    updateRegionFromGeoJSON(fallback);
    buildMapScene();
    mapRoot.add(villageGroup);
    mapRoot.add(flowsRoot);
    drawGeoJSONBoundary(fallback);
    log("Memakai GeoJSON fallback lokal.");
  }
}

async function loadKabupatenGeo() {
  try {
    const res = await fetch("./data/lampung_kabupaten.geojson", { cache: "no-store" });
    const gj = await res.json();
    drawKabupatenLayer(gj);
  } catch {
    log("Gagal memuat GeoJSON kabupaten. Menggunakan data sederhana.");
    const simple = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { name: "Lampung Selatan" }, geometry: { type: "Polygon", coordinates: [[ [105.35,-5.9],[105.85,-5.8],[105.9,-5.3],[105.5,-5.2],[105.2,-5.5],[105.35,-5.9] ]] } },
        { type: "Feature", properties: { name: "Lampung Tengah" }, geometry: { type: "Polygon", coordinates: [[ [104.9,-5.1],[105.5,-5.0],[105.6,-4.6],[105.0,-4.5],[104.8,-4.8],[104.9,-5.1] ]] } },
        { type: "Feature", properties: { name: "Lampung Barat" }, geometry: { type: "Polygon", coordinates: [[ [104.3,-5.4],[104.8,-5.3],[104.9,-4.9],[104.4,-4.8],[104.2,-5.1],[104.3,-5.4] ]] } }
      ]
    };
    drawKabupatenLayer(simple);
  }
}

function drawKabupatenLayer(gj) {
  kabBoundaryGroup.clear();
  kabFillGroup.clear();
  labelGroup.clear();
  const strokeMat = new THREE.LineBasicMaterial({ color: 0x2dbfff, transparent: true, opacity: 0.9 });
  const fillMat = new THREE.MeshBasicMaterial({ color: 0x0b2c4d, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
  const feats = gj.type === "FeatureCollection" ? gj.features : [gj];
  for (const f of feats) {
    const g = f.geometry || f;
    const props = f.properties || {};
    const name = props.name || props.NAME_2 || props.KABKOTA || props.KABUPATEN || "Kabupaten";
    const rings = [];
    if (g.type === "Polygon") rings.push(...(g.coordinates || []));
    else if (g.type === "MultiPolygon") {
      for (const poly of (g.coordinates || [])) rings.push(...poly);
    }
    let centroid = new THREE.Vector3();
    let total = 0;
    for (const ring of rings) {
      const len = ring.length;
      const positions = new Float32Array(len * 3);
      const shapePts = [];
      let cx = 0, cy = 0;
      for (let i = 0; i < len; i++) {
        const [lon, lat] = ring[i];
        const v = latLonToMapVec3(lat, lon);
        positions[i * 3 + 0] = v.x;
        positions[i * 3 + 1] = v.y;
        positions[i * 3 + 2] = v.z;
        shapePts.push(new THREE.Vector2(v.x, v.y));
        cx += v.x; cy += v.y;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      kabBoundaryGroup.add(new THREE.LineLoop(geom, strokeMat));
      if (shapePts.length >= 3) {
        const shape = new THREE.Shape(shapePts);
        const shapeGeom = new THREE.ShapeGeometry(shape);
        const mesh = new THREE.Mesh(shapeGeom, fillMat);
        mesh.position.z = 0.002;
        kabFillGroup.add(mesh);
      }
      centroid.add(new THREE.Vector3(cx / len, cy / len, 0));
      total++;
    }
    if (total > 0) {
      centroid.multiplyScalar(1 / total);
      labelGroup.add(makeLabelSprite(name, centroid));
    }
  }
}

function makeLabelSprite(text, position) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(13, 20, 33, 0.7)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "24px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillStyle = "#e6edf3";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  const scale = 0.35;
  sprite.scale.set(scale * (canvas.width / canvas.height), scale, 1);
  sprite.position.copy(position.clone().setZ(0.03));
  return sprite;
}
function updateRegionFromGeoJSON(gj) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  const feats = gj.type === "FeatureCollection" ? gj.features : [gj];
  for (const f of feats) {
    const g = f.geometry || f;
    if (!g) continue;
    const iterRings = [];
    if (g.type === "Polygon") iterRings.push(...(g.coordinates || []));
    else if (g.type === "MultiPolygon") {
      for (const poly of (g.coordinates || [])) iterRings.push(...poly);
    }
    for (const ring of iterRings) {
      for (const [lon, lat] of ring) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }
    }
  }
  if (isFinite(minLat) && isFinite(maxLat) && isFinite(minLon) && isFinite(maxLon)) {
    const padLat = 0.1, padLon = 0.1;
    region = { minLat: minLat - padLat, maxLat: maxLat + padLat, minLon: minLon - padLon, maxLon: maxLon + padLon };
    regionWidth = region.maxLon - region.minLon;
    regionHeight = region.maxLat - region.minLat;
  }
}

function drawGeoJSONBoundary(gj) {
  boundaryGroup.clear();
  const strokeMat = new THREE.LineBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.95 });
  const fillMat = new THREE.MeshBasicMaterial({ color: 0x0f2742, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
  function addRing(coords) {
    const len = coords.length;
    const positions = new Float32Array(len * 3);
    const shapePts = [];
    for (let i = 0; i < len; i++) {
      const [lon, lat] = coords[i];
      const v = latLonToMapVec3(lat, lon);
      positions[i * 3 + 0] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
      shapePts.push(new THREE.Vector2(v.x, v.y));
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const line = new THREE.LineLoop(geom, strokeMat);
    boundaryGroup.add(line);
    if (shapePts.length >= 3) {
      const shape = new THREE.Shape(shapePts);
      const shapeGeom = new THREE.ShapeGeometry(shape);
      const mesh = new THREE.Mesh(shapeGeom, fillMat);
      mesh.position.z = 0.001;
      fillGroup.add(mesh);
    }
  }
  const feats = gj.type === "FeatureCollection" ? gj.features : [gj];
  for (const f of feats) {
    const g = f.geometry || f;
    if (!g) continue;
    if (g.type === "Polygon") {
      const rings = g.coordinates || [];
      for (const ring of rings) addRing(ring);
    } else if (g.type === "MultiPolygon") {
      const polys = g.coordinates || [];
      for (const poly of polys) {
        for (const ring of poly) addRing(ring);
      }
    }
  }
}

async function loadData() {
  try {
    const res = await fetch("./data/desa.json");
    const json = await res.json();
    desaData = Array.isArray(json.desa) ? json.desa : [];
  } catch {
    desaData = [];
  }
}

async function main() {
  await loadLampungGeo();
  await loadKabupatenGeo();
  await loadData();
  villageGroup.clear();
  createVillagePoints(desaData);
  flowGroups = generateFlows(desaData, Object.keys(commodityColors));
  updateLegend({ desaCount: desaData.length, flowCount: Object.values(flowGroups).reduce((acc, g) => acc + (g._flowCount || 0), 0) });
  focusLampung();
  const commodityControls = document.querySelectorAll("#commodity-controls input[type=checkbox]");
  const enabled = {};
  commodityControls.forEach(el => {
    enabled[el.dataset.commodity] = el.checked;
  });
  setCommodityVisibility(flowGroups, enabled);
  commodityControls.forEach(el => {
    el.addEventListener("change", () => {
      enabled[el.dataset.commodity] = el.checked;
      setCommodityVisibility(flowGroups, enabled);
    });
  });
  document.getElementById("randomize-flows").addEventListener("click", () => {
    for (const group of Object.values(flowGroups)) {
      group.eachLayer(layer => {
        if (layer._anim) clearInterval(layer._anim);
        if (layer._dash) clearInterval(layer._dash);
      });
      if (map.hasLayer(group)) map.removeLayer(group);
    }
    transactionLayer.clearLayers();
    flowGroups = generateFlows(desaData, Object.keys(commodityColors).filter(c => enabled[c]));
    updateLegend({ desaCount: desaData.length, flowCount: Object.values(flowGroups).length });
  });
  const speedInput = document.getElementById("speed-control");
  if (speedInput) {
    speedInput.addEventListener("input", () => {
      const v = parseFloat(speedInput.value || "1");
      speedScale = isFinite(v) ? v : 1.0;
    });
  }
  const crossInput = document.getElementById("toggle-crossprov");
  if (crossInput) {
    crossInput.addEventListener("change", () => {
      crossProvEnabled = !!crossInput.checked;
      for (const group of Object.values(flowGroups)) {
        group.eachLayer(layer => {
          if (layer._anim) clearInterval(layer._anim);
          if (layer._dash) clearInterval(layer._dash);
        });
        if (map.hasLayer(group)) map.removeLayer(group);
      }
      transactionLayer.clearLayers();
      flowGroups = generateFlows(desaData, Object.keys(commodityColors).filter(c => enabled[c]));
      updateLegend({ desaCount: desaData.length, flowCount: Object.values(flowGroups).length });
    });
  }
  const priceInput = document.getElementById("price-factor");
  if (priceInput) {
    priceInput.addEventListener("input", () => {
      const v = parseFloat(priceInput.value || "1");
      priceFactor = isFinite(v) ? v : 1.0;
      for (const group of Object.values(flowGroups)) {
        group.eachLayer(layer => {
          if (layer._anim) clearInterval(layer._anim);
          if (layer._dash) clearInterval(layer._dash);
        });
        if (map.hasLayer(group)) map.removeLayer(group);
      }
      transactionLayer.clearLayers();
      flowGroups = generateFlows(desaData, Object.keys(commodityColors).filter(c => enabled[c]));
      updateLegend({ desaCount: desaData.length, flowCount: Object.values(flowGroups).length });
    });
  }
  const flowLinesInput = document.getElementById("toggle-flowlines");
  if (flowLinesInput) {
    flowLinesInput.addEventListener("change", () => {
      showFlowLines = !!flowLinesInput.checked;
      for (const group of Object.values(flowGroups)) {
        group.eachLayer(layer => {
          if (layer._anim) clearInterval(layer._anim);
          if (layer._dash) clearInterval(layer._dash);
        });
        if (map.hasLayer(group)) map.removeLayer(group);
      }
      transactionLayer.clearLayers();
      flowGroups = generateFlows(desaData, Object.keys(commodityColors).filter(c => enabled[c]));
      updateLegend({ desaCount: desaData.length, flowCount: Object.values(flowGroups).length });
    });
  }
  const densityInput = document.getElementById("line-density");
  if (densityInput) {
    densityInput.addEventListener("input", () => {
      const v = parseFloat(densityInput.value || "0.3");
      lineDensity = Math.min(1, Math.max(0.1, isFinite(v) ? v : 0.3));
      for (const group of Object.values(flowGroups)) {
        group.eachLayer(layer => {
          if (layer._anim) clearInterval(layer._anim);
          if (layer._dash) clearInterval(layer._dash);
        });
        if (map.hasLayer(group)) map.removeLayer(group);
      }
      transactionLayer.clearLayers();
      flowGroups = generateFlows(desaData, Object.keys(commodityColors).filter(c => enabled[c]));
      updateLegend({ desaCount: desaData.length, flowCount: Object.values(flowGroups).length });
    });
  }
  const mSpeed = document.getElementById("m-speed");
  if (mSpeed) {
    mSpeed.addEventListener("input", () => {
      const v = parseFloat(mSpeed.value || "1");
      speedScale = isFinite(v) ? v : 1.0;
    });
  }
  const mLines = document.getElementById("m-lines");
  if (mLines) {
    mLines.addEventListener("change", () => {
      showFlowLines = !!mLines.checked;
      for (const group of Object.values(flowGroups)) {
        group.eachLayer(layer => {
          if (layer._anim) clearInterval(layer._anim);
          if (layer._dash) clearInterval(layer._dash);
        });
        if (map.hasLayer(group)) map.removeLayer(group);
      }
      transactionLayer.clearLayers();
      flowGroups = generateFlows(desaData, Object.keys(commodityColors).filter(c => enabled[c]));
      updateLegend({ desaCount: desaData.length, flowCount: Object.values(flowGroups).length });
    });
  }
  const mDensity = document.getElementById("m-density");
  if (mDensity) {
    mDensity.addEventListener("input", () => {
      const v = parseFloat(mDensity.value || "0.2");
      lineDensity = Math.min(1, Math.max(0.1, isFinite(v) ? v : 0.2));
      for (const group of Object.values(flowGroups)) {
        group.eachLayer(layer => {
          if (layer._anim) clearInterval(layer._anim);
          if (layer._dash) clearInterval(layer._dash);
        });
        if (map.hasLayer(group)) map.removeLayer(group);
      }
      transactionLayer.clearLayers();
      flowGroups = generateFlows(desaData, Object.keys(commodityColors).filter(c => enabled[c]));
      updateLegend({ desaCount: desaData.length, flowCount: Object.values(flowGroups).length });
    });
  }
  const btnLegend = document.getElementById("btn-legend");
  const btnTxn = document.getElementById("btn-txn");
  const btnSpeed = document.getElementById("btn-speed");
  const legendPanel = document.getElementById("legend");
  const txnPanel = document.getElementById("txn-legend");
  const quickPanel = document.getElementById("mobile-quick-panel");
  function setPanelOpen(panel, open) {
    if (!panel) return;
    if (open) panel.classList.add("open");
    else panel.classList.remove("open");
  }
  if (btnLegend && legendPanel) {
    btnLegend.addEventListener("click", () => {
      log("Klik tombol Legenda");
      const willOpen = !legendPanel.classList.contains("open");
      setPanelOpen(legendPanel, willOpen);
      if (willOpen) setPanelOpen(txnPanel, false);
      if (quickPanel) setPanelOpen(quickPanel, false);
    });
  }
  if (btnTxn && txnPanel) {
    btnTxn.addEventListener("click", () => {
      log("Klik tombol Nilai");
      const willOpen = !txnPanel.classList.contains("open");
      setPanelOpen(txnPanel, willOpen);
      if (willOpen) setPanelOpen(legendPanel, false);
      if (quickPanel) setPanelOpen(quickPanel, false);
    });
  }
  if (btnSpeed && quickPanel) {
    btnSpeed.addEventListener("click", () => {
      log("Klik tombol Kecepatan");
      const willOpen = !quickPanel.classList.contains("open");
      setPanelOpen(quickPanel, willOpen);
      quickPanel.style.display = willOpen ? "block" : "none";
      if (willOpen) {
        setPanelOpen(legendPanel, false);
        setPanelOpen(txnPanel, false);
      }
    });
  }
  if (isMobile) {
    setPanelOpen(legendPanel, false);
    setPanelOpen(txnPanel, false);
    setPanelOpen(quickPanel, false);
  }
  document.getElementById("reset-view").addEventListener("click", () => {
    focusLampung();
  });
  renderer.setAnimationLoop(animate);
}

main();
