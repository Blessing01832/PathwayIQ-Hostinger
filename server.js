require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { runAnalysis } = require('./analysisEngine');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Database Connection Pool ---
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// --- Authentication Middleware ---
const protect = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: 'Not authorized, token failed' });
      }
      req.user = decoded; // Adds user payload (e.g., { id: userId }) to request
      next();
    });
  } else {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

// --- Middleware ---

// Enable Cross-Origin Resource Sharing (CORS)
// This allows your frontend (even on a different port/domain) to talk to this server.
app.use(cors());

// Enable the express server to parse JSON request bodies
app.use(express.json());

// --- API Routes ---

/**
 * @route   POST /api/analyze
 * @desc    Receives user state and returns a full academic profile analysis.
 * @access  Public
 */
app.post('/api/analyze', (req, res) => {
  try {
    // The 'state' object from the frontend is in the request body
    const userState = req.body;

    // The core logic is now encapsulated in the analysisEngine
    const profile = runAnalysis(userState);

    // Send the complete profile back to the frontend
    res.json(profile);
  } catch (error) {
    console.error('Analysis Error:', error);
    res.status(500).json({ message: `An error occurred on the server: ${error.message}` });
  }
});

// --- User Authentication API Routes ---

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Please provide email and password' });
  }
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const [result] = await pool.query('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);
    const userId = result.insertId;
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, email });
  } catch (error) {
    console.error('Registration Error:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Email already exists' });
    }
    res.status(500).json({ message: `Server error during registration: ${error.message}` });
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user and get token
 * @access  Public
 */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (user && (await bcrypt.compare(password, user.password))) {
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
      res.json({ token, email: user.email });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: `Server error during login: ${error.message}` });
  }
});

// --- Profile Persistence API Routes ---

/**
 * @route   POST /api/profiles
 * @desc    Save a user's profile
 * @access  Private
 */
app.post('/api/profiles', protect, async (req, res) => {
  const userId = req.user.id;
  const profileData = req.body;
  try {
    await pool.query('INSERT INTO profiles (user_id, profile_data) VALUES (?, ?)', [userId, JSON.stringify(profileData)]);
    res.status(201).json({ message: 'Profile saved successfully' });
  } catch (error) {
    console.error('Save Profile Error:', error);
    res.status(500).json({ message: `Server error saving profile: ${error.message}` });
  }
});

/**
 * @route   GET /api/profiles/latest
 * @desc    Get the latest profile for a user
 * @access  Private
 */
app.get('/api/profiles/latest', protect, async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.query('SELECT profile_data FROM profiles WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId]);
    rows.length > 0 ? res.json(rows[0].profile_data) : res.status(404).json({ message: 'No profiles found' });
  } catch (error) {
    console.error('Get Latest Profile Error:', error);
    res.status(500).json({ message: `Server error getting profile: ${error.message}` });
  }
});

// --- Server Activation ---
app.listen(PORT, () => console.log(`PathwayIQ server running on port ${PORT}`));