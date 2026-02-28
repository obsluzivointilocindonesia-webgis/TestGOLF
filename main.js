// 1. KONFIGURASI AWAL
//tambahan untuk supabase
let currentUser = null;
let userLat = 0, userLon = 0;
const supabaseUrl = 'https://jltjrfhbreswadzlexzg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsdGpyZmhicmVzd2FkemxleHpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMjA4NjIsImV4cCI6MjA4NTY5Njg2Mn0.mS7QjBoWBS-xYZcAE--SaZHioJ_RqA57l_Bs5p6ppag';
const sb = supabase.createClient(supabaseUrl, supabaseKey);

Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzY2ZhMGQ3MS1mYzYwLTQ1NzktODY1Mi1lODRhZjRmMWE4Y2EiLCJpZCI6Mzg0MjAyLCJpYXQiOjE3Njk1Njg5ODJ9.5U2zZd_um-3-iYrpnfZg1Xt7eI7N_CPTCQHoa2xB0jQ"
const viewer = new Cesium.Viewer('cesiumContainer', {
    homeButton: false,
    fullscreenButton: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    timeline: false,
    geocoder: false,
    animation: false,
    screenModePicker: false,
    terrain: Cesium.Terrain.fromWorldTerrain(),
});
viewer.scene.globe.depthTestAgainstTerrain = false;

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
let currentRoundId = localStorage.getItem('current_round_id');
let groupData = []; // Variabel penampung data semua pemain
let currentSyncRoundId = ""; // Menyimpan ID Grup aktif

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
        const holeResource = await Cesium.IonResource.fromAssetId(4480561);
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
 		        text: `HOLE ${entity.properties.HoleNo}\nPAR ${entity.properties.PAR}\nSI ${entity.properties.SI}`,
                font: 'bold 16pt "Arial Black", Gadget, sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -60),
                heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            };
        });

    } catch (e) {
        console.error("Failed to load hole:", e);
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
                text: `Bearing: ${bearing.toFixed(1)}°\nSlope: ${slope.toFixed(1)}%\nΔH: ${deltaH.toFixed(1)}m`,
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
    // HANYA proses grafik untuk 2 titik terakhir setelah titik baru diletakkan
    if (activePoints.length >= 2) {
        const lastSegment = activePoints.slice(-2);
        generateMultiPointProfile(lastSegment); 
    }
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
        
        // Panggil ini setiap kali user menambah titik baru (pukulan baru)
    if (activePoints.length >= 2) {
        const lastSegment = activePoints.slice(-2); 
        generateMultiPointProfile(lastSegment); // Hanya kirim 2 titik terakhir
    }
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
            document.getElementById('toolbar-info').style.display = 'none';
        }
    }

    // 4. Update visual (garis dan label) untuk titik yang tersisa
    updateVisuals();
});

// 6. MULTI-POINT PROFILE
async function generateMultiPointProfile(targetPoints = activePoints) {
    if (targetPoints.length < 2) return;

    const totalSamples = 50;
    const labels = [];
    const heights = [];
    const positions = targetPoints.map(p => p.position);
    
    let totalDist = 0;
    for (let i = 0; i < positions.length - 1; i++) {
        totalDist += Cesium.Cartesian3.distance(positions[i], positions[i+1]);
    }

    let cumDist = 0;
    for (let i = 0; i < positions.length - 1; i++) {
        const start = positions[i];
        const end = positions[i+1];
        const segD = Cesium.Cartesian3.distance(start, end);
        // Tentukan jumlah sampel untuk segmen ini
        const segS = Math.max(2, Math.floor((segD / totalDist) * totalSamples));

        for (let j = 0; j < segS; j++) {
            const r = j / segS;
            const p = Cesium.Cartesian3.lerp(start, end, r, new Cesium.Cartesian3());
            
            // KUNCI: Tetap menggunakan clampToHeight agar mengikuti tileset
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

//---------------------
function renderChart(labels, data) {
    const ctx = document.getElementById('profileChart').getContext('2d');
    if (profileChart) profileChart.destroy();
    profileChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Height Difference (m)',
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
    if (id) {
        document.getElementById('clearBtn').style.display = 'block'; 
        document.getElementById('undoBtn').style.display = 'block';
        document.getElementById('deleteHistoryBtn').style.display = 'block';
        document.getElementById('contourBtn').style.display = 'block';
        document.getElementById('historyBtn').style.display = 'block';
        document.getElementById('saveTrackBtn').style.display = 'block';
        document.getElementById('toolbar-info').style.display = 'none';
    }


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
    if (!holeId) return alert("Select Hole # First!");

    const data = holeData[holeId];
    isContourOn = !isContourOn;

    if (isContourOn) {
        this.textContent = "Contour OFF";
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
            console.error("Failed to Load:", error);
        }
    } else {
        this.textContent = "Contour ON";
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
    document.getElementById('contourBtn').textContent = "Contour ON";
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
        infoBox.style.display = 'none'; 
    }
});

//----------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    updateSummaryUI();
});
//-----------------------------------------------
document.getElementById('saveTrackBtn').addEventListener('click', async () => {
    const holeId = document.getElementById('holeSelect').value;
    const currentMerchantId = window.location.hostname.includes('mvg') ? 'MVG' : 'TGR';
    if (!holeId) return alert("Select Hole # First");
    if (activePoints.length < 2) return alert("At least 2 points to save track");

    // --- LOGIKA MULTIPLAYER: AMBIL ROUND ID ---
    // 1. Ambil dari input teks (Multiplayer)
    const multiplayerId = document.getElementById('roundIdInput').value.trim();
    // 2. Ambil dari LocalStorage (Sesi saat ini)
    const localRoundId = localStorage.getItem('current_round_id');
    
    // Tentukan ID mana yang dipakai: Prioritas Input > LocalStorage > Generate Baru
    const sessionRoundId = multiplayerId || localRoundId || ('session-' + Date.now());
    
    // Pastikan tersimpan di LocalStorage agar konsisten untuk hole berikutnya
    localStorage.setItem('current_round_id', sessionRoundId);
    // ------------------------------------------

    // UI Feedback
    if (document.getElementById('score-panel')) document.getElementById('score-panel').style.display = 'block';
    if (document.getElementById('score-summary-container')) document.getElementById('score-summary-container').style.display = 'none';
    if (profileChart) profileChart.destroy();
    document.getElementById('chartContainer').style.display = 'none';

    // 1. Ambil data PAR dari GeoJSON (Kode asli Anda)
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

    // 2. Hitung Strokes & Konfirmasi
    const autoStrokes = activePoints.length - 1;
    const confirmStrokes = prompt(`Hole ${holeId} (PAR ${holePar})\nDetected ${autoStrokes} strokes.\n\nIs this number correct?`, autoStrokes);
    if (confirmStrokes === null) return; 

    const finalStrokes = parseInt(confirmStrokes);
    const scoreTerm = getGolfTerm(finalStrokes, holePar);

    // 3. Koordinat Titik
    const trackPoints = activePoints.map(p => {
        const carto = Cesium.Cartographic.fromCartesian(p.position);
        return {
            lat: Cesium.Math.toDegrees(carto.latitude),
            lng: Cesium.Math.toDegrees(carto.longitude),
            height: carto.height
        };
    });

    // 4. Buat Entry Data
    const newEntry = {
        id: Date.now(),
        roundId: sessionRoundId,
        date: new Date().toLocaleString('id-ID'),
        hole: holeId,
        par: holePar,
        strokes: finalStrokes,
        scoreTerm: scoreTerm,
        points: trackPoints
    };

    // Simpan ke LocalStorage (Cadangan Offline)
    let allTracks = JSON.parse(localStorage.getItem('golf_tracks') || '[]');
    allTracks.push(newEntry);
    localStorage.setItem('golf_tracks', JSON.stringify(allTracks));

    // 5. SIMPAN KE SUPABASE (MODIFIKASI SYNC)
    // 5. SIMPAN KE SUPABASE (DENGAN MERCHANT_ID)
if (currentUser) {
    try {
        const { error } = await sb
            .from('tracks')
            .insert([{
                user_id: currentUser.id,
                merchant_id: currentMerchantId, // <--- TAMBAHKAN INI
                round_id: String(sessionRoundId),
                hole_number: parseInt(newEntry.hole),
                par: newEntry.par,
                strokes: newEntry.strokes,
                score_term: newEntry.scoreTerm,
                points: newEntry.points 
            }]);

            if (error) throw error;
            console.log("Synchronized to Supabase with Round ID:", sessionRoundId);
            
            // Panggil refresh tabel multiplayer agar pemain lain muncul
            if (typeof fetchGroupScores === "function") {
                fetchGroupScores(); 
            }
        } catch (err) {
            console.error("Failed to Cloud:", err.message);
        }
    }

    // Finalisasi UI
    document.getElementById('current-score-text').textContent = `${finalStrokes} Strokes (${scoreTerm})`;
    if (typeof updateSummaryUI === "function") updateSummaryUI();
    
    alert(`Saved to Cloud! (Round: ${sessionRoundId})`);
    clearAll(); // Pastikan fungsi clearAll() Anda sudah ada untuk reset titik di peta
});

