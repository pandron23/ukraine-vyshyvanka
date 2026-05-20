const socket = io();

// Student views
const views = {
  login: document.getElementById('studentLoginView'),
  lobby: document.getElementById('studentLobbyView'),
  drawing: document.getElementById('studentDrawingView'),
  waiting: document.getElementById('studentWaitingView')
};

// UI Elements
const nameInput = document.getElementById('studentNameInput');
const btnJoin = document.getElementById('btnJoin');
const helloName = document.getElementById('helloName');
const timerText = document.getElementById('studentTimerText');
const btnClear = document.getElementById('btnClear');
const btnSubmit = document.getElementById('btnSubmit');

// Canvas details
const canvas = document.getElementById('vyshyvankaCanvas');
const ctx = canvas.getContext('2d');
const GRID_COLS = 24;
const GRID_ROWS = 24;

// Color Selection
let currentColor = '#D12B2B'; // Default to Traditional Red
const swatches = document.querySelectorAll('.color-swatch');
const customColorInput = document.getElementById('customColorInput');
const customSwatch = document.querySelector('.custom-color-swatch');
let allowedCells = null; // Set of allowed "x,y" coordinates from teacher's stencil

// Interactive Drawing State
let myStudentId = null;
let myName = '';
const gridState = {}; // Key: "x,y" -> Value: color string
let isPainting = false;

// --- STATE MANAGEMENT ---

function switchView(viewName) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[viewName].classList.add('active');
}

// --- SOCKET LISTENERS ---

// Confirm registration
socket.on('student:joined', (data) => {
  myStudentId = data.id;
  myName = data.name;
  helloName.textContent = myName;
  
  // Set allowed stencil cells
  allowedCells = data.stencil ? new Set(data.stencil) : null;
  
  if (data.status === 'lobby') {
    switchView('lobby');
  } else if (data.status === 'drawing') {
    // If joining mid-drawing session
    timerText.textContent = data.remainingTime;
    switchView('drawing');
    resizeAndDrawCanvas();
  } else if (data.status === 'finished') {
    switchView('waiting');
  }
});

// Teacher starts session
socket.on('session:started', (data) => {
  if (!myStudentId) return; // Not joined yet
  
  // Clear any previous drawing when starting a brand new session
  for (const key in gridState) {
    delete gridState[key];
  }
  
  // Set allowed stencil cells
  allowedCells = data.stencil ? new Set(data.stencil) : null;
  
  timerText.textContent = data.remainingTime;
  switchView('drawing');
  resizeAndDrawCanvas();
});

// Timer tick countdown
socket.on('session:tick', (data) => {
  timerText.textContent = data.remainingTime;
  
  // Visual alert when time is low
  const badge = document.getElementById('studentTimerBadge');
  if (data.remainingTime <= 10) {
    badge.style.background = 'rgba(209, 43, 43, 0.2)';
    badge.style.borderColor = 'var(--primary-red)';
    badge.style.transform = 'scale(1.1)';
  } else {
    badge.style.background = 'rgba(209, 43, 43, 0.1)';
    badge.style.borderColor = 'rgba(209, 43, 43, 0.2)';
    badge.style.transform = 'scale(1)';
  }
});

// Teacher forced session stop (time ended or button clicked)
socket.on('session:stopped', () => {
  if (!myStudentId) return;
  // Automatically submit whatever the student has drawn so far!
  submitDrawing();
});

// Broadcast finish
socket.on('session:finished', () => {
  if (!myStudentId) return;
  switchView('waiting');
});

// Reset session (reload client)
socket.on('session:reset', () => {
  location.reload();
});

// Stencil updated on server
socket.on('session:stencil-update', (data) => {
  allowedCells = data.stencil ? new Set(data.stencil) : null;
  // If student is currently drawing, redraw canvas to show new constraints
  if (views.drawing.classList.contains('active')) {
    resizeAndDrawCanvas();
  }
});

// Submit confirm
socket.on('student:submit-success', () => {
  switchView('waiting');
});

// --- LOBBY/LOGIN BEHAVIOR ---

btnJoin.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (name === '') {
    alert('Будь ласка, введіть своє ім\'я!');
    nameInput.focus();
    return;
  }
  socket.emit('student:join', { name: name });
});

// Allow Enter key press to join
nameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    btnJoin.click();
  }
});

// --- COLOR PALETTE CONTROLS ---

swatches.forEach(swatch => {
  swatch.addEventListener('click', (e) => {
    if (swatch.classList.contains('custom-color-swatch')) {
      // If clicking the swatch area but not the color input itself, trigger the color picker dialog
      if (e.target !== customColorInput) {
        customColorInput.click();
      }
      return;
    }
    
    swatches.forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    currentColor = swatch.getAttribute('data-color');
    
    // Reset custom swatch border style when standard color is selected
    if (customSwatch) {
      customSwatch.style.borderColor = 'white';
    }
  });
});

if (customColorInput) {
  // Listen to changes in the custom color picker
  customColorInput.addEventListener('input', (e) => {
    const color = e.target.value;
    currentColor = color;
    
    swatches.forEach(s => s.classList.remove('active'));
    customSwatch.classList.add('active');
    customSwatch.style.borderColor = color;
  });

  // Handle color input click specifically
  customColorInput.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent duplicate trigger from parent click
    swatches.forEach(s => s.classList.remove('active'));
    customSwatch.classList.add('active');
    currentColor = customColorInput.value;
    customSwatch.style.borderColor = currentColor;
  });
}

