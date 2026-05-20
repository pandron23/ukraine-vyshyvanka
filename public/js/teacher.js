const socket = io();

// UI States and Views
const views = {
  lobby: document.getElementById('lobbyView'),
  drawing: document.getElementById('drawingView'),
  results: document.getElementById('resultsView')
};

const controls = {
  lobby: document.getElementById('lobbyControls'),
  drawing: document.getElementById('drawingControls'),
  finished: document.getElementById('finishedControls')
};

// UI Elements
const serverUrlText = document.getElementById('serverUrlText');
const durationSelect = document.getElementById('durationInput');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnReset = document.getElementById('btnReset');
const timerText = document.getElementById('timerText');
const studentCountText = document.getElementById('studentCount');
const lobbyStudentGrid = document.getElementById('lobbyStudentGrid');
const drawingStudentGrid = document.getElementById('drawingStudentGrid');
const galleryContainer = document.getElementById('galleryContainer');
const waitingBadge = document.getElementById('waitingBadge');

// Stencil Editor Elements
const stencilModal = document.getElementById('stencilModal');
const btnOpenStencil = document.getElementById('btnOpenStencil');
const stencilModalCloseBtn = document.getElementById('stencilModalCloseBtn');
const btnSaveStencil = document.getElementById('btnSaveStencil');
const stencilCanvas = document.getElementById('stencilCanvas');
const stencilCtx = stencilCanvas ? stencilCanvas.getContext('2d') : null;

const presetAll = document.getElementById('presetAll');
const presetChest = document.getElementById('presetChest');
const presetSleeves = document.getElementById('presetSleeves');
const presetFree = document.getElementById('presetFree');
const presetClear = document.getElementById('presetClear');

let customStencil = null; // Set of "x,y" strings
let isStencilPainting = false;

// Modal Elements
const shirtModal = document.getElementById('shirtModal');
const modalStudentName = document.getElementById('modalStudentName');
const modalPatternCanvas = document.getElementById('modalPatternCanvas');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const btnDownloadShirt = document.getElementById('btnDownloadShirt');

// Constants for canvas grid size
const GRID_COLS = 24;
const GRID_ROWS = 24;

// Cache for active student results data
let currentResults = [];
let selectedShirtData = null;

// Initialize connection as teacher
socket.emit('teacher:init');

// --- SOCKET EVENT HANDLERS ---

// Initial state load
socket.on('teacher:state', (state) => {
  console.log('Current server state:', state);
  
  // Set Server URL and Generate QR code
  serverUrlText.textContent = "https://ukraine-vyshyvanka.onrender.com/";
  generateQrCode(state.localUrl);
  
  updateUIState(state.status);
  
  if (state.status === 'drawing') {
    timerText.textContent = state.remainingTime;
  }
  
  // Initialize local stencil from server state if present
  if (state.stencil) {
    customStencil = new Set(state.stencil);
  }
  
  updateStudentsList(state.students);
});

// Real-time student directory updates
socket.on('teacher:students-update', (students) => {
  updateStudentsList(students);
});

// Drawing phase has begun
socket.on('session:started', (data) => {
  updateUIState('drawing');
  timerText.textContent = data.remainingTime;
});

// Timer tick
socket.on('session:tick', (data) => {
  timerText.textContent = data.remainingTime;
  
  // Visual timer pulse when time is low
  const circle = document.querySelector('.timer-circle');
  if (data.remainingTime <= 10) {
    circle.style.borderColor = 'var(--primary-red)';
    circle.style.animationDuration = '0.5s';
  } else {
    circle.style.borderColor = 'var(--border-glass)';
    circle.style.animationDuration = '2s';
  }
});

// Results received from server
socket.on('session:results', (students) => {
  currentResults = students;
  updateUIState('finished');
  renderResultsGallery(students);
});

// Reset session received (reload)
socket.on('session:reset', () => {
  location.reload();
});

