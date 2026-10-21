// --- Register PWA Service Worker ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// --- Configuration ---
const DEVICE_ID = "19919656-2562-4e5d-a970-60bb4f34068b";
const PRODUCT_SLUG = "linescale-3-lte";
const BROKER_URL = "wss://l081104a.ala.eu-central-1.emqxsl.com:8084/mqtt";
const TOPIC_UPLINK = `dtck-pub/${PRODUCT_SLUG}/${DEVICE_ID}/DATA`;
const TOPIC_DOWNLINK = `dtck/${PRODUCT_SLUG}/${DEVICE_ID}/CMD`;

// --- UI Elements ---
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const elTension = document.getElementById('valTension');
const elPeak = document.getElementById('valPeak');
const elLs3Bat = document.getElementById('valLs3Bat');
const elGwBat = document.getElementById('valGwBat');

let isFastRate = true;
let client = null;

// Tracking Variables
let lastKnownUnit = 'kN';
let chartRawHistory = []; // Array of { time: string, value: number, unit: string }
let targetChartUnit = "kN";

// Persist the highest peak in the browser's local storage (stored universally as kN)
let frontendMaxPeakKn = parseFloat(localStorage.getItem('ls3_max_peak_kn')) || 0;

// --- Unit Conversion Helpers ---
function convertTension(val, fromUnit, toUnit) {
  if (fromUnit === toUnit) return val;
  
  // First convert to kN (base value)
  let valInKn = val;
  if (fromUnit === 'kgf') valInKn = val / 101.9716;
  else if (fromUnit === 'lbf') valInKn = val / 224.8089;

  // Convert kN to target unit
  if (toUnit === 'kgf') return valInKn * 101.9716;
  if (toUnit === 'lbf') return valInKn * 224.8089;
  return valInKn; // kN
}

// --- Chart Setup ---
const ctx = document.getElementById('tensionChart').getContext('2d');
const tensionChart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [{
      data: [],
      borderColor: '#60a5fa',
      backgroundColor: 'rgba(96, 165, 250, 0.1)',
      borderWidth: 2,
      pointRadius: 2,
      fill: true,
      tension: 0.2
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: { display: false },
      y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', font: { size: 10 } } }
    },
    plugins: {
      legend: { display: false },
      zoom: { pan: { enabled: true, mode: 'x' }, zoom: { pinch: { enabled: true }, wheel: { enabled: true }, mode: 'x' } }
    }
  }
});

window.resetZoom = () => tensionChart.resetZoom();

window.changeChartUnit = (newUnit) => {
  targetChartUnit = newUnit;
  rebuildChart();
};

function rebuildChart() {
  tensionChart.data.labels = chartRawHistory.map(item => item.time);
  tensionChart.data.datasets[0].data = chartRawHistory.map(item => 
    convertTension(item.value, item.unit, targetChartUnit)
  );
  tensionChart.update('none');
}

function updateChart(tensionValue, unitStr) {
  if (isNaN(tensionValue)) return;
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  chartRawHistory.push({ time: now, value: tensionValue, unit: unitStr });
  if (chartRawHistory.length > 100) chartRawHistory.shift();
  rebuildChart();
}

// --- Authentication & MQTT Engine ---
window.addEventListener('load', () => {
  const savedUser = localStorage.getItem('ls3_mqtt_user');
  const savedPass = localStorage.getItem('ls3_mqtt_pass');
  if (savedUser && savedPass) {
    document.getElementById('inputUser').value = savedUser;
    document.getElementById('inputPass').value = savedPass;
    attemptLogin();
  }
});

