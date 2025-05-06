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

// フォルダ作成を確実にする関数
async function ensureDirectoryExists(itemId) {
  logDebug(`フォルダ作成の確認: ${itemId}`);
  try {
    // 空ファイルでフォルダを作成
    const downloadId = await browser.downloads.download({
      url: 'data:text/plain,',
      filename: `${itemId}/.folder_marker`,
      conflictAction: 'uniquify',
      saveAs: false
    });
    
    return new Promise((resolve, reject) => {
      const listener = browser.downloads.onChanged.addListener(delta => {
        if (delta.id === downloadId && delta.state) {
          if (delta.state.current === 'complete') {
            browser.downloads.onChanged.removeListener(listener);
            resolve(true);
          } else if (delta.state.current === 'interrupted') {
            browser.downloads.onChanged.removeListener(listener);
            // エラーがあってもフォルダは作成されている場合があるので成功とみなす
            resolve(true);
          }
        }
      });
      
      // 10秒のタイムアウト
      setTimeout(() => {
        browser.downloads.onChanged.removeListener(listener);
        // タイムアウトしても続行（フォルダ作成は成功している可能性あり）
        resolve(true);
      }, 10000);
    });
  } catch (error) {
    logDebug(`フォルダ作成エラー: ${error.message}`);
    // エラーがあっても処理を続行
    return Promise.resolve(true);
  }
}

// 代替ダウンロード方法 - コンテンツスクリプトに送信して処理
async function downloadWithContentScript(url, filename) {
  logDebug(`代替ダウンロード方法を使用: ${filename}`);
  try {
    // アクティブなタブにメッセージを送信
    const tabs = await browser.tabs.query({active: true, currentWindow: true});
    if (tabs.length > 0) {
      await browser.tabs.sendMessage(tabs[0].id, {
        action: 'alternativeDownload',
        url: url,
        filename: filename
      });
      return true;
    }
    return false;
  } catch (error) {
    logDebug(`代替ダウンロードエラー: ${error.message}`);
    return false;
  }
}

// メッセージリスナーを設定
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadImage') {
    logDebug('ダウンロード要求を受信:', message.url);
    
    // フォルダパス抽出
    const folderName = message.filename.split('/')[0];
    
    // フォルダを先に作成してからダウンロード
    ensureDirectoryExists(folderName)
      .then(() => {
        // キューにダウンロード要求を追加
        downloadQueue.push({
          url: message.url,
          filename: message.filename,
          attempts: 0  // 試行回数初期化
        });
        
        // キュー処理を開始
        processDownloadQueue();
      })
      .catch(error => {
        logDebug(`フォルダ作成中にエラー: ${error.message}`);
        // エラーが発生しても続行を試みる
        downloadQueue.push({
          url: message.url,
          filename: message.filename,
          attempts: 0
        });
        processDownloadQueue();
      });
  }
  // ダウンロード成功のメッセージを受け取る
  else if (message.action === 'downloadSuccess') {
    logDebug(`コンテンツスクリプトからダウンロード成功の通知: ${message.filename}`);
    successCount++;
    activeDownloads--;
    
    // 次のダウンロードを処理
    setTimeout(() => {
      processDownloadQueue();
    }, DOWNLOAD_DELAY);
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
    // 通常のダウンロードを試みる
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
            
            // 代替ダウンロード方法を試みる
            downloadWithContentScript(download.url, download.filename)
              .then(success => {
                if (!success && download.attempts < RETRY_ATTEMPTS - 1) {
                  // 再試行
                  logDebug(`ダウンロードを再試行します: ${download.filename} (${download.attempts + 1}/${RETRY_ATTEMPTS})`);
                  download.attempts++;
                  downloadQueue.unshift(download);
                } else if (!success) {
                  failureCount++;
                  logDebug(`最大試行回数に達しました: ${download.filename}`);
                }
                
                // アクティブダウンロード数を減らす
                activeDownloads--;
                
                // 次のダウンロードを処理
                setTimeout(() => {
                  processDownloadQueue();
                }, DOWNLOAD_DELAY * 2);
              });
          }
        }
      });
    }).catch(error => {
      logDebug(`ダウンロードエラー: ${download.filename}`, error);
      
      // 代替ダウンロード方法を試みる
      downloadWithContentScript(download.url, download.filename)
        .then(success => {
          if (!success && download.attempts < RETRY_ATTEMPTS - 1) {
            // 再試行
            logDebug(`ダウンロードを再試行します: ${download.filename} (${download.attempts + 1}/${RETRY_ATTEMPTS})`);
            download.attempts++;
            downloadQueue.unshift(download);
          } else if (!success) {
            failureCount++;
            logDebug(`最大試行回数に達しました: ${download.filename}`);
          }
          
          // アクティブダウンロード数を減らす
          activeDownloads--;
          
          // エラーが発生した場合、より長い遅延を設けて次のダウンロードを処理
          setTimeout(() => {
            processDownloadQueue();
          }, DOWNLOAD_DELAY * 2);
        });
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