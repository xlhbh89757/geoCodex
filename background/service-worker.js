// Background service worker for GEO testing assistant
console.log("GEO Testing Assistant: Service worker initialized");

// Open sidepanel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});
