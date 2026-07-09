/**
 * Browser-side player history and streak persistence engine.
 * Stores data safely via localStorage to keep operations 100% free.
 */

const STORAGE_KEY = 'letter_punk_stats_v1';

// Default empty statistics blueprint
const defaultStats = {
  gamesPlayed: 0,
  gamesWon: 0,
  currentStreak: 0,
  maxStreak: 0,
  lastPlayedDate: '', // Format: "YYYY-MM-DD"
  solveDistribution: {
    twoWords: 0,
    threeWords: 0,
    fourWords: 0,
    fiveOrMoreWords: 0
  },
  historyLog: [] // Array of pristine daily summary objects
};

/**
 * Create a fresh, fully-shaped stats object to avoid shared references.
 */
function makeDefaultStats() {
  return {
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastPlayedDate: '',
    solveDistribution: {
      twoWords: 0,
      threeWords: 0,
      fourWords: 0,
      fiveOrMoreWords: 0,
    },
    historyLog: [],
  };
}

function normalizeStats(raw) {
  const base = makeDefaultStats();
  const incoming = raw && typeof raw === 'object' ? raw : {};
  const incomingDistribution = incoming.solveDistribution && typeof incoming.solveDistribution === 'object'
    ? incoming.solveDistribution
    : {};

  return {
    ...base,
    ...incoming,
    solveDistribution: {
      ...base.solveDistribution,
      ...incomingDistribution,
    },
    historyLog: Array.isArray(incoming.historyLog) ? incoming.historyLog : [],
  };
}

/**
 * Safely extract historical player records from browser storage.
 */
export function getPlayerStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return makeDefaultStats();

    // Merge structure to protect against backwards-compatibility crashes if schema updates.
    return normalizeStats(JSON.parse(raw));
  } catch {
    return makeDefaultStats();
  }
}

/**
 * Record a finalized puzzle attempt and dynamically compute active streaks.
 * @param {string} puzzleId The ISO Date string identifying the puzzle (e.g. "2026-07-08").
 * @param {boolean} isWon Did they successfully consume every letter on the board?
 * @param {number} totalWords How many words were in their accepted chain?
 */
export function recordFinishedGame(puzzleId, isWon, totalWords) {
  const stats = getPlayerStats();
  
  // Clean sanitation: prevent double-logging if a user restarts a day they already completed
  const alreadyLogged = stats.historyLog.some(entry => entry.puzzleId === puzzleId);
  if (alreadyLogged) return stats;

  stats.gamesPlayed++;
  
  if (isWon) {
    stats.gamesWon++;
    
    // Evaluate word length distribution
    if (totalWords === 2) stats.solveDistribution.twoWords++;
    else if (totalWords === 3) stats.solveDistribution.threeWords++;
    else if (totalWords === 4) stats.solveDistribution.fourWords++;
    else stats.solveDistribution.fiveOrMoreWords++;

    // Calculate streak continuity rules
    const yesterdayStr = getRelativeDateString(-1);
    
    if (stats.lastPlayedDate === yesterdayStr) {
      // Continuing the hot streak
      stats.currentStreak++;
    } else if (stats.lastPlayedDate !== puzzleId) {
      // Streak snapped or restarted after a break
      stats.currentStreak = 1;
    }
    
    // Lock in highest peak record
    if (stats.currentStreak > stats.maxStreak) {
      stats.maxStreak = stats.currentStreak;
    }
  } else {
    // The player gave up/quit: Break active consecutive win streak
    stats.currentStreak = 0;
  }

  // Update absolute bookmarks
  stats.lastPlayedDate = puzzleId;
  stats.historyLog.push({
    puzzleId,
    timestamp: Date.now(),
    isWon,
    wordCount: isWon ? totalWords : null
  });

  // Commit compressed payload to local system profile
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch (e) {
    console.error("Storage vault restricted: ", e);
  }

  return stats;
}

/**
 * Helper to generate an ISO date string offset by specific days.
 */
function getRelativeDateString(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
