const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const os = require('os');
const path = require('path');
const fs = require('fs');

const STENCIL_FILE_PATH = path.join(__dirname, 'stencil.json');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Load stencil persistently on startup
let loadedStencil = null;
try {
  if (fs.existsSync(STENCIL_FILE_PATH)) {
    const data = fs.readFileSync(STENCIL_FILE_PATH, 'utf8');
    loadedStencil = JSON.parse(data);
    console.log('📦 Успішно завантажено збережений трафарет із файлу stencil.json');
  }
} catch (err) {
  console.error('⚠️ Помилка при завантаженні трафарету:', err);
}

// Game/Session State
let sessionState = {
  status: 'lobby', // 'lobby', 'drawing', 'finished'
  duration: 60,     // drawing time in seconds
  remainingTime: 0,
  students: {},     // socketId -> { name, drawingData, submitted, isConnected }
  teacherSocketId: null,
  stencil: loadedStencil // use persistent loaded stencil
};

let timerInterval = null;

// Helper to get local network IP address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    const addresses = interfaces[interfaceName];
    for (const addr of addresses) {
      // Look for IPv4 and non-internal loopback addresses
      if (addr.family === 'IPv4' && !addr.internal) {
        // Exclude virtual machine host adapters if possible, but return first valid IP
        if (interfaceName.toLowerCase().includes('virtual') || interfaceName.toLowerCase().includes('vbox')) {
          continue;
        }
        return addr.address;
      }
    }
  }
  // Fallback to localhost if no active network adapter found
  return 'localhost';
}

const localIp = getLocalIpAddress();
const localUrl = `https://ukraine-vyshyvanka.onrender.com/`;

console.log('==================================================');
console.log('🇺🇦 СЕРВЕР «УРОК ВИШИВАНКИ» ЗАПУСКАЄТЬСЯ...');
console.log(`🔗 Адреса для підключення учнів: https://ukraine-vyshyvanka.onrender.com/`);
console.log(`👨‍🏫 Адреса для входу вчителя: https://ukraine-vyshyvanka.onrender.com/teacher.html`);
console.log('==================================================');