//new ronde
// A. Fungsi untuk memulai ronde baru
document.getElementById('newGameBtn').addEventListener('click', () => {
    if (confirm("New Ronde? Score in scorecard will be reset, but tracking log be saved.")) {
        // Buat ID unik baru untuk ronde ini
        const newRoundId = Date.now();
        localStorage.setItem('current_round_id', newRoundId);
        
        // Refresh tampilan (akan jadi NOL karena ID ronde berubah)
        updateSummaryUI();
        
        // Reset UI teks hole saat ini
        document.getElementById('current-score-text').textContent = "-";
        alert("New Ronde Start!");
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
    if (profileChart) {
        profileChart.destroy();
        profileChart = null;
    }
    document.getElementById('chartContainer').style.display = 'none';
}

//--------------------------------------------------------
document.getElementById('historyBtn').addEventListener('click', async () => {
    if (!currentUser) {
        alert("Please login first.");
        return;
    }

    // 1. Deteksi Lapangan Saat Ini
    const currentMerchantId = window.location.hostname.includes('mvg') ? 'MVG' : 'TGR';

    console.log(`Mengambil history untuk: ${currentUser.id} di lapangan ${currentMerchantId}`);

    // 2. MODIFIKASI QUERY: Tambahkan filter merchant_id
    const { data: cloudTracks, error } = await sb
        .from('tracks')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('merchant_id', currentMerchantId) // <--- KUNCI PEMISAH DATA
        .order('created_at', { ascending: false });

    if (error) {
        alert("Failed to load history track: " + error.message);
        return;
    }

    if (!cloudTracks || cloudTracks.length === 0) {
        alert(`No history saved in ${currentMerchantId}.`);
        return;
    }

    // 3. Susun pesan untuk Prompt (Header pesan juga diperjelas)
    let message = `Select history to show in the map - ${currentMerchantId} (type number):\n`;
    cloudTracks.forEach((t, index) => {
        const tDate = new Date(t.created_at).toLocaleString('id-ID');
        message += `${index + 1}. Hole ${t.hole_number} - ${tDate}\n`;
    });

    const choice = prompt(message);
    if (choice === null) return; // User klik cancel

    const index = parseInt(choice) - 1;
    const selected = cloudTracks[index];

    if (selected) {
        clearAll(); 

        // Loop melalui data 'points'
        selected.points.forEach(p => {
            const position = Cesium.Cartesian3.fromDegrees(p.lng || p.lon, p.lat, p.height || 0);
            
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
        
        // Update Kamera
        if (activePoints.length > 0) {
            viewer.zoomTo(activePoints.map(p => p.entity));
        }

        document.getElementById('current-score-text').textContent = 
            `${selected.strokes} Strokes (${selected.score_term || 'N/A'}) - PAR ${selected.par}`;
        
        updateVisuals();
        generateMultiPointProfile(activePoints); 
        alert(`Load Track Hole ${selected.hole_number} (${currentMerchantId})`);
    } else {
        alert("Invalid number selection.");
    }
});

// Fungsi untuk menghapus SEMUA atau SALAH SATU riwayat
async function deleteTrackHistory() {
    if (!currentUser) return alert("Please login first");

    // 1. Deteksi Merchant Saat Ini
    const currentMerchantId = window.location.hostname.includes('mvg') ? 'MVG' : 'TGR';

    // 2. Ambil data HANYA untuk user ini DAN lapangan ini
    const { data: cloudTracks, error } = await sb
        .from('tracks')
        .select('id, hole_number, created_at, merchant_id')
        .eq('user_id', currentUser.id)
        .eq('merchant_id', currentMerchantId) // <-- FILTER WAJIB
        .order('created_at', { ascending: false });

    if (error) return alert("Failed to load data: " + error.message);
    if (!cloudTracks || cloudTracks.length === 0) return alert(`No data to delete at ${currentMerchantId}`);

    let message = `DELETE HISTORY - ${currentMerchantId}\n`;
    message += "Type track number to DELETE (or type 'ALL' to delete ALL in this field):\n";
    
    cloudTracks.forEach((t, index) => {
        const tDate = new Date(t.created_at).toLocaleString('id-ID');
        message += `${index + 1}. Hole ${t.hole_number} - ${tDate}\n`;
    });

    const choice = prompt(message);
    if (choice === null) return;

    if (choice.toUpperCase() === 'ALL') {
        // PERBAIKAN: Hapus ALL hanya untuk merchant ini
        if (confirm(`Clear ALL your data permanently at ${currentMerchantId}?`)) {
            const { error: delError } = await sb
                .from('tracks')
                .delete()
                .eq('user_id', currentUser.id)
                .eq('merchant_id', currentMerchantId); // <-- KUNCI KEAMANAN

            if (delError) alert("Failed to delete: " + delError.message);
            else {
                // Jangan hapus semua golf_tracks di localStorage karena isinya campuran
                // Lebih baik biarkan saja atau filter secara manual
                alert(`All data at ${currentMerchantId} has been deleted.`);
                location.reload();
            }
        }
    } else {
        const index = parseInt(choice) - 1;
        const targetTrack = cloudTracks[index];

        if (targetTrack) {
            if (confirm(`Delete Track Hole ${targetTrack.hole_number} at ${currentMerchantId}?`)) {
                const { error: delError } = await sb
                    .from('tracks')
                    .delete()
                    .eq('id', targetTrack.id)
                    .eq('merchant_id', currentMerchantId); // <-- Keamanan ekstra

                if (delError) alert("Failed to delete: " + delError.message);
                else {
                    alert("Success.");
                    location.reload();
                }
            }
        } else {
            alert("No valid number.");
        }
    }
}

// 8. FUNGSI HAPUS RIWAYAT
// Mengupdate event listener tombol hapus agar sinkron dengan Supabase
document.getElementById('deleteHistoryBtn').addEventListener('click', async () => {
    // Kita panggil fungsi deleteTrackHistory yang sudah mendukung Cloud
    await deleteTrackHistory();
    
    // Setelah dihapus di cloud, bersihkan visual di peta agar tidak membingungkan
    if (typeof clearAll === "function") {
        clearAll();
    }
    
    // Update tabel scorecard agar baris yang dihapus hilang dari layar
    updateSummaryUI();
});

//------------------

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
// Fungsi untuk mengisi data tabel horizontal
function prepareScorecardData() {
    const allTracks = JSON.parse(localStorage.getItem('golf_tracks') || '[]');
    if (allTracks.length === 0) return false;

    // Urutkan data
    allTracks.sort((a, b) => parseInt(a.hole) - parseInt(b.hole));

    const headerRow = document.getElementById('table-header-row');
    const strokesRow = document.getElementById('table-strokes-row');
    const parRow = document.getElementById('table-par-row');

    // Reset isi
    headerRow.innerHTML = '<th>Hole</th>';
    strokesRow.innerHTML = '<td><strong>Strokes</strong></td>';
    parRow.innerHTML = '<td><strong>PAR</strong></td>';

    let tStrokes = 0;
    let tPar = 0;

    allTracks.forEach(t => {
        headerRow.innerHTML += `<th>${t.hole}</th>`;
        strokesRow.innerHTML += `<td>${t.strokes}</td>`;
        parRow.innerHTML += `<td>${t.par}</td>`;
        tStrokes += parseInt(t.strokes);
        tPar += parseInt(t.par);
    });

    // Update angka total untuk PDF
    document.getElementById('total-strokes-pdf').textContent = tStrokes;
    document.getElementById('total-par-pdf').textContent = tPar;
    const diff = tStrokes - tPar;
    document.getElementById('total-diff-pdf').textContent = (diff > 0 ? "+" : "") + diff;
    document.getElementById('pdf-date').textContent = new Date().toLocaleDateString('id-ID');

    return true;
}

// 1. Tombol Lihat Detail (Layar)
// Saat tombol Detail diklik
document.getElementById('viewDetailBtn').addEventListener('click', async () => {
    // Pastikan kita tarik data terbaru dari Supabase dulu
    await fetchGroupScores(); 
    
    // Tampilkan panel detail
    toggleElement('detail-scorecard-container');
    
    // Render tabel di layar (Leaderboard hitam)
    renderMultiplayerTable();
});

// 2. Tombol Export PDF
// Saat tombol PDF diklik
document.getElementById('exportPdfBtn').addEventListener('click', async () => {
    // 1. Tarik data terbaru dulu
    await fetchGroupScores();

    // 2. Siapkan tabel PDF
    const ready = prepareHiddenPdfTable();

    if (ready) {
        const element = document.getElementById('pdf-report-hidden');
        element.style.display = 'block'; // Tampilkan sebentar agar ter-render

        const opt = {
            margin:       0.5,
            filename:     `TerraGOLF_${currentSyncRoundId}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2 },
            jsPDF:        { unit: 'in', format: 'letter', orientation: 'landscape' }
        };

        html2pdf().set(opt).from(element).save().then(() => {
            element.style.display = 'none'; // Sembunyikan lagi
        });
    } else {
        alert("Gagal menyiapkan data PDF. Pastikan data skor sudah masuk.");
    }
});

// FUNGSI TABEL VERTIKAL SEMBUNYI
function prepareHiddenPdfTable() {
    if (!groupData || groupData.length === 0) return false;

    const tbody = document.getElementById('table-body-detail-pdf');
    const thead = document.querySelector('#pdf-report-hidden table thead');
    const pdfRoundIdElem = document.getElementById('pdf-round-id');
    
    if (!tbody || !thead) return false;

    // 1. Set Round ID di Header PDF
    if (pdfRoundIdElem) {
        pdfRoundIdElem.textContent = currentSyncRoundId || "Personal Round";
    }

    const players = [...new Set(groupData.map(item => item.profiles?.full_name || 'Golfer'))];
    let playerTotals = players.map(() => 0);
    let totalParAccumulator = 0; // Variabel penampung Total PAR

    // 2. Render Header PDF
    thead.innerHTML = `
        <tr style="background: #1a472a; color: white;">
            <th style="border: 1px solid #ddd; padding: 8px;">Hole</th>
            <th style="border: 1px solid #ddd; padding: 8px;">PAR</th>
            ${players.map(p => `<th style="border: 1px solid #ddd; padding: 8px;">${p}</th>`).join('')}
        </tr>
    `;

    // 3. Render Baris Hole 1 - 18
    let rowsHtml = "";
    for (let h = 1; h <= 18; h++) {
        const holeEntries = groupData.filter(s => s.hole_number === h);
        const parVal = holeEntries.length > 0 ? parseInt(holeEntries[0].par) : 0;
        
        // Tambahkan ke total PAR
        totalParAccumulator += parVal;

        rowsHtml += `<tr>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${h}</td>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${parVal || '-'}</td>`;

        players.forEach((p, index) => {
            const pScore = groupData.find(s => s.hole_number === h && s.profiles?.full_name === p);
            const strokes = pScore ? parseInt(pScore.strokes) : 0;
            playerTotals[index] += strokes;
            rowsHtml += `<td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${strokes || '-'}</td>`;
        });

        rowsHtml += `</tr>`;
    }

    // 4. Tambahkan Baris TOTAL di paling bawah (Termasuk Total PAR)
    rowsHtml += `
        <tr style="background: #f2f2f2; font-weight: bold;">
            <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">TOTAL</td>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${totalParAccumulator}</td>
            ${playerTotals.map(t => `<td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${t}</td>`).join('')}
        </tr>`;

    tbody.innerHTML = rowsHtml;
    return true;
}

//-----------------------------------------
// REGISTER
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
document.getElementById('auth-primary-btn').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-pass').value;
    const fullName = document.getElementById('auth-name').value;

    try {
        if (isRegisterMode) {
            const { data, error } = await sb.auth.signUp({
                email, password: pass,
                options: { data: { full_name: fullName } }
            });
            if (error) throw error;
            alert("Success, Please Login.");
        } else {
            const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
            if (error) throw error;

            console.log("Login sukses!");
            // Sembunyikan overlay secara manual dulu sebelum reload
            document.getElementById('auth-overlay').style.display = 'none';
            
            // Reload hanya jika perlu untuk refresh state
            window.location.reload();
        }
    } catch (err) {
        alert("Message: " + err.message);
        console.error(err);
    }
});


// 3. Fungsi Tombol Logout
document.getElementById('logoutBtn').addEventListener('click', async () => {
    if (confirm("Are you sure you want to logout?")) {
        try {
            // 1. Perintah resmi ke Supabase untuk menghapus sesi
            const { error } = await sb.auth.signOut();
            
            if (error) throw error;

            // 2. Bersihkan sisa-sisa data di LocalStorage (opsional tapi disarankan)
            localStorage.clear(); 

            // 3. Reset variabel global aplikasi
            currentUser = null;
            activePoints = [];

            alert("You have successfully logout.");
            
            // 4. Refresh halaman untuk kembali ke layar login (Overlay)
            location.reload();
            
        } catch (err) {
            console.error("Failed logout:", err.message);
            alert("An error occurred while logout: " + err.message);
        }
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
                alert("Activated your GPS device.");
            },
            {
                enableHighAccuracy: true, // Wajib TRUE untuk akurasi lapangan golf
                maximumAge: 1000,
                timeout: 5000
            }
        );
    } else {
        alert("Device does not support GPS.");
    }
}
//fungsi user marker GPS device
function updateUserMarker(lat, lon) {
    const position = Cesium.Cartesian3.fromDegrees(lon, lat,0);

    if (!userLocationMarker) {
        // Jika belum ada, buat marker baru (Warna Biru)
        userLocationMarker = viewer.entities.add({
            position: position,
            point: {
                pixelSize: 15,
                color: Cesium.Color.BLUE,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 3,
                disableDepthTestDistance: Number.POSITIVE_INFINITY, 
                heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND
            },
            label: {
                text: "Golfer",
                font: "12px sans-serif",
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -20),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
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
        alert("Find GPS Signal...");
        startGpsTracking();
    }
});

//------------
async function saveScoreToCloud(hole, par, strokes, term) {
    if (!currentUser) return;

    // Tambahkan deteksi merchant
    const currentMerchantId = window.location.hostname.includes('mvg') ? 'MVG' : 'TGR';

    const { error } = await sb
        .from('tracks')
        .insert([{
            user_id: currentUser.id,
            merchant_id: currentMerchantId, // <--- TAMBAHKAN INI
            round_id: localStorage.getItem('current_round_id'),
            hole_number: parseInt(hole),
            par: par,
            strokes: strokes,
            score_term: term,
            points: { lat: userLat, lon: userLon } 
        }]);

    if (error) console.error("Gagal Sync:", error.message);
    else console.log("Data tersimpan di Cloud!");
}

// supabase access
async function checkAccess() {
    const { data: { session } } = await sb.auth.getSession();
    const overlay = document.getElementById('auth-overlay');
    if (!session) { overlay.style.display = 'flex'; return; }

    const currentMerchantId = window.location.hostname.includes('mvg') ? 'MVG' : 'TGR';

    // 1. Ambil/Buat Profil
    let { data: profile } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (!profile) {
        const metaName = session.user.user_metadata?.full_name || "Golfer";
        const { data: newProf } = await sb.from('profiles').insert([{ id: session.user.id, full_name: metaName }]).select().single();
        profile = newProf;
    }
    currentUser = profile;
    if (document.getElementById('display-user-name')) document.getElementById('display-user-name').textContent = profile.full_name;

    // 2. Cek/Buat Subscription (Trial Otomatis per Lapangan)
    let { data: sub } = await sb.from('subscriptions')
        .select('*').eq('user_id', session.user.id).eq('merchant_id', currentMerchantId).maybeSingle();

    if (!sub) {
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 7);
        const { data: newSub } = await sb.from('subscriptions').insert([{
            user_id: session.user.id,
            merchant_id: currentMerchantId,
            status: 'ACTIVE',
            is_paid: false,
            valid_until: expiry.toISOString()
        }]).select().single();
        sub = newSub;
    }

    // 3. Logika Akses & Info Sisa Trial
    const today = new Date();
    const expiryDate = new Date(sub.valid_until);
    const isValid = expiryDate > today;

    if (isValid) {
        overlay.style.display = 'none';
        const badge = document.getElementById('user-status-badge');
        const trialInfo = document.getElementById('trial-info-text');

        if (sub.is_paid) {
            if (badge) { badge.textContent = "PRO"; badge.style.backgroundColor = "#00ff88"; }
            if (trialInfo) trialInfo.style.display = 'none';
        } else {
            const diffDays = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
            if (badge) { badge.textContent = "TRIAL"; badge.style.backgroundColor = "#555"; }
            if (trialInfo) {
                trialInfo.style.display = 'block';
                trialInfo.textContent = `Trial ${currentMerchantId} sisa ${diffDays} hari.`;
                trialInfo.style.color = diffDays <= 2 ? "red" : "white";
            }
        }
        if (typeof loadTracksFromCloud === "function") loadTracksFromCloud();
    } else {
        lockUI(session.user.email, currentMerchantId);
    }
}

// Fungsi pembantu untuk merender tampilan terkunci
function lockUI(email, merchantId) {
    const overlay = document.getElementById('auth-overlay');
    overlay.style.display = 'flex';
    
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    if (title) title.textContent = "Akses Terkunci";
    if (subtitle) subtitle.innerHTML = `Masa trial habis. Silakan aktivasi khusus untuk lapangan <b>${merchantId}</b> untuk melanjutkan.`;
    
    if (document.getElementById('auth-email')) document.getElementById('auth-email').style.display = 'none';
    if (document.getElementById('auth-pass')) document.getElementById('auth-pass').style.display = 'none';
    
    const btnContainer = document.getElementById('auth-primary-btn').parentElement;
    btnContainer.innerHTML = ''; 

    const btnXendit = document.createElement('button');
    btnXendit.className = "auth-btn";
    btnXendit.style.backgroundColor = "#00ff88";
    btnXendit.style.color = "#000";
    btnXendit.style.fontWeight = "bold";
    btnXendit.textContent = `Activate ${merchantId} (Instant)`;
    
    // Saat diklik, startXenditPayment akan mengirimkan merchantId yang benar
    btnXendit.onclick = () => startXenditPayment(currentUser);
    btnContainer.appendChild(btnXendit);
}
checkAccess();

// akses Xendit Payment
async function startXenditPayment(userProfile) {
    // 1. Deteksi Lapangan secara otomatis berdasarkan Domain
    let merchantId = 'TGR'; // Default
    if (window.location.hostname.includes('mvg')) {
        merchantId = 'MVG';
    }

    // 2. Ambil email dari auth
    const { data: { user } } = await sb.auth.getUser();
    const userEmail = user?.email;

    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."; // Pakai Key Anda

    if (!userEmail) {
        alert("Email tidak ditemukan. Silakan login kembali.");
        return;
    }

    try {
        const response = await fetch('https://jltjrfhbreswadzlexzg.supabase.co/functions/v1/xendit-payment', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({
                userId: userProfile.id,
                email: userEmail,
                fullName: userProfile.full_name || "Golfer",
                merchantId: merchantId // <--- SEKARANG INI TERKIRIM KE SUPABASE
            })
        });

        const data = await response.json();
        
        if (data.invoice_url) {
            window.location.href = data.invoice_url;
        } else {
            console.error("Xendit Error:", data);
            alert("Gagal: " + (data.error || data.message || "Respon tidak valid"));
        }

    } catch (err) {
        console.error("Detail Error:", err);
        alert("Gagal menghubungi server: " + err.message);
    }
}

// akses any device
async function loadTracksFromCloud() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;

    // 1. Identifikasi lapangan saat ini
    const currentMerchantId = window.location.hostname.includes('mvg') ? 'MVG' : 'TGR';

    // 2. Tambahkan .eq('merchant_id', ...) pada query
    const { data: tracks, error } = await sb
        .from('tracks')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('merchant_id', currentMerchantId) // <-- INI WAJIB ADA
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Gagal filter history:", error.message);
        return;
    }

    // Jalankan fungsi render UI Anda dengan data yang sudah difilter
    renderHistoryUI(tracks); 
}

// Fungsi universal untuk buka/tutup elemen
function toggleElement(elementId) {
    const el = document.getElementById(elementId);
    if (el.style.display === "none" || el.style.display === "") {
        el.style.display = "block";
    } else {
        el.style.display = "none";
    }
}

//
// Event listener untuk tombol scorecard
document.getElementById('toggleScorecardBtn').addEventListener('click', () => {
    toggleElement('score-summary-container');
});

//back web
document.getElementById('backToWebBtn').addEventListener('click', () => {
    // Arahkan ke website utama Squarespace kamu
    window.location.href = 'https://www.obsluzivo.com/terra-golf';
});

//on off tombol2 agar bersih
function toggleElement(id) {
    const el = document.getElementById(id);
    if (!el) return;

    if (el.style.display === 'none' || el.style.display === '') {
        el.style.display = 'block';
        
        // JIKA sedang membuka Scorecard, sembunyikan tombol navigasi
        if (id === 'score-summary-container') {
            setNavButtonsDisplay('none');
        }
    } else {
        el.style.display = 'none';
        
        // JIKA sedang menutup Scorecard, munculkan KEMBALI tombol navigasi
        if (id === 'score-summary-container') {
            setNavButtonsDisplay('block');
        }
    }
}

// Fungsi pembantu agar kode lebih bersih (Helper Function)
function setNavButtonsDisplay(status) {
    const buttons = ['undoBtn', 'saveTrackBtn', 'deleteHistoryBtn','contourBtn','historyBtn','clearBtn'];
    buttons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) btn.style.display = status;
    });
}

// Cetak Histori Berdasarkan ROUND
// 1. Fungsi Utama Cetak (Pastikan nama tabel sesuai database: 'trackers')
async function printRoundFromSupabase(targetRoundId) {
    try {
        console.log("Fetching Group Details for Round:", targetRoundId);
        
        // Ambil data semua pemain di round tersebut
        const { data: scores, error } = await sb
            .from('tracks')
            .select('*, profiles(full_name)')
            .eq('round_id', targetRoundId)
            .order('hole_number', { ascending: true });

        if (error) throw error;
        if (!scores || scores.length === 0) return alert("Data tidak ditemukan.");

        // Ambil daftar pemain unik dalam grup ini
        const players = [...new Set(scores.map(s => s.profiles?.full_name || 'Anonim'))];

        // 1. Siapkan Header Tabel PDF (Dinamis sesuai jumlah pemain)
        const thead = document.querySelector('#pdf-report-hidden thead');
        thead.innerHTML = `
            <tr style="background: #1a472a; color: white;">
                <th style="border: 1px solid #ddd; padding: 8px;">Hole</th>
                <th style="border: 1px solid #ddd; padding: 8px;">PAR</th>
                ${players.map(p => `<th style="border: 1px solid #ddd; padding: 8px;">${p}</th>`).join('')}
            </tr>`;

        // 2. Isi Body Tabel
        const tbody = document.getElementById('table-body-detail-pdf');
        tbody.innerHTML = "";

        for (let h = 1; h <= 18; h++) {
            let holeData = scores.find(s => s.hole_number === h);
            let parVal = holeData ? holeData.par : '-';
            
            let rowHtml = `<tr>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${h}</td>
                <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${parVal}</td>`;
            
            players.forEach(p => {
                const pScore = scores.find(s => s.hole_number === h && s.profiles?.full_name === p);
                rowHtml += `<td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${pScore ? pScore.strokes : '-'}</td>`;
            });

            rowHtml += `</tr>`;
            tbody.innerHTML += rowHtml;
        }

        // 3. Update Identitas di PDF
        // Mengambil ID untuk tampilan (Hapus "pribadi-" jika ada)
        const displayID = targetRoundId.replace('pribadi-', 'Session: ');
        
        const roundDisplayElem = document.getElementById('pdf-round-id');
        if (roundDisplayElem) roundDisplayElem.textContent = displayID;

        const playerDisplayElem = document.getElementById('pdf-player-name');
        if (playerDisplayElem) playerDisplayElem.textContent = players.join(' & ');

        // Logika Tanggal: Jika ID bukan angka (timestamp), gunakan created_at dari data pertama
        let displayDate = "";
        if (!isNaN(targetRoundId)) {
            displayDate = new Date(parseInt(targetRoundId)).toLocaleDateString('id-ID');
        } else {
            displayDate = scores[0].created_at ? new Date(scores[0].created_at).toLocaleDateString('id-ID') : new Date().toLocaleDateString('id-ID');
        }
        
        const dateElem = document.getElementById('pdf-date');
        if (dateElem) dateElem.textContent = "Date: " + displayDate;

        // 4. Jalankan Cetak PDF
        const element = document.getElementById('pdf-report-hidden');
        element.style.display = "block";
        
        const opt = {
            margin: 0.3,
            filename: `Scorecard_Group_${targetRoundId}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' } // Landscape agar kolom muat
        };

        html2pdf().set(opt).from(element).save().then(() => {
            element.style.display = "none";
        });

    } catch (err) {
        console.error(err);
        alert("Gagal cetak: " + err.message);
    }
}
window.printRoundFromSupabase = printRoundFromSupabase;

// 2. Fungsi Menampilkan Daftar Ronde (Gunakan Modal, Hindari Prompt)
async function showHistoryRounds() {
    try {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return alert("Sesi login tidak ditemukan.");

        // Langsung tampilkan modal tanpa tanya-tanya lagi
        toggleElement('history-modal');
        const listContainer = document.getElementById('history-list-container');
        listContainer.innerHTML = "<p style='color: #00ff88; font-size: 0.8rem;'>Sinkronisasi Cloud...</p>";

        const { data, error } = await sb
            .from('tracks')
            .select('round_id, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Filter unik round_id
        const uniqueRounds = [...new Map(data.map(item => [item.round_id, item])).values()];

        if (uniqueRounds.length === 0) {
            listContainer.innerHTML = "<p style='color:#ccc;'>Belum ada data histori.</p>";
            return;
        }

        listContainer.innerHTML = "";
        uniqueRounds.forEach(round => {
            const dateObj = new Date(parseInt(round.round_id) || round.created_at);
            const dateStr = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

            const item = document.createElement('div');
            item.className = "history-item-row"; 
            item.style = "background: rgba(255,255,255,0.05);padding: 12px; margin-bottom: 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #333;";
            
            item.innerHTML = `
                <div>
                    <div style="font-size: 0.9rem; font-weight: bold; color: white;">${dateStr}</div>
                    <div style="font-size: 0.7rem; color: #888;">Jam ${timeStr} WIB</div>
                </div>
                <button class="btn-print-action" data-roundid="${round.round_id}" 
                        style="background: #27ae60; color: white; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: bold;">
                    PRINT
                </button>
            `;
            listContainer.appendChild(item);
        });

    } catch (err) {
        console.error(err);
        alert("Gagal memuat histori.");
    }
}

// Hubungkan tombol utama ke fungsi modal
//document.getElementById('btnHistoryRounds').addEventListener('click', showHistoryRounds);

// Menangani klik pada tombol cetak di dalam modal (Event Delegation)
document.addEventListener('click', function (e) {
    if (e.target && e.target.classList.contains('btn-print-history')) {
        const targetRoundId = e.target.getAttribute('data-id');
        console.log("Tombol ditekan untuk ID:", targetRoundId);
        
        // Panggil fungsi cetak
        printRoundFromSupabase(targetRoundId);
    }
});


// Menangani klik tombol Cetak di dalam modal
document.addEventListener('click', function(e) {
    if (e.target && e.target.classList.contains('btn-print-action')) {
        const rid = e.target.getAttribute('data-roundid');
        printRoundFromSupabase(rid);
    }
});


//-------------------
// PELANGGAN PRREMIUM
async function activatePremium(userId) {
    const { data, error } = await sb
      .from('profiles')
      .update({ 
          is_paid: true, 
          valid_until: new Date(new Date().setMonth(new Date().getMonth() + 1)) 
      })
      .eq('id', userId);
      
    if (!error) alert("Selamat! TerraGOLF Anda sekarang Premium.");
}

//MULTIPLE PLAYER
async function syncMultiplayer() {
    const inputId = document.getElementById('roundIdInput').value;
    if (!inputId) return Swal.fire('Info', 'Masukkan Round ID', 'info');

    // 1. ISI VARIABEL GLOBAL INI TERLEBIH DAHULU
    currentSyncRoundId = inputId; 
    localStorage.setItem('active_round_id', inputId);

    // 2. Baru panggil fungsi tarik data
    await fetchGroupScores();

    Swal.fire({ icon: 'success', title: 'Synced!', text: `Round: ${currentSyncRoundId}`, timer: 1500 });
}

async function fetchGroupScores() {
    const roundId = document.getElementById('roundIdInput').value || currentSyncRoundId;
    if (!roundId) return;

    try {
        // 1. Ambil data tracks
        const { data: trackData, error: trackError } = await sb
            .from('tracks')
            .select('*')
            .eq('round_id', roundId)
            .order('hole_number', { ascending: true });

        if (trackError) throw trackError;

        // 2. Ambil data profiles (pastikan mengambil semua yang terlibat)
        const { data: profileData, error: profileError } = await sb
            .from('profiles')
            .select('id, full_name');

        if (profileError) throw profileError;

        // 3. Gabungkan manual dengan pembersihan string (trim)
        groupData = trackData.map(t => {
            // Pastikan perbandingan ID mengabaikan spasi atau perbedaan tipe data
            const userProfile = profileData.find(p => String(p.id).trim() === String(t.user_id).trim());
            return {
                ...t,
                profiles: { 
                    full_name: userProfile ? userProfile.full_name : 'User ' + String(t.user_id).substring(0,4)
                }
            };
        });

        console.log("Data Gabungan:", groupData);
        
        // Render ke UI
        renderMultiplayerTable();

    } catch (err) {
        console.error("Gagal tarik data:", err.message);
    }
}


function renderMultiplayerTable() {
    const thead = document.getElementById('multi-thead');
    const tbody = document.getElementById('multi-tbody');
    const roundDisplay = document.getElementById('active-round-display');
    // 1. Tampilkan Nama Round di Header
    if (roundDisplay) {
        roundDisplay.textContent = currentSyncRoundId || "-";
    }

    if (!tbody || !groupData || groupData.length === 0) {
        if(tbody) tbody.innerHTML = "<tr><td colspan='4' style='color:white; padding:10px;'>Menunggu data skor...</td></tr>";
        return;
    }

    const players = [...new Set(groupData.map(item => item.profiles?.full_name || 'Anonim'))];
    let playerTotals = players.map(() => 0);
    let totalParSemuaHole = 0; // VARIABEL BARU UNTUK TOTAL PAR

    // 1. Render Header
    let headerHtml = `<tr style="background: #1a472a; color: white;">
                        <th style="padding: 8px; border: 1px solid #444;">Hole</th>
                        <th style="padding: 8px; border: 1px solid #444;">PAR</th>`;
    players.forEach(p => {
        headerHtml += `<th style="padding: 8px; border: 1px solid #444; color: #00ff88;">${p}</th>`;
    });
    headerHtml += `</tr>`;
    thead.innerHTML = headerHtml;

    // 2. Render Body (Hole 1-18)
    let bodyHtml = '';
    for (let h = 1; h <= 18; h++) {
        const holeScores = groupData.filter(s => s.hole_number === h);
        const parVal = holeScores.length > 0 ? parseInt(holeScores[0].par) : 0;
        
        // Tambahkan par hole ini ke total akumulasi
        totalParSemuaHole += parVal; 

        bodyHtml += `<tr style="border-bottom: 1px solid #333;">
                        <td style="padding: 6px; text-align: center; color: #aaa;">${h}</td>
                        <td style="padding: 6px; text-align: center; color: white;">${parVal || '-'}</td>`;
        
        players.forEach((player, idx) => {
            const scoreEntry = groupData.find(s => s.hole_number === h && s.profiles?.full_name === player);
            const strokes = scoreEntry ? parseInt(scoreEntry.strokes) : 0;
            playerTotals[idx] += strokes;
            
            bodyHtml += `<td style="padding: 6px; text-align: center; color: #00ff88;">${strokes || '-'}</td>`;
        });
        bodyHtml += `</tr>`;
    }

    // 3. Render Footer (TOTAL)
    // Sekarang kolom PAR akan menampilkan totalParSemuaHole
    let footerHtml = `<tr style="background: rgba(0,255,136,0.1); font-weight: bold; border-top: 2px solid #00ff88;">
                        <td style="padding: 10px; text-align: center; color: #fff;">TOTAL</td>
                        <td style="padding: 10px; text-align: center; color: #fff;">${totalParSemuaHole}</td>`; // TOTAL PAR DI SINI
    
    playerTotals.forEach(total => {
        footerHtml += `<td style="padding: 10px; text-align: center; color: #00ff88;">${total}</td>`;
    });
    footerHtml += `</tr>`;

    tbody.innerHTML = bodyHtml + footerHtml;
}

// EKSPORT GRUP
function exportGroupPdf() {
    const element = document.getElementById('pdf-report-hidden');
    element.style.display = 'block';
    
    document.getElementById('pdf-round-id').innerText = currentSyncRoundId || 'Single Round';
    document.getElementById('pdf-date-multi').innerText = new Date().toLocaleDateString();

    // Re-use tabel dari leaderboard multiplayer ke dalam PDF
    const container = document.getElementById('pdf-tables-container');
    container.innerHTML = document.getElementById('detail-scorecard-container').innerHTML;

    const opt = {
        margin: 10,
        filename: `TerraGOLF_Report_${currentSyncRoundId}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        element.style.display = 'none';
    });
}

//-----------------
// Mengambil ID Lapangan dari Environment Variable Vercel
// Gunakan Env Variable Vercel (NEXT_PUBLIC_MERCHANT_ID)

//const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID; 
async function checkout() {
  const { data, error } = await supabase.functions.invoke('xendit-payment', {
    body: { 
      merchantId: 'TGR', // Contoh: 'TGR'
      userId: user.id,
      email: user.email,
      fullName: user.user_metadata.full_name
    }
  });

  if (data?.invoice_url) {
    window.location.href = data.invoice_url;
  }
}

//---------------------------Versi 2 --------------------------
// Tambah FUngsi-Fungsi
//-----------------------------------------------------------
// Fungsi AI Advisor
// 1. Fungsi Pencari Stik (Helper)
function getClubRecommendation(effectiveDist) {
    const clubs = [
        { name: "Driver", min: 210, max: 1000, tip: "Fokus pada akurasi, bukan tenaga." },
        { name: "3-Wood", min: 190, max: 210, tip: "Gunakan jika fairway cukup lebar." },
        { name: "Hybrid", min: 175, max: 190, tip: "Pastikan ball-strike yang bersih." },
        { name: "Iron 4", min: 165, max: 175, tip: "Penetrasi udara rendah, cocok untuk angin kencang." },
        { name: "Iron 5", min: 155, max: 165, tip: "Ayunkan dengan ritme yang konsisten." },
        { name: "Iron 6", min: 145, max: 155, tip: "Kontrol arah lebih utama dari jarak." },
        { name: "Iron 7", min: 135, max: 145, tip: "Targetkan area aman di Green." },
        { name: "Iron 8", min: 125, max: 135, tip: "Gunakan untuk flight bola yang lebih tinggi." },
        { name: "Iron 9", min: 115, max: 125, tip: "Waktunya menyerang pin!" },
        { name: "Pitching Wedge", min: 100, max: 115, tip: "Kontrol kekuatan swing Anda." },
        { name: "Gap Wedge", min: 85, max: 100, tip: "Cari pendaratan di dekat hole." },
        { name: "Sand Wedge", min: 70, max: 85, tip: "Fokus pada landing spot." },
        { name: "Lob Wedge", min: 0, max: 70, tip: "Kontrol spin sangat penting di sini." }
    ];

    const suggestion = clubs.find(c => effectiveDist >= c.min && effectiveDist < c.max);
    return suggestion ? suggestion : { name: "Putter", tip: "Gunakan jika bola sudah di tepi green." };
}

// 2. Fungsi Utama AI Advisor yang digabung
function runAiAdvisor() {
    if (activePoints.length < 2) {
        Swal.fire("Info", "Tentukan dulu titik posisi dan target pada peta.", "info");
        return;
    }

    const lastIdx = activePoints.length - 1;
    const pStart = activePoints[lastIdx - 1].position;
    const pEnd = activePoints[lastIdx].position;
    
    const cStart = Cesium.Cartographic.fromCartesian(pStart);
    const cEnd = Cesium.Cartographic.fromCartesian(pEnd);

    const dist = Cesium.Cartesian3.distance(pStart, pEnd);
    const deltaH = cEnd.height - cStart.height;
    
    // Hitung Jarak Efektif
    const effectiveDist = dist + (deltaH * 1.5);

    // MEMANGGIL FUNGSI REKOMENDASI (Pengganti if-else)
    const recommendation = getClubRecommendation(effectiveDist);

    Swal.fire({
        title: '<span style="color: #00ff88;">AI Caddy Advisor</span>',
        background: '#1a1a1a',
        color: '#ffffff',
        html: `
            <div style="text-align: left; border: 1px solid #444; padding: 15px; border-radius: 10px;">
                <p style="margin: 5px 0;">📍 Jarak Langsung: <b>${dist.toFixed(1)} m</b></p>
                <p style="margin: 5px 0;">⛰️ Beda Tinggi: <b style="color: ${deltaH >= 0 ? '#ff4444' : '#00ff88'};">${deltaH.toFixed(1)} m (${deltaH >= 0 ? 'Tanjakan' : 'Turunan'})</b></p>
                <hr style="border-color: #444;">
                <p style="font-size: 1.1rem;">🎯 Jarak Efektif: <b style="color: #00ff88;">${effectiveDist.toFixed(1)} m</b></p>
                <div style="margin-top: 15px; background: #333; padding: 10px; border-radius: 5px; text-align: center;">
                    <small>Gunakan Stik:</small><br>
                    <strong style="font-size: 1.6rem; color: #ffeb3b;">${recommendation.name}</strong>
                </div>
                <p style="margin-top: 10px; font-style: italic; font-size: 0.8rem; color: #bbb;">💡 Tip: ${recommendation.tip}</p>
            </div>
        `,
        confirmButtonText: 'Terima Kasih, Caddy!',
        confirmButtonColor: '#27ae60'
    });
}

//---------------------------------------
// Fungsi Cuaca sesuai dengan lokasi Lapangan
const _partA = '3a40adebae12';  //3a40adebae12f302a5a5702582c7d5f2
const _partB = 'f302a5a5702582';
const _partC = 'c7d5f2';

async function getRealWeather() {
    // Tampilkan loading sebentar selagi mengambil data
    Swal.fire({
        title: 'Retrieving weather data...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    const apiKey = _partA+_partB+_partC;
    
    // Koordinat Dago Heritage (bisa dinamis sesuai GPS user nantinya) 107.6258056, -6.8698692729
    const lat = -6.8698692729; 
    const lon = 107.6258056;

    try {
        const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=id`);
        const data = await response.json();

        if (response.ok) {
            const windSpeed = (data.wind.speed * 3.6).toFixed(1); // Konversi m/s ke km/jam
            const windDeg = data.wind.deg; // Arah angin dalam derajat
            const temp = data.main.temp;
            const humidity = data.main.humidity;
            const desc = data.weather[0].description;

            Swal.fire({
                title: 'Condition of Dago Heritage',
                html: `
                    <div style="text-align: left; font-size: 0.9rem;">
                        <p>🌤️ <b>Condition:</b> ${desc}</p>
                        <p>🌡️ <b>Temperature:</b> ${temp}°C</p>
                        <p>🌬️ <b>Wind Speed:</b> ${windSpeed} km/jam</p>
                        <p>🧭 <b>Wind Direction:</b> ${windDeg}° (from North)</p>
                        <p>💧 <b>Humidity:</b> ${humidity}%</p>
                        <hr>
                        <small style="color: #666;">*Data update otomatis via OpenWeather</small>
                    </div>
                `,
                icon: 'success',
                confirmButtonColor: '#27ae60'
            });
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        Swal.fire('Gagal', 'Tidak dapat mengambil data cuaca: ' + error.message, 'error');
    }
}

//----------------------compas
//
let isCompassRunning = false;

function startCompass() {
    if (!window.DeviceOrientationEvent) {
        Swal.fire("Error", "Perangkat tidak mendukung sensor arah.", "error");
        return;
    }

    // Request permission untuk iOS 13+
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    activateListeners();
                }
            })
            .catch(err => console.error("iOS Permission Error:", err));
    } else {
        // Android dan browser lain
        activateListeners();
    }
}

function activateListeners() {
    // Android Chrome seringkali hanya mengirim data lewat event 'deviceorientationabsolute'
    if ('ondeviceorientationabsolute' in window) {
        window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    } else {
        window.addEventListener('deviceorientation', handleOrientation, true);
    }
    isCompassRunning = true;
    console.log("Compass listeners activated");
}

function handleOrientation(event) {
    let heading = 0;

    // Cek data dari iOS
    if (event.webkitCompassHeading) {
        heading = event.webkitCompassHeading;
    } 
    // Cek data dari Android (alpha adalah rotasi z-axis)
    else if (event.alpha !== null) {
        // Untuk Android, alpha biasanya dimulai dari 0 saat aplikasi dibuka.
        // Jika event.absolute true, maka 0 adalah Utara sejati.
        heading = 360 - event.alpha;
    }

    if (heading !== 0) {
        const icon = document.getElementById('compassIcon');
        const text = document.getElementById('directionText');
        
        // Update rotasi ikon
        icon.style.transform = `rotate(${-heading}deg)`;

        // Update teks label
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const index = Math.round(heading / 45) % 8;
        text.innerText = directions[index];
    }
}

function stopCompass() {
    window.removeEventListener('deviceorientation', handleOrientation);
    window.removeEventListener('deviceorientationabsolute', handleOrientation);
}

//-------------end compas ----------------------------