// --- UI AND DRAWING LOGIC ---

// Helper to switch view containers
function updateUIState(status) {
  // Hide all views and controls
  Object.values(views).forEach(v => v.classList.remove('active'));
  Object.values(controls).forEach(c => c.classList.remove('active'));
  
  if (status === 'lobby') {
    views.lobby.classList.add('active');
    controls.lobby.classList.add('active');
  } else if (status === 'drawing') {
    views.drawing.classList.add('active');
    controls.drawing.classList.add('active');
  } else if (status === 'finished') {
    views.results.classList.add('active');
    controls.finished.classList.add('active');
  }
}

// Generate the QR Code dynamically on frontend
function generateQrCode(url) {
  const qrContainer = document.getElementById('qrcode');
  qrContainer.innerHTML = ''; // clear any existing
  
  new QRCode(qrContainer, {
    text: url,
    width: 180,
    height: 180,
    colorDark: "#1E1E1E",
    colorLight: "#FFFFFF",
    correctLevel: QRCode.CorrectLevel.H
  });
}

// Update lists of connected/ready students
function updateStudentsList(students) {
  studentCountText.textContent = students.length;
  
  if (students.length > 0) {
    waitingBadge.textContent = 'Session Active';
    waitingBadge.style.background = 'rgba(43, 122, 75, 0.15)';
    waitingBadge.style.color = 'var(--accent-green)';
  } else {
    waitingBadge.textContent = 'Waiting for students...';
    waitingBadge.style.background = 'rgba(229,169,59,0.15)';
    waitingBadge.style.color = '#b77f1b';
  }
  
  // Render Lobby Grid
  lobbyStudentGrid.innerHTML = '';
  students.forEach(student => {
    const card = document.createElement('div');
    card.className = `student-card ${student.isConnected ? '' : 'disconnected'}`;
    
    // Beautiful initials or avatar circle
    const avatar = document.createElement('div');
    avatar.style.width = '44px';
    avatar.style.height = '44px';
    avatar.style.borderRadius = '50%';
    avatar.style.background = getRandomLinenColor(student.name);
    avatar.style.display = 'flex';
    avatar.style.alignItems = 'center';
    avatar.style.justifyContent = 'center';
    avatar.style.color = 'white';
    avatar.style.fontWeight = 'bold';
    avatar.style.fontSize = '1.2rem';
    avatar.style.marginBottom = '8px';
    avatar.style.border = '2px solid rgba(255,255,255,0.8)';
    avatar.textContent = student.name.charAt(0).toUpperCase();
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = student.name;
    nameSpan.style.fontSize = '0.95rem';
    nameSpan.style.wordBreak = 'break-all';
    
    card.appendChild(avatar);
    card.appendChild(nameSpan);
    lobbyStudentGrid.appendChild(card);
  });
  
  // Render Drawing Progress Grid
  drawingStudentGrid.innerHTML = '';
  students.forEach(student => {
    const card = document.createElement('div');
    card.className = `student-card ${student.submitted ? 'ready' : ''} ${student.isConnected ? '' : 'disconnected'}`;
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = student.name;
    nameSpan.style.fontSize = '0.95rem';
    
    const statusText = document.createElement('span');
    statusText.style.fontSize = '0.75rem';
    statusText.style.marginTop = '4px';
    statusText.style.color = student.submitted ? 'var(--accent-green)' : '#888';
    statusText.textContent = student.submitted ? '✓ Done' : '✍ drawing...';
    
    const dot = document.createElement('div');
    dot.className = 'status-dot';
    
    card.appendChild(nameSpan);
    card.appendChild(statusText);
    card.appendChild(dot);
    drawingStudentGrid.appendChild(card);
  });
}

