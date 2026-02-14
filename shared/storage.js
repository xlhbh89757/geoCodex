// Data storage module using chrome.storage.local
const Storage = {
  // Save current session
  async saveSession(session) {
    await chrome.storage.local.set({ currentSession: session });
  },

  // Get current session
  async getSession() {
    const result = await chrome.storage.local.get("currentSession");
    return result.currentSession || null;
  },

  // Update session progress
  async updateProgress(progress) {
    const session = await this.getSession();
    if (session) {
      session.progress = progress;
      await this.saveSession(session);
    }
  },

  // Add result to current session
  async addResult(result) {
    const session = await this.getSession();
    if (session) {
      session.results.push(result);
      session.progress.completed += 1;
      session.progress.currentIndex += 1;
      await this.saveSession(session);
    }
  },

  // Save report summary to history
  async saveToHistory(reportData) {
    const result = await chrome.storage.local.get("history");
    const history = result.history || [];
    history.unshift(reportData);

    // Keep only last 10 records
    if (history.length > 10) {
      history.splice(10);
    }

    await chrome.storage.local.set({ history });
  },

  // Get history
  async getHistory() {
    const result = await chrome.storage.local.get("history");
    return result.history || [];
  },

  // Clear current session
  async clearSession() {
    await chrome.storage.local.remove("currentSession");
  }
};

// Expose globally for browser scripts
if (typeof window !== "undefined") {
  window.Storage = Storage;
}

// Optional CommonJS export for local testing
if (typeof module !== "undefined" && module.exports) {
  module.exports = Storage;
}
