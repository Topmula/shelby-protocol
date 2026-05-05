require("node:dns/promises").setServers(["1.1.1.1", "8.8.8.8"]);
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected!'))
  .catch(err => console.error('MongoDB error:', err));

// USER SCHEMA
const userSchema = new mongoose.Schema({
  name: String,
  username: { type: String, unique: true, lowercase: true },
  password: String,
  xp: { type: Number, default: 0 },
  streak: { type: Number, default: 0 },
  lastCheckIn: String,
  lastTaskReset: String,
  totalTasksCompleted: { type: Number, default: 0 },
  tasks: [{
    id: Number,
    name: String,
    completed: { type: Boolean, default: false }
  }],
  badges: [{
    id: String,
    awardedAt: Date
  }],
  reflections: [{
    text: String,
    question: String,
    date: Date
  }],
  taskIdCounter: { type: Number, default: 5 },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.json({ success: false, message: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.json({ success: false, message: 'Invalid token' });
  }
}

const RANKS = [
  { rank: 15, name: 'STREET RAT', badge: '🐀', xpRequired: 0 },
  { rank: 14, name: 'BACK ALLEY BOY', badge: '🪨', xpRequired: 5 },
  { rank: 13, name: 'SMALL HEATH LOCAL', badge: '🏚️', xpRequired: 15 },
  { rank: 12, name: 'CORNER HUSTLER', badge: '🎲', xpRequired: 30 },
  { rank: 11, name: 'PEAKY RECRUIT', badge: '🧢', xpRequired: 50 },
  { rank: 10, name: 'PEAKY BLINDER', badge: '⚡', xpRequired: 75 },
  { rank: 9, name: 'STREET SOLDIER', badge: '🗡️', xpRequired: 105 },
  { rank: 8, name: 'GANG LIEUTENANT', badge: '🔫', xpRequired: 140 },
  { rank: 7, name: 'SHELBY ASSOCIATE', badge: '🥃', xpRequired: 180 },
  { rank: 6, name: 'SHELBY ENFORCER', badge: '💣', xpRequired: 220 },
  { rank: 5, name: 'SHELBY LIEUTENANT', badge: '🎩', xpRequired: 260 },
  { rank: 4, name: 'SHELBY CAPTAIN', badge: '⚔️', xpRequired: 295 },
  { rank: 3, name: 'SHELBY BROTHER', badge: '🩸', xpRequired: 320 },
  { rank: 2, name: 'SHELBY BLOOD', badge: '👁️', xpRequired: 345 },
  { rank: 1, name: 'THOMAS SHELBY', badge: '👑', xpRequired: 360 },
];

const XP = {
  TASK: 1,
  ALL_TASKS_BONUS: 5,
  REFLECTION: 2,
  CHECKIN: 1,
};

function getRankInfo(xp) {
  let current = RANKS[0];
  for (let r of RANKS) {
    if (xp >= r.xpRequired) current = r;
  }
  return current;
}

function awardBadge(user, badgeId) {
  if (!user.badges.find(b => b.id === badgeId)) {
    user.badges.push({ id: badgeId, awardedAt: new Date() });
  }
}

function checkDayReset(user) {
  const today = new Date().toDateString();
  if (user.lastTaskReset && user.lastTaskReset !== today) {
    const allDone = user.tasks.every(t => t.completed);
    if (!allDone) {
      user.streak = 0;
      const missed = user.tasks.filter(t => !t.completed).length;
      user.xp = Math.max(0, user.xp - missed);
    }
    user.tasks.forEach(t => t.completed = false);
  }
  user.lastTaskReset = today;
}

function sanitize(user) {
  const obj = user.toObject ? user.toObject() : user;
  delete obj.password;
  obj.rank = getRankInfo(obj.xp);
  obj.allRanks = RANKS;
  return obj;
}

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, username, password } = req.body;
    if (!name || !username || !password) return res.json({ success: false, message: 'All fields required' });
    const exists = await User.findOne({ username: username.toLowerCase() });
    if (exists) return res.json({ success: false, message: 'Username already taken' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name, username: username.toLowerCase(),
      password: hashedPassword,
      tasks: [
        { id: 1, name: 'Wake up before 6AM', completed: false },
        { id: 2, name: 'Exercise for 30 minutes', completed: false },
        { id: 3, name: 'Read for 20 minutes', completed: false },
        { id: 4, name: 'No social media before noon', completed: false },
      ],
    });
    awardBadge(user, 'FIRST_LOGIN');
    await user.save();
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    res.json({ success: true, token, user: sanitize(user) });
  } catch (err) {
    res.json({ success: false, message: 'Registration failed' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.json({ success: false, message: 'Username not found' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.json({ success: false, message: 'Wrong password' });
    checkDayReset(user);
    await user.save();
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    res.json({ success: true, token, user: sanitize(user) });
  } catch (err) {
    res.json({ success: false, message: 'Login failed' });
  }
});

// Get me
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.json({ success: false, message: 'User not found' });
    checkDayReset(user);
    const today = new Date().toDateString();
    if (user.lastCheckIn !== today) {
      user.lastCheckIn = today;
      user.xp += XP.CHECKIN;
      awardBadge(user, 'FIRST_CHECKIN');
      if (user.streak >= 3) awardBadge(user, 'STREAK_3');
      if (user.streak >= 7) awardBadge(user, 'STREAK_7');
      if (user.streak >= 14) awardBadge(user, 'STREAK_14');
      if (user.streak >= 30) awardBadge(user, 'STREAK_30');
    }
    await user.save();
    res.json({ success: true, user: sanitize(user) });
  } catch (err) {
    res.json({ success: false, message: 'Error fetching user' });
  }
});

