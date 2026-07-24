/* ============================================================
   Life Tracker — App Logic
   IndexedDB persistence, Mileage & Energy tracking,
   CSV import/export with JSZip
   ============================================================ */

/* ===== CONSTANTS ===== */
const APP_VERSION = '1.6.0';
const DB_NAME = 'MyTrackerDB';
const DB_VERSION = 4;

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

function formatCurrencyUSD(amount) {
  return Number(amount || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
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
        if (!db.objectStoreNames.contains('gigs')) {
          const s = db.createObjectStore('gigs', { keyPath: 'id', autoIncrement: true });
          s.createIndex('dateTime', 'startDateTime');
        }
        if (!db.objectStoreNames.contains('expenses')) {
          const s = db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
          s.createIndex('dateTime', 'dateTime');
        }
        if (!db.objectStoreNames.contains('indiaExpenses')) {
          const s = db.createObjectStore('indiaExpenses', { keyPath: 'id', autoIncrement: true });
          s.createIndex('purchaseDate', 'purchaseDate');
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
    TileManager.render();
    Dashboard.updateStats();

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  },

  showVersion() {
    showModal(`
      <div class="modal-title">MyTracker</div>
      <div class="version-info">
        <p>Version <strong>${APP_VERSION}</strong></p>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="closeModal()">Close</button>
      </div>
    `);
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
    else if (view === 'gigs') Gigs.init();
    else if (view === 'expenses') Expenses.init();
    else if (view === 'india-expenses') IndiaExpenses.init();

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
      $('stat-mileage') && ($('stat-mileage').textContent = cars.length > 0
        ? `${cars.length} car${cars.length > 1 ? 's' : ''} · ${thisMonth.length} trip${thisMonth.length !== 1 ? 's' : ''} this month`
        : 'No cars added yet');

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
        $('stat-energy') && ($('stat-energy').textContent = `${energyEntries.length} entries · Last: ${timeAgo}`);
      } else {
        $('stat-energy') && ($('stat-energy').textContent = 'No entries yet');
      }

      // Gig stats
      const gigs = await DB.getAll('gigs');
      if (gigs.length > 0) {
        const unsettled = gigs.filter(g => !g.paymentSettled).length;
        const undelivered = gigs.filter(g => !g.deliverablesComplete).length;
        const parts = [`${gigs.length} gig${gigs.length !== 1 ? 's' : ''}`];
        if (unsettled > 0) parts.push(`${unsettled} unsettled`);
        if (undelivered > 0) parts.push(`${undelivered} undelivered`);
        $('stat-gigs') && ($('stat-gigs').textContent = parts.join(' · '));
      } else {
        $('stat-gigs') && ($('stat-gigs').textContent = 'No gigs yet');
      }

      // Expense stats
      const expenses = await DB.getAll('expenses');
      if (expenses.length > 0) {
        const thisMonth = expenses.filter(ex => {
          const d = new Date(ex.dateTime);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });
        const noReceipt = expenses.filter(ex => !ex.hasReceipt).length;
        const parts = [`${expenses.length} total · ${thisMonth.length} this month`];
        if (noReceipt > 0) parts.push(`${noReceipt} no receipt`);
        $('stat-expenses') && ($('stat-expenses').textContent = parts.join(' · '));
      } else {
        $('stat-expenses') && ($('stat-expenses').textContent = 'No expenses yet');
      }

      // India expense stats
      const indiaExpenses = await DB.getAll('indiaExpenses');
      if (indiaExpenses.length > 0) {
        const thisMonthIndia = indiaExpenses.filter(ex => {
          const d = new Date(ex.purchaseDate);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });
        const monthTotal = thisMonthIndia.reduce((sum, ex) => sum + Number(ex.totalAmount || 0), 0);
        $('stat-india-expenses') && (
          $('stat-india-expenses').textContent = `${indiaExpenses.length} total · ${thisMonthIndia.length} this month · ${formatCurrencyUSD(monthTotal)}`
        );
      } else {
        $('stat-india-expenses') && ($('stat-india-expenses').textContent = 'No entries yet');
      }
    } catch (e) {
      console.error('Stats error:', e);
    }
  }
};