// Socket.io Connection Logic
io.on('connection', (socket) => {
  // 1. Teacher Identification
  socket.on('teacher:init', () => {
    sessionState.teacherSocketId = socket.id;
    console.log('👨‍🏫 Учитель підключився');
    
    // Send current session state to teacher
    socket.emit('teacher:state', {
      status: sessionState.status,
      duration: sessionState.duration,
      remainingTime: sessionState.remainingTime,
      students: getCleanStudentsList(),
      localUrl: localUrl,
      stencil: sessionState.stencil
    });
  });

  // 2. Student Joins
  socket.on('student:join', (data) => {
    const { name } = data;
    if (!name || name.trim() === '') return;

    console.log(`👶 Учень приєднався: ${name}`);

    // Register student
    sessionState.students[socket.id] = {
      name: name.trim(),
      drawingData: null,
      submitted: false,
      isConnected: true
    };

    // Confirm join to student and send current state
    socket.emit('student:joined', {
      id: socket.id,
      name: name.trim(),
      status: sessionState.status,
      duration: sessionState.duration,
      remainingTime: sessionState.remainingTime,
      stencil: sessionState.stencil
    });

    // Notify teacher
    notifyTeacherStudentsList();
  });

  // 3. Teacher starts drawing session
  socket.on('teacher:start-session', (config) => {
    if (sessionState.status === 'drawing') return;

    const duration = parseInt(config.duration) || 60;
    sessionState.status = 'drawing';
    sessionState.duration = duration;
    sessionState.remainingTime = duration;
    sessionState.stencil = config.stencil || null;

    // Reset students' submission states and drawings for the new session
    for (const id in sessionState.students) {
      sessionState.students[id].drawingData = null;
      sessionState.students[id].submitted = false;
    }

    console.log(`🚀 Малювання розпочато! Час: ${duration} секунд.`);

    // Broadcast session start to all connected clients
    io.emit('session:started', {
      duration: duration,
      remainingTime: duration,
      stencil: sessionState.stencil
    });

    notifyTeacherStudentsList();

    // Start Timer Interval
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      sessionState.remainingTime--;

      // Broadcast remaining time tick
      io.emit('session:tick', { remainingTime: sessionState.remainingTime });

      if (sessionState.remainingTime <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        finishSession();
      }
    }, 1000);
  });
  // Reset session back to lobby (e.g. for a new lesson)
  socket.on('teacher:reset-session', () => {
    console.log('🔄 Вчитель перезапустив урок. Перехід у лобі.');
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    
    // Clear students but keep their socket connections or reset their drawing state
    // Let's reset the entire sessionState, but keep teacherSocketId and PRESERVE stencil!
    const oldTeacherId = sessionState.teacherSocketId;
    sessionState = {
      status: 'lobby',
      duration: 60,
      remainingTime: 0,
      students: {},
      teacherSocketId: oldTeacherId,
      stencil: sessionState.stencil // Keep the active stencil
    };
    
    // Tell all connected clients to reload or redirect to lobby
    io.emit('session:reset');
  });

  // Save stencil persistently on server
  socket.on('teacher:save-stencil', (data) => {
    sessionState.stencil = data.stencil || null;
    console.log('💾 Отримано оновлений трафарет від вчителя. Збереження у stencil.json...');
    try {
      fs.writeFileSync(STENCIL_FILE_PATH, JSON.stringify(sessionState.stencil), 'utf8');
      console.log('✅ Трафарет успішно збережено на сервері!');
    } catch (err) {
      console.error('❌ Не вдалося зберегти трафарет у файл:', err);
    }
    
    // Dynamically update any currently connected students
    io.emit('session:stencil-update', { stencil: sessionState.stencil });
  });
  // 4. Teacher terminates/finishes session early
  socket.on('teacher:stop-session', () => {
    if (sessionState.status !== 'drawing') return;
    console.log('⏱️ Вчитель достроково завершив малювання.');
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    finishSession();
  });

  // 5. Student submits their drawing
  socket.on('student:submit', (data) => {
    const student = sessionState.students[socket.id];
    if (!student) return;

    student.drawingData = data.drawingData;
    student.submitted = true;

    console.log(`💾 Малюнок отримано від: ${student.name}`);

    // Notify teacher that someone submitted
    notifyTeacherStudentsList();

    // Let student know submission was successful
    socket.emit('student:submit-success');

    // Check if everyone has submitted (optional auto-finish)
    checkIfAllSubmitted();
  });

  // 6. Handle Disconnects
  socket.on('disconnect', () => {
    if (socket.id === sessionState.teacherSocketId) {
      console.log('👨‍🏫 Учитель відключився');
      sessionState.teacherSocketId = null;
    } else if (sessionState.students[socket.id]) {
      const student = sessionState.students[socket.id];
      console.log(`🔌 Учень відключився: ${student.name}`);
      
      if (sessionState.status === 'lobby') {
        // Remove completely in lobby state
        delete sessionState.students[socket.id];
      } else {
        // Keep their record but mark as disconnected so their drawing isn't lost
        student.isConnected = false;
      }
      
      notifyTeacherStudentsList();
    }
  });
});

// Helper to construct clean list of students for sending to clients
function getCleanStudentsList() {
  return Object.keys(sessionState.students).map(id => ({
    id: id,
    name: sessionState.students[id].name,
    submitted: sessionState.students[id].submitted,
    isConnected: sessionState.students[id].isConnected,
    drawingData: sessionState.students[id].drawingData // Only needed on finish, but safe to include
  }));
}

// Send updated list of students to the teacher
function notifyTeacherStudentsList() {
  if (sessionState.teacherSocketId) {
    io.to(sessionState.teacherSocketId).emit('teacher:students-update', getCleanStudentsList());
  }
}

// Finish drawing phase and transition to results
function finishSession() {
  sessionState.status = 'finished';
  console.log('🏁 Сесія завершена. Збір малюнків...');

  // Force all students to submit their current drawing
  io.emit('session:stopped');

  // Wait a short delay for final packets to arrive, then broadcast final results to teacher
  setTimeout(() => {
    if (sessionState.teacherSocketId) {
      io.to(sessionState.teacherSocketId).emit('session:results', getCleanStudentsList());
    }
    // Update student screens to finish state
    io.emit('session:finished');
  }, 1000);
}

// Auto-finish drawing state if everyone has submitted
function checkIfAllSubmitted() {
  const activeStudents = Object.values(sessionState.students).filter(s => s.isConnected);
  if (activeStudents.length > 0 && activeStudents.every(s => s.submitted)) {
    if (sessionState.status === 'drawing') {
      console.log('✨ Всі учні надіслали малюнки. Завершуємо раніше!');
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      finishSession();
    }
  }
}

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`📡 Сервер успішно запущено на порту ${PORT}`);
});