window.attemptLogin = function() {
  const user = document.getElementById('inputUser').value.trim();
  const pass = document.getElementById('inputPass').value.trim();
  const btn = document.getElementById('btnLogin');
  const errorMsg = document.getElementById('loginError');
  
  if (!user || !pass) return;

  btn.innerHTML = `<span class="animate-pulse">Connecting...</span>`;
  btn.disabled = true;
  errorMsg.classList.add('hidden');

  const options = {
    clientId: 'MobileUI_' + Math.random().toString(16).substring(2, 8),
    username: user,
    password: pass,
    clean: true,
    reconnectPeriod: 0,
  };

  if (client) client.end();
  client = mqtt.connect(BROKER_URL, options);

  client.on('connect', () => {
    document.getElementById('loginScreen').classList.add('hidden');
    localStorage.setItem('ls3_mqtt_user', user);
    localStorage.setItem('ls3_mqtt_pass', pass);
    client.options.reconnectPeriod = 3000;
    
    statusDot.className = "w-3 h-3 rounded-full bg-emerald-500";
    statusText.textContent = "CONNECTED";
    statusText.className = "text-xs font-bold tracking-wider uppercase text-emerald-400";
    client.subscribe(TOPIC_UPLINK);
  });

  client.on('error', (err) => {
    console.error("MQTT Auth Failed:", err);
    btn.innerHTML = `<span>Connect to Broker</span>`;
    btn.disabled = false;
    errorMsg.classList.remove('hidden');
    client.end();
  });

  client.on('message', (topic, message) => {
    if (topic === TOPIC_UPLINK) {
      try {
        const payload = JSON.parse(message.toString());
        
        // 1. Process Current Tension & Detect Scale Unit
        if (payload.tension !== undefined) {
          const rawTensionStr = String(payload.tension).trim();
          const numVal = parseFloat(rawTensionStr);
          
          const unitMatch = rawTensionStr.match(/[a-zA-Z]+/);
          if (unitMatch) {
            const u = unitMatch[0].toLowerCase();
            if (u === 'n' || u === 'kn') lastKnownUnit = 'kN';
            else if (u === 'kg' || u === 'kgf' || u === 'g') lastKnownUnit = 'kgf';
            else if (u === 'lbs' || u === 'lbf' || u === 'lb' || u === 'b') lastKnownUnit = 'lbf';
          }

          if (!isNaN(numVal)) {
            const decimals = (lastKnownUnit === 'kN') ? 2 : 0;
            elTension.innerHTML = `${numVal.toFixed(decimals)} <span class="text-2xl font-normal text-slate-400">${lastKnownUnit}</span>`;
            updateChart(numVal, lastKnownUnit);
          }
        }

        // 2. Process Peak Load & Store Universal High-Water Mark
        if (payload.peak_load !== undefined) {
          const rawPeakStr = String(payload.peak_load).trim();
          const numPeak = parseFloat(rawPeakStr);

          // Find out what unit the ESP32 sent this peak in
          let incomingPeakUnit = 'kN';
          const peakUnitMatch = rawPeakStr.match(/[a-zA-Z]+/);
          if (peakUnitMatch) {
            const u = peakUnitMatch[0].toLowerCase();
            if (u === 'n' || u === 'kn') incomingPeakUnit = 'kN';
            else if (u === 'kg' || u === 'kgf' || u === 'g') incomingPeakUnit = 'kgf';
            else if (u === 'lbs' || u === 'lbf' || u === 'lb' || u === 'b') incomingPeakUnit = 'lbf';
          }

          if (!isNaN(numPeak)) {
            // Convert the incoming peak to pure kN for a safe, universal comparison
            const incomingPeakKn = convertTension(numPeak, incomingPeakUnit, 'kN');
            
            // If the ESP32 caught a higher spike, save it to browser storage
            if (incomingPeakKn > frontendMaxPeakKn) {
              frontendMaxPeakKn = incomingPeakKn;
              localStorage.setItem('ls3_max_peak_kn', frontendMaxPeakKn);
            }
          }
        }

        // 3. Display the highest memorized peak, converted to the scale's current display unit
        const displayPeak = convertTension(frontendMaxPeakKn, 'kN', lastKnownUnit);
        const peakDecimals = (lastKnownUnit === 'kN') ? 3 : 0;
        elPeak.textContent = `${displayPeak.toFixed(peakDecimals)} ${lastKnownUnit}`;

        // 4. Process Batteries
        elLs3Bat.textContent = payload.battery || '--';
        elGwBat.textContent = (payload.module_bat !== undefined) ? `${payload.module_bat}%` : '--';

      } catch (e) {
        console.error("Payload Parse Error:", e);
      }
    }
  });

  client.on('offline', () => {
    statusDot.className = "w-3 h-3 rounded-full bg-red-500 animate-pulse";
    statusText.textContent = "OFFLINE";
    statusText.className = "text-xs font-bold tracking-wider uppercase text-slate-400";
  });
};

window.logout = function() {
  localStorage.removeItem('ls3_mqtt_user');
  localStorage.removeItem('ls3_mqtt_pass');
  if (client) client.end();
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('btnLogin').innerHTML = `<span>Connect to Broker</span>`;
  document.getElementById('btnLogin').disabled = false;
  document.getElementById('inputPass').value = '';
};

// --- Command Handling ---
window.sendCommand = (cmdChar) => {
  if (client && client.connected) {
    client.publish(TOPIC_DOWNLINK, cmdChar, { qos: 1 });

    // When "Clear Peak" is pressed, explicitly reset the browser's memorized peak
    if (cmdChar === 'C') {
      frontendMaxPeakKn = 0;
      localStorage.removeItem('ls3_max_peak_kn');
      
      const peakDecimals = (lastKnownUnit === 'kN') ? 3 : 0;
      elPeak.textContent = `0.${'0'.repeat(peakDecimals)} ${lastKnownUnit}`;
      console.log("Local frontend peak memory cleared.");
    }

  } else {
    alert("MQTT Offline. Please log in first.");
  }
};

window.toggleRate = () => {
  const btn = document.getElementById('btnRate');
  if (isFastRate) {
    sendCommand('S');
    btn.textContent = "Slow 10Hz";
    isFastRate = false;
  } else {
    sendCommand('F');
    btn.textContent = "Fast 40Hz";
    isFastRate = true;
  }
};
