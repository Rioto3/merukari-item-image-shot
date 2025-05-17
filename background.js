/**
 * メルカリ商品画像ダウンローダー
 * バックグラウンドスクリプト
 */

// ダウンロードキューと同時ダウンロード数の制限
const downloadQueue = [];
const MAX_CONCURRENT_DOWNLOADS = 1;
const DOWNLOAD_DELAY = 5000; // 5秒に延長
const RETRY_ATTEMPTS = 3;
let activeDownloads = 0;

// デバッグログ
const DEBUG = true;
function logDebug(...args) {
  if (DEBUG) console.log('[メルカリ画像ダウンローダー]', ...args);
}

// 成功 / 失敗カウンター
let successCount = 0;
let failureCount = 0;

// 画像をフェッチして直接バイナリデータを取得する関数
async function fetchImageAsBinary(url) {
  logDebug(`画像をフェッチ中: ${url}`);
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit', // CORSの問題を回避
      cache: 'no-cache',
      headers: {
        'Accept': 'image/*'
      }
    });
    
    if (!response.ok) {
      throw new Error(`画像の取得に失敗しました: ${response.status}`);
    }
    
    const blob = await response.blob();
    return blob;
  } catch (error) {
    logDebug(`画像のフェッチエラー: ${error.message}`);
    throw error;
  }
}

// メッセージリスナーを設定
browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  // 画像ダウンロード要求
  if (message.action === 'downloadImage') {
    logDebug('ダウンロード要求を受信:', message.url);
    
    try {
      // 画像をバックグラウンドでフェッチ
      const imageBlob = await fetchImageAsBinary(message.url);
      
      // Blob URLを作成
      const objectUrl = URL.createObjectURL(imageBlob);
      
      // ダウンロードを試行
      const downloadId = await browser.downloads.download({
        url: objectUrl,
        filename: message.filename,
        conflictAction: 'uniquify',
        saveAs: false
      });
      
      logDebug(`ダウンロードID: ${downloadId} を開始`);
      
      // ダウンロード完了を追跡して結果を返す
      browser.downloads.onChanged.addListener(function listener(delta) {
        if (delta.id === downloadId && delta.state) {
          if (delta.state.current === 'complete') {
            logDebug(`ダウンロード完了: ${message.filename}`);
            browser.downloads.onChanged.removeListener(listener);
            URL.revokeObjectURL(objectUrl);
            successCount++;
            
            // 成功を通知
            browser.tabs.sendMessage(sender.tab.id, {
              action: 'downloadComplete',
              success: true,
              filename: message.filename
            });
          } 
          else if (delta.state.current === 'interrupted') {
            logDebug(`ダウンロード中断: ${message.filename}`);
            browser.downloads.onChanged.removeListener(listener);
            URL.revokeObjectURL(objectUrl);
            failureCount++;
            
            // 失敗を通知
            browser.tabs.sendMessage(sender.tab.id, {
              action: 'downloadComplete',
              success: false,
              filename: message.filename,
              error: delta.error?.current || '不明なエラー'
            });
          }
        }
      });
    } catch (error) {
      logDebug(`ダウンロード処理エラー: ${error.message}`);
      // エラーを通知
      browser.tabs.sendMessage(sender.tab.id, {
        action: 'downloadComplete',
        success: false,
        filename: message.filename,
        error: error.message
      });
    }
    
    // 非同期処理を続行するため true を返す
    return true;
  }
  
  // 直接ダウンロードの要求（URLから直接ダウンロード）
  if (message.action === 'directDownload') {
    logDebug('一括ダウンロード要求を受信');
    
    // タブIDを保存
    const tabId = sender.tab.id;
    
    // 画像URLのリスト
    const { urls, itemId, folderName } = message;
    
    // フォルダ名をログに出力（デバッグ用）
    logDebug(`保存先フォルダ名: ${folderName || itemId}`);
    
    // 順番にダウンロード
    for (let i = 0; i < urls.length; i++) {
      try {
        // 進捗を通知
        browser.tabs.sendMessage(tabId, {
          action: 'downloadProgress',
          current: i + 1,
          total: urls.length
        });
        
        // 画像をフェッチ
        const imageBlob = await fetchImageAsBinary(urls[i]);
        
        // Blob URLを作成
        const objectUrl = URL.createObjectURL(imageBlob);
        
        // 保存用フォルダ名を設定（指定がなければitemId）
        const saveFolder = folderName || itemId;
        
        // ファイル名を設定
        const filename = `${saveFolder}/${itemId}_${i + 1}.jpg`;
        
        // ダウンロード
        await new Promise((resolve, reject) => {
          browser.downloads.download({
            url: objectUrl,
            filename: filename,
            conflictAction: 'uniquify',
            saveAs: false
          }).then(downloadId => {
            const listener = delta => {
              if (delta.id === downloadId && delta.state) {
                if (delta.state.current === 'complete') {
                  browser.downloads.onChanged.removeListener(listener);
                  URL.revokeObjectURL(objectUrl);
                  resolve();
                } else if (delta.state.current === 'interrupted') {
                  browser.downloads.onChanged.removeListener(listener);
                  URL.revokeObjectURL(objectUrl);
                  reject(new Error(`ダウンロード中断: ${delta.error?.current || '不明なエラー'}`));
                }
              }
            };
            
            browser.downloads.onChanged.addListener(listener);
          }).catch(reject);
        });
        
        // 遅延を入れる
        await new Promise(resolve => setTimeout(resolve, DOWNLOAD_DELAY));
        
      } catch (error) {
        logDebug(`画像 ${i + 1} のダウンロードエラー: ${error.message}`);
        // エラーを通知するが処理は続行
        browser.tabs.sendMessage(tabId, {
          action: 'downloadError',
          index: i,
          error: error.message
        });
        
        // より長い遅延を入れる
        await new Promise(resolve => setTimeout(resolve, DOWNLOAD_DELAY * 2));
      }
    }
    
    // 完了を通知
    browser.tabs.sendMessage(tabId, {
      action: 'allDownloadsComplete',
      success: true
    });
    
    return true;
  }
});

// アドオンのインストール/更新時に実行
browser.runtime.onInstalled.addListener(details => {
  logDebug('メルカリ商品画像ダウンローダーがインストールされました', details);
  // カウンターリセット
  successCount = 0;
  failureCount = 0;
});