/* ===== TILE MANAGER ===== */
const TileManager = {
  TILE_DEFS: [
    { id: 'mileage',  icon: '🚗', iconClass: 'mileage',  title: 'Mileage',       desc: 'Track business & personal trips',      statId: 'stat-mileage' },
    { id: 'energy',   icon: '⚡', iconClass: 'energy',   title: 'Energy Levels', desc: 'Monitor energy, focus & anxiety',      statId: 'stat-energy'  },
    { id: 'gigs',     icon: '💼', iconClass: 'gigs',     title: 'Gigs',          desc: 'Track gigs, invoices & deliverables',  statId: 'stat-gigs'    },
    { id: 'expenses', icon: '💳', iconClass: 'expenses', title: 'Expenses',      desc: 'Track spending & receipts',            statId: 'stat-expenses'},
    { id: 'india-expenses', icon: '🛍️', iconClass: 'india-expenses', title: 'India Expenses', desc: 'Track purchases and quantities', statId: 'stat-india-expenses' },
  ],

  STORAGE_KEY: 'hiddenTiles',

  getHidden() {
    try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || []; }
    catch { return []; }
  },

  setHidden(ids) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(ids));
  },

  render() {
    const hidden = this.getHidden();
    const grid = $('tiles-grid');
    grid.innerHTML = '';

    this.TILE_DEFS.forEach(t => {
      if (hidden.includes(t.id)) return;
      const div = document.createElement('div');
      div.className = 'tile';
      div.setAttribute('onclick', `App.navigate('${t.id}')`);
      div.innerHTML = `
        <div class="tile-icon ${t.iconClass}">${t.icon}</div>
        <h3>${t.title}</h3>
        <p class="tile-desc">${t.desc}</p>
        <div class="tile-stat" id="${t.statId}"></div>
      `;
      grid.appendChild(div);
    });

    const customize = document.createElement('div');
    customize.className = 'tile customize-tile';
    customize.setAttribute('onclick', 'TileManager.showCustomizeModal()');
    customize.innerHTML = `
      <div class="tile-icon customize">⚙️</div>
      <h3>Customize</h3>
      <p class="tile-desc">Show or hide tiles</p>
    `;
    grid.appendChild(customize);
  },

  showCustomizeModal() {
    const hidden = this.getHidden();
    const rows = this.TILE_DEFS.map(t => {
      const checked = !hidden.includes(t.id) ? 'checked' : '';
      return `
        <label class="tile-toggle-row">
          <span class="tile-toggle-info">
            <span class="tile-toggle-icon">${t.icon}</span>
            <span>${t.title}</span>
          </span>
          <input type="checkbox" class="tile-toggle-cb" data-id="${t.id}" ${checked}>
        </label>`;
    }).join('');

    showModal(`
      <div class="modal-title">Customize Home</div>
      <p class="modal-subtitle">Choose which tiles appear on your home screen.</p>
      <div class="tile-toggle-list">${rows}</div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="TileManager.saveCustomize()">Done</button>
      </div>
    `);
  },

  saveCustomize() {
    const hidden = [];
    document.querySelectorAll('.tile-toggle-cb').forEach(cb => {
      if (!cb.checked) hidden.push(cb.dataset.id);
    });
    this.setHidden(hidden);
    closeModal();
    this.render();
    Dashboard.updateStats();
  }
};

