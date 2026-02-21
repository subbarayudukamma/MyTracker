/* ============================================================
   Life Tracker — App Logic
   IndexedDB persistence, Mileage & Energy tracking,
   CSV import/export with JSZip
   ============================================================ */

/* ===== CONSTANTS ===== */
const DB_NAME = 'MyTrackerDB';
const DB_VERSION = 1;

/* ===== HELPERS ===== */
const $ = id => document.getElementById(id);

function formatDateLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTimeLocal(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function friendlyDateTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  }) + ' · ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit'
  });
}

function formatNum(n, decimals = 1) {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function setNow(dateId, timeId) {
  const now = new Date();
  $(dateId).value = formatDateLocal(now);
  $(timeId).value = formatTimeLocal(now);
}

/* ===== DATABASE MODULE ===== */
const DB = {
  db: null,

  init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onerror = () => reject(req.error);

      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('cars')) {
          const s = db.createObjectStore('cars', { keyPath: 'id', autoIncrement: true });
          s.createIndex('makeModelYear', ['make', 'model', 'year']);
        }
        if (!db.objectStoreNames.contains('trips')) {
          const s = db.createObjectStore('trips', { keyPath: 'id', autoIncrement: true });
          s.createIndex('carId', 'carId');
          s.createIndex('dateTime', 'dateTime');
        }
        if (!db.objectStoreNames.contains('energy')) {
          const s = db.createObjectStore('energy', { keyPath: 'id', autoIncrement: true });
          s.createIndex('dateTime', 'dateTime');
        }
      };

      req.onsuccess = () => { this.db = req.result; resolve(); };
    });
  },

  _tx(store, mode = 'readonly') {
    const tx = this.db.transaction(store, mode);
    return tx.objectStore(store);
  },

  add(store, data) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store, 'readwrite').add(data);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },

  put(store, data) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store, 'readwrite').put(data);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },

  get(store, id) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store).get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },

  getAll(store) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },

  delete(store, id) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store, 'readwrite').delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  },

  getByIndex(store, indexName, value) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store).index(indexName).getAll(value);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },

  clear(store) {
    return new Promise((resolve, reject) => {
      const r = this._tx(store, 'readwrite').clear();
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }
};

/* ===== TOAST ===== */
let toastTimer = null;
function showToast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

/* ===== MODAL ===== */
function showModal(html) {
  $('modal-body').innerHTML = html;
  $('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  $('modal-overlay').classList.add('hidden');
}
function modalOverlayClick(e) {
  if (e.target === $('modal-overlay')) closeModal();
}

/* ===== CONFIRM DIALOG ===== */
function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <p>${message}</p>
        <div class="confirm-actions">
          <button class="btn-secondary" id="confirm-no">Cancel</button>
          <button class="btn-danger" id="confirm-yes" style="width:auto;padding:10px 20px">Delete</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#confirm-yes').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#confirm-no').onclick = () => { overlay.remove(); resolve(false); };
  });
}

/* ===== INSTALL BANNER ===== */
function dismissInstallBanner() {
  $('install-banner').classList.add('hidden');
  localStorage.setItem('install-banner-dismissed', '1');
}
function checkInstallBanner() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isIOS && !isStandalone && !localStorage.getItem('install-banner-dismissed')) {
    $('install-banner').classList.remove('hidden');
  }
}

/* ===== APP & NAVIGATION ===== */
const App = {
  currentView: 'dashboard',

  async init() {
    try {
      await DB.init();
    } catch (e) {
      showToast('Database error: ' + e.message, true);
      return;
    }

    checkInstallBanner();
    Dashboard.updateStats();

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  },

  navigate(view) {
    // Deactivate current
    const current = document.querySelector('.view.active');
    if (current) current.classList.remove('active');

    // Activate target
    const target = $('view-' + view);
    if (target) target.classList.add('active');

    this.currentView = view;

    // Initialize sub-views
    if (view === 'dashboard') Dashboard.updateStats();
    else if (view === 'mileage') Mileage.init();
    else if (view === 'energy') Energy.init();

    // Scroll to top
    window.scrollTo(0, 0);
  }
};

