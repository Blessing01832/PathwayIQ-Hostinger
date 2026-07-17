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
  port: process.env.DB_PORT || 3306,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// --- Authentication Middleware ---
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const [rows] = await pool.query('SELECT id FROM users WHERE id = ?', [decoded.id]);
      if (rows.length === 0) {
        const error = new Error('Not authorized, user for this token no longer exists');
        error.statusCode = 401;
        return next(error);
      }
      
      req.user = { id: decoded.id }; // Adds user payload to request
      next();
    } catch (error) {
      const err = new Error('Not authorized, token failed');
      err.statusCode = 401;
      next(err);
    }
  } else {
    const error = new Error('Not authorized, no token');
    error.statusCode = 401;
    next(error);
  }
};

// --- Middleware ---

// Enable Cross-Origin Resource Sharing (CORS)
const corsOptions = {
  // Use environment variables for production URLs to avoid hardcoding.
  origin: [
    'http://localhost', // For local development
    'http://127.0.0.1', // For local development
    'http://127.0.0.1:8080', // For live-server local development
    process.env.FRONTEND_URL, // e.g., https://adaptroute.com
    process.env.FRONTEND_URL_WWW // e.g., https://www.adaptroute.com
  ].filter(Boolean), // This removes any undefined entries if the env vars aren't set
};
app.use(cors(corsOptions));

// Enable the express server to parse JSON request bodies
app.use(express.json());

// --- API Routes ---

/**
 * @route   POST /api/analyze
 * @desc    Receives user state and returns a full academic profile analysis.
 * @access  Public
 */
app.post('/api/analyze', (req, res, next) => {
  try {
    // The 'state' object from the frontend is in the request body
    const userState = req.body;

    // The core logic is now encapsulated in the analysisEngine
    const profile = runAnalysis(userState);

    // Send the complete profile back to the frontend
    res.json(profile);
  } catch (error) {
    console.error('Analysis Error:', error);
    next(error); // Pass to centralized handler
  }
});

// --- User Authentication API Routes ---

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
app.post('/api/auth/register', async (req, res, next) => {
  const { username, email, password } = req.body;
  if (!username || username.trim().length < 3 || !email || !password || password.length < 6) {
    return res.status(400).json({ message: 'Username must be at least 3 characters, and password at least 6 characters.' });
  }
  try {
    const trimmedUsername = username.trim();
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const [result] = await pool.query('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [trimmedUsername, email, hashedPassword]);
    const userId = result.insertId;
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, username: trimmedUsername, email });
  } catch (error) {
    console.error('Registration Error:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      const message = error.message.includes('email') ? 'Email already exists' : 'Username already exists';
      return res.status(400).json({ message });
    }
    next(error); // Pass to centralized handler
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user and get token
 * @access  Public
 */
app.post('/api/auth/login', async (req, res, next) => {
  // Allow login with either email or username
  const { identifier, password } = req.body;
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ? OR name = ?', [identifier, identifier]);
    const user = rows[0];
    if (user && (await bcrypt.compare(password, user.password))) {
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
      res.json({ token, username: user.name, email: user.email });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login Error:', error);
    next(error); // Pass to centralized handler
  }
});

// --- Profile Persistence API Routes ---

/**
 * @route   POST /api/profiles
 * @desc    Save a user's profile
 * @access  Private
 */
app.post('/api/profiles', protect, async (req, res, next) => {
  const userId = req.user.id;
  const profileData = req.body;
  try {
    await pool.query('INSERT INTO profiles (user_id, profile_data) VALUES (?, ?)', [userId, JSON.stringify(profileData)]);
    res.status(201).json({ message: 'Profile saved successfully' });
  } catch (error) {
    console.error('Save Profile Error:', error);
    next(error); // Pass to centralized handler
  }
});

/**
 * @route   GET /api/profiles/latest
 * @desc    Get the latest profile for a user
 * @access  Private
 */
app.get('/api/profiles/latest', protect, async (req, res, next) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.query('SELECT profile_data FROM profiles WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId]);
    if (rows.length > 0) {
      res.json(rows[0].profile_data);
    } else {
      res.status(404).json({ message: 'No profiles found' });
    }
  } catch (error) {
    console.error('Get Latest Profile Error:', error);
    next(error); // Pass to centralized handler
  }
});

// --- Centralized Error Handler ---
// This middleware must be the last one in the chain.
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    message: err.message || 'An internal server error occurred.',
    // Only include the stack trace in development for debugging
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};

app.use(errorHandler);

// --- Server Activation ---
const startServer = async () => {
  try {
    // Test the database connection before starting the server
    const connection = await pool.getConnection();
    console.log('✅ Successfully connected to the database.');
    connection.release();

    // If connection is successful, start listening for requests
    app.listen(PORT, () => console.log(`PathwayIQ server running on port ${PORT}`));

  } catch (error) {
    console.error('❌ Failed to connect to the database. Please ensure Docker is running and the .env file is configured correctly.');
    console.error('Error details:', error.message);
    process.exit(1);
  }
};

startServer();