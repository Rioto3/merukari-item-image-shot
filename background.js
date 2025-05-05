/**
 * メルカリ商品画像ダウンローダー
 * バックグラウンドスクリプト
 */

// ダウンロードキューと同時ダウンロード数の制限
const downloadQueue = [];
const MAX_CONCURRENT_DOWNLOADS = 2; // 同時ダウンロード数を2に減らす
const DOWNLOAD_DELAY = 2000; // ダウンロード間に2秒の遅延を追加
let activeDownloads = 0;

// デバッグログ
const DEBUG = true;
function logDebug(...args) {
  if (DEBUG) console.log('[メルカリ画像ダウンローダー]', ...args);
}

// メッセージリスナーを設定
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadImage') {
    logDebug('ダウンロード要求を受信:', message.url);
    
    // キューにダウンロード要求を追加
    downloadQueue.push({
      url: message.url,
      filename: message.filename
    });
    
    // キュー処理を開始
    processDownloadQueue();
  }
});

// ダウンロードキューを処理
function processDownloadQueue() {
  // すでに最大数のダウンロードが進行中ならリターン
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    logDebug(`最大同時ダウンロード数に達しています (${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS})`);
    return;
  }
  
  // キューが空なら処理しない
  if (downloadQueue.length === 0) {
    logDebug('キューが空です');
    return;
  }
  
  // キューから次のダウンロードを取得
  const download = downloadQueue.shift();
  activeDownloads++;
  
  logDebug(`ダウンロード開始: ${download.filename} (アクティブ: ${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS})`);
  
  // 遅延を追加してからダウンロードを実行
  setTimeout(() => {
    // ダウンロードを開始
    browser.downloads.download({
      url: download.url,
      filename: download.filename,
      conflictAction: 'uniquify'
    }).then(downloadId => {
      logDebug(`ダウンロードID: ${downloadId} を開始`);
      
      // ダウンロード完了リスナーを設定
      const listener = browser.downloads.onChanged.addListener(delta => {
        if (delta.id === downloadId && delta.state) {
          if (delta.state.current === 'complete') {
            logDebug(`ダウンロード完了: ${download.filename}`);
            
            // リスナーを削除
            browser.downloads.onChanged.removeListener(listener);
            
            // アクティブダウンロード数を減らす
            activeDownloads--;
            
            // 少し待ってから次のダウンロードを処理
            setTimeout(() => {
              processDownloadQueue();
            }, DOWNLOAD_DELAY);
          } 
          else if (delta.state.current === 'interrupted') {
            logDebug(`ダウンロード中断: ${download.filename}, 理由: ${delta.error?.current || '不明'}`);
            
            // リスナーを削除
            browser.downloads.onChanged.removeListener(listener);
            
            // アクティブダウンロード数を減らす
            activeDownloads--;
            
            // エラーが発生した場合も遅延を設けて次のダウンロードを処理
            setTimeout(() => {
              processDownloadQueue();
            }, DOWNLOAD_DELAY);
          }
        }
      });
    }).catch(error => {
      logDebug(`ダウンロードエラー: ${download.filename}`, error);
      activeDownloads--;
      
      // エラーが発生した場合も遅延を設けて次のダウンロードを処理
      setTimeout(() => {
        processDownloadQueue();
      }, DOWNLOAD_DELAY);
    });
  }, DOWNLOAD_DELAY);
}

// アドオンのインストール/更新時に実行
browser.runtime.onInstalled.addListener(details => {
  logDebug('メルカリ商品画像ダウンローダーがインストールされました', details);
});

// ダウンロード進捗リスナー
browser.downloads.onCreated.addListener(item => {
  if (item.filename && item.filename.includes('/m')) {
    logDebug(`新規ダウンロード開始: ${item.filename}`);
  }
});