/* ===== DASHBOARD ===== */
const Dashboard = {
  async updateStats() {
    try {
      // Mileage stats
      const cars = await DB.getAll('cars');
      const trips = await DB.getAll('trips');
      const now = new Date();
      const thisMonth = trips.filter(t => {
        const d = new Date(t.dateTime);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      });
      $('stat-mileage').textContent = cars.length > 0
        ? `${cars.length} car${cars.length > 1 ? 's' : ''} · ${thisMonth.length} trip${thisMonth.length !== 1 ? 's' : ''} this month`
        : 'No cars added yet';

      // Energy stats
      const energyEntries = await DB.getAll('energy');
      if (energyEntries.length > 0) {
        energyEntries.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
        const last = new Date(energyEntries[0].dateTime);
        const diffMs = now - last;
        const diffH = Math.floor(diffMs / 3600000);
        let timeAgo;
        if (diffH < 1) timeAgo = 'Just now';
        else if (diffH < 24) timeAgo = `${diffH}h ago`;
        else timeAgo = `${Math.floor(diffH / 24)}d ago`;
        $('stat-energy').textContent = `${energyEntries.length} entries · Last: ${timeAgo}`;
      } else {
        $('stat-energy').textContent = 'No entries yet';
      }
    } catch (e) {
      console.error('Stats error:', e);
    }
  }
};

