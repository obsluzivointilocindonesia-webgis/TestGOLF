// 1. KONFIGURASI AWAL
Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzY2ZhMGQ3MS1mYzYwLTQ1NzktODY1Mi1lODRhZjRmMWE4Y2EiLCJpZCI6Mzg0MjAyLCJpYXQiOjE3Njk1Njg5ODJ9.5U2zZd_um-3-iYrpnfZg1Xt7eI7N_CPTCQHoa2xB0jQ";

const viewer = new Cesium.Viewer('cesiumContainer', {
    terrain: Cesium.Terrain.fromWorldTerrain(),
});
viewer.scene.globe.depthTestAgainstTerrain = true;

let activePoints = []; 
let labelsList = []; // Untuk menyimpan label agar mudah dihapus
let profileChart = null;
let contourDataSource = null;
let isContourVisible = false;
let isDragging = false;
let draggedEntity = null;
let currentContourTileset = null; // Menyimpan tileset kontur yang sedang aktif
let isContourOn = false;         // Status tombol ON/OFF
let currentContourDataSource = null; // Gunakan DataSource untuk GeoJSON
let currentContourLayer = null;
let userLocationMarker = null;
// Cek apakah sudah ada ronde aktif di browser
let currentRoundId = localStorage.getItem('current_round_id');

// Jika belum ada (baru pertama kali buka aplikasi), buat satu ID awal
if (!currentRoundId) {
    currentRoundId = Date.now(); // Menggunakan timestamp sebagai ID unik
    localStorage.setItem('current_round_id', currentRoundId);
}

// 2. LOAD ASSET TILESET
async function init() {
    try {
        const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(4406223);
        viewer.scene.primitives.add(tileset);
        tileset.classificationType = Cesium.ClassificationType.BOTH;
        viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(107.6258056, -6.8698692729, 990),
            orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-15.0), roll: 0.0 },
            duration: 2
        });    
    } catch (e) { console.error(e); }
}
init();
async function loadHoles() {
    try {
        const holeResource = await Cesium.IonResource.fromAssetId(4408863);
        const holeDataSource = await Cesium.GeoJsonDataSource.load(holeResource);
        await viewer.dataSources.add(holeDataSource);

        const entities = holeDataSource.entities.values;
        const triangleCanvas = createTriangleCanvas('#FF0000');

        entities.forEach(entity => {
            // Ambil posisi asli dari GeoJSON (Cartographic)
            const position = entity.position.getValue(viewer.clock.currentTime);
            
            // PAKSA MENEMPEL KE TILESET
            // Kita gunakan properti disableDepthTestDistance agar tidak tenggelam di bawah tileset
            entity.billboard = {
                image: triangleCanvas,
                width: 30,
                height: 30,
                heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND, // Berubah ke Relative
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY // INI KUNCINYA: Menembus permukaan agar selalu terlihat di atas Tileset
            };

            entity.label = {
                text: `HOLE ${entity.properties.HoleNo}\nPAR ${entity.properties.PAR}`,
                font: 'bold 16pt "Arial Black", Gadget, sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -50),
                heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            };
        });

    } catch (e) {
        console.error("Gagal memuat hole:", e);
    }
}
loadHoles();

// logo hole triangle
function createTriangleCanvas(colorStr) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Bersihkan canvas
    ctx.clearRect(0, 0, 64, 64);

    // Gambar Segitiga
    ctx.beginPath();
    ctx.moveTo(32, 5);   // Puncak segitiga
    ctx.lineTo(60, 58);  // Kanan bawah
    ctx.lineTo(4, 58);   // Kiri bawah
    ctx.closePath();

    ctx.fillStyle = colorStr;
    ctx.fill();
    
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 4;
    ctx.stroke();

    return canvas;
}

// 3. FUNGSI PERHITUNGAN BEARING
function getBearing(start, end) {
    const s = Cesium.Cartographic.fromCartesian(start);
    const e = Cesium.Cartographic.fromCartesian(end);
    const y = Math.sin(e.longitude - s.longitude) * Math.cos(e.latitude);
    const x = Math.cos(s.latitude) * Math.sin(e.latitude) - Math.sin(s.latitude) * Math.cos(e.latitude) * Math.cos(e.longitude - s.longitude);
    return (Cesium.Math.toDegrees(Math.atan2(y, x)) + 360) % 360;
}

