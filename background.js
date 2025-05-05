/**
 * メルカリ商品画像ダウンローダー
 * バックグラウンドスクリプト
 */

// ダウンロードキューと同時ダウンロード数の制限
const downloadQueue = [];
const MAX_CONCURRENT_DOWNLOADS = 3; // 同時ダウンロード数を3に減らす
const DOWNLOAD_DELAY = 1000; // ダウンロード間に1秒の遅延を追加
let activeDownloads = 0;

// メッセージリスナーを設定
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadImage') {
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
    return;
  }
  
  // キューが空なら処理しない
  if (downloadQueue.length === 0) {
    return;
  }
  
  // キューから次のダウンロードを取得
  const download = downloadQueue.shift();
  activeDownloads++;
  
  // 遅延を追加してからダウンロードを実行
  setTimeout(() => {
    // ダウンロードを開始
    browser.downloads.download({
      url: download.url,
      filename: download.filename,
      conflictAction: 'uniquify'
    }).then(downloadId => {
      // ダウンロード完了リスナーを設定
      const listener = browser.downloads.onChanged.addListener(delta => {
        if (delta.id === downloadId && (delta.state?.current === 'complete' || delta.state?.current === 'interrupted')) {
          // リスナーを削除
          browser.downloads.onChanged.removeListener(listener);
          
          // アクティブダウンロード数を減らす
          activeDownloads--;
          
          // 少し待ってから次のダウンロードを処理
          setTimeout(() => {
            processDownloadQueue();
          }, DOWNLOAD_DELAY);
        }
      });
    }).catch(error => {
      console.error('ダウンロードエラー:', error);
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
  console.log('メルカリ商品画像ダウンローダーがインストールされました', details);
});