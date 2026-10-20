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
let client = null; // Global MQTT client instance

// --- Chart Setup (Dark Mode & Touch Zoom) ---
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

function updateChart(tensionString) {
  const val = parseFloat(tensionString);
  if (isNaN(val)) return;

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  tensionChart.data.labels.push(now);
  tensionChart.data.datasets[0].data.push(val);

  if (tensionChart.data.labels.length > 100) {
    tensionChart.data.labels.shift();
    tensionChart.data.datasets[0].data.shift();
  }
  tensionChart.update('none');
}

// --- Authentication & MQTT Engine ---

// Check for saved credentials on app open
window.addEventListener('load', () => {
  const savedUser = localStorage.getItem('ls3_mqtt_user');
  const savedPass = localStorage.getItem('ls3_mqtt_pass');
  if (savedUser && savedPass) {
    document.getElementById('inputUser').value = savedUser;
    document.getElementById('inputPass').value = savedPass;
    attemptLogin(); // Auto-login if previously saved
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
    reconnectPeriod: 0, // Disable auto-reconnect if password is wrong
  };

  if (client) {
    client.end(); // Clear any stale connection
  }

  client = mqtt.connect(BROKER_URL, options);

  client.on('connect', () => {
    // Auth Success
    document.getElementById('loginScreen').classList.add('hidden');
    localStorage.setItem('ls3_mqtt_user', user);
    localStorage.setItem('ls3_mqtt_pass', pass);
    
    // Enable auto-reconnect now that auth is verified
    client.options.reconnectPeriod = 3000;
    
    statusDot.className = "w-3 h-3 rounded-full bg-emerald-500";
    statusText.textContent = "CONNECTED";
    statusText.className = "text-xs font-bold tracking-wider uppercase text-emerald-400";
    
    client.subscribe(TOPIC_UPLINK);
  });

  client.on('error', (err) => {
    // Auth Failed
    console.error("MQTT Error (Auth Failed):", err);
    btn.innerHTML = `<span>Connect to Broker</span>`;
    btn.disabled = false;
    errorMsg.classList.remove('hidden');
    client.end();
  });

  client.on('message', (topic, message) => {
    if (topic === TOPIC_UPLINK) {
      try {
        const payload = JSON.parse(message.toString());
        if (payload.tension) {
          elTension.innerHTML = `${payload.tension.replace(/[^\d.-]/g, '')} <span class="text-2xl font-normal text-slate-400">${payload.tension.replace(/[\d.-]/g, '').trim()}</span>`;
          updateChart(payload.tension);
        }
        elPeak.textContent = payload.peak_load || '--';
        elLs3Bat.textContent = payload.battery || '--';
        elGwBat.textContent = (payload.module_bat !== undefined) ? `${payload.module_bat}%` : '--';
      } catch (e) {
        console.error(e);
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
  if (client) {
    client.end();
  }
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('btnLogin').innerHTML = `<span>Connect to Broker</span>`;
  document.getElementById('btnLogin').disabled = false;
  document.getElementById('inputPass').value = '';
};

// --- Command Handling ---
window.sendCommand = (cmdChar) => {
  if (client && client.connected) {
    client.publish(TOPIC_DOWNLINK, cmdChar, { qos: 1 });
  } else {
    alert("MQTT Offline. Please log in first.");
  }
};

window.toggleRate = () => {
  const btn = document.getElementById('btnRate');
  if (isFastRate) {
    sendCommand('S'); // Slow 10Hz
    btn.textContent = "Slow 10Hz";
    isFastRate = false;
  } else {
    sendCommand('F'); // Fast 40Hz
    btn.textContent = "Fast 40Hz";
    isFastRate = true;
  }
};

window.confirmPowerOff = () => {
  if (confirm("Turn off LineScale 3 hardware? You must physically restart the scale afterwards.")) {
    sendCommand('O');
  }
};