// Complete task
app.post('/api/task/complete', authMiddleware, async (req, res) => {
  try {
    const { taskId } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.json({ success: false });
    const task = user.tasks.find(t => t.id === taskId);
    if (!task) return res.json({ success: false });
    const prevRank = getRankInfo(user.xp);
    if (!task.completed) {
      task.completed = true;
      user.xp += XP.TASK;
      user.totalTasksCompleted += 1;
      awardBadge(user, 'FIRST_TASK');
      if (user.totalTasksCompleted >= 10) awardBadge(user, 'TASKS_10');
      if (user.totalTasksCompleted >= 50) awardBadge(user, 'TASKS_50');
      if (user.totalTasksCompleted >= 100) awardBadge(user, 'TASKS_100');
      const allDone = user.tasks.every(t => t.completed);
      if (allDone) {
        user.streak += 1;
        user.xp += XP.ALL_TASKS_BONUS;
        awardBadge(user, 'FULL_LOCKDOWN');
      }
    } else {
      task.completed = false;
      user.xp = Math.max(0, user.xp - XP.TASK);
      user.totalTasksCompleted = Math.max(0, user.totalTasksCompleted - 1);
    }
    const newRank = getRankInfo(user.xp);
    if (newRank.rank < prevRank.rank) {
      awardBadge(user, `RANK_${newRank.name}`);
      if (newRank.rank === 1) awardBadge(user, 'THOMAS_SHELBY');
    }
    await user.save();
    res.json({
      success: true,
      user: sanitize(user),
      rankChanged: newRank.rank !== prevRank.rank,
      rankUp: newRank.rank < prevRank.rank,
      newRank
    });
  } catch (err) {
    res.json({ success: false, message: 'Error completing task' });
  }
});

// Add task
app.post('/api/task/add', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    const user = await User.findById(req.user.id);
    if (!user || !name) return res.json({ success: false });
    user.tasks.push({ id: user.taskIdCounter++, name, completed: false });
    await user.save();
    res.json({ success: true, user: sanitize(user) });
  } catch (err) {
    res.json({ success: false });
  }
});

// Delete task
app.delete('/api/task/:id', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.json({ success: false });
    user.tasks = user.tasks.filter(t => t.id !== parseInt(req.params.id));
    await user.save();
    res.json({ success: true, user: sanitize(user) });
  } catch (err) {
    res.json({ success: false });
  }
});

// Save reflection
app.post('/api/reflection', authMiddleware, async (req, res) => {
  try {
    const { text, question } = req.body;
    const user = await User.findById(req.user.id);
    if (!user || !text) return res.json({ success: false });
    user.reflections.push({ text, question, date: new Date() });
    user.xp += XP.REFLECTION;
    awardBadge(user, 'FIRST_REFLECTION');
    if (user.reflections.length >= 7) awardBadge(user, 'DEEP_THINKER');
    await user.save();
    res.json({ success: true, user: sanitize(user) });
  } catch (err) {
    res.json({ success: false });
  }
});

// Tommy AI
app.post('/api/tommy', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.json({ success: false });
    const rank = getRankInfo(user.xp);
    const completedToday = user.tasks.filter(t => t.completed).length;
    const totalTasks = user.tasks.length;
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 150,
        messages: [
          {
            role: 'system',
            content: `You are Thomas Shelby from Peaky Blinders. Cold. Sharp. No warmth unless earned. Maximum 3 sentences. Speaking to ${user.name} who is ranked "${rank.name}" with ${user.xp} XP. They completed ${completedToday}/${totalTasks} tasks today. Streak: ${user.streak} days. Reference their name and progress. Sign off as Tommy Shelby.`
          },
          {
            role: 'user',
            content: `Give ${user.name} their daily orders.`
          }
        ]
      })
    });
    const data = await response.json();
    const message = data.choices[0].message.content;
    res.json({ success: true, message });
  } catch (error) {
    res.json({ success: true, message: `Do the work. No excuses. — Tommy Shelby` });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Shelby Protocol running on http://localhost:${process.env.PORT}`);
});