// 4. UPDATE VISUAL & LABEL (VERSI LABEL DI TITIK AWAL)
function updateVisuals() {
    // Hapus semua label lama
    labelsList.forEach(l => viewer.entities.remove(l));
    labelsList = [];

    if (activePoints.length < 2) return;

    // Gambar ulang garis utama
    const lineId = 'dynamicLine';
    if (!viewer.entities.getById(lineId)) {
        viewer.entities.add({
            id: lineId,
            polyline: {
                // Menggunakan CallbackProperty agar garis 'elastis' saat titik ditarik
                positions: new Cesium.CallbackProperty(() => {
                    return activePoints.map(p => p.position);
                }, false),
                width: 4,
                material: Cesium.Color.YELLOW,
                clampToGround: true
            }
        });
    }

    // Iterasi untuk membuat label
    for (let i = 1; i < activePoints.length; i++) {
        const pStart = activePoints[i-1].position; // Titik Awal Segmen
        const pEnd = activePoints[i].position;     // Titik Akhir Segmen
        
        const cStart = Cesium.Cartographic.fromCartesian(pStart);
        const cEnd = Cesium.Cartographic.fromCartesian(pEnd);

        const dist = Cesium.Cartesian3.distance(pStart, pEnd);
        const deltaH = cEnd.height - cStart.height;
        const bearing = getBearing(pStart, pEnd);
        const slope = (deltaH / dist) * 100;

        // A. Label JARAK (Tetap di tengah segmen)
        const midPos = Cesium.Cartesian3.lerp(pStart, pEnd, 0.5, new Cesium.Cartesian3());
        const distLabel = viewer.entities.add({
            position: midPos,
            label: {
                text: `${dist.toFixed(1)} m`,
                font: 'bold 12pt "Arial Black", Gadget, sans-serif',
                fillColor: Cesium.Color.AQUA,
                outlineWidth: 4,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                heightReference: Cesium.HeightReference.clampToHeightMostDetailed,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
        labelsList.push(distLabel);

        // B. Label INFO DETAIL (diletakkan di pStart / Titik Awal Segmen)
        const infoLabel = viewer.entities.add({
            position: pStart,
            label: {
                text: `ARAH: ${bearing.toFixed(1)}°\nKEMIRINGAN: ${slope.toFixed(1)}%\nΔTINGGI: ${deltaH.toFixed(1)}m`,
                font: 'bold 12pt "Arial Black", Gadget, sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 4,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                showBackground: true,
                backgroundColor: new Cesium.Color(0, 0, 0, 0.5), // Hitam transparan 50%
                backgroundPadding: new Cesium.Cartesian2(7, 5), // Jarak teks ke pinggir kotak
                pixelOffset: new Cesium.Cartesian2(0, -50), // Offset agak tinggi agar tidak tumpang tindih
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM
            }
        });
        labelsList.push(infoLabel);
    }
    generateMultiPointProfile();
}
// 5. EVENT HANDLER KLIK
// --- REVISI EVENT HANDLER UNTUK SUPPORT HP & DESKTOP ---

const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
const viewerControls = viewer.scene.screenSpaceCameraController;

// FUNGSI UNTUK MENAMBAH TITIK (Klik/Tap Baru)
handler.setInputAction(async function (movement) {
    const scoreNow = document.getElementById('score-panel');
    if (scoreNow) {
        scoreNow.style.display = 'none'; 
    }
    const infoBox = document.getElementById('toolbar-info');
    if (infoBox) {
        infoBox.style.display = 'none'; 
    }

    const infoScore = document.getElementById('score-summary-container');
    if (infoScore) {
        infoScore.style.display = 'none'; 
    }

    // Jika sedang nge-drag, jangan buat titik baru
    if (isDragging) return;

    const cartesian = viewer.scene.pickPosition(movement.position);
    if (!Cesium.defined(cartesian)) return;

    const v = viewer.entities.add({
        position: cartesian,
        point: { 
            pixelSize: 20, // Diperbesar agar mudah di-tap di HP
            color: Cesium.Color.GREEN, 
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY 
        }
    });
    
    activePoints.push({ position: cartesian, entity: v });
    updateVisuals();
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// MULAI GESER (Support Mouse Down & Touch Start)
// Di mobile, LEFT_DOWN otomatis terpicu saat jari menyentuh layar
handler.setInputAction(function(click) {
    const pickedObject = viewer.scene.pick(click.position);
    if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.point) {
        isDragging = true;
        draggedEntity = pickedObject.id;
        
        // KUNCI KAMERA: Sangat penting di HP agar layar tidak ikut goyang saat geser titik
        viewerControls.enableInputs = false; 
    }
}, Cesium.ScreenSpaceEventType.LEFT_DOWN);

// PROSES GESER (Support Mouse Move & Touch Move)
handler.setInputAction(function(movement) {
    if (isDragging && draggedEntity) {
        // Gunakan endPosition untuk posisi jari/mouse terbaru
        const cartesian = viewer.scene.pickPosition(movement.endPosition);
        if (Cesium.defined(cartesian)) {
            draggedEntity.position = cartesian;
            
            // Update data di array agar garis ikut bergerak
            const pointData = activePoints.find(p => p.entity === draggedEntity);
            if (pointData) pointData.position = cartesian;

            updateVisuals(); 
        }
    }
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

// SELESAI GESER (Support Mouse Up & Touch End)
handler.setInputAction(function() {
    if (isDragging) {
        isDragging = false;
        draggedEntity = null;
        
        // AKTIFKAN KEMBALI KAMERA
        viewerControls.enableInputs = true; 
        
        generateMultiPointProfile();
    }
}, Cesium.ScreenSpaceEventType.LEFT_UP);

document.getElementById('undoBtn').addEventListener('click', () => {
    if (activePoints.length === 0) return;

    // 1. Ambil data titik terakhir
    const lastPoint = activePoints.pop();

    // 2. Hapus entitas titik dari peta
    viewer.entities.remove(lastPoint.entity);

    // 3. Jika setelah dihapus titik sisa kurang dari 2, hapus garis dan grafik
    if (activePoints.length < 2) {
        if (viewer.entities.getById('dynamicLine')) {
            viewer.entities.removeById('dynamicLine');
        }
        if (profileChart) profileChart.destroy();
        document.getElementById('chartContainer').style.display = 'none';
        
        // Munculkan kembali instruksi jika semua titik habis
        if (activePoints.length === 0) {
            document.getElementById('toolbar-info').style.display = 'block';
        }
    }

    // 4. Update visual (garis dan label) untuk titik yang tersisa
    updateVisuals();
});


// 6. MULTI-POINT PROFILE
async function generateMultiPointProfile() {
    const totalSamples = 50;
    const labels = [];
    const heights = [];
    const positions = activePoints.map(p => p.position);
    
    let totalDist = 0;
    for (let i = 0; i < positions.length - 1; i++) totalDist += Cesium.Cartesian3.distance(positions[i], positions[i+1]);

    let cumDist = 0;
    for (let i = 0; i < positions.length - 1; i++) {
        const start = positions[i];
        const end = positions[i+1];
        const segD = Cesium.Cartesian3.distance(start, end);
        const segS = Math.max(2, Math.floor((segD / totalDist) * totalSamples));

        for (let j = 0; j < segS; j++) {
            const r = j / segS;
            const p = Cesium.Cartesian3.lerp(start, end, r, new Cesium.Cartesian3());
            const cl = await viewer.scene.clampToHeightMostDetailed([p]);
            if (cl[0]) {
                const h = Cesium.Cartographic.fromCartesian(cl[0]).height;
                labels.push((cumDist + (r * segD)).toFixed(1) + "m");
                heights.push(h);
            }
        }
        cumDist += segD;
    }
    document.getElementById('chartContainer').style.display = 'block';
    renderChart(labels, heights);
}

function renderChart(labels, data) {
    const ctx = document.getElementById('profileChart').getContext('2d');
    if (profileChart) profileChart.destroy();
    profileChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Beda Tinggi Kumulatif (m)',
                data: data,
                borderColor: '#2ecc71',
                backgroundColor: 'rgba(46, 204, 113, 0.2)',
                fill: true,
                tension: 0.1,
                pointRadius: 0
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

// 7. KONTUR & CLEAR
// VIEWER PER HOLE dan LOAD DATA ASSET KONTUR
const holeData = {
 "1": {//-6.868553594615521, 107.62457935894973;  4406266
        center: Cesium.Cartesian3.fromDegrees(107.6245793589, -6.86855359, 1000), // Koordinat Hole 1
        contourAssetId: 4406266, // ID Asset Kontur Hole 1 di Ion
        heading: 210, pitch: -35, roll:0 
    },
    "2": {//-6.8703580,107.6238354 ; 4406267
        center: Cesium.Cartesian3.fromDegrees(107.6238354, -6.8703580, 1000),
        contourAssetId: 4406267,
        heading: 25, pitch: -60, roll:0
    },

    "3": {//-6.8697840,107.6244687 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6244687, -6.8697840, 950),
        contourAssetId: 4406268,
        heading: 200, pitch: -45, roll:0
    },

    "4": {//-6.8715004,107.6247602 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6247602, -6.8715004, 1050),
        contourAssetId: 4406269,
        heading: 180, pitch: -55, roll:0
    },

    "5": {//-6.8732492,107.6243212 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6243212, -6.8732492, 950),
        contourAssetId: 4406270,
        heading: 200, pitch: -45, roll:0
    },

    "6": {//-6.8739832,107.6250553 
        center: Cesium.Cartesian3.fromDegrees(107.6250553, -6.8739832, 950),
        contourAssetId: 4406272,
        heading: 120, pitch: -55, roll:0
    },

    "7": {//-6.8735298,107.62570297 ; 
        center: Cesium.Cartesian3.fromDegrees(107.62570297, -6.8735298, 950),
        contourAssetId: 4406273,
        heading: 270, pitch: -60, roll:0
    },

    "8": {//-6.8716947,107.6251632 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6251632, -6.8716947, 950),
        contourAssetId: 4406274,
        heading: 355, pitch: -45, roll:0
    },

    "9": {//-6.8690032,107.6250409 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6250409, -6.8690032, 1050),
        contourAssetId: 4406275,
        heading: 19, pitch: -65, roll:0
    },

    "10": {//-6.8692191,107.6254655 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6254655, -6.8692191, 950),
        contourAssetId: 4406276,
        heading: 190, pitch: -50, roll:0
    },

    "11": {//-6.8710111,107.6255662 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6255662, -6.8710111, 950),
        contourAssetId: 4406277,
        heading: 168, pitch: -55, roll:0
    },

    "12": {//-6.8693631,107.6258397 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6258397, -6.8693631, 980),
        contourAssetId: 4406278,
        heading: 3, pitch: -45, roll:0
    },

    "13": {//-6.8693127,107.6262355 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6262355, -6.8693127, 980),
        contourAssetId: 4406279,
        heading: 185, pitch: -45, roll:0
    },

    "14": {//-6.8729829,107.6259116 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6259116, -6.8729829, 940),
        contourAssetId: 4406280,
        heading: 150, pitch: -45, roll:0
    },

    "15": {//-6.8742549,107.6269605 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6269605, -6.8742549, 930),
        contourAssetId: 4406281,
        heading: 160, pitch: -78, roll:0
    },

    "16": {//-6.8734561,107.6265773 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6265773, -6.8734561, 950),
        contourAssetId: 4406282,
        heading: 10, pitch: -60, roll:0
    },

    "17": {//-6.8712539,107.6268688 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6268688, -6.8712539, 950),
        contourAssetId: 4406283,
        heading: 10, pitch: -43, roll:0
    },

    "18": {//-6.8686092,107.6265665 ; 
        center: Cesium.Cartesian3.fromDegrees(107.6265665, -6.8686092, 1000),
        contourAssetId: 4406284,
        heading: 348, pitch: -43, roll:0
    }
};


document.getElementById('holeSelect').addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!id) return;

    const data = holeData[id];

    // 1. Zoom ke Hole
    viewer.camera.flyTo({
        destination: data.center,
        orientation: { heading: Cesium.Math.toRadians(data.heading), pitch: Cesium.Math.toRadians(data.pitch) }
    });

    // 2. Hapus Kontur sebelumnya jika ada
    if (currentContourLayer) {
        viewer.scene.primitives.remove(currentContourLayer);
        currentContourLayer = null;
    }

    // 3. Load Kontur spesifik Hole ini (tapi jangan tampilkan dulu sebelum tombol Kontur ON)
    currentContourLayer = await Cesium.Cesium3DTileset.fromIonAssetId(data.contourAssetId);
    currentContourLayer.show = false; // Default OFF
    viewer.scene.primitives.add(currentContourLayer);
});

///..............................................

document.getElementById('contourBtn').addEventListener('click', async function() {
    const holeId = document.getElementById('holeSelect').value;
    if (!holeId) return alert("Silakan pilih Hole terlebih dahulu!");

    const data = holeData[holeId];
    isContourOn = !isContourOn;

    if (isContourOn) {
        this.textContent = "Matikan Kontur";
        this.style.backgroundColor = "#e74c3c";

        try {
            const resource = await Cesium.IonResource.fromAssetId(data.contourAssetId);
            currentContourDataSource = await Cesium.GeoJsonDataSource.load(resource, {
                clampToGround: true // Menempel pada Tileset/Terrain
            });

            const entities = currentContourDataSource.entities.values;

            // 1. Ambil semua nilai dari properti "Kontur" untuk mencari Min & Max
            const heights = entities.map(e => {
                return e.properties.Kontur ? parseFloat(e.properties.Kontur.getValue()) : 0;
            });
            const minH = Math.min(...heights);
            const maxH = Math.max(...heights);

            // 2. Beri warna gradasi dan label pada setiap entitas
                entities.forEach(e => {
        const h = e.properties.Kontur ? parseFloat(e.properties.Kontur.getValue()) : 0;
        let ratio = (h - minH) / (maxH - minH);
        if (isNaN(ratio)) ratio = 0;

        const color = Cesium.Color.fromHsl(0.6 * (1.0 - ratio), 1.0, 0.5);

        if (e.polyline) {
            e.polyline.material = color;
            e.polyline.width = 2;
            e.polyline.classificationType = Cesium.ClassificationType.BOTH;

        // Kita ambil titik tengah dari koordinat garis untuk menaruh label
            const positions = e.polyline.positions.getValue();
            if (positions && positions.length > 0) {
                const centerIndex = Math.floor(positions.length / 2);
                const centerPos = positions[centerIndex];

                e.position = centerPos; // Menentukan posisi label pada entity
                e.label = {
                    text: h.toString(),
                    font: 'bold 10pt Verdana, Geneva, sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 3,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                // heightReference sangat penting agar tidak tenggelam di bawah terrain
                    heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND, 
                    eyeOffset: new Cesium.ConstantProperty(new Cesium.Cartesian3(0, 0, -1)), // Memaksa label tampil sedikit di depan garis
                    disableDepthTestDistance: Number.POSITIVE_INFINITY, // Label tembus pandang terhadap objek lain
                    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 50)
                    };
                }
            }
        }
        //---------------------------------
        );

            await viewer.dataSources.add(currentContourDataSource);
        } catch (error) {
            console.error("Gagal memuat kontur:", error);
        }
    } else {
        this.textContent = "Tampilkan Kontur";
        this.style.backgroundColor = "";
        if (currentContourDataSource) {
            viewer.dataSources.remove(currentContourDataSource);
            currentContourDataSource = null;
        }
    }
});

function getColorFromHeight(height, min, max) {
    // Jika semua garis punya tinggi yang sama, gunakan warna tengah (ungu/hijau)
    if (max === min) return Cesium.Color.CYAN.withAlpha(0.8);
    
    const ratio = (height - min) / (max - min);
    // Interpolasi: Biru (rendah) -> Ungu -> Merah (tinggi)
    return new Cesium.Color(ratio, 0, 1 - ratio, 0.8);
}

document.getElementById('holeSelect').addEventListener('change', function() {
    // Hapus GeoJSON lama
    if (currentContourDataSource) {
        viewer.dataSources.remove(currentContourDataSource);
        currentContourDataSource = null;
    }
    
    // Reset status tombol
    isContourOn = false;
    document.getElementById('contourBtn').textContent = "Tampilkan Kontur";
    document.getElementById('contourBtn').style.backgroundColor = "";

    // Fly to hole area...
});

document.getElementById('clearBtn').addEventListener('click', () => {
    activePoints.forEach(p => viewer.entities.remove(p.entity));
    labelsList.forEach(l => viewer.entities.remove(l));
    if (viewer.entities.getById('dynamicLine')) viewer.entities.removeById('dynamicLine');
    activePoints = []; labelsList = [];
    if (profileChart) profileChart.destroy();
    document.getElementById('chartContainer').style.display = 'none';
    const infoBox = document.getElementById('toolbar-info');
    if (infoBox) {
        infoBox.style.display = 'block'; 
    }
});

//----------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    updateSummaryScore();
});
//-----------------------------------------------
document.getElementById('saveTrackBtn').addEventListener('click', () => {
    const holeId = document.getElementById('holeSelect').value;
    if (!holeId) return alert("Pilih Hole terlebih dahulu!");
    if (activePoints.length < 2) return alert("Minimal harus ada 2 titik (1 pukulan) untuk menyimpan track.");

    const scoreNow = document.getElementById('score-panel');
    if (scoreNow) {
        scoreNow.style.display = 'block'; 
    }

    const infoScore = document.getElementById('score-summary-container');
    if (infoScore) {
        infoScore.style.display = 'block'; 
    }

    if (profileChart) profileChart.destroy();
    document.getElementById('chartContainer').style.display = 'none';

    // 1. Ambil data PAR dari GeoJSON yang sudah ter-load
    let holePar = 0;
    const dataSources = viewer.dataSources;
    for (let i = 0; i < dataSources.length; i++) {
        const ds = dataSources.get(i);
        const entity = ds.entities.values.find(e => e.properties && e.properties.HoleNo && e.properties.HoleNo.getValue() == holeId);
        if (entity && entity.properties.PAR) {
            holePar = parseInt(entity.properties.PAR.getValue());
            break;
        }
    }

    // 2. Hitung jumlah pukulan berdasarkan jumlah titik
    // Rumus: Strokes = Jumlah Titik - 1 (Titik awal tidak dihitung sebagai pukulan)
    const autoStrokes = activePoints.length - 1;

    // 3. Konfirmasi ke user
    const confirmStrokes = prompt(`Hole ${holeId} (PAR ${holePar})\nTerdeteksi ${autoStrokes} pukulan.\n\nApakah jumlah ini sudah benar? (Jika salah, masukkan angka yang benar):`, autoStrokes);
    
    if (confirmStrokes === null) return; // Batal simpan jika tekan Cancel

    const finalStrokes = parseInt(confirmStrokes);
    const scoreTerm = getGolfTerm(finalStrokes, holePar);

    // 4. Siapkan data titik koordinat
    const trackPoints = activePoints.map(p => {
        const carto = Cesium.Cartographic.fromCartesian(p.position);
        return {
            lat: Cesium.Math.toDegrees(carto.latitude),
            lng: Cesium.Math.toDegrees(carto.longitude),
            height: carto.height
        };
    });

    // 5. Simpan ke LocalStorage
    const newEntry = {
        id: Date.now(),
        roundId: localStorage.getItem('current_round_id'),
        date: new Date().toLocaleString('id-ID'),
        hole: holeId,
        par: holePar,
        strokes: finalStrokes,
        scoreTerm: scoreTerm,
        points: trackPoints
    };

    let allTracks = JSON.parse(localStorage.getItem('golf_tracks') || '[]');
    allTracks.push(newEntry);
    localStorage.setItem('golf_tracks', JSON.stringify(allTracks));

    // Update UI Skor
    document.getElementById('current-score-text').textContent = `${finalStrokes} Strokes (${scoreTerm})`;
    updateSummaryUI();
   // alert(`Track Berhasil Disimpan!\nHole ${holeId} | Skor: ${scoreTerm}`);
    alert(`Tersimpan di Ronde Aktif!`)
});
//new ronde
// A. Fungsi untuk memulai ronde baru
document.getElementById('newGameBtn').addEventListener('click', () => {
    if (confirm("Mulai ronde baru? Skor pada scorecard akan direset, tapi log permainan tetap tersimpan.")) {
        // Buat ID unik baru untuk ronde ini
        const newRoundId = Date.now();
        localStorage.setItem('current_round_id', newRoundId);
        
        // Refresh tampilan (akan jadi NOL karena ID ronde berubah)
        updateSummaryUI();
        
        // Reset UI teks hole saat ini
        document.getElementById('current-score-text').textContent = "-";
        alert("Ronde baru dimulai!");
    }
});    

function updateSummaryUI() {
    const allTracks = JSON.parse(localStorage.getItem('golf_tracks') || '[]');
    const currentRoundId = localStorage.getItem('current_round_id');
    
    // FILTER KETAT: Hanya ambil data yang roundId-nya sama dengan ronde aktif
    const currentTracks = allTracks.filter(track => {
        return track.roundId == currentRoundId; 
    });

    const latestScores = {};
    currentTracks.forEach(track => {
        // Jika ada input ganda di hole yang sama pada ronde yang sama, ambil yang terakhir
        latestScores[track.hole] = { strokes: track.strokes, par: track.par };
    });

    let totalStrokes = 0;
    let totalPar = 0;
    const holesPlayed = Object.keys(latestScores).length;

    for (const hole in latestScores) {
        totalStrokes += latestScores[hole].strokes;
        totalPar += latestScores[hole].par;
    }

    // Update elemen HTML
    document.getElementById('total-strokes-val').textContent = totalStrokes;
    document.getElementById('total-par-val').textContent = totalPar;
    document.getElementById('holes-played-val').textContent = `${holesPlayed}/18`;

    // Reset status Over/Under
    const statusEl = document.getElementById('over-under-status');
    if (holesPlayed === 0) {
        statusEl.textContent = "No Data";
        statusEl.style.color = "#aaa";
    } else {
        const diff = totalStrokes - totalPar;
        statusEl.textContent = diff === 0 ? "EVEN" : (diff > 0 ? `+${diff}` : `${diff}`);
        statusEl.style.color = diff > 0 ? "#ff4444" : (diff < 0 ? "#00ff88" : "white");
    }
}
//---------minimize score container
document.getElementById('score-summary-container').addEventListener('click', function(e) {
    // Jangan trigger jika yang diklik adalah tombol "New Game"
    if (e.target.id === 'newGameBtn') return;
    
    this.classList.toggle('minimized');
});


//-------------------------------------------------------
function clearAll() {
    // Hapus semua entitas titik
    activePoints.forEach(p => viewer.entities.remove(p.entity));
    // Hapus semua label
    labelsList.forEach(l => viewer.entities.remove(l));
    // Hapus garis
    if (viewer.entities.getById('dynamicLine')) {
        viewer.entities.removeById('dynamicLine');
    }
    // Reset array
    activePoints = [];
    labelsList = [];
    // Sembunyikan chart
    if (profileChart) profileChart.destroy();
    document.getElementById('chartContainer').style.display = 'none';
}

//--------------------------------------------------------
document.getElementById('historyBtn').addEventListener('click', () => {
    let allTracks = JSON.parse(localStorage.getItem('golf_tracks') || '[]');
    if (allTracks.length === 0) return alert("Belum ada riwayat tersimpan.");

    let message = "Pilih Riwayat (Ketik nomor urut):\n";
    allTracks.forEach((t, index) => {
        message += `${index + 1}. Hole ${t.hole} - ${t.date}\n`;
    });

    const choice = prompt(message);
    const index = parseInt(choice) - 1;
    const selectedTrack = allTracks[index];

    if (selectedTrack) {
        clearAll(); // Sekarang fungsi ini sudah ada

        selectedTrack.points.forEach(p => {
            // Gunakan Cartesian3 dari derajat yang disimpan
            const position = Cesium.Cartesian3.fromDegrees(p.lng, p.lat, p.height);
            
            const v = viewer.entities.add({
                position: position,
                point: { 
                    pixelSize: 20, 
                    color: Cesium.Color.YELLOW, 
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY 
                }
            });
            activePoints.push({ position: position, entity: v });
        });
        
        // PENTING: Update kamera ke lokasi track agar langsung terlihat
        if (activePoints.length > 0) {
            viewer.zoomTo(activePoints.map(p => p.entity));
        }
        //-----------------------
        document.getElementById('current-score-text').textContent = 
        `${selectedTrack.strokes} Strokes (${selectedTrack.scoreTerm || 'N/A'}) - PAR ${selectedTrack.par}`;
        updateVisuals();
        alert(`Memuat Track Hole ${selectedTrack.hole}`);
    }
});

// Fungsi untuk menghapus SEMUA atau SALAH SATU riwayat
function deleteTrackHistory() {
    let allTracks = JSON.parse(localStorage.getItem('golf_tracks') || '[]');
    if (allTracks.length === 0) return alert("Tidak ada data untuk dihapus.");

    let message = "Ketik nomor track yang ingin DIHAPUS (atau ketik 'ALL' untuk hapus semua):\n";
    allTracks.forEach((t, index) => {
        message += `${index + 1}. Hole ${t.hole} - ${t.date}\n`;
    });

    const choice = prompt(message);
    
    if (choice === null) return; // User tekan cancel

    if (choice.toUpperCase() === 'ALL') {
        if (confirm("Hapus semua riwayat?")) {
            localStorage.removeItem('golf_tracks');
            alert("Semua riwayat telah dihapus.");
        }
    } else {
        const index = parseInt(choice) - 1;
        if (allTracks[index]) {
            const removed = allTracks.splice(index, 1);
            localStorage.setItem('golf_tracks', JSON.stringify(allTracks));
            alert(`Track Hole ${removed[0].hole} berhasil dihapus.`);
        } else {
            alert("Nomor tidak valid.");
        }
    }
}

// 8. FUNGSI HAPUS RIWAYAT
document.getElementById('deleteHistoryBtn').addEventListener('click', () => {
    let allTracks = JSON.parse(localStorage.getItem('golf_tracks') || '[]');
    
    if (allTracks.length === 0) {
        return alert("Tidak ada riwayat untuk dihapus.");
    }

    // Buat daftar riwayat untuk dipilih
    let message = "Ketik nomor track yang ingin DIHAPUS (atau ketik 'ALL' untuk hapus semua):\n";
    allTracks.forEach((t, index) => {
        message += `${index + 1}. Hole ${t.hole} - ${t.date}\n`;
    });

    const choice = prompt(message);
    
    // Jika user klik 'Cancel'
    if (choice === null) return; 

    if (choice.toUpperCase() === 'ALL') {
        if (confirm("Apakah Anda yakin ingin menghapus SEMUA riwayat?")) {
            localStorage.removeItem('golf_tracks');
            clearAll(); // Bersihkan peta juga
            alert("Semua riwayat telah dihapus.");
        }
    } else {
        const index = parseInt(choice) - 1;
        if (!isNaN(index) && allTracks[index]) {
            const removedHole = allTracks[index].hole;
            const removedDate = allTracks[index].date;
            
            // Hapus satu item dari array
            allTracks.splice(index, 1);
            
            // Simpan kembali ke localStorage
            localStorage.setItem('golf_tracks', JSON.stringify(allTracks));
            
            // Opsional: Jika track yang dihapus adalah yang sedang tampil, bersihkan peta
            clearAll(); 
            
            alert(`Riwayat Hole ${removedHole} (${removedDate}) berhasil dihapus.`);
        } else {
            alert("Nomor tidak valid atau tidak ditemukan.");
        }
    }
});

function getGolfTerm(strokes, par) {
    const diff = strokes - par;
    const terms = {
        "-3": "Albatross",
        "-2": "Eagle",
        "-1": "Birdie",
        "0": "Par",
        "1": "Bogey",
        "2": "Double Bogey",
        "3": "Triple Bogey"
    };
    return terms[diff] || (diff > 0 ? `+${diff} Strokes` : `${diff} Strokes`);
}

// 1. Fungsi untuk mengisi data ke dalam tabel detail
function generateTableDetail() {
    const allTracks = JSON.parse(localStorage.getItem('golf_tracks') || '[]');
    const currentRoundId = localStorage.getItem('current_round_id');
    const currentTracks = allTracks.filter(t => t.roundId == currentRoundId);

    const tbody = document.getElementById('table-body-detail');
    tbody.innerHTML = ""; // Bersihkan tabel

    let tStrokes = 0;
    let tPar = 0;

    // Urutkan berdasarkan nomor Hole
    currentTracks.sort((a, b) => parseInt(a.hole) - parseInt(b.hole));

    currentTracks.forEach(track => {
        const row = `
            <tr>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${track.hole}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${track.par}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${track.strokes}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${track.scoreTerm}</td>
            </tr>
        `;
        tbody.innerHTML += row;
        tStrokes += track.strokes;
        tPar += track.par;
    });

    // Update Footer Tabel
    document.getElementById('total-par-pdf').textContent = tPar;
    document.getElementById('total-strokes-pdf').textContent = tStrokes;
    document.getElementById('total-diff-pdf').textContent = (tStrokes - tPar > 0 ? "+" : "") + (tStrokes - tPar);
    document.getElementById('pdf-date').textContent = "Tanggal: " + new Date().toLocaleDateString('id-ID');
}

// 2. Event Listener Tombol Lihat Detail
document.getElementById('viewDetailBtn').addEventListener('click', () => {
    const content = document.getElementById('pdf-content');
    if (content.style.display === "none") {
        generateTableDetail();
        content.style.display = "block";
        document.getElementById('viewDetailBtn').textContent = "Tutup Detail";
    } else {
        content.style.display = "none";
        document.getElementById('viewDetailBtn').textContent = "Lihat Detail Scorecard";
    }
});

// 3. Event Listener Tombol Export PDF
document.getElementById('exportPdfBtn').addEventListener('click', () => {
    const element = document.getElementById('pdf-content');
    
    // Simpan tampilan asli
    const originalDisplay = element.style.display;
    element.style.display = "block"; 

    const opt = {
        margin:       0.5,
        filename:     `Golf-Scorecard-${Date.now()}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, logging: false, useCORS: true },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        // Jangan kembalikan ke display none jika user sedang melihat detail
        if (originalDisplay === "none") {
            element.style.display = "none";
        }
    });
});

let isRegisterMode = false;

// 1. Fungsi Toggle Login/Daftar
document.getElementById('toggle-auth').addEventListener('click', () => {
    isRegisterMode = !isRegisterMode;
    document.getElementById('auth-title').textContent = isRegisterMode ? "Daftar Akun Baru" : "Selamat Datang";
    document.getElementById('register-fields').style.display = isRegisterMode ? "block" : "none";
    document.getElementById('auth-primary-btn').textContent = isRegisterMode ? "Daftar" : "Masuk";
    document.getElementById('toggle-auth').textContent = isRegisterMode ? "Sudah punya akun? Login" : "Daftar sekarang";
});

// 2. Logika Utama Tombol Auth
document.getElementById('auth-primary-btn').addEventListener('click', () => {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-pass').value;
    const users = JSON.parse(localStorage.getItem('golf_users') || '[]');

    if (isRegisterMode) {
        // PROSES DAFTAR
        const name = document.getElementById('auth-name').value;
        if (!email || !pass || !name) return alert("Isi semua bidang!");
        
        const newUser = {
            email, pass, name,
            joinDate: new Date().toISOString(), // Penting untuk cek trial 7 hari
            isPaid: false
        };
        users.push(newUser);
        localStorage.setItem('golf_users', JSON.stringify(users));
        alert("Pendaftaran Berhasil! Silakan Login.");
        location.reload();
    } else {
        // PROSES LOGIN
        const user = users.find(u => u.email === email && u.pass === pass);
        if (user) {
            localStorage.setItem('active_user', JSON.stringify(user));
            checkTrialAccess(); // Langsung cek akses setelah login
        } else {
            alert("Email atau password salah!");
        }
    }
});

// 3. Fungsi Cek Akses (Trial 7 Hari / Berbayar)
function checkTrialAccess() {
    const activeUser = JSON.parse(localStorage.getItem('active_user'));
    const overlay = document.getElementById('auth-overlay');

    if (!activeUser) {
        overlay.style.display = 'flex';
        return;
    }

    // Hitung selisih hari
    const joinDate = new Date(activeUser.joinDate);
    const today = new Date();
    const diffTime = Math.abs(today - joinDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (!activeUser.isPaid && diffDays > 7) {
        // Jika masa trial habis dan belum bayar
        document.getElementById('auth-title').textContent = "Masa Trial Berakhir";
        document.getElementById('auth-subtitle').textContent = "Masa gratis 7 hari Anda sudah habis. Silakan hubungi admin untuk aktivasi bulanan.";
        document.getElementById('auth-email').style.display = 'none';
        document.getElementById('auth-pass').style.display = 'none';
        document.getElementById('auth-primary-btn').textContent = "Hubungi Admin (WhatsApp)";
        document.getElementById('auth-primary-btn').onclick = () => window.open('https://wa.me/62812345678');
        overlay.style.display = 'flex';
    } else {
        // Akses diberikan
        overlay.style.display = 'none';
        console.log(`Selamat Datang, ${activeUser.name}. Hari ke-${diffDays} dari 7 hari trial.`);
    }
}

// Jalankan pengecekan setiap halaman di-load
checkTrialAccess();

function checkTrialAccess() {
    const activeUser = JSON.parse(localStorage.getItem('active_user'));
    const overlay = document.getElementById('auth-overlay');

    if (!activeUser) {
        overlay.style.display = 'flex';
        return;
    }

    // --- LOGIKA MENAMPILKAN NAMA ---
    const nameEl = document.getElementById('display-user-name');
    if (nameEl) nameEl.textContent = activeUser.name;

    // Logika cek tanggal trial
    const joinDate = new Date(activeUser.joinDate);
    const today = new Date();
    const diffTime = Math.abs(today - joinDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (!activeUser.isPaid && diffDays > 7) {
        // ... (logika lockdown aplikasi jika > 7 hari) ...
        overlay.style.display = 'flex';
    } else {
        overlay.style.display = 'none';
    }
}

// 3. Fungsi Tombol Logout
document.getElementById('logoutBtn').addEventListener('click', () => {
    if (confirm("Apakah Anda yakin ingin logout?")) {
        localStorage.removeItem('active_user'); // Hapus sesi
        location.reload(); // Refresh halaman akan otomatis memicu form login
    }
});

//fungsi GPS
function startGpsTracking() {
    if ("geolocation" in navigator) {
        // Menggunakan watchPosition agar lokasi terupdate otomatis saat pemain berjalan
        navigator.geolocation.watchPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                const accuracy = position.coords.accuracy; // Akurasi dalam meter

                console.log(`Lokasi GPS: ${lat}, ${lon} (Akurasi: ${accuracy}m)`);
                updateUserMarker(lat, lon);
            },
            (error) => {
                console.error("Gagal mendapatkan GPS:", error.message);
                alert("Mohon aktifkan GPS di perangkat Anda.");
            },
            {
                enableHighAccuracy: true, // Wajib TRUE untuk akurasi lapangan golf
                maximumAge: 1000,
                timeout: 5000
            }
        );
    } else {
        alert("Perangkat Anda tidak mendukung GPS.");
    }
}

function updateUserMarker(lat, lon) {
    const position = Cesium.Cartesian3.fromDegrees(lon, lat);

    if (!userLocationMarker) {
        // Jika belum ada, buat marker baru (Warna Biru)
        userLocationMarker = viewer.entities.add({
            position: position,
            point: {
                pixelSize: 15,
                color: Cesium.Color.BLUE,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 3
            },
            label: {
                text: "Posisi Saya",
                font: "12px sans-serif",
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -20)
            }
        });
    } else {
        // Jika sudah ada, tinggal update posisinya
        userLocationMarker.position = position;
    }
}

document.getElementById('focusGpsBtn').addEventListener('click', () => {
    if (userLocationMarker) {
        viewer.zoomTo(userLocationMarker);
    } else {
        alert("Mencari sinyal GPS...");
        startGpsTracking();
    }
});