// Generate aesthetic colors for student avatars
function getRandomLinenColor(name) {
  const colors = [
    '#D12B2B', // traditional red
    '#1C3F60', // deep blue
    '#E5A93B', // gold yellow
    '#2B7A4B', // embroidery green
    '#8B0000', // burgundy
    '#553555', // rich plum
    '#e25822'  // flame red
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

// --- CROSS-STITCH RENDERING ENGINE ---
function drawCrossStitch(canvas, drawingData) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (!drawingData || !Array.isArray(drawingData)) return;
  
  const cw = canvas.width / GRID_COLS;
  const ch = canvas.height / GRID_ROWS;
  
  ctx.lineCap = 'round';
  // Scale thickness proportional to canvas size
  ctx.lineWidth = Math.max(1.8, cw * 0.22); 
  
  drawingData.forEach(cell => {
    ctx.strokeStyle = cell.color;
    
    // Add micro-padding so threads look separated
    const p = cw * 0.12; 
    
    const x1 = cell.x * cw + p;
    const y1 = cell.y * ch + p;
    const x2 = (cell.x + 1) * cw - p;
    const y2 = (cell.y + 1) * ch - p;
    
    // Draw the X cross-stitch pattern
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.moveTo(x2, y1);
    ctx.lineTo(x1, y2);
    ctx.stroke();
  });
}

// Render student gallery
function renderResultsGallery(students) {
  galleryContainer.innerHTML = '';
  const template = document.getElementById('shirtTemplate');
  
  if (!students || students.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.gridColumn = '1 / -1';
    emptyMsg.style.padding = '40px';
    emptyMsg.style.color = '#777';
    emptyMsg.innerHTML = '<span style="font-size:3rem;">🌸</span><br><br>Sorry, no students are in the class.';
    galleryContainer.appendChild(emptyMsg);
    return;
  }
  
  students.forEach(student => {
    const clone = document.importNode(template.content, true);
    
    // Title
    const nameEl = clone.querySelector('.student-author-name');
    nameEl.textContent = student.name;
    
    // Render pattern onto mini shirt canvas
    const canvas = clone.querySelector('.shirt-pattern-canvas');
    drawCrossStitch(canvas, student.drawingData || []);
    
    // Click behavior to open detailed view
    const itemCard = clone.querySelector('.vyshyvanka-item');
    itemCard.addEventListener('click', () => {
      openDetailedView(student);
    });
    
    galleryContainer.appendChild(clone);
  });
}

// Open modal for detailed shirt analysis
function openDetailedView(student) {
  selectedShirtData = student;
  modalStudentName.textContent = `Shirt: ${student.name} 🇺🇦`;
  shirtModal.style.display = 'flex';
  
  // Set dimensions higher for clearer modal rendering
  modalPatternCanvas.width = 300;
  modalPatternCanvas.height = 300;
  drawCrossStitch(modalPatternCanvas, student.drawingData);
}

// Close Modal
modalCloseBtn.addEventListener('click', () => {
  shirtModal.style.display = 'none';
  selectedShirtData = null;
});

// Download shirt pattern drawing
btnDownloadShirt.addEventListener('click', () => {
  if (!selectedShirtData) return;
  
  // We want to download the entire shirt + pattern together!
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = 600;
  exportCanvas.height = 660;
  const ctx = exportCanvas.getContext('2d');
  
  // Background fill (soft linen color)
  ctx.fillStyle = '#F5EFEB';
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  
  // Load and draw the traditional shirt image
  const img = new Image();
  img.src = 'vsyvanka_shirt.png';
  img.onload = function() {
    // Draw the shirt image centered and filling nicely (width 540, height 540, placed at x=30, y=30 - 5% padding)
    ctx.drawImage(img, 30, 30, 540, 540);
    
    // Now overlay the drawing pattern on the entire 600x600 area matching the student canvas logic
    const patternW = 600;
    const patternH = 600;
    
    const cw = patternW / GRID_COLS;
    const ch = patternH / GRID_ROWS;
    
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.8, cw * 0.22); // Thick threads
    
    selectedShirtData.drawingData.forEach(cell => {
      ctx.strokeStyle = cell.color;
      const p = cw * 0.12;
      const x1 = cell.x * cw + p;
      const y1 = cell.y * ch + p;
      const x2 = (cell.x + 1) * cw - p;
      const y2 = (cell.y + 1) * ch - p;
      
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.moveTo(x2, y1);
      ctx.lineTo(x1, y2);
      ctx.stroke();
    });
    
    // Draw the Student's name at the bottom
    ctx.fillStyle = '#8B0000';
    ctx.font = 'bold 36px "Comfortaa", Arial';
    ctx.textAlign = 'center';
    ctx.fillText(selectedShirtData.name, exportCanvas.width / 2, exportCanvas.height - 25);
    
    // Download trigger
    const link = document.createElement('a');
    link.download = `shirt_${selectedShirtData.name.toLowerCase().replace(/\s+/g, '_')}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  };
});

// Close modal clicking outside
window.addEventListener('click', (e) => {
  if (e.target === shirtModal) {
    shirtModal.style.display = 'none';
    selectedShirtData = null;
  }
  if (e.target === stencilModal) {
    stencilModal.style.display = 'none';
  }
});

// --- STENCIL EDITOR ACTIONS & GRID DRAWING ---

function isInsideDefaultShirtShape(x, y) {
  // 1. Block top-left empty corner (diagonal cut above left shoulder)
  if (x < 10 - y) return false;
  
  // 2. Block top-right empty corner (diagonal cut above right shoulder)
  if (x > 13 + y) return false;
  
  // 3. Block bottom corners below the cuffs
  if (y >= 22) {
    return x >= 5 && x <= 18;
  }
  
  return true;
}

function drawStencilCanvas() {
  if (!stencilCanvas) return;
  stencilCtx.clearRect(0, 0, stencilCanvas.width, stencilCanvas.height);
  
  const cw = stencilCanvas.width / GRID_COLS;
  const ch = stencilCanvas.height / GRID_ROWS;
  
  // Initialize to default shape if empty
  if (customStencil === null) {
    customStencil = new Set();
    for (let x = 0; x < GRID_COLS; x++) {
      for (let y = 0; y < GRID_ROWS; y++) {
        if (isInsideDefaultShirtShape(x, y)) {
          customStencil.add(`${x},${y}`);
        }
      }
    }
  }
  
  // Draw grid and translucent overlays
  for (let x = 0; x < GRID_COLS; x++) {
    for (let y = 0; y < GRID_ROWS; y++) {
      const key = `${x},${y}`;
      const isAllowed = customStencil.has(key);
      
      if (isAllowed) {
        stencilCtx.fillStyle = 'rgba(43, 122, 75, 0.35)'; // green for allowed
        stencilCtx.fillRect(x * cw, y * ch, cw, ch);
      } else {
        stencilCtx.fillStyle = 'rgba(30, 30, 30, 0.15)'; // gray for blocked
        stencilCtx.fillRect(x * cw, y * ch, cw, ch);
      }
      
      // Draw grid borders
      stencilCtx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
      stencilCtx.lineWidth = 0.5;
      stencilCtx.strokeRect(x * cw, y * ch, cw, ch);
    }
  }
}

function handleStencilInteraction(clientX, clientY) {
  if (!stencilCanvas) return;
  const rect = stencilCanvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  
  const gridX = Math.floor((x / rect.width) * GRID_COLS);
  const gridY = Math.floor((y / rect.height) * GRID_ROWS);
  
  if (gridX >= 0 && gridX < GRID_COLS && gridY >= 0 && gridY < GRID_ROWS) {
    const key = `${gridX},${gridY}`;
    const mode = document.querySelector('input[name="stencilMode"]:checked').value;
    
    if (mode === 'allow') {
      customStencil.add(key);
    } else {
      customStencil.delete(key);
    }
    
    drawStencilCanvas();
  }
}

// Mouse events for stencil canvas
if (stencilCanvas) {
  stencilCanvas.addEventListener('mousedown', (e) => {
    isStencilPainting = true;
    handleStencilInteraction(e.clientX, e.clientY);
  });

  stencilCanvas.addEventListener('mousemove', (e) => {
    if (isStencilPainting) {
      handleStencilInteraction(e.clientX, e.clientY);
    }
  });

  window.addEventListener('mouseup', () => {
    isStencilPainting = false;
  });

  // Touch events for stencil canvas (smart boards or tablets)
  stencilCanvas.addEventListener('touchstart', (e) => {
    isStencilPainting = true;
    if (e.touches.length > 0) {
      e.preventDefault();
      handleStencilInteraction(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  stencilCanvas.addEventListener('touchmove', (e) => {
    if (isStencilPainting && e.touches.length > 0) {
      e.preventDefault();
      handleStencilInteraction(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  window.addEventListener('touchend', () => {
    isStencilPainting = false;
  });
}

// Presets Listeners
if (presetAll) {
  presetAll.addEventListener('click', () => {
    customStencil = new Set();
    for (let x = 0; x < GRID_COLS; x++) {
      for (let y = 0; y < GRID_ROWS; y++) {
        if (isInsideDefaultShirtShape(x, y)) {
          customStencil.add(`${x},${y}`);
        }
      }
    }
    drawStencilCanvas();
  });
}

if (presetChest) {
  presetChest.addEventListener('click', () => {
    customStencil = new Set();
    for (let x = 9; x <= 14; x++) {
      for (let y = 2; y <= 12; y++) {
        customStencil.add(`${x},${y}`);
      }
    }
    drawStencilCanvas();
  });
}

if (presetSleeves) {
  presetSleeves.addEventListener('click', () => {
    customStencil = new Set();
    for (let x = 0; x < GRID_COLS; x++) {
      for (let y = 0; y < GRID_ROWS; y++) {
        if (isInsideDefaultShirtShape(x, y) && (x < 6 || x > 17) && y <= 21) {
          customStencil.add(`${x},${y}`);
        }
      }
    }
    drawStencilCanvas();
  });
}

if (presetFree) {
  presetFree.addEventListener('click', () => {
    customStencil = new Set();
    for (let x = 0; x < GRID_COLS; x++) {
      for (let y = 0; y < GRID_ROWS; y++) {
        customStencil.add(`${x},${y}`);
      }
    }
    drawStencilCanvas();
  });
}

if (presetClear) {
  presetClear.addEventListener('click', () => {
    customStencil = new Set();
    drawStencilCanvas();
  });
}

// Open/Close and Save Stencil Modal
if (btnOpenStencil) {
  btnOpenStencil.addEventListener('click', () => {
    stencilModal.style.display = 'flex';
    drawStencilCanvas();
  });
}

if (stencilModalCloseBtn) {
  stencilModalCloseBtn.addEventListener('click', () => {
    stencilModal.style.display = 'none';
  });
}

if (btnSaveStencil) {
  btnSaveStencil.addEventListener('click', () => {
    stencilModal.style.display = 'none';
    // Emit saving to the server
    socket.emit('teacher:save-stencil', {
      stencil: customStencil ? Array.from(customStencil) : null
    });
  });
}

// --- CONTROLLER ACTION LISTENERS ---

// Start session
btnStart.addEventListener('click', () => {
  const duration = durationSelect.value;
  socket.emit('teacher:start-session', { 
    duration: duration,
    stencil: customStencil ? Array.from(customStencil) : null
  });
});

// Force-stop session early
btnStop.addEventListener('click', () => {
  socket.emit('teacher:stop-session');
});

// Reset and return to lobby for a new session
btnReset.addEventListener('click', () => {
  // Emit reset event to server to clear the active state
  socket.emit('teacher:reset-session');
});
