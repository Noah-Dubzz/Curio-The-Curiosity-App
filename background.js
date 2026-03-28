// ============================================================
//  Curio Chrome Extension – Background Service Worker
//  Opens the app in a new tab when the toolbar icon is clicked.
//  API calls go directly to the Netlify proxy — no secrets here.
// ============================================================

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});