/* ===== MILEAGE TRACKER ===== */
const Mileage = {
  selectedCarId: null,

  async init() {
    await this.loadCars();
    setNow('trip-date', 'trip-time');
    // Re-select previously selected car
    if (this.selectedCarId) {
      $('car-select').value = this.selectedCarId;
      this.selectCar(this.selectedCarId);
    } else {
      this.showEmptyState();
    }
  },

  async loadCars() {
    const cars = await DB.getAll('cars');
    const sel = $('car-select');
    // Preserve first option
    sel.innerHTML = '<option value="">Select a car…</option>';
    cars.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.make} ${c.model} ${c.year}`;
      sel.appendChild(opt);
    });
  },

  showEmptyState() {
    $('car-info').classList.add('hidden');
    $('trip-form-card').classList.add('hidden');
    $('trip-history').classList.add('hidden');
    $('mileage-empty').classList.remove('hidden');
  },

  async selectCar(id) {
    if (!id) { this.selectedCarId = null; this.showEmptyState(); return; }
    this.selectedCarId = Number(id);
    $('mileage-empty').classList.add('hidden');
    $('car-info').classList.remove('hidden');
    $('trip-form-card').classList.remove('hidden');
    $('trip-history').classList.remove('hidden');
    await this.updateOdometer();
    await this.renderTrips();
  },

  async updateOdometer() {
    const car = await DB.get('cars', this.selectedCarId);
    if (!car) return;
    const trips = await DB.getByIndex('trips', 'carId', this.selectedCarId);
    const totalMiles = trips.reduce((sum, t) => sum + t.miles, 0);
    $('current-odo').textContent = formatNum(car.initialOdometer + totalMiles);
  },

  /* --- Car CRUD --- */
  showAddCarModal() {
    showModal(`
      <div class="modal-title">Add New Car</div>
      <div class="form-field">
        <label for="car-make">Make</label>
        <input type="text" id="car-make" placeholder="e.g. Toyota">
      </div>
      <div class="form-field">
        <label for="car-model">Model</label>
        <input type="text" id="car-model" placeholder="e.g. Camry">
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="car-year">Year</label>
          <input type="number" id="car-year" placeholder="${new Date().getFullYear()}" inputmode="numeric">
        </div>
        <div class="form-field">
          <label for="car-odo">Starting Odometer</label>
          <input type="number" id="car-odo" placeholder="0" inputmode="decimal" step="0.1">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="Mileage.saveCar()">Add Car</button>
        <button class="btn-link" onclick="closeModal()">Cancel</button>
      </div>
    `);
    setTimeout(() => $('car-make') && $('car-make').focus(), 300);
  },

  async showEditCarModal() {
    if (!this.selectedCarId) return;
    const car = await DB.get('cars', this.selectedCarId);
    if (!car) return;
    showModal(`
      <div class="modal-title">Edit Car</div>
      <div class="form-field">
        <label for="car-make">Make</label>
        <input type="text" id="car-make" value="${car.make}">
      </div>
      <div class="form-field">
        <label for="car-model">Model</label>
        <input type="text" id="car-model" value="${car.model}">
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="car-year">Year</label>
          <input type="number" id="car-year" value="${car.year}" inputmode="numeric">
        </div>
        <div class="form-field">
          <label for="car-odo">Starting Odometer</label>
          <input type="number" id="car-odo" value="${car.initialOdometer}" inputmode="decimal" step="0.1">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="Mileage.updateCar(${car.id})">Save Changes</button>
        <button class="btn-danger" onclick="Mileage.deleteCar(${car.id})">Delete Car</button>
        <button class="btn-link" onclick="closeModal()">Cancel</button>
      </div>
    `);
  },

  async saveCar() {
    const make = $('car-make').value.trim();
    const model = $('car-model').value.trim();
    const year = $('car-year').value.trim();
    const odo = parseFloat($('car-odo').value) || 0;

    if (!make || !model || !year) {
      showToast('Please fill in make, model, and year', true);
      return;
    }

    const id = await DB.add('cars', {
      make, model, year,
      initialOdometer: odo,
      dateAdded: new Date().toISOString()
    });

    closeModal();
    await this.loadCars();
    $('car-select').value = id;
    this.selectCar(id);
    showToast(`${make} ${model} ${year} added!`);
  },

  async updateCar(id) {
    const make = $('car-make').value.trim();
    const model = $('car-model').value.trim();
    const year = $('car-year').value.trim();
    const odo = parseFloat($('car-odo').value) || 0;

    if (!make || !model || !year) {
      showToast('Please fill in make, model, and year', true);
      return;
    }

    const car = await DB.get('cars', id);
    await DB.put('cars', { ...car, make, model, year, initialOdometer: odo });

    closeModal();
    await this.loadCars();
    $('car-select').value = id;
    await this.selectCar(id);
    showToast('Car updated!');
  },

  async deleteCar(id) {
    const car = await DB.get('cars', id);
    const trips = await DB.getByIndex('trips', 'carId', id);
    const ok = await showConfirm(
      `Delete <b>${car.make} ${car.model} ${car.year}</b> and ${trips.length} associated trip${trips.length !== 1 ? 's' : ''}?`
    );
    if (!ok) return;

    // Delete all associated trips
    for (const t of trips) {
      await DB.delete('trips', t.id);
    }
    await DB.delete('cars', id);

    closeModal();
    this.selectedCarId = null;
    await this.loadCars();
    $('car-select').value = '';
    this.showEmptyState();
    showToast('Car deleted');
  },

  showManageCars() {
    // Quick access to car management — show edit modal for current car
    // or list all cars if none selected
    if (this.selectedCarId) {
      this.showEditCarModal();
    } else {
      this.showAddCarModal();
    }
  },

  /* --- Trip CRUD --- */
  async logTrip() {
    if (!this.selectedCarId) {
      showToast('Please select a car first', true);
      return;
    }

    const date = $('trip-date').value;
    const time = $('trip-time').value;
    const miles = parseFloat($('trip-miles').value);
    const destination = $('trip-destination').value.trim();
    const purpose = $('trip-purpose').value;
    const notes = $('trip-notes').value.trim();

    if (!date || !time) { showToast('Please set date and time', true); return; }
    if (!miles || miles <= 0) { showToast('Please enter miles driven', true); return; }
    if (!destination) { showToast('Please enter a destination', true); return; }

    const dateTime = `${date}T${time}:00`;

    await DB.add('trips', {
      carId: this.selectedCarId,
      dateTime,
      miles,
      destination,
      purpose,
      notes
    });

    // Reset form
    $('trip-miles').value = '';
    $('trip-destination').value = '';
    $('trip-purpose').value = 'Business';
    $('trip-notes').value = '';
    setNow('trip-date', 'trip-time');

    await this.updateOdometer();
    await this.renderTrips();
    showToast(`${miles} mi logged!`);
  },

  async deleteTrip(id) {
    await DB.delete('trips', id);
    await this.updateOdometer();
    await this.renderTrips();
    showToast('Trip deleted');
  },

  async renderTrips() {
    if (!this.selectedCarId) return;

    const car = await DB.get('cars', this.selectedCarId);
    const trips = await DB.getByIndex('trips', 'carId', this.selectedCarId);
    trips.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

    $('trip-count').textContent = `${trips.length} trip${trips.length !== 1 ? 's' : ''}`;

    if (trips.length === 0) {
      $('trip-list').innerHTML = `
        <div class="empty-state">
          <p>No trips logged yet.<br>Log your first trip above!</p>
        </div>`;
      return;
    }

    // Calculate running odometer (forward order) then display in reverse
    const sorted = [...trips].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
    const odoMap = {};
    let running = car.initialOdometer;
    for (const t of sorted) {
      running += t.miles;
      odoMap[t.id] = running;
    }

    $('trip-list').innerHTML = trips.map(t => `
      <div class="entry-item">
        <button class="entry-delete" onclick="Mileage.deleteTrip(${t.id})" title="Delete">✕</button>
        <div class="entry-header">
          <span class="entry-date">${friendlyDateTime(t.dateTime)}</span>
          <span class="entry-badge ${t.purpose.toLowerCase()}">${t.purpose}</span>
        </div>
        <div class="entry-miles">${formatNum(t.miles)} mi</div>
        <div class="entry-odo">Odometer: ${formatNum(odoMap[t.id])} mi</div>
        ${t.destination ? `<div class="entry-destination">${escapeHtml(t.destination)}</div>` : ''}
        ${t.notes ? `<div class="entry-notes">${escapeHtml(t.notes)}</div>` : ''}
      </div>
    `).join('');
  }
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ===== ENERGY TRACKER ===== */
const Energy = {
  async init() {
    setNow('energy-date', 'energy-time');
    // Reset sliders to 3
    ['energy-slider', 'focus-slider', 'tired-slider', 'anxiety-slider'].forEach(id => {
      const el = $(id);
      el.value = 3;
      this.updateSlider(el, id.replace('-slider', '-val'));
    });
    $('energy-notes').value = '';
    await this.renderEntries();
  },

  updateSlider(slider, displayId) {
    $(displayId).textContent = slider.value;
    const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.setProperty('--pct', pct + '%');
  },

  async logEntry() {
    const date = $('energy-date').value;
    const time = $('energy-time').value;
    if (!date || !time) { showToast('Please set date and time', true); return; }

    const entry = {
      dateTime: `${date}T${time}:00`,
      energy: parseInt($('energy-slider').value),
      focus: parseInt($('focus-slider').value),
      tired: parseInt($('tired-slider').value),
      anxiety: parseInt($('anxiety-slider').value),
      notes: $('energy-notes').value.trim()
    };

    await DB.add('energy', entry);

    // Reset
    setNow('energy-date', 'energy-time');
    ['energy-slider', 'focus-slider', 'tired-slider', 'anxiety-slider'].forEach(id => {
      const el = $(id);
      el.value = 3;
      this.updateSlider(el, id.replace('-slider', '-val'));
    });
    $('energy-notes').value = '';

    await this.renderEntries();
    showToast('Entry logged!');
  },

  async deleteEntry(id) {
    await DB.delete('energy', id);
    await this.renderEntries();
    showToast('Entry deleted');
  },

  async renderEntries() {
    const entries = await DB.getAll('energy');
    entries.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

    $('energy-count').textContent = `${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'}`;

    if (entries.length === 0) {
      $('energy-list').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚡</div>
          <p>No entries yet.<br>Log your first check-in above!</p>
        </div>`;
      return;
    }

    $('energy-list').innerHTML = entries.map(e => `
      <div class="entry-item">
        <button class="entry-delete" onclick="Energy.deleteEntry(${e.id})" title="Delete">✕</button>
        <div class="entry-header">
          <span class="entry-date">${friendlyDateTime(e.dateTime)}</span>
        </div>
        <div class="energy-bars">
          <div class="energy-bar-group">
            <div class="energy-bar-label">Energy</div>
            <div class="energy-bar-track">
              <div class="energy-bar-fill green" style="width:${e.energy * 20}%"></div>
            </div>
            <div class="energy-bar-value" style="color:var(--green)">${e.energy}</div>
          </div>
          <div class="energy-bar-group">
            <div class="energy-bar-label">Focus</div>
            <div class="energy-bar-track">
              <div class="energy-bar-fill blue" style="width:${e.focus * 20}%"></div>
            </div>
            <div class="energy-bar-value" style="color:var(--blue)">${e.focus}</div>
          </div>
          <div class="energy-bar-group">
            <div class="energy-bar-label">Tired</div>
            <div class="energy-bar-track">
              <div class="energy-bar-fill purple" style="width:${(e.tired || 0) * 20}%"></div>
            </div>
            <div class="energy-bar-value" style="color:var(--purple)">${e.tired || 0}</div>
          </div>
          <div class="energy-bar-group">
            <div class="energy-bar-label">Anxiety</div>
            <div class="energy-bar-track">
              <div class="energy-bar-fill red" style="width:${e.anxiety * 20}%"></div>
            </div>
            <div class="energy-bar-value" style="color:var(--red)">${e.anxiety}</div>
          </div>
        </div>
        ${e.notes ? `<div class="entry-notes">${escapeHtml(e.notes)}</div>` : ''}
      </div>
    `).join('');
  }
};

/* ===== IMPORT / EXPORT ===== */
const DataIO = {

  /* --- CSV Utilities --- */
  toCSV(headers, rows) {
    const esc = val => {
      const s = String(val == null ? '' : val);
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  },

  parseCSV(text) {
    const lines = text.trim().replace(/\r\n/g, '\n').split('\n');
    if (lines.length < 2) return [];
    const headers = this._parseLine(lines[0]);
    return lines.slice(1).filter(l => l.trim()).map(line => {
      const vals = this._parseLine(line);
      const obj = {};
      headers.forEach((h, i) => obj[h.trim()] = (vals[i] || '').trim());
      return obj;
    });
  },

  _parseLine(line) {
    const vals = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { vals.push(cur); cur = ''; }
        else cur += c;
      }
    }
    vals.push(cur);
    return vals;
  },

  sanitize(str) {
    return String(str).replace(/[^a-zA-Z0-9._-]/g, '_');
  },

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  /* --- EXPORT --- */
  async exportAll() {
    try {
      if (typeof JSZip === 'undefined') {
        showToast('JSZip not loaded. Check your internet connection.', true);
        return;
      }

      const zip = new JSZip();
      const mileageDir = zip.folder('mileage');
      const energyDir = zip.folder('energy');

      // Export cars
      const cars = await DB.getAll('cars');
      if (cars.length > 0) {
        const csv = this.toCSV(
          ['ID', 'Make', 'Model', 'Year', 'InitialOdometer', 'DateAdded'],
          cars.map(c => [c.id, c.make, c.model, c.year, c.initialOdometer, c.dateAdded || ''])
        );
        mileageDir.file('cars.csv', csv);
      }

      // Export trips (one CSV per car per year)
      const allTrips = await DB.getAll('trips');
      const tripGroups = {}; // key: "carId_year"
      for (const t of allTrips) {
        const year = new Date(t.dateTime).getFullYear();
        const key = `${t.carId}_${year}`;
        if (!tripGroups[key]) tripGroups[key] = { carId: t.carId, year, trips: [] };
        tripGroups[key].trips.push(t);
      }

      for (const g of Object.values(tripGroups)) {
        g.trips.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

        // Calculate running odometer
        const car = cars.find(c => c.id === g.carId);
        if (!car) continue;

        // Prior trips (before this year)
        const priorMiles = allTrips
          .filter(t => t.carId === g.carId && new Date(t.dateTime).getFullYear() < g.year)
          .reduce((sum, t) => sum + t.miles, 0);
        let running = car.initialOdometer + priorMiles;

        const csv = this.toCSV(
          ['CarID', 'Make', 'Model', 'Year', 'Date', 'Time', 'MilesDriven', 'Odometer', 'Destination', 'Purpose', 'Notes'],
          g.trips.map(t => {
            running += t.miles;
            const dt = new Date(t.dateTime);
            return [
              car.id, car.make, car.model, car.year,
              formatDateLocal(dt), formatTimeLocal(dt),
              t.miles, running.toFixed(1),
              t.destination || '', t.purpose, t.notes || ''
            ];
          })
        );
        mileageDir.file(`trips_${g.carId}_${g.year}.csv`, csv);
      }

      // Export energy (one CSV per year)
      const allEnergy = await DB.getAll('energy');
      const energyByYear = {};
      for (const e of allEnergy) {
        const year = new Date(e.dateTime).getFullYear();
        if (!energyByYear[year]) energyByYear[year] = [];
        energyByYear[year].push(e);
      }

      for (const [year, entries] of Object.entries(energyByYear)) {
        entries.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
        const csv = this.toCSV(
          ['Date', 'Time', 'Energy', 'Focus', 'Tired', 'Anxiety', 'Notes'],
          entries.map(e => {
            const dt = new Date(e.dateTime);
            return [
              formatDateLocal(dt), formatTimeLocal(dt),
              e.energy, e.focus, e.tired || 0, e.anxiety, e.notes || ''
            ];
          })
        );
        energyDir.file(`energy_${year}.csv`, csv);
      }

      // Generate and download
      const blob = await zip.generateAsync({ type: 'blob' });
      const today = formatDateLocal(new Date());
      this.downloadBlob(blob, `mytracker-export-${today}.zip`);

      showToast('Data exported successfully!');
    } catch (e) {
      showToast('Export failed: ' + e.message, true);
      console.error('Export error:', e);
    }
  },

  /* --- IMPORT --- */
  triggerImport() {
    $('import-input').value = '';
    $('import-input').click();
  },

  async handleImport(input) {
    const file = input.files[0];
    if (!file) return;

    try {
      if (typeof JSZip === 'undefined') {
        showToast('JSZip not loaded. Check your internet connection.', true);
        return;
      }

      const zip = await JSZip.loadAsync(file);
      let imported = { cars: 0, trips: 0, energy: 0 };

      // Clear all existing data first — import is a full overwrite
      await DB.clear('trips');
      await DB.clear('energy');
      await DB.clear('cars');

      // 1) Import cars
      const carIdMap = {}; // exported ID -> local ID
      const carsFile = zip.file(/mileage\/cars\.csv$/i)[0];
      if (carsFile) {
        const text = await carsFile.async('text');
        const rows = this.parseCSV(text);

        for (const row of rows) {
          const exportedId = row.ID;
          const newId = await DB.add('cars', {
            make: row.Make || '',
            model: row.Model || '',
            year: row.Year || '',
            initialOdometer: parseFloat(row.InitialOdometer) || 0,
            dateAdded: row.DateAdded || new Date().toISOString()
          });
          carIdMap[exportedId] = newId;
          imported.cars++;
        }
      }

      // 2) Import trips
      const tripFiles = zip.file(/mileage\/trips_\d+_\d{4}\.csv$/i);

      for (const tf of tripFiles) {
        const text = await tf.async('text');
        const rows = this.parseCSV(text);

        // Extract carId from filename as fallback
        const match = tf.name.match(/trips_(\d+)_(\d{4})\.csv$/i);
        const fileCarId = match ? match[1] : null;

        for (const row of rows) {
          // Use CarID column if present, otherwise fall back to filename
          const exportedCarId = row.CarID || fileCarId;
          if (!exportedCarId) continue;

          const localCarId = carIdMap[exportedCarId];
          if (!localCarId) continue; // Car not found/imported

          const dateTime = `${row.Date}T${row.Time}:00`;
          const miles = parseFloat(row.MilesDriven) || 0;

          await DB.add('trips', {
            carId: localCarId,
            dateTime,
            miles,
            destination: row.Destination || '',
            purpose: row.Purpose || 'Business',
            notes: row.Notes || ''
          });
          imported.trips++;
        }
      }

      // 3) Import energy
      const energyFiles = zip.file(/energy\/energy_\d{4}\.csv$/i);

      for (const ef of energyFiles) {
        const text = await ef.async('text');
        const rows = this.parseCSV(text);

        for (const row of rows) {
          const dateTime = `${row.Date}T${row.Time}:00`;

          await DB.add('energy', {
            dateTime,
            energy: parseInt(row.Energy) || 0,
            focus: parseInt(row.Focus) || 0,
            tired: parseInt(row.Tired) || 0,
            anxiety: parseInt(row.Anxiety) || 0,
            notes: row.Notes || ''
          });
          imported.energy++;
        }
      }

      showToast(`Imported: ${imported.cars} cars, ${imported.trips} trips, ${imported.energy} energy entries`);

      // Refresh current view
      if (App.currentView === 'mileage') Mileage.init();
      else if (App.currentView === 'energy') Energy.init();
      Dashboard.updateStats();

    } catch (e) {
      showToast('Import failed: ' + e.message, true);
      console.error('Import error:', e);
    }
  }
};

/* ===== INITIALIZATION ===== */
document.addEventListener('DOMContentLoaded', () => App.init());