/* ===== MILEAGE TRACKER ===== */
const Mileage = {
  selectedCarId: null,

  async init() {
    await this.loadCars();
    setNow('trip-date', 'trip-time');
    // Re-select previously selected car (from memory or localStorage)
    const savedCarId = this.selectedCarId || Number(localStorage.getItem('lastCarId'));
    if (savedCarId) {
      $('car-select').value = savedCarId;
      this.selectCar(savedCarId);
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
    if (!id) { this.selectedCarId = null; localStorage.removeItem('lastCarId'); this.showEmptyState(); return; }
    this.selectedCarId = Number(id);
    localStorage.setItem('lastCarId', this.selectedCarId);
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

/* ===== GIG TRACKER ===== */
const Gigs = {
  currentFilter: 'all',

  async init() {
    this.currentFilter = 'all';
    this.updateFilterButtons();
    await this.renderGigs();
  },

  calcDuration(startISO, endISO) {
    const start = new Date(startISO);
    const end = new Date(endISO);
    const diffMs = end - start;
    if (diffMs <= 0) return 0;
    const diffMin = Math.floor(diffMs / 60000);
    return Math.floor(diffMin / 15) * 15;
  },

  formatDuration(minutes) {
    if (minutes <= 0) return '0 min';
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hrs === 0) return `${mins} min`;
    if (mins === 0) return `${hrs} hr`;
    return `${hrs} hr ${mins} min`;
  },

  _modalFormHTML(gig) {
    const isEdit = !!gig;
    const title = isEdit ? 'Edit Gig' : 'Add Gig';
    const now = new Date();
    const startDate = isEdit ? gig.startDateTime.slice(0, 10) : formatDateLocal(now);
    const startTime = isEdit ? gig.startDateTime.slice(11, 16) : formatTimeLocal(now);
    const endDate = isEdit ? gig.endDateTime.slice(0, 10) : formatDateLocal(now);
    const endTime = isEdit ? gig.endDateTime.slice(11, 16) : formatTimeLocal(now);
    const gigTitle = isEdit ? escapeHtml(gig.title) : '';
    const invoice = isEdit ? escapeHtml(gig.invoiceNumber || '') : '';
    const paid = isEdit && gig.paymentSettled;
    const paidDate = isEdit && gig.paymentSettledDate ? gig.paymentSettledDate : formatDateLocal(now);
    const delivered = isEdit && gig.deliverablesComplete;
    const deliveredDate = isEdit && gig.deliverablesCompleteDate ? gig.deliverablesCompleteDate : formatDateLocal(now);
    const notes = isEdit ? escapeHtml(gig.notes || '') : '';

    return `
      <div class="modal-title">${title}</div>
      <div class="form-field">
        <label for="gig-title">Title</label>
        <input type="text" id="gig-title" placeholder="e.g. Website redesign" value="${gigTitle}">
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="gig-start-date">Start Date</label>
          <input type="date" id="gig-start-date" value="${startDate}">
        </div>
        <div class="form-field">
          <label for="gig-start-time">Start Time</label>
          <input type="time" id="gig-start-time" value="${startTime}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="gig-end-date">End Date</label>
          <input type="date" id="gig-end-date" value="${endDate}">
        </div>
        <div class="form-field">
          <label for="gig-end-time">End Time</label>
          <input type="time" id="gig-end-time" value="${endTime}">
        </div>
      </div>
      <div class="form-field">
        <label for="gig-invoice">Invoice Number</label>
        <input type="text" id="gig-invoice" placeholder="e.g. INV-001" value="${invoice}">
      </div>
      <div class="checkbox-row">
        <label class="checkbox-label">
          <input type="checkbox" id="gig-paid" ${paid ? 'checked' : ''} onchange="Gigs.togglePaidDate()">
          <span>Payment Settled</span>
        </label>
        <input type="date" id="gig-paid-date" class="${paid ? '' : 'hidden'}" value="${paidDate}">
      </div>
      <div class="checkbox-row">
        <label class="checkbox-label">
          <input type="checkbox" id="gig-delivered" ${delivered ? 'checked' : ''} onchange="Gigs.toggleDeliveredDate()">
          <span>All Deliverables Done</span>
        </label>
        <input type="date" id="gig-delivered-date" class="${delivered ? '' : 'hidden'}" value="${deliveredDate}">
      </div>
      <div class="form-field">
        <label for="gig-notes">Notes</label>
        <textarea id="gig-notes" rows="2" placeholder="Details about this gig...">${notes}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="Gigs.${isEdit ? 'updateGig(' + gig.id + ')' : 'saveGig()'}">
          ${isEdit ? 'Save Changes' : 'Add Gig'}
        </button>
        ${isEdit ? `<button class="btn-danger" onclick="Gigs.deleteGig(${gig.id})">Delete Gig</button>` : ''}
        <button class="btn-link" onclick="closeModal()">Cancel</button>
      </div>`;
  },

  showAddModal() {
    showModal(this._modalFormHTML(null));
    setTimeout(() => $('gig-title') && $('gig-title').focus(), 300);
  },

  async showEditModal(id) {
    const gig = await DB.get('gigs', id);
    if (!gig) return;
    showModal(this._modalFormHTML(gig));
  },

  togglePaidDate() {
    const checked = $('gig-paid').checked;
    const dateEl = $('gig-paid-date');
    if (checked) {
      dateEl.classList.remove('hidden');
      if (!dateEl.value) dateEl.value = formatDateLocal(new Date());
    } else {
      dateEl.classList.add('hidden');
    }
  },

  toggleDeliveredDate() {
    const checked = $('gig-delivered').checked;
    const dateEl = $('gig-delivered-date');
    if (checked) {
      dateEl.classList.remove('hidden');
      if (!dateEl.value) dateEl.value = formatDateLocal(new Date());
    } else {
      dateEl.classList.add('hidden');
    }
  },

  _readForm() {
    const title = $('gig-title').value.trim();
    const startDate = $('gig-start-date').value;
    const startTime = $('gig-start-time').value;
    const endDate = $('gig-end-date').value;
    const endTime = $('gig-end-time').value;
    const invoiceNumber = $('gig-invoice').value.trim();
    const paymentSettled = $('gig-paid').checked;
    const paymentSettledDate = paymentSettled ? $('gig-paid-date').value : '';
    const deliverablesComplete = $('gig-delivered').checked;
    const deliverablesCompleteDate = deliverablesComplete ? $('gig-delivered-date').value : '';
    const notes = $('gig-notes').value.trim();

    if (!title) { showToast('Please enter a title', true); return null; }
    if (!startDate || !startTime) { showToast('Please set start date and time', true); return null; }
    if (!endDate || !endTime) { showToast('Please set end date and time', true); return null; }

    const startDateTime = `${startDate}T${startTime}:00`;
    const endDateTime = `${endDate}T${endTime}:00`;

    if (new Date(endDateTime) <= new Date(startDateTime)) {
      showToast('End time must be after start time', true);
      return null;
    }

    const totalMinutes = this.calcDuration(startDateTime, endDateTime);

    return {
      title,
      startDateTime,
      endDateTime,
      totalMinutes,
      invoiceNumber,
      paymentSettled,
      paymentSettledDate,
      deliverablesComplete,
      deliverablesCompleteDate,
      notes
    };
  },

  async saveGig() {
    const data = this._readForm();
    if (!data) return;
    data.dateAdded = new Date().toISOString();
    await DB.add('gigs', data);
    closeModal();
    await this.renderGigs();
    showToast('Gig added!');
  },

  async updateGig(id) {
    const data = this._readForm();
    if (!data) return;
    const existing = await DB.get('gigs', id);
    await DB.put('gigs', { ...existing, ...data });
    closeModal();
    await this.renderGigs();
    showToast('Gig updated!');
  },

  async deleteGig(id) {
    const gig = await DB.get('gigs', id);
    const ok = await showConfirm(`Delete gig <b>${escapeHtml(gig.title)}</b>?`);
    if (!ok) return;
    await DB.delete('gigs', id);
    closeModal();
    await this.renderGigs();
    showToast('Gig deleted');
  },

  setFilter(filter) {
    this.currentFilter = filter;
    this.updateFilterButtons();
    this.renderGigs();
  },

  updateFilterButtons() {
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    const btn = $('filter-' + this.currentFilter);
    if (btn) btn.classList.add('active');
  },

  async renderGigs() {
    let gigs = await DB.getAll('gigs');

    if (this.currentFilter === 'unsettled') {
      gigs = gigs.filter(g => !g.paymentSettled);
    } else if (this.currentFilter === 'settled') {
      gigs = gigs.filter(g => g.paymentSettled);
    } else if (this.currentFilter === 'undelivered') {
      gigs = gigs.filter(g => !g.deliverablesComplete);
    } else if (this.currentFilter === 'delivered') {
      gigs = gigs.filter(g => g.deliverablesComplete);
    }

    gigs.sort((a, b) => new Date(b.startDateTime) - new Date(a.startDateTime));

    $('gig-count').textContent = `${gigs.length} gig${gigs.length !== 1 ? 's' : ''}`;

    if (gigs.length === 0) {
      $('gig-history').classList.add('hidden');
      $('gigs-empty').classList.remove('hidden');
      return;
    }

    $('gigs-empty').classList.add('hidden');
    $('gig-history').classList.remove('hidden');

    $('gig-list').innerHTML = gigs.map(g => {
      const duration = this.formatDuration(g.totalMinutes);
      const startD = new Date(g.startDateTime);
      const dateStr = startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const paidBadge = g.paymentSettled
        ? '<span class="entry-badge settled">Paid</span>'
        : '<span class="entry-badge unsettled">Unpaid</span>';
      const delivBadge = g.deliverablesComplete
        ? '<span class="entry-badge delivered">Delivered</span>'
        : '<span class="entry-badge undelivered">Pending</span>';

      return `
      <div class="entry-item gig-entry" onclick="Gigs.showEditModal(${g.id})">
        <div class="entry-header">
          <span class="entry-date">${dateStr} · ${timeStr}</span>
          <div class="gig-badges">${paidBadge}${delivBadge}</div>
        </div>
        <div class="gig-title">${escapeHtml(g.title)}</div>
        <div class="gig-meta">
          <span class="gig-duration">⏱ ${duration}</span>
          ${g.invoiceNumber ? `<span class="gig-invoice">📄 ${escapeHtml(g.invoiceNumber)}</span>` : ''}
        </div>
        ${g.notes ? `<div class="entry-notes">${escapeHtml(g.notes)}</div>` : ''}
      </div>`;
    }).join('');
  }
};

/* ===== EXPENSE TRACKER ===== */
const Expenses = {
  currentFilter: 'all',

  async init() {
    this.currentFilter = 'all';
    this.updateFilterButtons();
    await this.renderExpenses();
  },

  _modalFormHTML(exp) {
    const isEdit = !!exp;
    const title = isEdit ? 'Edit Expense' : 'Add Expense';
    const now = new Date();
    const expDate = isEdit ? exp.dateTime.slice(0, 10) : formatDateLocal(now);
    const expTime = isEdit ? exp.dateTime.slice(11, 16) : formatTimeLocal(now);
    const category = isEdit ? exp.category : 'Business';
    const expenseCategory = isEdit ? (exp.expenseCategory || '') : '';
    const merchant = isEdit ? escapeHtml(exp.merchant || '') : '';
    const description = isEdit ? escapeHtml(exp.description || '') : '';
    const amount = isEdit ? (exp.amount || '') : '';
    const payment = isEdit ? exp.paymentMode : 'Credit Card';
    const hasReceipt = isEdit ? exp.hasReceipt : false;
    const notes = isEdit ? escapeHtml(exp.notes || '') : '';

    const expenseCategoryOptions = [
      'Advertising', 'Equipment', 'Supplies', 'Meals', 'Utilities', 'Other',
      'Rent/Lease', 'Repairs', 'Car Fees', '1099 Contractors', 'Insurance',
      'Professional Services', 'Maintenance', 'Taxes & Licenses', 'Travel'
    ];
    const expenseCategoryOptionsHTML = '<option value="">(none)</option>' +
      expenseCategoryOptions.map(o =>
        `<option value="${o}" ${expenseCategory === o ? 'selected' : ''}>${o}</option>`
      ).join('');

    return `
      <div class="modal-title">${title}</div>
      <div class="form-row">
        <div class="form-field">
          <label for="exp-date">Date</label>
          <input type="date" id="exp-date" value="${expDate}">
        </div>
        <div class="form-field">
          <label for="exp-time">Time</label>
          <input type="time" id="exp-time" value="${expTime}">
        </div>
      </div>
      <div class="form-field">
        <label for="exp-category">Category</label>
        <select id="exp-category">
          <option value="Business" ${category === 'Business' ? 'selected' : ''}>Business</option>
          <option value="Personal" ${category === 'Personal' ? 'selected' : ''}>Personal</option>
        </select>
      </div>
      <div class="form-field">
        <label for="exp-expense-category">Expense Category</label>
        <select id="exp-expense-category">${expenseCategoryOptionsHTML}</select>
      </div>
      <div class="form-field">
        <label for="exp-merchant">Merchant</label>
        <input type="text" id="exp-merchant" list="merchant-list" placeholder="Select or type a merchant…" value="${merchant}">
        <datalist id="merchant-list">
          <option value="Amazon">
          <option value="Kenmore Camera">
          <option value="B&amp;H">
          <option value="Adorama">
          <option value="Cardinal Camera">
          <option value="Home Depot">
          <option value="Dollar Tree">
          <option value="QFC">
          <option value="Costco">
        </datalist>
      </div>
      <div class="form-field">
        <label for="exp-description">What is this expense for?</label>
        <input type="text" id="exp-description" placeholder="e.g. Office supplies, Software license…" value="${description}">
      </div>
      <div class="form-field">
        <label for="exp-amount">Amount ($)</label>
        <input type="number" id="exp-amount" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${amount}">
      </div>
      <div class="form-field">
        <label for="exp-payment">Mode of Payment</label>
        <select id="exp-payment">
          <option value="Cash" ${payment === 'Cash' ? 'selected' : ''}>Cash</option>
          <option value="Zelle" ${payment === 'Zelle' ? 'selected' : ''}>Zelle</option>
          <option value="Credit Card" ${payment === 'Credit Card' ? 'selected' : ''}>Credit Card</option>
          <option value="Personal Card" ${payment === 'Personal Card' ? 'selected' : ''}>Personal Card</option>
        </select>
      </div>
      <div class="checkbox-row">
        <label class="checkbox-label">
          <input type="checkbox" id="exp-receipt" ${hasReceipt ? 'checked' : ''}>
          <span>Has Receipt</span>
        </label>
      </div>
      <div class="form-field">
        <label for="exp-notes">Notes</label>
        <textarea id="exp-notes" rows="2" placeholder="Additional details…">${notes}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="Expenses.${isEdit ? 'updateExpense(' + exp.id + ')' : 'saveExpense()'}">
          ${isEdit ? 'Save Changes' : 'Add Expense'}
        </button>
        ${isEdit ? `<button class="btn-danger" onclick="Expenses.deleteExpense(${exp.id})">Delete Expense</button>` : ''}
        <button class="btn-link" onclick="closeModal()">Cancel</button>
      </div>`;
  },

  showAddModal() {
    showModal(this._modalFormHTML(null));
    setTimeout(() => $('exp-description') && $('exp-description').focus(), 300);
  },

  async showEditModal(id) {
    const exp = await DB.get('expenses', id);
    if (!exp) return;
    showModal(this._modalFormHTML(exp));
  },

  _readForm() {
    const date = $('exp-date').value;
    const time = $('exp-time').value;
    const category = $('exp-category').value;
    const expenseCategory = $('exp-expense-category').value;
    const merchant = $('exp-merchant').value.trim();
    const description = $('exp-description').value.trim();
    const amount = parseFloat($('exp-amount').value) || 0;
    const paymentMode = $('exp-payment').value;
    const hasReceipt = $('exp-receipt').checked;
    const notes = $('exp-notes').value.trim();

    if (!date || !time) { showToast('Please set date and time', true); return null; }
    if (!description) { showToast('Please enter what the expense is for', true); return null; }

    return {
      dateTime: `${date}T${time}:00`,
      category,
      expenseCategory,
      merchant,
      description,
      amount,
      paymentMode,
      hasReceipt,
      notes
    };
  },

  async saveExpense() {
    const data = this._readForm();
    if (!data) return;
    data.dateAdded = new Date().toISOString();
    await DB.add('expenses', data);
    closeModal();
    await this.renderExpenses();
    showToast('Expense added!');
  },

  async updateExpense(id) {
    const data = this._readForm();
    if (!data) return;
    const existing = await DB.get('expenses', id);
    await DB.put('expenses', { ...existing, ...data });
    closeModal();
    await this.renderExpenses();
    showToast('Expense updated!');
  },

  async deleteExpense(id) {
    const exp = await DB.get('expenses', id);
    const ok = await showConfirm(`Delete expense <b>${escapeHtml(exp.description)}</b>?`);
    if (!ok) return;
    await DB.delete('expenses', id);
    closeModal();
    await this.renderExpenses();
    showToast('Expense deleted');
  },

  setFilter(filter) {
    this.currentFilter = filter;
    this.updateFilterButtons();
    this.renderExpenses();
  },

  updateFilterButtons() {
    document.querySelectorAll('#view-expenses .filter-btn').forEach(btn => btn.classList.remove('active'));
    const btn = $('exp-filter-' + this.currentFilter);
    if (btn) btn.classList.add('active');
  },

  async renderExpenses() {
    let expenses = await DB.getAll('expenses');

    if (this.currentFilter === 'business') {
      expenses = expenses.filter(e => e.category === 'Business');
    } else if (this.currentFilter === 'personal') {
      expenses = expenses.filter(e => e.category === 'Personal');
    } else if (this.currentFilter === 'no-receipt') {
      expenses = expenses.filter(e => !e.hasReceipt);
    }

    expenses.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

    $('expense-count').textContent = `${expenses.length} expense${expenses.length !== 1 ? 's' : ''}`;

    if (expenses.length === 0) {
      $('expense-history').classList.add('hidden');
      $('expenses-empty').classList.remove('hidden');
      return;
    }

    $('expenses-empty').classList.add('hidden');
    $('expense-history').classList.remove('hidden');

    $('expense-list').innerHTML = expenses.map(e => {
      const dateStr = friendlyDateTime(e.dateTime);
      const catBadge = e.category === 'Business'
        ? '<span class="entry-badge business">Business</span>'
        : '<span class="entry-badge personal">Personal</span>';
      const expCatBadge = e.expenseCategory
        ? `<span class="entry-badge expense-cat">${escapeHtml(e.expenseCategory)}</span>`
        : '';
      const receiptIcon = e.hasReceipt ? '🧾' : '';

      return `
      <div class="entry-item expense-entry" onclick="Expenses.showEditModal(${e.id})">
        <div class="entry-header">
          <span class="entry-date">${dateStr}</span>
          ${catBadge}
          ${expCatBadge}
        </div>
        ${e.merchant ? `<div class="expense-merchant">${escapeHtml(e.merchant)}</div>` : ''}
        <div class="expense-desc">${escapeHtml(e.description)}</div>
        ${e.amount ? `<div class="expense-amount">$${formatNum(e.amount, 2)}</div>` : ''}
        <div class="expense-meta">
          <span class="expense-payment">${e.paymentMode}</span>
          ${receiptIcon ? `<span class="expense-receipt">${receiptIcon} Receipt</span>` : '<span class="expense-no-receipt">No receipt</span>'}
        </div>
        ${e.notes ? `<div class="entry-notes">${escapeHtml(e.notes)}</div>` : ''}
      </div>`;
    }).join('');
  }
};

/* ===== INDIA EXPENSE TRACKER ===== */
const IndiaExpenses = {
  async init() {
    await this.renderEntries();
  },

  _modalFormHTML(entry) {
    const isEdit = !!entry;
    const title = isEdit ? 'Edit India Expense' : 'Add India Expense';
    const now = new Date();
    const purchaseDate = isEdit ? entry.purchaseDate : formatDateLocal(now);
    const itemName = isEdit ? escapeHtml(entry.itemName || '') : '';
    const unitPrice = isEdit ? (entry.unitPrice ?? '') : '';
    const quantity = isEdit ? (entry.quantity ?? 1) : 1;
    const boughtFor = isEdit ? escapeHtml(entry.boughtFor || '') : '';
    const boughtWhere = isEdit ? escapeHtml(entry.boughtWhere || '') : '';
    const notes = isEdit ? escapeHtml(entry.notes || '') : '';

    return `
      <div class="modal-title">${title}</div>
      <div class="form-field">
        <label for="ie-date">When</label>
        <input type="date" id="ie-date" value="${purchaseDate}">
      </div>
      <div class="form-field">
        <label for="ie-item">What was bought</label>
        <input type="text" id="ie-item" placeholder="e.g. Mangoes" value="${itemName}">
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="ie-unit-price">How much per item (USD)</label>
          <input type="number" id="ie-unit-price" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${unitPrice}">
        </div>
        <div class="form-field">
          <label for="ie-qty">How many items</label>
          <input type="number" id="ie-qty" inputmode="numeric" step="1" min="1" placeholder="1" value="${quantity}">
        </div>
      </div>
      <div class="form-field">
        <label for="ie-for">Bought for what</label>
        <input type="text" id="ie-for" placeholder="e.g. Family dinner" value="${boughtFor}">
      </div>
      <div class="form-field">
        <label for="ie-where">Bought where</label>
        <input type="text" id="ie-where" placeholder="e.g. Local market" value="${boughtWhere}">
      </div>
      <div class="form-field">
        <label for="ie-notes">Notes</label>
        <textarea id="ie-notes" rows="2" placeholder="Additional details...">${notes}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="IndiaExpenses.${isEdit ? 'updateEntry(' + entry.id + ')' : 'saveEntry()'}">
          ${isEdit ? 'Save Changes' : 'Add Expense'}
        </button>
        ${isEdit ? `<button class="btn-danger" onclick="IndiaExpenses.deleteEntry(${entry.id})">Delete Expense</button>` : ''}
        <button class="btn-link" onclick="closeModal()">Cancel</button>
      </div>`;
  },

  showAddModal() {
    showModal(this._modalFormHTML(null));
    setTimeout(() => $('ie-item') && $('ie-item').focus(), 300);
  },

  async showEditModal(id) {
    const entry = await DB.get('indiaExpenses', id);
    if (!entry) return;
    showModal(this._modalFormHTML(entry));
  },

  _readForm() {
    const purchaseDate = $('ie-date').value;
    const itemName = $('ie-item').value.trim();
    const unitPrice = parseFloat($('ie-unit-price').value);
    const quantity = parseInt($('ie-qty').value);
    const boughtFor = $('ie-for').value.trim();
    const boughtWhere = $('ie-where').value.trim();
    const notes = $('ie-notes').value.trim();

    if (!purchaseDate) { showToast('Please set the date', true); return null; }
    if (!itemName) { showToast('Please enter what was bought', true); return null; }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) { showToast('Please enter a valid per-item amount', true); return null; }
    if (!Number.isFinite(quantity) || quantity <= 0) { showToast('Please enter a valid item quantity', true); return null; }

    return {
      purchaseDate,
      itemName,
      unitPrice,
      quantity,
      totalAmount: Number((unitPrice * quantity).toFixed(2)),
      boughtFor,
      boughtWhere,
      notes
    };
  },

  async saveEntry() {
    const data = this._readForm();
    if (!data) return;
    data.dateAdded = new Date().toISOString();
    await DB.add('indiaExpenses', data);
    closeModal();
    await this.renderEntries();
    showToast('India expense added!');
  },

  async updateEntry(id) {
    const data = this._readForm();
    if (!data) return;
    const existing = await DB.get('indiaExpenses', id);
    await DB.put('indiaExpenses', { ...existing, ...data });
    closeModal();
    await this.renderEntries();
    showToast('India expense updated!');
  },

  async deleteEntry(id) {
    const entry = await DB.get('indiaExpenses', id);
    const ok = await showConfirm(`Delete expense <b>${escapeHtml(entry.itemName)}</b>?`);
    if (!ok) return;
    await DB.delete('indiaExpenses', id);
    closeModal();
    await this.renderEntries();
    showToast('India expense deleted');
  },

  async renderEntries() {
    const entries = await DB.getAll('indiaExpenses');
    entries.sort((a, b) => {
      const dateDiff = new Date(b.purchaseDate) - new Date(a.purchaseDate);
      if (dateDiff !== 0) return dateDiff;
      return new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0);
    });

    $('india-expense-count').textContent = `${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'}`;

    if (entries.length === 0) {
      $('india-expense-history').classList.add('hidden');
      $('india-expenses-empty').classList.remove('hidden');
      Dashboard.updateStats();
      return;
    }

    $('india-expenses-empty').classList.add('hidden');
    $('india-expense-history').classList.remove('hidden');

    $('india-expense-list').innerHTML = entries.map(e => {
      const dateObj = new Date(`${e.purchaseDate}T00:00:00`);
      const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `
      <div class="entry-item expense-entry" onclick="IndiaExpenses.showEditModal(${e.id})">
        <div class="entry-header">
          <span class="entry-date">${dateStr}</span>
          <span class="entry-badge expense-cat">Qty ${e.quantity}</span>
        </div>
        <div class="expense-desc">${escapeHtml(e.itemName)}</div>
        <div class="expense-meta">
          <span>Per item: ${formatCurrencyUSD(e.unitPrice)}</span>
          <span>Total: ${formatCurrencyUSD(e.totalAmount)}</span>
        </div>
        ${e.boughtFor ? `<div class="expense-merchant">For: ${escapeHtml(e.boughtFor)}</div>` : ''}
        ${e.boughtWhere ? `<div class="expense-merchant">Where: ${escapeHtml(e.boughtWhere)}</div>` : ''}
        ${e.notes ? `<div class="entry-notes">${escapeHtml(e.notes)}</div>` : ''}
      </div>`;
    }).join('');

    Dashboard.updateStats();
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
      const gigsDir = zip.folder('gigs');
      const expensesDir = zip.folder('expenses');
      const indiaExpensesDir = zip.folder('india-expenses');

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

      // Export gigs
      const allGigs = await DB.getAll('gigs');
      if (allGigs.length > 0) {
        allGigs.sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));
        const csv = this.toCSV(
          ['Title', 'StartDate', 'StartTime', 'EndDate', 'EndTime', 'TotalMinutes',
           'InvoiceNumber', 'PaymentSettled', 'PaymentSettledDate',
           'DeliverablesComplete', 'DeliverablesCompleteDate', 'Notes'],
          allGigs.map(g => {
            const sd = new Date(g.startDateTime);
            const ed = new Date(g.endDateTime);
            return [
              g.title,
              formatDateLocal(sd), formatTimeLocal(sd),
              formatDateLocal(ed), formatTimeLocal(ed),
              g.totalMinutes,
              g.invoiceNumber || '',
              g.paymentSettled ? 'Yes' : 'No',
              g.paymentSettledDate || '',
              g.deliverablesComplete ? 'Yes' : 'No',
              g.deliverablesCompleteDate || '',
              g.notes || ''
            ];
          })
        );
        gigsDir.file('gigs.csv', csv);
      }

      // Export expenses
      const allExpenses = await DB.getAll('expenses');
      if (allExpenses.length > 0) {
        allExpenses.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
        const csv = this.toCSV(
          ['Date', 'Time', 'Category', 'ExpenseCategory', 'Merchant', 'Description', 'Amount', 'PaymentMode', 'HasReceipt', 'Notes'],
          allExpenses.map(e => {
            const dt = new Date(e.dateTime);
            return [
              formatDateLocal(dt), formatTimeLocal(dt),
              e.category, e.expenseCategory || '',
              e.merchant || '',
              e.description,
              e.amount || 0,
              e.paymentMode,
              e.hasReceipt ? 'Yes' : 'No',
              e.notes || ''
            ];
          })
        );
        expensesDir.file('expenses.csv', csv);
      }

      // Export India expenses
      const allIndiaExpenses = await DB.getAll('indiaExpenses');
      if (allIndiaExpenses.length > 0) {
        allIndiaExpenses.sort((a, b) => new Date(a.purchaseDate) - new Date(b.purchaseDate));
        const csv = this.toCSV(
          ['Date', 'Item', 'UnitPrice', 'Quantity', 'TotalAmount', 'BoughtFor', 'BoughtWhere', 'Notes'],
          allIndiaExpenses.map(e => [
            e.purchaseDate,
            e.itemName,
            e.unitPrice,
            e.quantity,
            e.totalAmount,
            e.boughtFor || '',
            e.boughtWhere || '',
            e.notes || ''
          ])
        );
        indiaExpensesDir.file('india-expenses.csv', csv);
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
      let imported = { cars: 0, trips: 0, energy: 0, gigs: 0, expenses: 0, indiaExpenses: 0 };

      // Clear all existing data first — import is a full overwrite
      await DB.clear('trips');
      await DB.clear('energy');
      await DB.clear('cars');
      await DB.clear('gigs');
      await DB.clear('expenses');
      await DB.clear('indiaExpenses');

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

      // 4) Import gigs
      const gigsFile = zip.file(/gigs\/gigs\.csv$/i)[0];
      if (gigsFile) {
        const text = await gigsFile.async('text');
        const rows = this.parseCSV(text);

        for (const row of rows) {
          const startDateTime = `${row.StartDate}T${row.StartTime}:00`;
          const endDateTime = `${row.EndDate}T${row.EndTime}:00`;

          await DB.add('gigs', {
            title: row.Title || '',
            startDateTime,
            endDateTime,
            totalMinutes: parseInt(row.TotalMinutes) || 0,
            invoiceNumber: row.InvoiceNumber || '',
            paymentSettled: row.PaymentSettled === 'Yes',
            paymentSettledDate: row.PaymentSettledDate || '',
            deliverablesComplete: row.DeliverablesComplete === 'Yes',
            deliverablesCompleteDate: row.DeliverablesCompleteDate || '',
            notes: row.Notes || '',
            dateAdded: new Date().toISOString()
          });
          imported.gigs++;
        }
      }

      // 5) Import expenses
      const expensesFile = zip.file(/expenses\/expenses\.csv$/i)[0];
      if (expensesFile) {
        const text = await expensesFile.async('text');
        const rows = this.parseCSV(text);

        for (const row of rows) {
          const dateTime = `${row.Date}T${row.Time}:00`;

          await DB.add('expenses', {
            dateTime,
            category: row.Category || 'Business',
            expenseCategory: row.ExpenseCategory || '',
            merchant: row.Merchant || '',
            description: row.Description || '',
            amount: parseFloat(row.Amount) || 0,
            paymentMode: row.PaymentMode || 'Credit Card',
            hasReceipt: row.HasReceipt === 'Yes',
            notes: row.Notes || '',
            dateAdded: new Date().toISOString()
          });
          imported.expenses++;
        }
      }

      // 6) Import India expenses
      const indiaExpensesFile = zip.file(/india-expenses\/india-expenses\.csv$/i)[0];
      if (indiaExpensesFile) {
        const text = await indiaExpensesFile.async('text');
        const rows = this.parseCSV(text);

        for (const row of rows) {
          const quantity = parseInt(row.Quantity);
          const unitPrice = parseFloat(row.UnitPrice);
          const totalFromCsv = parseFloat(row.TotalAmount);
          const totalAmount = Number.isFinite(totalFromCsv)
            ? totalFromCsv
            : ((Number.isFinite(unitPrice) ? unitPrice : 0) * (Number.isFinite(quantity) ? quantity : 0));

          await DB.add('indiaExpenses', {
            purchaseDate: row.Date || formatDateLocal(new Date()),
            itemName: row.Item || '',
            unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
            quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
            totalAmount: Number(totalAmount.toFixed(2)),
            boughtFor: row.BoughtFor || '',
            boughtWhere: row.BoughtWhere || '',
            notes: row.Notes || '',
            dateAdded: new Date().toISOString()
          });
          imported.indiaExpenses++;
        }
      }

      showToast(`Imported: ${imported.cars} cars, ${imported.trips} trips, ${imported.energy} energy, ${imported.gigs} gigs, ${imported.expenses} expenses, ${imported.indiaExpenses} India expenses`);

      // Refresh current view
      if (App.currentView === 'mileage') Mileage.init();
      else if (App.currentView === 'energy') Energy.init();
      else if (App.currentView === 'gigs') Gigs.init();
      else if (App.currentView === 'expenses') Expenses.init();
      else if (App.currentView === 'india-expenses') IndiaExpenses.init();
      Dashboard.updateStats();

    } catch (e) {
      showToast('Import failed: ' + e.message, true);
      console.error('Import error:', e);
    }
  }
};

/* ===== INITIALIZATION ===== */
document.addEventListener('DOMContentLoaded', () => App.init());
