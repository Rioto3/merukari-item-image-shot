/**
 * メルカリ商品画像ダウンローダー
 * バックグラウンドスクリプト
 */

// ダウンロードキューと同時ダウンロード数の制限
const downloadQueue = [];
const MAX_CONCURRENT_DOWNLOADS = 1; // 同時ダウンロード数を1に減らす
const DOWNLOAD_DELAY = 3000; // ダウンロード間に3秒の遅延を追加
const RETRY_ATTEMPTS = 3;  // ダウンロード失敗時の再試行回数
let activeDownloads = 0;

// デバッグログ
const DEBUG = true;
function logDebug(...args) {
  if (DEBUG) console.log('[メルカリ画像ダウンローダー]', ...args);
}

// 成功 / 失敗カウンター
let successCount = 0;
let failureCount = 0;

// メッセージリスナーを設定
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadImage') {
    logDebug('ダウンロード要求を受信:', message.url);
    
    // キューにダウンロード要求を追加
    downloadQueue.push({
      url: message.url,
      filename: message.filename,
      attempts: 0  // 試行回数初期化
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
  
  logDebug(`ダウンロード開始: ${download.filename} (アクティブ: ${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS}, 試行: ${download.attempts + 1}/${RETRY_ATTEMPTS})`);
  
  // 遅延を追加してからダウンロードを実行
  setTimeout(() => {
    // ダウンロードを開始
    browser.downloads.download({
      url: download.url,
      filename: download.filename,
      conflictAction: 'uniquify',
      saveAs: false
    }).then(downloadId => {
      logDebug(`ダウンロードID: ${downloadId} を開始`);
      
      // ダウンロード完了リスナーを設定
      const listener = browser.downloads.onChanged.addListener(delta => {
        if (delta.id === downloadId && delta.state) {
          if (delta.state.current === 'complete') {
            logDebug(`ダウンロード完了: ${download.filename}`);
            successCount++;
            
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
            
            // 再試行するかどうか判断
            if (download.attempts < RETRY_ATTEMPTS - 1) {
              logDebug(`ダウンロードを再試行します: ${download.filename} (${download.attempts + 1}/${RETRY_ATTEMPTS})`);
              download.attempts++;
              // キューの先頭に再追加
              downloadQueue.unshift(download);
            } else {
              failureCount++;
              logDebug(`最大試行回数に達しました: ${download.filename}`);
            }
            
            // エラーが発生した場合、より長い遅延を設けて次のダウンロードを処理
            setTimeout(() => {
              processDownloadQueue();
            }, DOWNLOAD_DELAY * 2);
          }
        }
      });
    }).catch(error => {
      logDebug(`ダウンロードエラー: ${download.filename}`, error);
      
      activeDownloads--;
      
      // 再試行するかどうか判断
      if (download.attempts < RETRY_ATTEMPTS - 1) {
        logDebug(`ダウンロードを再試行します: ${download.filename} (${download.attempts + 1}/${RETRY_ATTEMPTS})`);
        download.attempts++;
        // キューの先頭に再追加
        downloadQueue.unshift(download);
      } else {
        failureCount++;
        logDebug(`最大試行回数に達しました: ${download.filename}`);
      }
      
      // エラーが発生した場合、より長い遅延を設けて次のダウンロードを処理
      setTimeout(() => {
        processDownloadQueue();
      }, DOWNLOAD_DELAY * 2);
    });
  }, DOWNLOAD_DELAY);
}

// アドオンのインストール/更新時に実行
browser.runtime.onInstalled.addListener(details => {
  logDebug('メルカリ商品画像ダウンローダーがインストールされました', details);
  // カウンターリセット
  successCount = 0;
  failureCount = 0;
});

// ダウンロード進捗リスナー
browser.downloads.onCreated.addListener(item => {
  if (item.filename && item.filename.includes('/m')) {
    logDebug(`新規ダウンロード開始: ${item.filename}`);
  }
});