// --- CANVAS DRAWING ENGINE (CROSS-STITCH) ---

// Check if a grid coordinate lies inside the traditional shirt silhouette
function isInsideShirt(x, y) {
  // If teacher has set a custom stencil, check against that
  if (allowedCells) {
    return allowedCells.has(`${x},${y}`);
  }
  
  // y is from 0 to 23, x is from 0 to 23
  
  // 1. Block top-left empty corner (diagonal cut above left shoulder)
  if (x < 10 - y) return false;
  
  // 2. Block top-right empty corner (diagonal cut above right shoulder)
  if (x > 13 + y) return false;
  
  // 3. Block bottom corners below the cuffs (only the hemmed body exists at the bottom)
  if (y >= 22) {
    return x >= 5 && x <= 18;
  }
  
  // 4. All other areas are inside the shirt (chest, sleeves, cuffs, and body)
  return true;
}

// Setup responsive canvas pixel sizing
function resizeAndDrawCanvas() {
  // We want to keep the drawing canvas crisp and adapt to container size
  const parent = canvas.parentElement;
  const size = Math.min(parent.clientWidth - 20, 320); // adapt to mobile viewport
  canvas.width = size;
  canvas.height = size;
  
  drawCanvas();
}

// Watch window resize events
window.addEventListener('resize', resizeAndDrawCanvas);

// Main render function
function drawCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const cw = canvas.width / GRID_COLS;
  const ch = canvas.height / GRID_ROWS;
  
  // 1. Draw grid guidelines ONLY inside the shirt silhouette
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
  ctx.lineWidth = 0.8;
  
  for (let x = 0; x < GRID_COLS; x++) {
    for (let y = 0; y < GRID_ROWS; y++) {
      if (isInsideShirt(x, y)) {
        ctx.strokeRect(x * cw, y * ch, cw, ch);
      }
    }
  }
  
  // 2. Draw active cross-stitch cells
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.8, cw * 0.22); // Thick threads
  
  for (const key in gridState) {
    const [x, y] = key.split(',').map(Number);
    const color = gridState[key];
    
    ctx.strokeStyle = color;
    
    // Add micro-padding so threads look separated
    const p = cw * 0.12; 
    
    const x1 = x * cw + p;
    const y1 = y * ch + p;
    const x2 = (x + 1) * cw - p;
    const y2 = (y + 1) * ch - p;
    
    // Draw the X cross-stitch pattern
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.moveTo(x2, y1);
    ctx.lineTo(x1, y2);
    ctx.stroke();
  }
}

// Translate screen coordinates to grid coordinates and update
function handleDrawingInteraction(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  
  // Calculate relative coordinate offset
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  
  // Translate to grid cell columns/rows
  const gridX = Math.floor((x / rect.width) * GRID_COLS);
  const gridY = Math.floor((y / rect.height) * GRID_ROWS);
  
  // Verify bounds and shirt boundaries
  if (gridX >= 0 && gridX < GRID_COLS && gridY >= 0 && gridY < GRID_ROWS) {
    if (!isInsideShirt(gridX, gridY)) return; // Reject points outside shirt!
    
    const key = `${gridX},${gridY}`;
    
    if (currentColor === 'erase') {
      delete gridState[key];
    } else {
      gridState[key] = currentColor;
    }
    
    drawCanvas();
  }
}

// --- INPUT EVENT BINDINGS (MOUSE + TOUCH) ---

// Mouse Listeners
canvas.addEventListener('mousedown', (e) => {
  isPainting = true;
  handleDrawingInteraction(e.clientX, e.clientY);
});

canvas.addEventListener('mousemove', (e) => {
  if (isPainting) {
    handleDrawingInteraction(e.clientX, e.clientY);
  }
});

window.addEventListener('mouseup', () => {
  isPainting = false;
});

// Touch Listeners (Crucial for mobile phones!)
canvas.addEventListener('touchstart', (e) => {
  isPainting = true;
  if (e.touches.length > 0) {
    // Prevent scrolling/zooming when drawing
    e.preventDefault();
    handleDrawingInteraction(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (isPainting && e.touches.length > 0) {
    e.preventDefault();
    handleDrawingInteraction(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });

window.addEventListener('touchend', () => {
  isPainting = false;
});

// --- SUBMISSION ACTIONS ---

// Submit current drawing state
function submitDrawing() {
  // Convert gridState object to list form: [ { x, y, color } ]
  const list = Object.keys(gridState).map(key => {
    const [x, y] = key.split(',').map(Number);
    return { x, y, color: gridState[key] };
  });
  
  socket.emit('student:submit', { drawingData: list });
}

btnSubmit.addEventListener('click', () => {
  submitDrawing();
});

// Clear canvas
btnClear.addEventListener('click', () => {
  if (confirm('Ви впевнені, що хочете очистити весь візерунок?')) {
    for (const key in gridState) {
      delete gridState[key];
    }
    drawCanvas();
  }
});
